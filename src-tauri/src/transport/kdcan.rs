//! K+DCAN USB cable transport.
//!
//! The cable is a dumb FTDI serial bridge wired to OBD pin 7 (K-line) and
//! pins 6/14 (D-CAN). The PC speaks BMW-flavoured KWP2000 frames directly:
//!
//!   [FMT] [TGT] [SRC] [payload...] [CS]
//!
//! FMT = 0x80 | payload_len (for len <= 0x3F), or 0x80 with an extra length
//! byte for longer payloads. SRC is the tester address 0xF1. CS is the
//! 8-bit sum of all preceding bytes.
//!
//! D-CAN cars (E9x and later E-series, ~2007+): 115200 baud, 8N1 (BMW-FAST).
//! K-line cars (pre-2007): 10400 baud, 8N1 (ISO 14230), with fast-init.
//! (8E1 belongs to the older DS2 protocol at 9600 baud — not used here.)
//!
//! The cable echoes every transmitted byte (K-line loopback), so we read
//! back and discard our own frame before reading the response.

use super::{Result, Transport, TransportError};
use std::io::{Read, Write};
use std::time::{Duration, Instant};

const TESTER: u8 = 0xF1;

pub struct KdcanTransport {
    port: Box<dyn serialport::SerialPort>,
    dcan: bool,
    /// K-line only: ECU addresses with an established KWP session.
    /// An ECU drops off this list when it times out (session lost).
    kline_ready: std::collections::HashSet<u8>,
}

/// Sleep with sub-millisecond accuracy: coarse sleep, then spin. Plain
/// `thread::sleep` can overshoot by ~15 ms on Windows, which blows the
/// ISO 14230 fast-init 25 ms timing.
fn precise_sleep(d: Duration) {
    let end = Instant::now() + d;
    if d > Duration::from_millis(5) {
        std::thread::sleep(d - Duration::from_millis(5));
    }
    while Instant::now() < end {
        std::hint::spin_loop();
    }
}

impl KdcanTransport {
    pub fn open(port_name: &str, dcan: bool) -> Result<Self> {
        let baud = if dcan { 115_200 } else { 10_400 };
        let port = serialport::new(port_name, baud)
            .data_bits(serialport::DataBits::Eight)
            .parity(serialport::Parity::None)
            .stop_bits(serialport::StopBits::One)
            .timeout(Duration::from_millis(100))
            .open()
            .map_err(|e| TransportError::Io(format!("open {port_name}: {e}")))?;
        Ok(Self { port, dcan, kline_ready: Default::default() })
    }

    /// Auto-detect D-CAN vs K-line by trying 115200 baud first, then falling
    /// back to 10400 baud with fast-init.
    pub fn auto_detect(port_name: &str) -> Result<Self> {
        // Try D-CAN first (most common for E9x and later).
        if let Ok(mut t) = Self::open(port_name, true) {
            let frame = Self::build_frame(0x12, &[0x3E, 0x00]);
            let _ = t.port.clear(serialport::ClearBuffer::Input);
            if t.port.write_all(&frame).is_ok() {
                let _ = t.port.flush();
                let deadline = Instant::now() + Duration::from_millis(600);
                let mut echo = vec![0u8; frame.len()];
                if t.read_exact_timeout(&mut echo, deadline).is_ok() && echo == frame {
                    if let Ok(resp) = t.read_frame(deadline) {
                        if resp.first() == Some(&0x7E) {
                            return Ok(t);
                        }
                    }
                }
            }
            // D-CAN port opened but no response — drop it before retrying K-line.
        }
        // Fall back to K-line.
        Self::open(port_name, false)
    }

    /// ISO 14230-2 fast init: wake the ECU with a 25 ms low / 25 ms high
    /// pulse on the K-line, then open a KWP session with StartCommunication
    /// (0x81). Required once per ECU on pre-2007 K-line cars; D-CAN needs
    /// no init.
    fn fast_init(&mut self, target: u8) -> Result<()> {
        // W5: bus must be idle before the wake-up pattern.
        std::thread::sleep(Duration::from_millis(300));

        // 25 ms low (break asserts a space on TX), 25 ms high.
        self.port
            .set_break()
            .map_err(|e| TransportError::Io(format!("set_break: {e}")))?;
        precise_sleep(Duration::from_millis(25));
        self.port
            .clear_break()
            .map_err(|e| TransportError::Io(format!("clear_break: {e}")))?;
        precise_sleep(Duration::from_millis(25));

        // The break shows up in our own RX as a framing-error 0x00 — drop it.
        let _ = self.port.clear(serialport::ClearBuffer::Input);

        // StartCommunication request, expect positive response 0xC1 + key bytes.
        let frame = Self::build_frame(target, &[0x81]);
        self.port
            .write_all(&frame)
            .map_err(|e| TransportError::Io(e.to_string()))?;
        let _ = self.port.flush();

        let deadline = Instant::now() + Duration::from_millis(500);
        let mut echo = vec![0u8; frame.len()];
        self.read_exact_timeout(&mut echo, deadline)?;
        let resp = self.read_frame(deadline)?;
        match resp.first() {
            Some(0xC1) => Ok(()),
            _ => Err(TransportError::BadFrame(format!("fast_init: expected 0xC1, got {resp:?}"))),
        }
    }

    fn build_frame(target: u8, payload: &[u8]) -> Vec<u8> {
        let len = (payload.len() + 3) as u8;
        let mut frame = vec![len, target, TESTER];
        frame.extend_from_slice(payload);
        let sum: u8 = frame.iter().fold(0, |a, &b| a.wrapping_add(b));
        frame.push(sum);
        frame
    }

    fn read_frame(&mut self, deadline: Instant) -> Result<Vec<u8>> {
        let mut buf = vec![0u8; 256];
        let mut pos = 0;
        while Instant::now() < deadline {
            match self.port.read(&mut buf[pos..pos+1]) {
                Ok(0) => return Err(TransportError::Io("eof".into())),
                Ok(n) => {
                    pos += n;
                    if pos >= 3 && pos >= buf[0] as usize + 1 { break; }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
                Err(e) => return Err(TransportError::Io(e.to_string())),
            }
        }
        Ok(buf[..pos].to_vec())
    }

    fn read_exact_timeout(&mut self, buf: &mut [u8], deadline: Instant) -> Result<()> {
        let mut pos = 0;
        while pos < buf.len() && Instant::now() < deadline {
            match self.port.read(&mut buf[pos..]) {
                Ok(0) => return Err(TransportError::Io("eof".into())),
                Ok(n) => pos += n,
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
                Err(e) => return Err(TransportError::Io(e.to_string())),
            }
        }
        if pos < buf.len() { Err(TransportError::Timeout) } else { Ok(()) }
    }

    fn ensure_session(&mut self, target: u8) -> Result<()> {
        if !self.dcan && !self.kline_ready.contains(&target) {
            self.fast_init(target)?;
            self.kline_ready.insert(target);
        }
        Ok(())
    }
}

impl Transport for KdcanTransport {
    fn name(&self) -> &'static str { "K+DCAN" }

    fn request(&mut self, target: u8, payload: &[u8]) -> Result<Vec<u8>> {
        self.ensure_session(target)?;
        let frame = Self::build_frame(target, payload);
        self.port.write_all(&frame).map_err(|e| TransportError::Io(e.to_string()))?;
        let _ = self.port.flush();
        let deadline = Instant::now() + Duration::from_millis(1000);
        let mut echo = vec![0u8; frame.len()];
        self.read_exact_timeout(&mut echo, deadline)?;
        let resp = self.read_frame(deadline)?;
        if resp.len() < 3 { return Err(TransportError::BadFrame("short".into())); }
        Ok(resp[3..resp.len()-1].to_vec())
    }

    fn disconnect(&mut self) {}
}
