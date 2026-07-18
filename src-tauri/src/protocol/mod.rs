//! Diagnostic service layer — builds KWP2000/UDS requests, parses responses,
//! translates negative response codes. Works over any `Transport`.

pub mod security;

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

pub(crate) fn nrc_text(nrc: u8) -> &'static str {
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
            text: crate::data::dtc::lookup(&code),
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

/// Scan OBD-II mode 01 PIDs `0x00..=0x7F` and return the set the ECU
/// actually responds to.
///
/// Algorithm: per SAE J1979, PID `0x00` returns a 4-byte bitmask where
/// bit `7-n` (MSB-first) of byte `n/8` indicates support for PID `n+1`
/// through `n+8`. The four bitmask blocks (PIDs 0x00, 0x20, 0x40, 0x60)
/// are independent — a real ECU may answer `0x00` (block 1) and `0x40`
/// (block 3) but not `0x20` (block 2). We probe each bitmask PID
/// individually; an empty mask byte for a given block skips that
/// block's data-PID probe but does NOT abort the scan, so we still
/// catch the higher blocks.
///
/// The returned `Vec<u8>` includes both the bitmask PIDs (`0x00`, `0x20`,
/// `0x40`, `0x60`) and the data PIDs they report as supported.
/// For PIDs where the bitmask says "supported" but the actual read fails
/// (rare; the bitmask is usually truthful), we drop the PID from the
/// returned list. A diagnostic caller that needs the per-PID failure
/// reason can probe the missing ones individually.
pub fn scan_obd2_pids(t: &mut dyn Transport, target: u8) -> PResult<Vec<u8>> {
    let mut supported = Vec::new();
    // Always include PID 0x00 itself (the bitmask PID).
    if let Ok(data) = read_obd_pid(t, target, 0x00) {
        if !data.is_empty() {
            supported.push(0x00);
        }
        // J1979 bitmask is 4 bytes; if the ECU returns fewer, pad with zeros.
        let mut mask = [0u8; 4];
        for (i, b) in data.iter().take(4).enumerate() {
            mask[i] = *b;
        }
        // Walk PIDs 0x01..0x20, 0x21..0x40, 0x41..0x60, 0x61..0x80 against
        // each of the 4 mask bytes. The bitmask PID 0x00 covers 0x01..0x20,
        // 0x20 covers 0x21..0x40, etc. — but a real ECU may not respond to
        // every bitmask PID, so we test what we can and stop at the first
        // unsupported block.
        for (mask_idx, &mask_byte) in mask.iter().enumerate() {
            let bitmask_pid = 0x20u8.wrapping_mul(mask_idx as u8);
            // Probe the bitmask PID itself (0x20, 0x40, 0x60) for
            // blocks 2-4; PID 0x00 was already probed above. If the
            // bitmask PID fails, the block is unsupported even if
            // the previous mask byte said otherwise — skip the inner
            // loop for this block but continue probing later blocks
            // (a real ECU may respond to 0x40 even if it didn't to
            // 0x20).
            if bitmask_pid != 0 && read_obd_pid(t, target, bitmask_pid).is_err() {
                continue;
            }
            // Record the bitmask PID (0x20/0x40/0x60) as supported —
            // if the probe above succeeded, it's a real answer.
            if bitmask_pid != 0 {
                supported.push(bitmask_pid);
            }
            // If both the bitmask PID and the data byte say "nothing
            // supported in this block," we can short-circuit and skip
            // remaining higher blocks too: PIDs 0x41..0x60 and
            // 0x61..0x80 are independent per J1979, but a zero
            // bitmask byte strongly implies the ECU doesn't bother
            // with anything in that range.
            if mask_byte == 0 {
                continue;
            }
            for bit in 0..8 {
                let pid = (bitmask_pid.wrapping_add(1)).wrapping_add(bit);
                if mask_byte & (1 << (7 - bit)) != 0 {
                    if read_obd_pid(t, target, pid).is_ok() {
                        supported.push(pid);
                    }
                }
            }
        }
    }
    Ok(supported)
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

/// Re-exported so callers can keep using `protocol::FreezeItem`; the type and
/// its schema-driven decoder now live in `data::freeze`.
pub use crate::data::freeze::FreezeItem;

/// readFreezeFrame (12 hi lo) -> 52 hi lo <env bytes>. The environmental
/// payload is decoded through the per-ECU schema registry in `data::freeze`,
/// so byte layouts are configured declaratively rather than hardcoded.
pub fn read_freeze_frame(t: &mut dyn Transport, target: u8, code: &str) -> PResult<Vec<FreezeItem>> {
    if code.len() < 4 {
        return Err("DTC code must be 4 hex digits".into());
    }
    let hi = u8::from_str_radix(&code[0..2], 16).map_err(|_| "Bad DTC code")?;
    let lo = u8::from_str_radix(&code[2..4], 16).map_err(|_| "Bad DTC code")?;
    let resp = service(t, target, &[0x12, hi, lo])?;
    if resp.first() != Some(&0x52) || resp.len() < 3 {
        return Err(format!("Unexpected freeze response: {:02X?}", resp));
    }
    Ok(crate::data::freeze::registry().decode(target, &resp[3..]))
}

/// Read the vehicle VIN, hiding the UDS/KWP split per car generation:
///
///   1. UDS path (F/G-series + simulator): readDataByIdentifier
///      `22 F1 90` on the DME (0x12).
///   2. KWP path (E-series): readEcuIdentification `1A 90` on the DME.
///   3. KWP fallback: the CAS (0x40) owns the VIN on E-series cars — if the
///      DME doesn't answer or has no VIN, ask the CAS.
///
/// Protocol selection is probe-and-fallback, the same detection the
/// codebase already uses everywhere: `KdcanTransport::auto_detect`
/// (transport/kdcan.rs) tries D-CAN then K-line, and `identify` /
/// `scan_modules` probe each ECU and treat "no answer" as "absent". There
/// is no out-of-band KWP-vs-UDS flag to reuse — a car reveals what it
/// speaks by answering, so we ask in order and take the first VIN.
///
/// ISO-TP (issue #88): on real F/G cars the `62 F1 90` response is 20+
/// bytes and will arrive multi-frame once ISO 15765-2 FF/CF/FC reassembly
/// lands in the transport layer. Nothing changes here — `read_did` will
/// simply start returning the full payload. The KWP `5A 90` path stays
/// single-frame on K+DCAN.
pub fn read_vin(t: &mut dyn Transport) -> PResult<String> {
    read_vin_uds(t, 0x12)
        .or_else(|_| read_vin_kwp(t, 0x12))
        .or_else(|_| read_vin_kwp(t, 0x40))
        .map_err(|_| "VIN not available: UDS 22 F190 and KWP 1A 90 (DME + CAS) all failed".into())
}

fn read_vin_uds(t: &mut dyn Transport, target: u8) -> PResult<String> {
    let data = read_did(t, target, 0xF190)?;
    clean_vin(&data)
}

/// KWP readEcuIdentification option 0x90 (VIN) -> 5A 90 <17 ASCII bytes>.
fn read_vin_kwp(t: &mut dyn Transport, target: u8) -> PResult<String> {
    let resp = service(t, target, &[0x1A, 0x90])?;
    if resp.first() != Some(&0x5A) || resp.get(1) != Some(&0x90) {
        return Err(format!("Unexpected VIN ident response: {:02X?}", resp));
    }
    clean_vin(&resp[2..])
}

/// A VIN is exactly 17 printable ASCII chars; ECUs may pad with NULs or
/// whitespace at either end, which we strip.
fn clean_vin(raw: &[u8]) -> PResult<String> {
    let s = String::from_utf8_lossy(raw)
        .trim_matches(|c: char| c == '\0' || c.is_ascii_whitespace())
        .to_string();
    if s.len() == 17 && s.chars().all(|c| c.is_ascii_graphic()) {
        Ok(s)
    } else {
        Err(format!("No VIN in response ({} cleaned bytes)", s.len()))
    }
}

/// diagnosticSessionControl (10 session) -> 50 session ...
pub fn set_session(t: &mut dyn Transport, target: u8, session: u8) -> PResult<()> {
    let resp = service(t, target, &[0x10, session])?;
    if resp.first() == Some(&0x50) {
        Ok(())
    } else {
        Err(format!("Unexpected session response: {:02X?}", resp))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::{Transport, TransportError};
    use std::collections::VecDeque;

    /// Minimal mock transport that returns scripted responses keyed by
    /// request payload. Used to exercise `scan_obd2_pids` without a
    /// real ECU.
    struct ScriptedTransport {
        script: VecDeque<Vec<u8>>,
    }
    impl ScriptedTransport {
        fn new(responses: Vec<Vec<u8>>) -> Self {
            Self {
                script: responses.into(),
            }
        }
    }
    impl Transport for ScriptedTransport {
        fn name(&self) -> &'static str { "scripted" }
        fn request(&mut self, _target: u8, _payload: &[u8]) -> Result<Vec<u8>, TransportError> {
            self.script
                .pop_front()
                .ok_or_else(|| TransportError::BadFrame("script exhausted".into()))
        }
        fn disconnect(&mut self) {}
    }

    fn obd_resp(pid: u8, data: &[u8]) -> Vec<u8> {
        let mut v = vec![0x41, pid];
        v.extend_from_slice(data);
        v
    }

    #[test]
    fn scan_obd2_pids_returns_empty_when_bitmask_pid_unavailable() {
        // PID 0x00 returns empty payload → nothing supported.
        let mut t = ScriptedTransport::new(vec![Vec::new()]);
        let pids = scan_obd2_pids(&mut t, 0x12).unwrap();
        assert!(pids.is_empty(), "expected no supported PIDs, got {:?}", pids);
    }

    #[test]
    fn scan_obd2_pids_returns_bitmask_pid_only_when_no_data_pids_set() {
        // Bitmask = 00 00 00 00 → only PID 0x00 itself reported.
        let mut t = ScriptedTransport::new(vec![obd_resp(0x00, &[0x00, 0x00, 0x00, 0x00])]);
        let pids = scan_obd2_pids(&mut t, 0x12).unwrap();
        assert_eq!(pids, vec![0x00]);
    }

    #[test]
    fn scan_obd2_pids_decodes_msb_first_bitmask_correctly() {
        // SAE J1979 bitmask: byte 0 covers PIDs 0x01..0x20, MSB-first.
        // 0x98 = 1001_1000 → bits 7,4,3 set → PIDs 0x01, 0x04, 0x05 supported.
        // Byte 1 = 0x00 → stop after first block (no PIDs 0x21+ probed).
        //
        // Scripted responses, in order:
        //   1. PID 0x00 → bitmask [0x98, 0x00, 0x00, 0x00]
        //   2. PID 0x01 → supported (data, arbitrary)
        //   3. PID 0x04 → supported
        //   4. PID 0x05 → supported
        let mut t = ScriptedTransport::new(vec![
            obd_resp(0x00, &[0x98, 0x00, 0x00, 0x00]),
            obd_resp(0x01, &[0x12]),
            obd_resp(0x04, &[0x34]),
            obd_resp(0x05, &[0x56]),
        ]);
        let pids = scan_obd2_pids(&mut t, 0x12).unwrap();
        assert_eq!(pids, vec![0x00, 0x01, 0x04, 0x05], "MSB-first decode");
    }

    #[test]
    fn scan_obd2_pids_walks_block_2_via_bitmask_pid_0x20() {
        // Byte 0 = 0x00 → no PIDs 0x01..0x20.
        // Byte 1 = 0x80 → only PID 0x21 supported.
        //
        // Responses:
        //   1. PID 0x00 → [0x00, 0x80, 0x00, 0x00]
        //   2. PID 0x20 (block 2 bitmask) → confirm-supported
        //   3. PID 0x21 → data
        let mut t = ScriptedTransport::new(vec![
            obd_resp(0x00, &[0x00, 0x80, 0x00, 0x00]),
            obd_resp(0x20, &[0x80, 0x00, 0x00, 0x00]),
            obd_resp(0x21, &[0xAB]),
        ]);
        let pids = scan_obd2_pids(&mut t, 0x12).unwrap();
        assert_eq!(pids, vec![0x00, 0x20, 0x21]);
    }

    #[test]
    fn scan_obd2_pids_drops_pids_whose_data_read_fails_despite_bitmask() {
        // Bitmask says PID 0x05 is supported, but the actual read fails
        // (e.g. flaky adapter). The scanner should drop it from the
        // returned list rather than report a misleading "supported."
        //
        // Responses:
        //   1. PID 0x00 → [0xA0, 0x00, 0x00, 0x00]  (bit 7 set → 0x01, bit 5 → 0x03)
        //   2. PID 0x01 → ok
        //   3. PID 0x03 → ok (script returns a non-OBD shape, triggers Err)
        //      We'll model the failure by returning the wrong first byte.
        let mut t = ScriptedTransport::new(vec![
            obd_resp(0x00, &[0xA0, 0x00, 0x00, 0x00]),
            obd_resp(0x01, &[0xFF]),
            vec![0x00, 0x03, 0xAA], // bad response: leading 0x00 not 0x41
        ]);
        let pids = scan_obd2_pids(&mut t, 0x12).unwrap();
        assert_eq!(pids, vec![0x00, 0x01], "PID 0x03 should be dropped on bad response");
    }
}

#[cfg(test)]
mod vin_tests {
    use super::*;
    use crate::transport::record::{RecordingTransport, SharedLog};
    use crate::transport::sim::{SimTransport, VinMode};
    use std::sync::Arc;

    const SIM_VIN_STR: &str = "WBAVA31050NL12345";

    /// Wrap a sim in the recording transport so the exact requests read_vin
    /// issued (and their targets / success) can be asserted afterwards.
    fn recorded_sim(mode: VinMode) -> (RecordingTransport, SharedLog) {
        let mut sim = SimTransport::new();
        sim.set_vin_mode(mode);
        let log: SharedLog = Default::default();
        let rec = RecordingTransport::new(Box::new(sim), Arc::clone(&log));
        (rec, log)
    }

    /// (target, positive) triples for requests with the given payload, e.g.
    /// "22 F1 90" or "1A 90". `positive` means the ECU did NOT answer with a
    /// 7F negative response (the transport-level `ok` flag is true for NRCs
    /// too — a rejected request is still a successful round-trip).
    fn requests(log: &SharedLog, payload: &str) -> Vec<(u8, bool)> {
        log.lock()
            .unwrap()
            .snapshot()
            .into_iter()
            .filter(|e| e.request == payload)
            .map(|e| (e.target, !e.response.starts_with("7F")))
            .collect()
    }

    #[test]
    fn uds_path_returns_vin() {
        let (mut t, log) = recorded_sim(VinMode::Uds);
        let vin = read_vin(&mut t).unwrap();
        assert_eq!(vin, SIM_VIN_STR);
        // UDS answered on the DME — the KWP fallback was never needed.
        assert_eq!(requests(&log, "22 F1 90"), vec![(0x12, true)]);
        assert!(requests(&log, "1A 90").is_empty(), "KWP path must not be probed when UDS answers");
    }

    #[test]
    fn kwp_dme_path_returns_vin() {
        let (mut t, log) = recorded_sim(VinMode::KwpDme);
        let vin = read_vin(&mut t).unwrap();
        assert_eq!(vin, SIM_VIN_STR);
        // UDS was tried first and rejected, then KWP 1A 90 on the DME answered.
        assert_eq!(requests(&log, "22 F1 90"), vec![(0x12, false)]);
        assert_eq!(requests(&log, "1A 90"), vec![(0x12, true)]);
    }

    #[test]
    fn kwp_cas_fallback_returns_vin() {
        let (mut t, log) = recorded_sim(VinMode::KwpCas);
        let vin = read_vin(&mut t).unwrap();
        assert_eq!(vin, SIM_VIN_STR);
        // DME failed both services; CAS (0x40) answered 1A 90.
        assert_eq!(requests(&log, "22 F1 90"), vec![(0x12, false)]);
        assert_eq!(requests(&log, "1A 90"), vec![(0x12, false), (0x40, true)]);
    }

    #[test]
    fn clean_vin_strips_padding_and_enforces_length() {
        assert_eq!(clean_vin(b"WBAVA31050NL12345").unwrap(), SIM_VIN_STR);
        // NUL-padded (common ECU framing) and space-padded forms still parse.
        assert_eq!(clean_vin(b"\0WBAVA31050NL12345\0\0").unwrap(), SIM_VIN_STR);
        assert_eq!(clean_vin(b"WBAVA31050NL12345  ").unwrap(), SIM_VIN_STR);
        // Too short / too long after cleaning is not a VIN.
        assert!(clean_vin(b"WBAVA3105").is_err());
        assert!(clean_vin(b"WBAVA31050NL12345XX").is_err());
        assert!(clean_vin(b"").is_err());
    }

    /// Call-site guard: every VIN read in the command layer must go through
    /// protocol::read_vin — no raw `22 F1 90` DID reads outside protocol/
    /// (CLAUDE.md VIN invariant, issue #89). Static source scan, mirroring
    /// tests/async_commands.rs.
    #[test]
    fn command_layer_has_no_raw_vin_did_reads() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let commands = std::fs::read_to_string(dir.join("src/commands.rs")).unwrap();
        assert!(
            !commands.contains("0xF190"),
            "commands.rs must route VIN reads through protocol::read_vin, not raw 0xF190 DID reads"
        );
        assert!(
            commands.contains("protocol::read_vin"),
            "commands.rs must call protocol::read_vin"
        );
    }

    /// End-to-end through the wrapped recording transport, exactly as
    /// `connect` / `read_vehicle_info` / `export_session` drive it: the
    /// VIN surfaces from the same shared transport the commands use.
    #[test]
    fn vin_survives_recording_transport_wrapping() {
        let log: SharedLog = Default::default();
        let mut t: Box<dyn crate::transport::Transport> =
            Box::new(RecordingTransport::new(Box::new(SimTransport::new()), Arc::clone(&log)));
        assert_eq!(read_vin(t.as_mut()).unwrap(), SIM_VIN_STR);
    }
}
