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
//!
//! ISO-TP note (issue #88): the ZGW terminates the CAN-side ISO 15765-2
//! segmentation — every HSFZ message already carries a complete,
//! reassembled diagnostic payload (u32 length field). No FF/CF/FC machinery
//! is needed here; it lives in `transport::isotp` for raw CAN-class
//! transports.
//!
//! Rejection handling (issue #248, real-car F36/N55 report): the gateway
//! answers a request it will *not* route with a rejection control word
//! (0x0040..0x0045, 0x00FF) rather than a diagnostic message. Those frames
//! used to fall into the same `continue` as keep-alive traffic and were
//! discarded, so a refused request surfaced only as a generic 3 s
//! `TransportError::Timeout` with no reason — the reporter's "0 control
//! units found" on a car that answered ping and TCP 6801 fine.
//!
//! This module now names rejections (`TransportError::Rejected`) and, when a
//! read times out after the gateway sent *only* control words it ignores,
//! says which ones it saw. The change is deliberately one-directional: it
//! never alters a success path and never changes what is written to the
//! socket, so a session that works today cannot start failing because of it.

use super::{Result, Transport, TransportError};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

/// Tester (diagnostic tool) address we present to the gateway.
const TESTER: u8 = 0xF4;
const CTRL_DIAG: u16 = 0x0001;
const CTRL_ACK: u16 = 0x0002;
/// Gateway keep-alive. Benign; expected interleaved with a live session.
const CTRL_ALIVE_CHECK: u16 = 0x0012;

/// ZGW rejection control words (HSFZ). Each tells the user which knob to
/// turn, which is the whole point of surfacing them.
const CTRL_ERR_TESTER_ADDR: u16 = 0x0040;
const CTRL_ERR_CONTROL_WORD: u16 = 0x0041;
const CTRL_ERR_FORMAT: u16 = 0x0042;
const CTRL_ERR_DEST_ADDR: u16 = 0x0043;
const CTRL_ERR_TOO_LARGE: u16 = 0x0044;
const CTRL_ERR_NOT_READY: u16 = 0x0045;
const CTRL_ERR_OOM: u16 = 0x00FF;

/// Production read timeout for one HSFZ frame.
const DEFAULT_READ_TIMEOUT: Duration = Duration::from_millis(3000);

/// Human-readable reason for a gateway rejection control word, or `None`
/// when the control word is not a rejection.
fn zgw_rejection_reason(ctrl: u16) -> Option<&'static str> {
    Some(match ctrl {
        CTRL_ERR_TESTER_ADDR => "incorrect tester address (this gateway refuses 0xF4)",
        CTRL_ERR_CONTROL_WORD => "unknown control word",
        CTRL_ERR_FORMAT => "malformed frame (check the HSFZ length field)",
        CTRL_ERR_DEST_ADDR => "destination ECU address not reachable on this car",
        CTRL_ERR_TOO_LARGE => "message too large for the gateway",
        CTRL_ERR_NOT_READY => "gateway not ready (retry once the car is awake)",
        CTRL_ERR_OOM => "gateway out of memory",
        _ => return None,
    })
}

/// "control word 0x0012 (keep-alive)" / "control words 0x0012 (keep-alive),
/// 0x0005" — used to explain a timeout that was not really silence.
fn describe_control_words(ctrls: &[u16]) -> String {
    let list = ctrls
        .iter()
        .map(|c| match *c {
            CTRL_ALIVE_CHECK => "0x0012 (keep-alive)".to_string(),
            // Reached when a diagnostic frame was too short to carry
            // src+tgt+payload: worth naming, because it means the gateway
            // answered and we could not use the answer.
            CTRL_DIAG => "0x0001 (diagnostic frame too short)".to_string(),
            other => format!("0x{other:04X}"),
        })
        .collect::<Vec<_>>()
        .join(", ");
    if ctrls.len() == 1 {
        format!("control word {list}")
    } else {
        format!("control words {list}")
    }
}

/* ---------------- DoIP discovery (ISO 13400-2, UDP 13400) ---------------- */

/// TCP port the ZGW speaks HSFZ on — what a discovered target connects to.
pub const HSFZ_PORT: u16 = 6801;
/// UDP port for DoIP vehicle identification / announcement.
pub const DOIP_PORT: u16 = 13400;
/// Limited broadcast — egresses every active interface on the single-NIC
/// laptops this app targets. Per-interface *directed* broadcasts would need
/// an interface-enumeration crate; deliberately not added for one edge case
/// (multi-homed machines can still type the IP manually).
pub const DOIP_BROADCAST: &str = "255.255.255.255:13400";
/// Vehicle-identification request is re-sent this many times: an F-series
/// gateway (ZGM) asleep for hours can miss the first broadcast (watchlist
/// note — the 12V-pulse / OBD-preframe wakeup is hardware, out of scope).
pub const DISCOVERY_ATTEMPTS: u32 = 3;
pub const DISCOVERY_RETRY: Duration = Duration::from_millis(250);
/// Response-collection window after the last request. Bounded: the whole
/// discovery takes ATTEMPTS*RETRY + WINDOW ≈ 2.5 s worst case.
pub const DISCOVERY_WINDOW: Duration = Duration::from_millis(2000);

const DOIP_HDR_LEN: usize = 8;
const PAYLOAD_VEHICLE_ANNOUNCEMENT: u16 = 0x0004;

/// One vehicle that answered DoIP discovery. `port` is the HSFZ diagnostic
/// port (6801), not the UDP source port, so the UI can connect directly.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DiscoveredTarget {
    pub vin: String,
    pub ip: String,
    pub port: u16,
    pub logical_address: u16,
}

/// Split one DoIP datagram into (payload type, payload). Returns None on
/// anything malformed — discovery must skip junk, never fail.
fn parse_doip_message(buf: &[u8]) -> Option<(u16, &[u8])> {
    if buf.len() < DOIP_HDR_LEN {
        return None;
    }
    // protocol version byte must be the bitwise inverse of the next byte
    if buf[0] ^ buf[1] != 0xFF {
        return None;
    }
    let payload_type = u16::from_be_bytes([buf[2], buf[3]]);
    let len = u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]) as usize;
    if buf.len() < DOIP_HDR_LEN + len {
        return None; // truncated datagram
    }
    Some((payload_type, &buf[DOIP_HDR_LEN..DOIP_HDR_LEN + len]))
}

/// Parse a vehicle announcement / identification response (0x0004):
/// VIN (17 bytes) + logical address (2). EID/GID/action bytes follow but
/// are not needed here. Non-alphanumeric VIN bytes become '?'.
fn parse_vehicle_announcement(buf: &[u8]) -> Option<(String, u16)> {
    let (ptype, payload) = parse_doip_message(buf)?;
    if ptype != PAYLOAD_VEHICLE_ANNOUNCEMENT || payload.len() < 19 {
        return None;
    }
    let vin: String = payload[..17]
        .iter()
        .map(|b| if b.is_ascii_alphanumeric() { *b as char } else { '?' })
        .collect();
    let logical = u16::from_be_bytes([payload[17], payload[18]]);
    Some((vin, logical))
}

/// Broadcast a DoIP vehicle-identification request to `dest` and collect
/// announcements for `window` after the last send. Zero responders is an
/// empty list, not an error; only socket setup / total send failure errors.
pub fn discover(dest: &str, window: Duration) -> Result<Vec<DiscoveredTarget>> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| TransportError::Io(format!("discovery bind: {e}")))?;
    sock.set_broadcast(true)
        .map_err(|e| TransportError::Io(format!("discovery broadcast: {e}")))?;
    // 02 FD = version/inverse pair, 0x0001 = vehicle identification request
    const REQUEST: [u8; DOIP_HDR_LEN] = [0x02, 0xFD, 0x00, 0x01, 0, 0, 0, 0];
    let mut sent = 0u32;
    for attempt in 0..DISCOVERY_ATTEMPTS {
        if sock.send_to(&REQUEST, dest).is_ok() {
            sent += 1;
        }
        if attempt + 1 < DISCOVERY_ATTEMPTS {
            std::thread::sleep(DISCOVERY_RETRY);
        }
    }
    if sent == 0 {
        return Err(TransportError::Io(format!(
            "discovery: could not send to {dest} (no usable network interface?)"
        )));
    }

    let deadline = Instant::now() + window;
    let mut found: Vec<DiscoveredTarget> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    loop {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        sock.set_read_timeout(Some(deadline - now)).ok();
        let mut buf = [0u8; 1024];
        match sock.recv_from(&mut buf) {
            Ok((n, src)) => {
                if let Some((vin, logical)) = parse_vehicle_announcement(&buf[..n]) {
                    let ip = src.ip().to_string();
                    if seen.insert((vin.clone(), ip.clone())) {
                        found.push(DiscoveredTarget {
                            vin,
                            ip,
                            port: HSFZ_PORT,
                            logical_address: logical,
                        });
                    }
                }
                // wrong payload type / malformed: skip, keep listening
            }
            // Windows reports ICMP port-unreachable as ConnectionReset on
            // UDP recv; a timeout just means the window elapsed. Both are
            // benign here — anything else is too.
            Err(_) => {
                if Instant::now() >= deadline {
                    break;
                }
            }
        }
    }
    Ok(found)
}

/// Resolve the `host:port` to connect to for an ENET session. With
/// `auto_discover`, broadcast first and prefer the discovered car; fall
/// back to the manually entered `addr`; error clearly when neither works.
pub fn resolve_addr(addr: &str, auto_discover: bool) -> Result<String> {
    if auto_discover {
        if let Some(first) = discover(DOIP_BROADCAST, DISCOVERY_WINDOW)?.first() {
            return Ok(format!("{}:{}", first.ip, first.port));
        }
        if addr.trim().is_empty() {
            return Err(TransportError::Io(
                "DoIP discovery found no vehicle. F-series cars do not answer \
                 DoIP discovery (UDP 13400) — they speak HSFZ on TCP 6801 \
                 only — so enter the car's IP manually (typically 169.254.x.x)"
                    .into(),
            ));
        }
    }
    if addr.trim().is_empty() {
        return Err(TransportError::Io(
            "No ENET address entered — type the car's IP or click Discover".into(),
        ));
    }
    Ok(addr.trim().to_string())
}

pub struct EnetTransport {
    stream: TcpStream,
    read_timeout: Duration,
}

impl EnetTransport {
    pub fn open(addr: &str) -> Result<Self> {
        Self::open_with(addr, DEFAULT_READ_TIMEOUT)
    }

    /// Connect with an explicit per-frame read timeout. Split out from
    /// `open` so tests can drive a scripted gateway without waiting out the
    /// production deadline.
    fn open_with(addr: &str, read_timeout: Duration) -> Result<Self> {
        let stream = TcpStream::connect(addr)
            .map_err(|e| TransportError::Io(format!("connect {addr}: {e}")))?;
        stream
            .set_read_timeout(Some(read_timeout))
            .map_err(|e| TransportError::Io(e.to_string()))?;
        stream.set_nodelay(true).ok();
        Ok(Self {
            stream,
            read_timeout,
        })
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
        msg.push(self.tester);
        msg.push(target);
        msg.extend_from_slice(payload);
        self.stream
            .write_all(&msg)
            .map_err(|e| TransportError::Io(e.to_string()))?;

        // Control words the gateway sent that are neither a rejection nor a
        // diagnostic message (keep-alives, status) — skipped as before, but
        // remembered so a timeout can explain itself instead of reporting
        // silence the car never produced.
        let mut ignored: Vec<u16> = Vec::new();
        loop {
            let (ctrl, data) = match self.read_msg() {
                Ok(msg) => msg,
                Err(TransportError::Timeout) if !ignored.is_empty() => {
                    return Err(TransportError::Rejected(format!(
                        "no diagnostic answer within {} ms; gateway sent only {}",
                        self.read_timeout.as_millis(),
                        describe_control_words(&ignored),
                    )));
                }
                Err(e) => return Err(e),
            };
            if let Some(reason) = zgw_rejection_reason(ctrl) {
                return Err(TransportError::Rejected(format!(
                    "target 0x{target:02X}: {reason} (control 0x{ctrl:04X})"
                )));
            }
            if ctrl == CTRL_ACK {
                continue; // gateway ack of our own message
            }
            if ctrl >= CTRL_ERR_INCORRECT_TESTER_ADDRESS
                && (ctrl <= CTRL_ERR_DIAG_APP_NOT_READY || ctrl == CTRL_ERR_OUT_OF_MEMORY)
            {
                return Err(TransportError::GatewayRejected(describe_error_word(ctrl, &data)));
            }
            if ctrl != CTRL_DIAG || data.len() < 3 {
                if !ignored.contains(&ctrl) {
                    ignored.push(ctrl);
                }
                continue;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::UdpSocket;

    const TEST_VIN: &[u8; 17] = b"WBA8E9G51GNU12345";

    /// Build a well-formed DoIP datagram of the given payload type.
    fn doip_packet(payload_type: u16, payload: &[u8]) -> Vec<u8> {
        let mut p = vec![0x02, 0xFD];
        p.extend_from_slice(&payload_type.to_be_bytes());
        p.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        p.extend_from_slice(payload);
        p
    }

    fn announcement() -> Vec<u8> {
        let mut payload = TEST_VIN.to_vec();
        payload.extend_from_slice(&0x0E26u16.to_be_bytes()); // logical address
        payload.extend_from_slice(&[0xAA; 6]); // EID
        payload.extend_from_slice(&[0xBB; 6]); // GID
        payload.push(0x00); // no further action
        doip_packet(PAYLOAD_VEHICLE_ANNOUNCEMENT, &payload)
    }

    #[test]
    fn parses_valid_announcement() {
        let (vin, logical) = parse_vehicle_announcement(&announcement()).expect("must parse");
        assert_eq!(vin, "WBA8E9G51GNU12345");
        assert_eq!(logical, 0x0E26);
    }

    #[test]
    fn skips_truncated_datagram() {
        let pkt = announcement();
        assert!(parse_vehicle_announcement(&pkt[..20]).is_none()); // mid-payload
        assert!(parse_vehicle_announcement(&pkt[..5]).is_none()); // mid-header
    }

    #[test]
    fn skips_wrong_payload_type() {
        let mut payload = TEST_VIN.to_vec();
        payload.extend_from_slice(&[0; 15]);
        let pkt = doip_packet(0x0006, &payload); // routing activation response
        assert!(parse_vehicle_announcement(&pkt).is_none());
    }

    #[test]
    fn skips_bad_version_pair_and_short_payload() {
        let mut pkt = announcement();
        pkt[1] = 0x00; // inverse byte no longer complements version
        assert!(parse_vehicle_announcement(&pkt).is_none());
        // header claims 32-byte payload but only 17 (VIN, no logical addr)
        let pkt = doip_packet(PAYLOAD_VEHICLE_ANNOUNCEMENT, TEST_VIN);
        assert!(parse_vehicle_announcement(&pkt).is_none());
    }

    #[test]
    fn skips_declared_length_mismatch() {
        let mut pkt = announcement();
        pkt[7] = 0xFF; // declared length far beyond buffer
        assert!(parse_vehicle_announcement(&pkt).is_none());
    }

    /// Scripted-UDP integration: a loopback responder answers the request
    /// with a canned announcement (twice — dedupe must collapse it), and
    /// discovery must return exactly one target within its window.
    #[test]
    fn discovers_loopback_responder() {
        let responder = UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = responder.local_addr().unwrap().port();
        let reply = announcement();
        std::thread::spawn(move || {
            let mut buf = [0u8; 64];
            // answer up to ATTEMPTS requests, twice each (dedupe exercise)
            for _ in 0..DISCOVERY_ATTEMPTS {
                if let Ok((_, src)) = responder.recv_from(&mut buf) {
                    let _ = responder.send_to(&reply, src);
                    let _ = responder.send_to(&reply, src);
                }
            }
        });
        let dest = format!("127.0.0.1:{port}");
        let start = Instant::now();
        let found = discover(&dest, Duration::from_millis(800)).expect("discover");
        assert!(start.elapsed() < Duration::from_secs(4), "must not hang");
        assert_eq!(found.len(), 1, "duplicate responses must dedupe");
        assert_eq!(found[0].vin, "WBA8E9G51GNU12345");
        assert_eq!(found[0].ip, "127.0.0.1");
        assert_eq!(found[0].port, HSFZ_PORT);
        assert_eq!(found[0].logical_address, 0x0E26);
    }

    /// Zero responders: empty list, not an error, and no hang. (On Windows
    /// the ICMP port-unreachable surfaces as ConnectionReset on recv — the
    /// loop must tolerate it.)
    #[test]
    fn zero_responders_returns_empty() {
        // bind-then-drop to get a port nothing listens on
        let port = UdpSocket::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let dest = format!("127.0.0.1:{port}");
        let start = Instant::now();
        let found = discover(&dest, Duration::from_millis(400)).expect("discover");
        assert!(start.elapsed() < Duration::from_secs(3), "must not hang");
        assert!(found.is_empty());
    }

    #[test]
    fn resolve_addr_prefers_manual_when_not_auto() {
        let addr = resolve_addr("169.254.16.11:6801", false).unwrap();
        assert_eq!(addr, "169.254.16.11:6801");
    }

    #[test]
    fn resolve_addr_errors_when_empty_and_not_auto() {
        assert!(resolve_addr("", false).is_err());
    }

    /* -------- issue #248: a ZGW rejection must not look like silence -------- */

    /// Scripted HSFZ gateway on loopback: accepts one connection, drains the
    /// request frame, writes each `(ctrl, data)` reply in order, then holds
    /// the socket open for `hold` so the client sees quiet rather than EOF.
    fn scripted_gateway(replies: Vec<(u16, Vec<u8>)>, hold: Duration) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            // drain one request frame: [len u32 BE][ctrl u16 BE][data...]
            let mut hdr = [0u8; 6];
            if std::io::Read::read_exact(&mut stream, &mut hdr).is_err() {
                return;
            }
            let len = u32::from_be_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]) as usize;
            let mut body = vec![0u8; len];
            let _ = std::io::Read::read_exact(&mut stream, &mut body);
            for (ctrl, data) in replies {
                let mut frame = (data.len() as u32).to_be_bytes().to_vec();
                frame.extend_from_slice(&ctrl.to_be_bytes());
                frame.extend_from_slice(&data);
                if std::io::Write::write_all(&mut stream, &frame).is_err() {
                    return;
                }
                let _ = stream.flush();
            }
            std::thread::sleep(hold);
        });
        addr
    }

    /// A diagnostic reply body: [src, tgt, uds...] — the shape `request()`
    /// strips two bytes from.
    fn diag_body(uds: &[u8]) -> Vec<u8> {
        let mut v = vec![0x12, 0xF1];
        v.extend_from_slice(uds);
        v
    }

    /// Short read timeout so the timeout paths cost 300 ms, not 3 s.
    fn connect(addr: &str) -> EnetTransport {
        EnetTransport::open_with(addr, Duration::from_millis(300)).expect("connect")
    }

    #[test]
    fn every_documented_rejection_code_has_a_reason() {
        for ctrl in [
            CTRL_ERR_TESTER_ADDR,
            CTRL_ERR_CONTROL_WORD,
            CTRL_ERR_FORMAT,
            CTRL_ERR_DEST_ADDR,
            CTRL_ERR_TOO_LARGE,
            CTRL_ERR_NOT_READY,
            CTRL_ERR_OOM,
        ] {
            assert!(zgw_rejection_reason(ctrl).is_some(), "0x{ctrl:04X} unmapped");
        }
        // Non-rejections must stay unrecognised, or we would abort healthy
        // sessions over ordinary traffic.
        assert!(zgw_rejection_reason(CTRL_ALIVE_CHECK).is_none());
        assert!(zgw_rejection_reason(CTRL_ACK).is_none());
        assert!(zgw_rejection_reason(CTRL_DIAG).is_none());
        assert!(zgw_rejection_reason(0x9999).is_none());
    }

    /// The reporter's case (F36/N55): the gateway refuses the destination
    /// address. The error must name it immediately — not after the read
    /// timeout, and not as a generic Timeout.
    #[test]
    fn surfaces_zgw_destination_rejection_without_waiting_for_timeout() {
        let addr = scripted_gateway(vec![(CTRL_ERR_DEST_ADDR, vec![])], Duration::from_millis(600));
        let mut t = connect(&addr);
        let start = Instant::now();
        let err = t.request(0x12, &[0x22, 0xF1, 0x90]).expect_err("must fail");
        let elapsed = start.elapsed();
        assert!(
            elapsed < Duration::from_millis(200),
            "must fail fast, took {elapsed:?}"
        );
        assert!(matches!(err, TransportError::Rejected(_)), "got {err:?}");
        let msg = err.to_string();
        assert!(msg.contains("0x0043"), "must name the control word: {msg}");
        assert!(msg.contains("0x12"), "must name the target: {msg}");
        assert!(msg.contains("destination"), "must explain why: {msg}");
    }

    #[test]
    fn surfaces_tester_address_rejection() {
        let addr = scripted_gateway(vec![(CTRL_ERR_TESTER_ADDR, vec![])], Duration::from_millis(600));
        let mut t = connect(&addr);
        let err = t.request(0x12, &[0x22, 0xF1, 0x90]).expect_err("must fail");
        assert!(matches!(err, TransportError::Rejected(_)), "got {err:?}");
        let msg = err.to_string();
        assert!(msg.contains("0x0040"), "{msg}");
        assert!(msg.contains("tester address"), "{msg}");
    }

    /// A rejection arriving after the gateway's own ACK still surfaces.
    #[test]
    fn surfaces_rejection_sent_after_gateway_ack() {
        let addr = scripted_gateway(
            vec![(CTRL_ACK, vec![]), (CTRL_ERR_FORMAT, vec![])],
            Duration::from_millis(600),
        );
        let mut t = connect(&addr);
        let err = t.request(0x12, &[0x22, 0xF1, 0x90]).expect_err("must fail");
        assert!(matches!(err, TransportError::Rejected(_)), "got {err:?}");
        assert!(err.to_string().contains("0x0042"), "{err}");
    }

    /// Happy path pinned: ACK then a diagnostic reply still returns payload.
    #[test]
    fn ack_then_diagnostic_reply_returns_payload() {
        let addr = scripted_gateway(
            vec![
                (CTRL_ACK, vec![]),
                (CTRL_DIAG, diag_body(&[0x62, 0xF1, 0x90, b'W', b'B', b'A'])),
            ],
            Duration::from_millis(600),
        );
        let mut t = connect(&addr);
        let resp = t.request(0x12, &[0x22, 0xF1, 0x90]).expect("must succeed");
        assert_eq!(resp, vec![0x62, 0xF1, 0x90, b'W', b'B', b'A']);
    }

    /// UDS responsePending is still skipped and the follow-up reply returned.
    #[test]
    fn waits_through_uds_response_pending() {
        let addr = scripted_gateway(
            vec![
                (CTRL_DIAG, diag_body(&[0x7F, 0x22, 0x78])),
                (CTRL_DIAG, diag_body(&[0x62, 0xF1, 0x90, 0x00])),
            ],
            Duration::from_millis(600),
        );
        let mut t = connect(&addr);
        let resp = t.request(0x12, &[0x22, 0xF1, 0x90]).expect("must succeed");
        assert_eq!(resp, vec![0x62, 0xF1, 0x90, 0x00]);
    }

    /// A gateway that says nothing at all stays a plain timeout: we must not
    /// claim a rejection the car never sent.
    #[test]
    fn silent_gateway_stays_a_plain_timeout() {
        let addr = scripted_gateway(vec![], Duration::from_millis(600));
        let mut t = connect(&addr);
        let err = t.request(0x12, &[0x22, 0xF1, 0x90]).expect_err("must fail");
        assert!(matches!(err, TransportError::Timeout), "got {err:?}");
    }

    /// Keep-alive traffic then silence: the timeout must name what it saw,
    /// because "no answer" and "an answer we ignored" are different bugs.
    #[test]
    fn keepalive_only_then_timeout_names_the_control_word() {
        let addr = scripted_gateway(
            vec![(CTRL_ALIVE_CHECK, vec![]), (CTRL_ALIVE_CHECK, vec![])],
            Duration::from_millis(1500),
        );
        let mut t = connect(&addr);
        let err = t.request(0x12, &[0x22, 0xF1, 0x90]).expect_err("must fail");
        assert!(matches!(err, TransportError::Rejected(_)), "got {err:?}");
        let msg = err.to_string();
        assert!(msg.contains("0x0012"), "must name the keep-alive: {msg}");
        assert!(msg.contains("keep-alive"), "must label it: {msg}");
        assert!(msg.contains("300 ms"), "must state the deadline: {msg}");
    }

    /// A diagnostic frame too short to carry src+tgt+payload, then silence:
    /// the gateway *did* answer, and the user must be told that rather than
    /// shown a generic timeout.
    #[test]
    fn short_diagnostic_frame_is_named_not_silent() {
        let addr = scripted_gateway(vec![(CTRL_DIAG, vec![0x12])], Duration::from_millis(1500));
        let mut t = connect(&addr);
        let err = t.request(0x12, &[0x22, 0xF1, 0x90]).expect_err("must fail");
        assert!(matches!(err, TransportError::Rejected(_)), "got {err:?}");
        let msg = err.to_string();
        assert!(msg.contains("too short"), "must explain the frame: {msg}");
    }
}
