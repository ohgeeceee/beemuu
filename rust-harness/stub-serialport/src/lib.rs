//! Stand-in for the `serialport` crate.
//!
//! The real crate's default Linux backend needs libudev (pkg-config +
//! system package), which is not installable in this sandbox. This stub
//! provides only the surface `transport/mod.rs::list_serial_ports` uses.

pub struct SerialPortInfo {
    pub port_name: String,
}

#[derive(Debug)]
pub struct Error;

pub fn available_ports() -> Result<Vec<SerialPortInfo>, Error> {
    Ok(Vec::new())
}
