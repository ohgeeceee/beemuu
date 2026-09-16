//! Stand-in for the real `kdcan.rs` (K+DCAN serial transport).
//!
//! This change does not touch kdcan, and the real module needs the
//! `serialport` API surface (libudev backend) that can't be built here. This
//! provides only the two constructors `transport/mod.rs::open` calls, so the
//! rest of the module tree compiles and its tests run.
//!
//! The real kdcan.rs is still compiled by CI (`cargo test`) on every PR.

use super::{Result, Transport, TransportError};

pub struct KdcanTransport;

impl KdcanTransport {
    pub fn open(_port: &str, _dcan: bool) -> Result<Self> {
        Ok(Self)
    }

    pub fn auto_detect(_port: &str) -> Result<Self> {
        Ok(Self)
    }
}

impl Transport for KdcanTransport {
    fn name(&self) -> &'static str {
        "K+DCAN (harness stub)"
    }

    fn request(&mut self, _target: u8, _payload: &[u8]) -> Result<Vec<u8>> {
        Err(TransportError::NotConnected)
    }
}
