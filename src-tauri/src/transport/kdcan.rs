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
