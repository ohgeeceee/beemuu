//! Transport layer — pluggable physical interfaces to the car.
//!
//! Every transport moves raw diagnostic payloads (KWP2000 or UDS service
//! bytes) to/from a target ECU address. Framing (KWP checksums, HSFZ
//! headers) is the transport's job; service-level logic lives in `protocol`.

pub mod kdcan;
pub mod enet;
pub mod record;
pub mod sim;

use std::fmt;

#[derive(Debug)]
pub enum TransportError {
    Io(String),
    Timeout,
    BadFrame(String),
    NotConnected,
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TransportError::Io(e) => write!(f, "I/O error: {e}"),
            TransportError::Timeout => write!(f, "Timeout waiting for ECU response"),
            TransportError::BadFrame(e) => write!(f, "Malformed frame: {e}"),
            TransportError::NotConnected => write!(f, "Not connected"),
        }
    }
}

impl std::error::Error for TransportError {}

pub type Result<T> = std::result::Result<T, TransportError>;

/// A connected diagnostic interface.
///
/// `request` sends one service payload to `target` (ECU address) and returns
/// the raw response payload (service bytes, framing stripped).
pub trait Transport: Send {
    fn name(&self) -> &'static str;
    fn request(&mut self, target: u8, payload: &[u8]) -> Result<Vec<u8>>;
    fn disconnect(&mut self) {}
}

/// Which physical interface to open.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TransportConfig {
    /// K+DCAN USB cable (FTDI COM port). `port` e.g. "COM3" or "/dev/ttyUSB0".
    Kdcan { port: String, dcan: bool },
    /// K+DCAN with auto-detect: tries D-CAN first, then K-line.
    KdcanAuto { port: String },
    /// ENET cable. `addr` e.g. "169.254.16.11:6801" (HSFZ port).
    Enet { addr: String },
    /// Built-in simulated E90 — no hardware required.
    Sim {},
}

/// Lets the app's shared `Arc<Mutex<Option<Box<dyn Transport>>>>` slot be
/// used directly as a `Transport` — needed so the Tester Present keep-alive
/// worker can hold the same lock as every command. `None` (not connected)
/// answers `NotConnected`, which tells the worker to stop itself.
impl Transport for Option<Box<dyn Transport>> {
    fn name(&self) -> &'static str {
        self.as_ref().map(|t| t.name()).unwrap_or("none")
    }
    fn request(&mut self, target: u8, payload: &[u8]) -> Result<Vec<u8>> {
        self.as_mut()
            .ok_or(TransportError::NotConnected)?
            .request(target, payload)
    }
    fn disconnect(&mut self) {
        if let Some(t) = self.as_mut() {
            t.disconnect();
        }
    }
}

pub fn open(config: &TransportConfig) -> Result<Box<dyn Transport>> {
    match config {
        TransportConfig::Kdcan { port, dcan } => {
            Ok(Box::new(kdcan::KdcanTransport::open(port, *dcan)?))
        }
        TransportConfig::KdcanAuto { port } => {
            Ok(Box::new(kdcan::KdcanTransport::auto_detect(port)?))
        }
        TransportConfig::Enet { addr } => Ok(Box::new(enet::EnetTransport::open(addr)?)),
        TransportConfig::Sim {} => Ok(Box::new(sim::SimTransport::new())),
    }
}

/// List available serial ports (for UI dropdown).
pub fn list_serial_ports() -> Vec<String> {
    serialport::available_ports()
        .map(|ports| ports.iter().map(|p| p.port_name.clone()).collect())
        .unwrap_or_default()
}