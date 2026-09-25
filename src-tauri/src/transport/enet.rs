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

/// HSFZ error control words (Wireshark `packet-hsfz.c`, Scapy `hsfz.py`).
/// The gateway answers a diagnostic request with one of these instead of a
/// `0x0001` response when it refuses the message. Each carries a payload
/// that explains the refusal (see `describe_error_word`).
const CTRL_ERR_INCORRECT_TESTER_ADDRESS: u16 = 0x0040;
const CTRL_ERR_INCORRECT_CONTROL_WORD: u16 = 0x0041;
const CTRL_ERR_INCORRECT_FORMAT: u16 = 0x0042;
const CTRL_ERR_INCORRECT_DEST_ADDRESS: u16 = 0x0043;
const CTRL_ERR_MESSAGE_TOO_LARGE: u16 = 0x0044;
const CTRL_ERR_DIAG_APP_NOT_READY: u16 = 0x0045;
const CTRL_ERR_OUT_OF_MEMORY: u16 = 0x00FF;

/// Human wording for an HSFZ error control word, plus the payload bytes the
/// gateway sent. `incorrect_tester_address` (0x40) carries
/// `[expected, received]`; `incorrect_dest_address` (0x43) carries
/// `[source, target]`; the rest carry no addressing.
fn describe_error_word(ctrl: u16, data: &[u8]) -> String {
    let name = match ctrl {
        CTRL_ERR_INCORRECT_TESTER_ADDRESS => "incorrect tester address",
        CTRL_ERR_INCORRECT_CONTROL_WORD => "incorrect control word",
        CTRL_ERR_INCORRECT_FORMAT => "incorrect format",
        CTRL_ERR_INCORRECT_DEST_ADDRESS => "incorrect destination address",
        CTRL_ERR_MESSAGE_TOO_LARGE => "message too large",
        CTRL_ERR_DIAG_APP_NOT_READY => "diagnostic application not ready",
        CTRL_ERR_OUT_OF_MEMORY => "out of memory",
        _ => "unknown error",
    };
    let detail = match ctrl {
        CTRL_ERR_INCORRECT_TESTER_ADDRESS if data.len() >= 2 => {
            format!(" (expected tester 0x{:02X}, got 0x{:02X})", data[0], data[1])
        }
        CTRL_ERR_INCORRECT_DEST_ADDRESS if data.len() >= 2 => {
            format!(" (source 0x{:02X}, target 0x{:02X})", data[0], data[1])
        }
        _ => String::new(),
    };
    format!("HSFZ 0x{ctrl:04X} {name}{detail}")
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
    /// Tester address carried in the `src` byte of every frame we send.
    /// Starts at the standard value and steps to `0xF5` once if the gateway
    /// refuses `0xF4` (issue #248: some F-series ZGWs want the alternate).
    tester: u8,
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
        let mut transport = Self {
            stream,
            read_timeout,
            tester: TESTER,
        };
        transport.send_wakeup()?;
        Ok(transport)
    }

    /// Send an ALIVE_CHECK (0x0012) wake-up right after connecting.
    ///
    /// Experimental (issue #248): some F-series ZGWs won't route diagnostic
    /// frames to the CAN side until they have seen one, per the issue's
    /// attached draft. This is its own commit because it adds a frame to the
    /// wire on *every* connect — a success-path change — unlike the rest of
    /// the #248 work, which only turns opaque failures into explained ones.
    /// Not verified on hardware. Deliberately no sleep after the write: TCP
    /// preserves order, and the first request already carries its own read
    /// timeout; if the F36 needs a pause here, add it when we have evidence.
    fn send_wakeup(&mut self) -> Result<()> {
        let mut msg = Vec::with_capacity(8);
        msg.extend_from_slice(&2u32.to_be_bytes()); // len = src + tgt
        msg.extend_from_slice(&CTRL_ALIVE_CHECK.to_be_bytes());
        msg.push(self.tester);
        msg.push(0x00); // gateway
        self.stream
            .write_all(&msg)
            .map_err(|e| TransportError::Io(e.to_string()))
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

        // Frames we saw but that were not the ECU's diagnostic answer. If the
        // gateway refuses the request it answers with an *error* control word
        // (0x0040..0x00FF) — that is the reason, not a timeout, so surface it
        // instead of silently discarding it and waiting out the 3 s deadline
        // (issue #248: "0 Control Units Found" with no explanation).
        let mut seen: Vec<String> = Vec::new();
        loop {
            let (ctrl, data) = match self.read_msg() {
                Ok(v) => v,
                Err(TransportError::Timeout) => {
                    return Err(if seen.is_empty() {
                        TransportError::Timeout
                    } else {
                        TransportError::BadFrame(format!(
                            "no diagnostic response within 3 s; gateway sent only: {}",
                            seen.join(", ")
                        ))
                    });
                }
                Err(e) => return Err(e),
            };
            if ctrl == CTRL_ACK {
                continue; // gateway ack of our own message
            }
            if ctrl >= CTRL_ERR_INCORRECT_TESTER_ADDRESS
                && (ctrl <= CTRL_ERR_DIAG_APP_NOT_READY || ctrl == CTRL_ERR_OUT_OF_MEMORY)
            {
                return Err(TransportError::GatewayRejected(describe_error_word(ctrl, &data)));
            }
            if ctrl != CTRL_DIAG || data.len() < 3 {
                // keep-alive, terminal-15, vehicle-ident, or an unrelated
                // frame: remember it for the timeout diagnostic, keep waiting
                seen.push(format!("0x{ctrl:04X}"));
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

    /// Build one HSFZ wire frame: [len:u32 BE][ctrl:u16 BE][data...].
    fn hsfz_frame(ctrl: u16, data: &[u8]) -> Vec<u8> {
        let mut f = Vec::with_capacity(data.len() + 6);
        f.extend_from_slice(&(data.len() as u32).to_be_bytes());
        f.extend_from_slice(&ctrl.to_be_bytes());
        f.extend_from_slice(data);
        f
    }

    /// A fake ZGW that reads one request then writes the given frames.
    fn fake_gateway(frames: Vec<Vec<u8>>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut hdr = [0u8; 6];
                let _ = stream.read_exact(&mut hdr); // request header
                let len = u32::from_be_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]) as usize;
                let mut body = vec![0u8; len];
                let _ = stream.read_exact(&mut body); // request body
                for f in frames {
                    let _ = stream.write_all(&f);
                }
                // Hold the connection open so a client that got no answer
                // hits its read timeout (a real ZGW never closes on us).
                std::thread::sleep(Duration::from_secs(5));
            }
        });
        addr
    }

    #[test]
    fn describe_error_word_names_and_addresses() {
        let s = describe_error_word(CTRL_ERR_INCORRECT_DEST_ADDRESS, &[0xF4, 0x12]);
        assert!(s.contains("incorrect destination address"), "{s}");
        assert!(s.contains("0x12"), "{s}");
        let s = describe_error_word(CTRL_ERR_INCORRECT_TESTER_ADDRESS, &[0xF4, 0xE0]);
        assert!(s.contains("expected tester 0xF4"), "{s}");
        assert!(s.contains("got 0xE0"), "{s}");
        let s = describe_error_word(CTRL_ERR_OUT_OF_MEMORY, &[]);
        assert!(s.contains("out of memory"), "{s}");
    }

    /// The regression for issue #248: a gateway *refusal* must surface as a
    /// descriptive error, not be silently discarded into a 3 s timeout.
    #[test]
    fn gateway_error_word_is_reported_not_swallowed() {
        // 0x0043 incorrect destination address, payload [source, target]
        let addr = fake_gateway(vec![hsfz_frame(CTRL_ERR_INCORRECT_DEST_ADDRESS, &[0xF4, 0x12])]);
        let mut t = EnetTransport::open(&addr).expect("connect");
        let err = t.request(0x12, &[0x22, 0xF1, 0x90]).unwrap_err();
        match err {
            TransportError::GatewayRejected(msg) => {
                assert!(msg.contains("incorrect destination address"), "{msg}");
                assert!(msg.contains("0x12"), "{msg}");
            }
            other => panic!("expected GatewayRejected, got {other:?}"),
        }
    }

    /// Happy path is unchanged: an ACK (0x0002) is skipped, then the ECU's
    /// 0x0001 response is returned with the src/tgt bytes stripped.
    #[test]
    fn ack_then_diag_response_returns_uds() {
        let ack = hsfz_frame(CTRL_ACK, &[0xF4, 0x12]);
        let resp = hsfz_frame(CTRL_DIAG, &[0x12, 0xF4, 0x62, 0xF1, 0x90, 0x57, 0x42, 0x41]);
        let addr = fake_gateway(vec![ack, resp]);
        let mut t = EnetTransport::open(&addr).expect("connect");
        let uds = t.request(0x12, &[0x22, 0xF1, 0x90]).expect("response");
        assert_eq!(uds, vec![0x62, 0xF1, 0x90, 0x57, 0x42, 0x41]);
    }

    /// An unrelated frame (alive-check 0x0012) is no longer *silently*
    /// discarded: if the real answer never comes, the timeout names what the
    /// gateway did send instead of a bare "Timeout".
    #[test]
    fn unrelated_frame_then_timeout_names_it() {
        let addr = fake_gateway(vec![hsfz_frame(0x0012, &[0x12, 0xF4])]);
        let mut t = EnetTransport::open(&addr).expect("connect");
        let err = t.request(0x12, &[0x22, 0xF1, 0x90]).unwrap_err();
        match err {
            TransportError::BadFrame(msg) => {
                assert!(msg.contains("gateway sent only"), "{msg}");
                assert!(msg.contains("0x0012"), "{msg}");
            }
            other => panic!("expected BadFrame naming the frame, got {other:?}"),
        }
    }
}
