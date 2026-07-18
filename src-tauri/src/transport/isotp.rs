//! ISO 15765-2 (ISO-TP) multi-frame reassembly for raw CAN-class transports
//! (issue #88).
//!
//! ## Where segmentation actually appears in this codebase (evidence)
//!
//! - **K+DCAN cable (`kdcan.rs`): never reaches the PC.** The cable is an
//!   FTDI bridge whose firmware terminates the CAN side; the PC speaks
//!   complete BMW-framed messages `[len][tgt][src][payload...][cs]` on both
//!   D-CAN and K-line — see `build_frame`/`read_frame`: one length-prefixed
//!   message in, one out, no 8-byte CAN chunks anywhere. Long responses
//!   (VIN, fault memory) arrive as single KWP messages up to 252 payload
//!   bytes. So there is deliberately no ISO-TP machinery in `kdcan.rs`.
//! - **ENET (`enet.rs`): never reaches the PC.** The ZGW gateway terminates
//!   CAN-side ISO-TP and delivers one reassembled diagnostic payload per
//!   HSFZ message (`[len:u32][ctrl][src,tgt,uds...]`, u32 length).
//! - **Raw CAN-class transports (SocketCAN, OBDLink STN, future DoIP
//!   socket): segmentation reaches the PC** as 8-byte CAN frames. None of
//!   those transports exists yet — this module is their integration point,
//!   and the simulator's `SimCanBus` personality exercises it end-to-end
//!   today.
//!
//! ## Design
//!
//! `IsoTpTransport` adapts any `CanBus` (raw frame I/O) to the message-level
//! `Transport` trait. Receive path (the priority — we send short requests,
//! receive long responses): Single Frame → payload; First Frame → we
//! transmit Flow Control (Clear-To-Send) → Consecutive Frames are
//! sequence-validated and reassembled with an N_Cr inter-frame timeout.
//!
//! Sender-side segmentation (us transmitting FF/CF and awaiting FC) is
//! **not implemented**: the longest request anywhere in `protocol/` today
//! is 6 bytes (SecurityAccess sendKey, `27 <sub> <key:4>`), so every
//! request fits a Single Frame. `request()` rejects >7-byte payloads with a
//! clear error; the send path below is the marked extension point if a
//! future feature (e.g. flashing) needs long requests.
//!
//! Flow Control policy: `FS=0` CTS, `BS=0` (no block limit — our reassembly
//! buffer is capped at `MAX_PAYLOAD` and BMW ECUs stream fine), `STmin=0`
//! (K+DCAN's 1 ms FTDI latency timer is hardware per CLAUDE.md — the bus
//! tolerates back-to-back CFs; do not pad artificial delays).

use super::{Result, Transport, TransportError};
use std::time::{Duration, Instant};

/// Max wait for the next Consecutive Frame mid-message — ISO 15765-2
/// network-layer timeout N_Cr (1000 ms default).
pub const N_CR_TIMEOUT: Duration = Duration::from_millis(1000);
/// Max wait for the first response frame, matching kdcan's existing 1 s.
pub const RESPONSE_TIMEOUT: Duration = Duration::from_millis(1000);
/// Reassembly buffer cap — the 12-bit FF_DL ceiling (4095 bytes).
pub const MAX_PAYLOAD: usize = 0x0FFF;

/// The Flow Control frame we transmit on receiving a First Frame:
/// FS=0 (Clear-To-Send), BS=0 (send all), STmin=0 (see module docs).
pub const FC_CLEAR_TO_SEND: [u8; 3] = [0x30, 0x00, 0x00];

/// Raw CAN-class frame I/O — the extension point for future raw-CAN
/// transports. `target` abstracts the ISO-TP channel / CAN-ID pairing the
/// concrete transport uses. Frames are the 1..=8 ISO-TP data bytes (PCI +
/// payload); CAN padding is the concrete transport's concern.
pub trait CanBus: Send {
    /// Transmit one frame toward `target`'s ISO-TP channel.
    fn send_frame(&mut self, target: u8, frame: &[u8]) -> Result<()>;
    /// Receive the next frame from `target`'s channel, giving up with
    /// `TransportError::Timeout` once `deadline` passes.
    fn recv_frame(&mut self, target: u8, deadline: Instant) -> Result<Vec<u8>>;
}

/// Message-level `Transport` over a raw CAN-class `CanBus`, performing
/// ISO-TP reassembly so `protocol` sees complete payloads.
pub struct IsoTpTransport<B: CanBus> {
    bus: B,
    response_timeout: Duration,
    n_cr_timeout: Duration,
}

impl<B: CanBus> IsoTpTransport<B> {
    pub fn new(bus: B) -> Self {
        Self { bus, response_timeout: RESPONSE_TIMEOUT, n_cr_timeout: N_CR_TIMEOUT }
    }

    /// Override the timeouts (tests compress time instead of sleeping 1 s).
    pub fn with_timeouts(mut self, response: Duration, n_cr: Duration) -> Self {
        self.response_timeout = response;
        self.n_cr_timeout = n_cr;
        self
    }

    /// Consume frames until one complete diagnostic message is reassembled.
    fn recv_message(&mut self, target: u8) -> Result<Vec<u8>> {
        let deadline = Instant::now() + self.response_timeout;
        let frame = self.bus.recv_frame(target, deadline)?;
        let (&pci, data) = frame
            .split_first()
            .ok_or_else(|| TransportError::BadFrame("empty CAN frame".into()))?;
        if frame.len() > 8 {
            return Err(TransportError::BadFrame(format!("oversized CAN frame ({} bytes)", frame.len())));
        }
        match pci >> 4 {
            // Single Frame: PCI low nibble = payload length.
            0x0 => {
                let n = (pci & 0x0F) as usize;
                if n == 0 || n > 7 || data.len() < n {
                    return Err(TransportError::BadFrame(format!(
                        "bad single frame (len nibble {n}, {} data bytes)",
                        data.len()
                    )));
                }
                Ok(data[..n].to_vec())
            }
            // First Frame: 12-bit total length, first 6 payload bytes.
            0x1 => {
                if data.len() < 7 {
                    return Err(TransportError::BadFrame("short first frame".into()));
                }
                let total = (((pci & 0x0F) as usize) << 8) | data[0] as usize;
                if total <= 7 {
                    return Err(TransportError::BadFrame(format!("FF_DL {total} fits a single frame")));
                }
                if total > MAX_PAYLOAD {
                    return Err(TransportError::BadFrame(format!("FF_DL {total} exceeds cap {MAX_PAYLOAD}")));
                }
                let mut buf = Vec::with_capacity(total);
                buf.extend_from_slice(&data[1..7]);
                // Clear-To-Send: stream the rest.
                self.bus.send_frame(target, &FC_CLEAR_TO_SEND)?;
                let mut expected_sn: u8 = 1;
                while buf.len() < total {
                    let cf_deadline = Instant::now() + self.n_cr_timeout;
                    let cf = self.bus.recv_frame(target, cf_deadline)?;
                    let (&cpci, cdata) = cf
                        .split_first()
                        .ok_or_else(|| TransportError::BadFrame("empty CAN frame".into()))?;
                    if cpci >> 4 != 0x2 {
                        return Err(TransportError::BadFrame(format!(
                            "expected consecutive frame, got PCI {cpci:02X}"
                        )));
                    }
                    let sn = cpci & 0x0F;
                    if sn != expected_sn {
                        return Err(TransportError::BadFrame(format!(
                            "CF sequence {sn} out of order (expected {expected_sn})"
                        )));
                    }
                    let need = total - buf.len();
                    buf.extend_from_slice(&cdata[..need.min(cdata.len())]);
                    // Sequence numbers cycle 1..=15, 0, 1, ...
                    expected_sn = expected_sn.wrapping_add(1) & 0x0F;
                }
                buf.truncate(total);
                Ok(buf)
            }
            0x2 => Err(TransportError::BadFrame("unexpected consecutive frame".into())),
            0x3 => Err(TransportError::BadFrame(
                "unexpected flow control frame (we never send a first frame)".into(),
            )),
            other => Err(TransportError::BadFrame(format!("unknown PCI type {other}"))),
        }
    }
}

impl<B: CanBus> Transport for IsoTpTransport<B> {
    fn name(&self) -> &'static str {
        "ISO-TP (raw CAN)"
    }

    fn request(&mut self, target: u8, payload: &[u8]) -> Result<Vec<u8>> {
        // Sender-side segmentation extension point: no request in
        // `protocol/` exceeds 6 bytes today, so only Single Frames go out.
        // To support long requests: segment into FF/CF here and await the
        // ECU's Flow Control between blocks (mirror of recv_message).
        if payload.len() > 7 {
            return Err(TransportError::BadFrame(format!(
                "ISO-TP sender segmentation not implemented ({}-byte request)",
                payload.len()
            )));
        }
        let mut sf = Vec::with_capacity(8);
        sf.push(payload.len() as u8); // PCI: SF, length in low nibble
        sf.extend_from_slice(payload);
        self.bus.send_frame(target, &sf)?;
        loop {
            let resp = self.recv_message(target)?;
            // UDS responsePending (7F sid 78): the final response follows in
            // its own message — keep waiting (same policy as enet.rs).
            if resp.len() >= 3 && resp[0] == 0x7F && resp[2] == 0x78 {
                continue;
            }
            return Ok(resp);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::sim::{SimCanBus, SimTransport, VinMode};
    use std::collections::VecDeque;

    /// Scripted frame source/sink: replays queued inbound frames (or errors)
    /// and records everything the transport transmits.
    struct ScriptedCanBus {
        rx: VecDeque<Result<Vec<u8>>>,
        sent: Vec<Vec<u8>>,
    }

    impl ScriptedCanBus {
        fn new(rx: Vec<Result<Vec<u8>>>) -> Self {
            Self { rx: rx.into(), sent: Vec::new() }
        }
    }

    impl CanBus for ScriptedCanBus {
        fn send_frame(&mut self, _target: u8, frame: &[u8]) -> Result<()> {
            self.sent.push(frame.to_vec());
            Ok(())
        }
        fn recv_frame(&mut self, _target: u8, _deadline: Instant) -> Result<Vec<u8>> {
            self.rx.pop_front().unwrap_or(Err(TransportError::Timeout))
        }
    }

    fn sf(payload: &[u8]) -> Vec<u8> {
        let mut f = vec![payload.len() as u8];
        f.extend_from_slice(payload);
        f
    }

    /// First frame announcing `total` bytes, carrying the first 6.
    fn ff(total: usize, first6: &[u8]) -> Vec<u8> {
        assert_eq!(first6.len(), 6);
        let mut f = vec![0x10 | ((total >> 8) as u8), (total & 0xFF) as u8];
        f.extend_from_slice(first6);
        f
    }

    fn cf(sn: u8, data: &[u8]) -> Vec<u8> {
        let mut f = vec![0x20 | sn];
        f.extend_from_slice(data);
        f
    }

    fn transport(rx: Vec<Result<Vec<u8>>>) -> IsoTpTransport<ScriptedCanBus> {
        IsoTpTransport::new(ScriptedCanBus::new(rx))
            .with_timeouts(Duration::from_millis(50), Duration::from_millis(20))
    }

    #[test]
    fn single_frame_passthrough() {
        let mut t = transport(vec![Ok(sf(&[0x7E]))]);
        assert_eq!(t.request(0x12, &[0x3E, 0x00]).unwrap(), vec![0x7E]);
    }

    #[test]
    fn request_is_sent_as_single_frame() {
        let mut t = transport(vec![Ok(sf(&[0x7E]))]);
        t.request(0x12, &[0x3E, 0x00]).unwrap();
        assert_eq!(t.bus.sent[0], vec![0x02, 0x3E, 0x00]);
    }

    #[test]
    fn thirty_byte_payload_reassembles_across_five_frames() {
        let payload: Vec<u8> = (0u8..30).collect();
        let mut t = transport(vec![
            Ok(ff(30, &payload[0..6])),
            Ok(cf(1, &payload[6..13])),
            Ok(cf(2, &payload[13..20])),
            Ok(cf(3, &payload[20..27])),
            Ok(cf(4, &payload[27..30])),
        ]);
        assert_eq!(t.request(0x12, &[0x22, 0xF1, 0x90]).unwrap(), payload);
    }

    #[test]
    fn first_frame_triggers_clear_to_send_flow_control() {
        let payload: Vec<u8> = (0u8..10).collect();
        let mut t = transport(vec![Ok(ff(10, &payload[0..6])), Ok(cf(1, &payload[6..10]))]);
        t.request(0x12, &[0x22, 0xF1, 0x90]).unwrap();
        // sent[0] is the request SF; sent[1] must be FC: FS=CTS, BS=0, STmin=0.
        assert_eq!(t.bus.sent[1], FC_CLEAR_TO_SEND.to_vec());
        assert_eq!(t.bus.sent[1], vec![0x30, 0x00, 0x00]);
    }

    #[test]
    fn out_of_order_consecutive_frame_is_rejected() {
        let payload: Vec<u8> = (0u8..20).collect();
        let mut t = transport(vec![
            Ok(ff(20, &payload[0..6])),
            Ok(cf(2, &payload[13..20])), // SN 2 before SN 1
        ]);
        let err = t.request(0x12, &[0x22, 0xF1, 0x90]).unwrap_err();
        assert!(err.to_string().contains("out of order"), "got: {err}");
    }

    #[test]
    fn sequence_number_wraps_after_15() {
        // 6 + 16*7 = 118 bytes → SNs 1..=15 then 0.
        let payload: Vec<u8> = (0..118u16).map(|v| (v % 251) as u8).collect();
        let mut frames = vec![Ok(ff(payload.len(), &payload[0..6]))];
        let mut off = 6;
        for sn in 1u8..=15 {
            frames.push(Ok(cf(sn, &payload[off..off + 7])));
            off += 7;
        }
        frames.push(Ok(cf(0, &payload[off..off + 7]))); // SN wraps to 0
        let mut t = transport(frames);
        assert_eq!(t.request(0x12, &[0x22, 0xF1, 0x90]).unwrap(), payload);
    }

    #[test]
    fn missing_consecutive_frame_times_out() {
        let payload: Vec<u8> = (0u8..20).collect();
        let mut t = transport(vec![Ok(ff(20, &payload[0..6]))]); // CFs never arrive
        let err = t.request(0x12, &[0x22, 0xF1, 0x90]).unwrap_err();
        assert!(matches!(err, TransportError::Timeout), "got: {err}");
    }

    #[test]
    fn unexpected_consecutive_frame_is_rejected() {
        let mut t = transport(vec![Ok(cf(1, &[0xAA, 0xBB]))]);
        let err = t.request(0x12, &[0x3E, 0x00]).unwrap_err();
        assert!(err.to_string().contains("unexpected consecutive frame"), "got: {err}");
    }

    #[test]
    fn first_frame_with_tiny_length_is_rejected() {
        // FF_DL <= 7 fits a single frame — announcing it as multi-frame is
        // malformed. (FF_DL is 12-bit, so it can never exceed MAX_PAYLOAD;
        // the cap check in recv_message is defense-in-depth only.)
        let mut t = transport(vec![Ok(ff(7, &[0; 6]))]);
        let err = t.request(0x12, &[0x3E, 0x00]).unwrap_err();
        assert!(err.to_string().contains("fits a single frame"), "got: {err}");
    }

    #[test]
    fn long_requests_are_rejected_with_extension_note() {
        let mut t = transport(vec![]);
        let err = t.request(0x12, &[0x36, 1, 2, 3, 4, 5, 6, 7]).unwrap_err();
        assert!(err.to_string().contains("sender segmentation not implemented"), "got: {err}");
    }

    #[test]
    fn response_pending_is_followed_by_final_response() {
        let mut t = transport(vec![Ok(sf(&[0x7F, 0x22, 0x78])), Ok(sf(&[0x62, 0xF1, 0x90]))]);
        assert_eq!(t.request(0x12, &[0x22, 0xF1, 0x90]).unwrap(), vec![0x62, 0xF1, 0x90]);
    }

    /* -------- end-to-end over the simulator's multi-frame personality -------- */

    fn can_sim(sim: SimTransport) -> IsoTpTransport<SimCanBus> {
        IsoTpTransport::new(SimCanBus::new(sim))
            .with_timeouts(Duration::from_millis(50), Duration::from_millis(20))
    }

    /// The #88 acceptance test: protocol::read_vin (unchanged since #98)
    /// returns all 17 VIN chars when the sim emits the 20-byte UDS response
    /// as ISO-TP FF + CFs.
    #[test]
    fn vin_read_survives_multi_frame_segmentation() {
        let mut t = can_sim(SimTransport::new());
        let vin = crate::protocol::read_vin(&mut t).unwrap();
        assert_eq!(vin, "WBAVA31050NL12345");
        assert_eq!(vin.len(), 17);
    }

    /// KWP fallback also works over segmented frames: DME has no VIN, the
    /// CAS answers 1A 90 multi-frame.
    #[test]
    fn vin_cas_fallback_survives_multi_frame_segmentation() {
        let mut sim = SimTransport::new();
        sim.set_vin_mode(VinMode::KwpCas);
        let mut t = can_sim(sim);
        assert_eq!(crate::protocol::read_vin(&mut t).unwrap(), "WBAVA31050NL12345");
    }

    /// A full fault-memory read (multi-DTC) reassembles across CF chunks.
    #[test]
    fn dtc_list_reassembles_across_consecutive_frames() {
        let mut t = can_sim(SimTransport::new());
        let dtcs = crate::protocol::read_dtcs(&mut t, 0x12).unwrap();
        assert_eq!(dtcs.len(), 2, "sim DME ships two faults");
        assert_eq!(dtcs[0].code, "2A82");
    }

    /// The 34-byte ident string spans FF + 4 CFs — the longest stock sim
    /// response.
    #[test]
    fn long_ident_reassembles_across_consecutive_frames() {
        let mut t = can_sim(SimTransport::new());
        let ident = crate::protocol::identify(&mut t, 0x12).unwrap();
        assert_eq!(ident, "DME MSV70 7558449 hw04 sw11.32 ci08");
    }

    /// Short exchanges stay single-frame on the CAN personality.
    #[test]
    fn tester_present_stays_single_frame() {
        let mut t = can_sim(SimTransport::new());
        assert_eq!(t.request(0x12, &[0x3E, 0x00]).unwrap(), vec![0x7E]);
    }

    /// The sim honors Flow Control block size: with BS=2 it releases two
    /// CFs then waits for the next FC.
    #[test]
    fn sim_honors_flow_control_block_size() {
        let mut bus = SimCanBus::new(SimTransport::new());
        // Request the 20-byte VIN DID (0x22 F190) → FF + 2 CFs (6+7+7).
        bus.send_frame(0x12, &[0x03, 0x22, 0xF1, 0x90]).unwrap();
        let ff = bus.recv_frame(0x12, Instant::now() + Duration::from_millis(50)).unwrap();
        assert_eq!(ff[0] >> 4, 0x1, "first frame expected");
        // FC with BS=2, then FC with BS=1: sim must meter the CFs out.
        bus.send_frame(0x12, &[0x30, 0x02, 0x00]).unwrap();
        let cf1 = bus.recv_frame(0x12, Instant::now() + Duration::from_millis(50)).unwrap();
        assert_eq!(cf1[0], 0x21);
        let cf2 = bus.recv_frame(0x12, Instant::now() + Duration::from_millis(50)).unwrap();
        assert_eq!(cf2[0], 0x22);
        // Block exhausted — nothing more until another FC arrives.
        assert!(bus.recv_frame(0x12, Instant::now()).is_err());
    }

    /// The sim aborts a multi-frame transmission on FC overflow, so the
    /// tester's N_Cr wait times out instead of hanging forever.
    #[test]
    fn sim_aborts_transmission_on_flow_control_overflow() {
        let mut bus = SimCanBus::new(SimTransport::new());
        bus.send_frame(0x12, &[0x03, 0x22, 0xF1, 0x90]).unwrap();
        let _ff = bus.recv_frame(0x12, Instant::now() + Duration::from_millis(50)).unwrap();
        bus.send_frame(0x12, &[0x32, 0x00, 0x00]).unwrap(); // FS=2 overflow
        assert!(bus.recv_frame(0x12, Instant::now()).is_err(), "CFs must stop after overflow");
    }
}
