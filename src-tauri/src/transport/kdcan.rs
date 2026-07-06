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
            _ => Err(TransportError::BadFrame(format!(
                "StartCommunication to {target:02X} rejected: {resp:02X?}"
            ))),
        }
    }

    fn build_frame(target: u8, payload: &[u8]) -> Vec<u8> {
        let mut frame = Vec::with_capacity(payload.len() + 5);
        if payload.len() <= 0x3F {
            frame.push(0x80 | payload.len() as u8);
            frame.push(target);
            frame.push(TESTER);
        } else {
            frame.push(0x80);
            frame.push(target);
            frame.push(TESTER);
            frame.push(payload.len() as u8);
        }
        frame.extend_from_slice(payload);
        let cs = frame.iter().fold(0u8, |a, b| a.wrapping_add(*b));
        frame.push(cs);
        frame
    }

    /// Read exactly `n` bytes or time out.
    fn read_exact_timeout(&mut self, buf: &mut [u8], deadline: Instant) -> Result<()> {
        let mut filled = 0;
        while filled < buf.len() {
            if Instant::now() > deadline {
                return Err(TransportError::Timeout);
            }
            match self.port.read(&mut buf[filled..]) {
                Ok(0) => {}
                Ok(n) => filled += n,
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(e) => return Err(TransportError::Io(e.to_string())),
            }
        }
        Ok(())
    }

    /// Read one KWP frame (header + payload + checksum), return the payload.
    fn read_frame(&mut self, deadline: Instant) -> Result<Vec<u8>> {
        let mut hdr = [0u8; 3];
        self.read_exact_timeout(&mut hdr, deadline)?;
        let short_len = (hdr[0] & 0x3F) as usize;
        let (len, extra_len_byte) = if short_len > 0 {
            (short_len, false)
        } else {
            let mut lb = [0u8; 1];
            self.read_exact_timeout(&mut lb, deadline)?;
            (lb[0] as usize, true)
        };
        let mut rest = vec![0u8; len + 1]; // payload + checksum
        self.read_exact_timeout(&mut rest, deadline)?;

        // Verify checksum
        let mut sum = hdr.iter().fold(0u8, |a, b| a.wrapping_add(*b));
        if extra_len_byte {
            sum = sum.wrapping_add(len as u8);
        }
        for b in &rest[..len] {
            sum = sum.wrapping_add(*b);
        }
        if sum != rest[len] {
            return Err(TransportError::BadFrame(format!(
                "checksum mismatch (calc {sum:02X}, got {:02X})",
                rest[len]
            )));
        }
        rest.truncate(len);
        Ok(rest)
    }
}

impl Transport for KdcanTransport {
    fn name(&self) -> &'static str {
        if self.dcan { "K+DCAN (D-CAN)" } else { "K+DCAN (K-line)" }
    }

    fn request(&mut self, target: u8, payload: &[u8]) -> Result<Vec<u8>> {
        // K-line ECUs must be woken with fast-init before first contact.
        if !self.dcan && !self.kline_ready.contains(&target) {
            self.fast_init(target)?;
            self.kline_ready.insert(target);
        }

        match self.transact(target, payload) {
            // A timeout on K-line usually means the KWP session expired
            // (P3max idle). Re-init once and retry before giving up.
            Err(TransportError::Timeout) if !self.dcan => {
                self.kline_ready.remove(&target);
                self.fast_init(target)?;
                self.kline_ready.insert(target);
                self.transact(target, payload)
            }
            other => other,
        }
    }
}

impl KdcanTransport {
    /// One framed request/response exchange (no init logic).
    fn transact(&mut self, target: u8, payload: &[u8]) -> Result<Vec<u8>> {
        let frame = Self::build_frame(target, payload);

        // Flush stale bytes
        let _ = self.port.clear(serialport::ClearBuffer::Input);

        self.port
            .write_all(&frame)
            .map_err(|e| TransportError::Io(e.to_string()))?;
        let _ = self.port.flush();

        let deadline = Instant::now() + Duration::from_millis(2500);

        // Discard the loopback echo of our own frame. The echo is generated
        // by the cable itself (TX/RX share the K-line), so its absence means
        // the cable's line driver is dead — almost always missing vehicle 12V
        // on OBD pin 16 (e.g. bench testing with no car attached).
        let echo_deadline = Instant::now() + Duration::from_millis(300);
        let mut echo = vec![0u8; frame.len()];
        self.read_exact_timeout(&mut echo, echo_deadline)
            .map_err(|e| match e {
                TransportError::Timeout => TransportError::Io(
                    "no echo from cable — cable unpowered? (needs vehicle 12V \
                     on OBD pin 16; check ignition is on and cable is plugged \
                     into the car)"
                        .into(),
                ),
                other => other,
            })?;
        if echo != frame {
            return Err(TransportError::BadFrame(
                "echo mismatch — check baud/parity settings or bus contention".into(),
            ));
        }

        // ECUs may send 0x78 (responsePending) before the real answer
        loop {
            let resp = self.read_frame(deadline)?;
            if resp.len() >= 3 && resp[0] == 0x7F && resp[2] == 0x78 {
                continue; // busy — keep waiting
            }
            return Ok(resp);
        }
    }
}
