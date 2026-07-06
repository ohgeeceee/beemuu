//! Diagnostic service layer — builds KWP2000/UDS requests, parses responses,
//! translates negative response codes. Works over any `Transport`.

use crate::transport::{Transport, TransportError};
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct EcuInfo {
    pub address: u8,
    pub name: String,
    pub description: String,
    pub ident: Option<String>,
    pub present: bool,
    pub fault_count: Option<usize>,
}

#[derive(Debug, Serialize, Clone)]
pub struct Dtc {
    /// BMW-style hex code, e.g. "2A82"
    pub code: String,
    pub status: u8,
    pub status_text: String,
    pub text: String,
}

pub type PResult<T> = Result<T, String>;

fn nrc_text(nrc: u8) -> &'static str {
    match nrc {
        0x10 => "General reject",
        0x11 => "Service not supported",
        0x12 => "Sub-function not supported",
        0x13 => "Incorrect message length",
        0x21 => "Busy — repeat request",
        0x22 => "Conditions not correct",
        0x31 => "Request out of range",
        0x33 => "Security access denied",
        0x35 => "Invalid key",
        0x78 => "Response pending",
        _ => "Unknown negative response",
    }
}

/// Send a request; map negative responses (7F sid nrc) to readable errors.
fn service(t: &mut dyn Transport, target: u8, req: &[u8]) -> PResult<Vec<u8>> {
    let resp = t
        .request(target, req)
        .map_err(|e: TransportError| e.to_string())?;
    if resp.first() == Some(&0x7F) && resp.len() >= 3 {
        return Err(format!(
            "ECU rejected service {:02X}: {} (NRC {:02X})",
            resp[1],
            nrc_text(resp[2]),
            resp[2]
        ));
    }
    Ok(resp)
}

/// readEcuIdentification (KWP 1A 80). Returns the raw ident string.
pub fn identify(t: &mut dyn Transport, target: u8) -> PResult<String> {
    let resp = service(t, target, &[0x1A, 0x80])?;
    if resp.first() != Some(&0x5A) {
        return Err(format!("Unexpected ident response: {:02X?}", resp.first()));
    }
    let body = if resp.len() > 2 { &resp[2..] } else { &[] as &[u8] };
    Ok(body
        .iter()
        .map(|&b| if b.is_ascii_graphic() || b == b' ' { b as char } else { '.' })
        .collect())
}

fn dtc_status_text(status: u8) -> String {
    let mut parts = Vec::new();
    if status & 0x01 != 0 { parts.push("test failed"); }
    if status & 0x08 != 0 { parts.push("confirmed"); }
    if status & 0x20 != 0 { parts.push("stored"); }
    if status & 0x40 != 0 { parts.push("current"); }
    if parts.is_empty() { parts.push("logged"); }
    parts.join(", ")
}

/// Read stored faults. KWP: 18 02 FF FF -> 58 n [hi lo status]*
pub fn read_dtcs(t: &mut dyn Transport, target: u8) -> PResult<Vec<Dtc>> {
    let resp = service(t, target, &[0x18, 0x02, 0xFF, 0xFF])?;
    if resp.first() != Some(&0x58) || resp.len() < 2 {
        return Err(format!("Unexpected DTC response: {:02X?}", resp));
    }
    let count = resp[1] as usize;
    let mut dtcs = Vec::with_capacity(count);
    let mut i = 2;
    while i + 2 < resp.len() && dtcs.len() < count {
        let code = format!("{:02X}{:02X}", resp[i], resp[i + 1]);
        let status = resp[i + 2];
        dtcs.push(Dtc {
            text: crate::data::dtc::lookup(&code).to_string(),
            code,
            status,
            status_text: dtc_status_text(status),
        });
        i += 3;
    }
    Ok(dtcs)
}

/// Clear all faults. KWP: 14 FF FF -> 54
pub fn clear_dtcs(t: &mut dyn Transport, target: u8) -> PResult<()> {
    let resp = service(t, target, &[0x14, 0xFF, 0xFF])?;
    if resp.first() == Some(&0x54) {
        Ok(())
    } else {
        Err(format!("Unexpected clear response: {:02X?}", resp))
    }
}

/// readDataByIdentifier (22 <did>) -> raw data bytes.
pub fn read_did(t: &mut dyn Transport, target: u8, did: u16) -> PResult<Vec<u8>> {
    let d = did.to_be_bytes();
    let resp = service(t, target, &[0x22, d[0], d[1]])?;
    if resp.len() >= 3 && resp[0] == 0x62 && resp[1] == d[0] && resp[2] == d[1] {
        Ok(resp[3..].to_vec())
    } else {
        Err(format!("Unexpected DID response: {:02X?}", resp))
    }
}

/// OBD-II mode 01 (01 <pid>) -> data bytes after [41, pid].
pub fn read_obd_pid(t: &mut dyn Transport, target: u8, pid: u8) -> PResult<Vec<u8>> {
    let resp = service(t, target, &[0x01, pid])?;
    if resp.len() >= 2 && resp[0] == 0x41 && resp[1] == pid {
        Ok(resp[2..].to_vec())
    } else {
        Err(format!("Unexpected OBD response: {:02X?}", resp))
    }
}

/// KWP readDataByLocalIdentifier (21 <id>) -> data bytes after [61, id].
pub fn read_local_ident(t: &mut dyn Transport, target: u8, id: u8) -> PResult<Vec<u8>> {
    let resp = service(t, target, &[0x21, id])?;
    if resp.len() >= 2 && resp[0] == 0x61 && resp[1] == id {
        Ok(resp[2..].to_vec())
    } else {
        Err(format!("Unexpected local-ident response: {:02X?}", resp))
    }
}

/// routineControl (31 sub routine) — used for service functions.
pub fn routine(t: &mut dyn Transport, target: u8, sub: u8, rid: u16) -> PResult<Vec<u8>> {
    let r = rid.to_be_bytes();
    let resp = service(t, target, &[0x31, sub, r[0], r[1]])?;
    if resp.first() == Some(&0x71) {
        Ok(resp)
    } else {
        Err(format!("Unexpected routine response: {:02X?}", resp))
    }
}
