//! ENET cable transport (F/G-series) — UDS over HSFZ (High Speed Fahrzeug
//! Zugang), BMW's TCP framing on port 6801.
//!
//! HSFZ frame:
//!   [len: u32 BE] [ctrl: u16 BE] [data...]
//!   ctrl 0x0001 = diagnostic message; data = [src, tgt, uds bytes...]
//!   len counts data bytes only.
//!
//! The gateway (ZGW) answers with an ACK copy (ctrl 0x0002) of the request,
//! then the ECU response as another 0x0001 message.

use super::{Result, Transport, TransportError};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const TESTER: u8 = 0xF4;
const CTRL_DIAG: u16 = 0x0001;
const CTRL_ACK: u16 = 0x0002;

pub struct EnetTransport {
    stream: TcpStream,
}

impl EnetTransport {
    pub fn open(addr: &str) -> Result<Self> {
        let stream = TcpStream::connect(addr)
            .map_err(|e| TransportError::Io(format!("connect {addr}: {e}")))?;
        stream
            .set_read_timeout(Some(Duration::from_millis(3000)))
            .map_err(|e| TransportError::Io(e.to_string()))?;
        stream.set_nodelay(true).ok();
        Ok(Self { stream })
    }

    fn read_msg(&mut self) -> Result<(u16, Vec<u8>)> {
        let mut hdr = [0u8; 6];
        self.stream
            .read_exact(&mut hdr)
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => {
                    TransportError::Timeout
                }
                _ => TransportError::Io(e.to_string()),
            })?;
        let len = u32::from_be_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]) as usize;
        let ctrl = u16::from_be_bytes([hdr[4], hdr[5]]);
        if len > 0x0100_0000 {
            return Err(TransportError::BadFrame(format!("absurd length {len}")));
        }
        let mut data = vec![0u8; len];
        self.stream
            .read_exact(&mut data)
            .map_err(|e| TransportError::Io(e.to_string()))?;
        Ok((ctrl, data))
    }
}

impl Transport for EnetTransport {
    fn name(&self) -> &'static str {
        "ENET (HSFZ)"
    }

    fn request(&mut self, target: u8, payload: &[u8]) -> Result<Vec<u8>> {
        let data_len = payload.len() + 2;
        let mut msg = Vec::with_capacity(data_len + 6);
        msg.extend_from_slice(&(data_len as u32).to_be_bytes());
        msg.extend_from_slice(&CTRL_DIAG.to_be_bytes());
        msg.push(TESTER);
        msg.push(target);
        msg.extend_from_slice(payload);
        self.stream
            .write_all(&msg)
            .map_err(|e| TransportError::Io(e.to_string()))?;

        loop {
            let (ctrl, data) = self.read_msg()?;
            if ctrl == CTRL_ACK {
                continue; // gateway ack of our own message
            }
            if ctrl != CTRL_DIAG || data.len() < 3 {
                continue; // keep-alive or unrelated
            }
            let uds = &data[2..];
            // UDS responsePending (7F xx 78): keep waiting
            if uds.len() >= 3 && uds[0] == 0x7F && uds[2] == 0x78 {
                continue;
            }
            return Ok(uds.to_vec());
        }
    }
}
