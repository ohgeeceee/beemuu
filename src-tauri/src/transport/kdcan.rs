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
//! D-CAN cars (E9x and later E-series, ~2007+): 115200 baud, 8E1.
//! K-line cars (pre-2007): 10400 baud, 8E1, with fast-init.
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
}

impl KdcanTransport {
    pub fn open(port_name: &str, dcan: bool) -> Result<Self> {
        let baud = if dcan { 115_200 } else { 10_400 };
        let port = serialport::new(port_name, baud)
            .data_bits(serialport::DataBits::Eight)
            .parity(serialport::Parity::Even)
            .stop_bits(serialport::StopBits::One)
            .timeout(Duration::from_millis(100))
            .open()
            .map_err(|e| TransportError::Io(format!("open {port_name}: {e}")))?;
        Ok(Self { port, dcan })
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
        let frame = Self::build_frame(target, payload);

        // Flush stale bytes
        let _ = self.port.clear(serialport::ClearBuffer::Input);

        self.port
            .write_all(&frame)
            .map_err(|e| TransportError::Io(e.to_string()))?;
        let _ = self.port.flush();

        let deadline = Instant::now() + Duration::from_millis(2500);

        // Discard the loopback echo of our own frame
        let mut echo = vec![0u8; frame.len()];
        self.read_exact_timeout(&mut echo, deadline)?;

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
