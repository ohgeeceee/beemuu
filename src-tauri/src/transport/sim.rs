//! Simulated vehicle — a virtual E90 (N52) that answers KWP2000/UDS
//! requests so the whole app can be developed and demoed without a car.
//!
//! Supported services per simulated ECU:
//!   10 <session> diagnosticSessionControl -> 50 <session> 00 32 01 F4
//!   1A 80        readEcuIdentification  -> 5A 80 <ident string>
//!   1A 90        readEcuIdentification (VIN) -> 5A 90 <17-byte VIN> (per VinMode)
//!   18 02 FF FF  readDTCByStatus (KWP)  -> 58 <count> [hi lo status]*
//!   12 <hi> <lo> readFreezeFrame        -> 52 <hi> <lo> <env bytes>
//!   14 FF FF     clearDTC               -> 54
//!   22 <DID:2>   readDataByIdentifier   -> 62 <DID:2> <data>
//!   27 <sub>     securityAccess         -> 67 <sub> <seed> | 67 <sub>
//!   3E ..        testerPresent          -> 7E
//!   31 ..        routineControl (service functions) -> 71 ..
//!
//! S3server (ISO 14229-2): while a non-default session is active, more than
//! ~5 s of bus silence reverts the ECU to the default session and drops
//! security access. Any request — including Tester Present — resets the
//! timer. This lets the Tester Present keep-alive worker be exercised
//! without a car.

use super::{Result, Transport, TransportError};
use std::time::{Duration, Instant};

struct SimEcu {
    address: u8,
    ident: &'static str,
    /// (dtc_hi, dtc_lo, status)
    dtcs: Vec<(u8, u8, u8)>,
    /// Freeze-frame environmental data per DTC, indexed same as `dtcs`.
    /// Layout matches protocol::freeze::decode: rpm(u16), coolant(u8-40),
    /// speed(u8), load(u8), volts(u8/10), mileage(u24 km).
    freeze: Vec<[u8; 9]>,
}

/// XOR constant the sim uses for its trivial seed→key security algorithm.
/// Real BMW modules use undisclosed per-ECU algorithms — this only lets the
/// unlock flow be exercised against the simulator.
const SIM_KEY_XOR: u32 = 0x5A_A5_1234;

/// Default S3server timeout: how long a non-default session survives without
/// any diagnostic request before the ECU reverts to default session
/// (ISO 14229-2 typical value).
const DEFAULT_S3_TIMEOUT: Duration = Duration::from_secs(5);

/// The simulated car's VIN (WBAVA31050NL12345 — a WBA VIN in the valid
/// 17-char format). Answered via UDS `22 F1 90` and/or KWP `1A 90`
/// depending on `VinMode`.
const SIM_VIN: &[u8; 17] = b"WBAVA31050NL12345";

/// VIN personality of the simulated vehicle — which protocol path answers
/// VIN requests. The default `Uds` preserves the sim's long-standing
/// behavior; the other variants model E-series KWP cars so the KWP and
/// CAS-fallback paths of `protocol::read_vin` can be exercised (also handy
/// for demos of pre-2007 cars).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VinMode {
    /// UDS `22 F1 90` answers on the DME (F/G-style behavior). The DME and
    /// CAS also answer KWP `1A 90`, like D-CAN E9x modules that speak both.
    Uds,
    /// UDS VIN reads are rejected; the DME answers KWP `1A 90` (E-series
    /// K-line style).
    KwpDme,
    /// The DME has no VIN via either service; only the CAS (0x40) answers
    /// KWP `1A 90` — the classic E-series fallback.
    KwpCas,
}

pub struct SimTransport {
    ecus: Vec<SimEcu>,
    started: Instant,
    /// Current diagnostic session (0x01 default, 0x03 extended, etc.)
    session: u8,
    /// Last seed handed out, per requesting sub-function.
    last_seed: u32,
    /// Whether security access is currently granted.
    unlocked: bool,
    /// Time of the last diagnostic request — the S3 timer reference.
    last_diag: Instant,
    /// S3server timeout; `DEFAULT_S3_TIMEOUT` in production, shortened by tests.
    s3_timeout: Duration,
    /// Which VIN protocol path(s) this car answers.
    vin_mode: VinMode,
}

impl SimTransport {
    pub fn new() -> Self {
        let dme_freeze = [0x02, 0xEE, 0x7A, 0x00, 0x14, 0x8B, 0x01, 0xE2, 0x40];
        let ecus = vec![
            SimEcu { address: 0x12, ident: "DME MSV70 7558449 hw04 sw11.32 ci08", dtcs: vec![(0x2A, 0x82, 0x24), (0x30, 0xFF, 0x20)], freeze: vec![dme_freeze, [0x00, 0x00, 0x59, 0x00, 0x0C, 0x8C, 0x01, 0xE2, 0x40]] },
            SimEcu { address: 0x18, ident: "EGS GS19D 7566999 hw02 sw09.10 ci03", dtcs: vec![], freeze: vec![] },
            SimEcu { address: 0x29, ident: "DSC MK60E5 6778239 hw05 sw06.40 ci04", dtcs: vec![(0x5D, 0xF0, 0x22)], freeze: vec![[0x00, 0x00, 0x51, 0x2D, 0x00, 0x8A, 0x01, 0xE2, 0x41]] },
            SimEcu { address: 0x40, ident: "CAS3 9147193 hw03 sw05.60 ci11", dtcs: vec![], freeze: vec![] },
            SimEcu { address: 0x60, ident: "KOMBI L6 9187068 hw01 sw10.02 ci06", dtcs: vec![], freeze: vec![] },
            SimEcu { address: 0x72, ident: "FRM2 9241322 hw22 sw16.10 ci07", dtcs: vec![(0x9C, 0xBA, 0x21)], freeze: vec![[0x00, 0x00, 0x4B, 0x00, 0x00, 0x8B, 0x01, 0xE2, 0x40]] },
            SimEcu { address: 0x78, ident: "IHKA 9226613 hw02 sw08.30 ci02", dtcs: vec![], freeze: vec![] },
            SimEcu { address: 0x01, ident: "ACSM2 9166087 hw04 sw03.21 ci05", dtcs: vec![], freeze: vec![] },
        ];
        let now = Instant::now();
        Self { ecus, started: now, session: 0x01, last_seed: 0, unlocked: false, last_diag: now, s3_timeout: DEFAULT_S3_TIMEOUT, vin_mode: VinMode::Uds }
    }

    /// Set the VIN personality (UDS vs KWP DME vs CAS-only fallback).
    pub fn set_vin_mode(&mut self, mode: VinMode) {
        self.vin_mode = mode;
    }

    /// Current diagnostic session byte — test-only introspection for the
    /// keep-alive worker tests (the real bus has no readSession service).
    #[cfg(test)]
    pub(crate) fn current_session(&self) -> u8 {
        self.session
    }

    /// Shorten the S3 timeout so tests can compress time instead of
    /// sleeping for the real ~5 s / >30 s windows.
    #[cfg(test)]
    pub(crate) fn set_s3_timeout(&mut self, d: Duration) {
        self.s3_timeout = d;
    }

    /// Time-varying engine model for live values.
    fn live_value(&self, did: u16) -> Vec<u8> {
        let t = self.started.elapsed().as_secs_f64();
        let wave = (t * 0.7).sin();
        let fast = (t * 3.1).sin();
        match did {
            // RPM (u16, 1/rpm) — idle hunting around 750 with occasional revs
            0x1000 => {
                let rev = if (t % 20.0) > 16.0 { 2200.0 * ((t % 20.0) - 16.0) / 4.0 } else { 0.0 };
                let rpm = (748.0 + wave * 28.0 + fast * 12.0 + rev).max(0.0) as u16;
                rpm.to_be_bytes().to_vec()
            }
            // Coolant temp (u8, value - 40 = °C) — warms from 20°C to 98°C
            0x1001 => {
                let c = 20.0 + (98.0 - 20.0) * (1.0 - (-t / 90.0).exp());
                vec![(c + 40.0) as u8]
            }
            // Oil temp (u8, -40 offset) — lags coolant
            0x1002 => {
                let c = 18.0 + (105.0 - 18.0) * (1.0 - (-t / 150.0).exp());
                vec![(c + 40.0) as u8]
            }
            // Intake air temp (u8, -40 offset)
            0x1003 => vec![(28.0 + wave * 3.0 + 40.0) as u8],
            // Battery voltage (u8, value/10 = V)
            0x1004 => vec![(139.0 + fast * 3.0) as u8],
            // Vehicle speed (u8 km/h)
            0x1005 => vec![0],
            // Engine load (u8, %)
            0x1006 => vec![(18.0 + wave.abs() * 9.0) as u8],
            // Fuel level (u8, %)
            0x1007 => vec![63],
            // Ambient temp (u8, -40 offset)
            0x1008 => vec![(19 + 40) as u8],
            // Boost / manifold pressure (u16, mbar)
            0x1009 => ((980.0 + wave * 15.0) as u16).to_be_bytes().to_vec(),
            // VIN
            0xF190 => SIM_VIN.to_vec(),
            // Odometer (u24, km) — 123456 km = 0x01E240
            0x1010 => vec![0x01, 0xE2, 0x40],
            _ => vec![0x00],
        }
    }

    /// Standard OBD-II mode 01 answers, derived from the same engine model
    /// so the "Generic OBD-II" profile is testable in the simulator.
    fn obd_value(&self, pid: u8) -> Option<Vec<u8>> {
        let t = self.started.elapsed().as_secs_f64();
        let wave = (t * 0.7).sin();
        match pid {
            0x00 => Some(vec![0xBE, 0x3F, 0xA8, 0x13]), // supported PIDs 01-20
            0x0C => {
                let rpm4 = ((748.0 + wave * 28.0) * 4.0) as u16;
                Some(rpm4.to_be_bytes().to_vec())
            }
            0x05 => Some(vec![(20.0 + 78.0 * (1.0 - (-t / 90.0).exp()) + 40.0) as u8]),
            0x0F => Some(vec![(28.0 + wave * 3.0 + 40.0) as u8]),
            0x0D => Some(vec![0]),
            0x04 => Some(vec![((18.0 + wave.abs() * 9.0) * 255.0 / 100.0) as u8]),
            0x11 => Some(vec![((14.0 + wave.abs() * 2.0) * 255.0 / 100.0) as u8]),
            0x0B => Some(vec![(98.0 + wave * 1.5) as u8]),
            0x2F => Some(vec![(63.0 * 255.0 / 100.0) as u8]),
            0x42 => Some(((13900.0 + wave * 300.0) as u16).to_be_bytes().to_vec()),
            0x46 => Some(vec![19 + 40]),
            0x0E => Some(vec![(12.0 + wave * 4.0) as u8]),
            _ => None,
        }
    }

    /// KWP local idents — a fake "messwertblock" so the Parameter Explorer
    /// has something to discover in the simulator.
    fn local_ident_value(&self, id: u8) -> Option<Vec<u8>> {
        let t = self.started.elapsed().as_secs_f64();
        match id {
            0x01 => {
                // status block: rpm(u16), coolant(u8+40), volts(u8*10)
                let rpm = (748.0 + (t * 0.7).sin() * 28.0) as u16;
                let mut v = rpm.to_be_bytes().to_vec();
                v.push((20.0 + 78.0 * (1.0 - (-t / 90.0).exp()) + 40.0) as u8);
                v.push((139.0 + (t * 3.1).sin() * 3.0) as u8);
                Some(v)
            }
            0x02 => Some(vec![0x00, 0x1F, 0x42, 0x00]), // static block
            _ => None,
        }
    }
}

impl Transport for SimTransport {
    fn name(&self) -> &'static str {
        "Simulator (virtual E90)"
    }

    fn request(&mut self, target: u8, payload: &[u8]) -> Result<Vec<u8>> {
        // S3server (ISO 14229-2): a non-default session times out after
        // `s3_timeout` of bus silence, reverting to default session and
        // dropping security. Any request — including Tester Present —
        // resets the timer.
        if self.session != 0x01 && self.last_diag.elapsed() > self.s3_timeout {
            self.session = 0x01;
            self.unlocked = false;
        }
        self.last_diag = Instant::now();

        let live = if payload.len() == 3 && payload[0] == 0x22 {
            Some(self.live_value(u16::from_be_bytes([payload[1], payload[2]])))
        } else {
            None
        };
        let obd = if payload.len() == 2 && payload[0] == 0x01 {
            Some(self.obd_value(payload[1]))
        } else {
            None
        };

        // Session control and security access mutate transport-wide state, so
        // handle them before the per-ECU borrow.
        match payload {
            [0x10, session, ..] => {
                self.session = *session;
                self.unlocked = false; // session change drops security
                // 50 <session> P2=0x0032 P2*=0x01F4 (timing params)
                return Ok(vec![0x50, *session, 0x00, 0x32, 0x01, 0xF4]);
            }
            [0x27, sub] if sub % 2 == 1 => {
                // requestSeed — derive a pseudo-seed from time + sub
                let seed = 0x1000_0000u32
                    .wrapping_add((self.started.elapsed().as_millis() as u32) & 0x00FF_FFFF)
                    .wrapping_add(*sub as u32);
                self.last_seed = seed;
                let mut r = vec![0x67, *sub];
                r.extend_from_slice(&seed.to_be_bytes());
                return Ok(r);
            }
            [0x27, sub, k0, k1, k2, k3] if sub % 2 == 0 => {
                let key = u32::from_be_bytes([*k0, *k1, *k2, *k3]);
                let expected = self.last_seed ^ SIM_KEY_XOR;
                if key == expected {
                    self.unlocked = true;
                    return Ok(vec![0x67, *sub]);
                } else {
                    return Ok(vec![0x7F, 0x27, 0x35]); // invalidKey
                }
            }
            _ => {}
        }

        let ecu = self
            .ecus
            .iter_mut()
            .find(|e| e.address == target)
            .ok_or(TransportError::Timeout)?; // absent module: no answer, like a real bus

        match payload {
            [0x1A, 0x80, ..] => {
                let mut r = vec![0x5A, 0x80];
                r.extend_from_slice(ecu.ident.as_bytes());
                Ok(r)
            }
            [0x18, 0x02, ..] => {
                let mut r = vec![0x58, ecu.dtcs.len() as u8];
                for (hi, lo, st) in &ecu.dtcs {
                    r.extend_from_slice(&[*hi, *lo, *st]);
                }
                Ok(r)
            }
            [0x12, hi, lo] => {
                // readFreezeFrame for a specific DTC
                match ecu.dtcs.iter().position(|(h, l, _)| h == hi && l == lo) {
                    Some(idx) if idx < ecu.freeze.len() => {
                        let mut r = vec![0x52, *hi, *lo];
                        r.extend_from_slice(&ecu.freeze[idx]);
                        Ok(r)
                    }
                    _ => Ok(vec![0x7F, 0x12, 0x31]), // no freeze frame for this DTC
                }
            }
            [0x14, ..] => {
                ecu.dtcs.clear();
                Ok(vec![0x54])
            }
            [0x1A, 0x90] => {
                // KWP readEcuIdentification option 0x90: VIN (E-series).
                // DME and CAS both own a copy — except in KwpCas mode, where
                // the DME has none and only the CAS (0x40) answers.
                let has_vin = match (self.vin_mode, target) {
                    (VinMode::KwpCas, 0x12) => false,
                    (_, 0x12 | 0x40) => true,
                    _ => false,
                };
                if has_vin {
                    let mut r = vec![0x5A, 0x90];
                    r.extend_from_slice(SIM_VIN);
                    Ok(r)
                } else {
                    Ok(vec![0x7F, 0x1A, 0x12]) // subFunctionNotSupported
                }
            }
            [0x22, _, _] => {
                let did = u16::from_be_bytes([payload[1], payload[2]]);
                // In KWP personalities the DME rejects UDS VIN reads, forcing
                // callers down the KWP 1A 90 path (E-series behavior).
                if did == 0xF190 && self.vin_mode != VinMode::Uds {
                    Ok(vec![0x7F, 0x22, 0x31]) // requestOutOfRange
                } else {
                    let mut r = vec![0x62, payload[1], payload[2]];
                    r.extend_from_slice(&live.unwrap());
                    Ok(r)
                }
            }
            [0x01, pid] => match obd.unwrap() {
                Some(data) => {
                    let mut r = vec![0x41, *pid];
                    r.extend_from_slice(&data);
                    Ok(r)
                }
                None => Ok(vec![0x7F, 0x01, 0x12]), // PID not supported
            },
            [0x21, id] => match self.local_ident_value(*id) {
                Some(data) => {
                    let mut r = vec![0x61, *id];
                    r.extend_from_slice(&data);
                    Ok(r)
                }
                None => Ok(vec![0x7F, 0x21, 0x31]), // request out of range
            },
            [0x3E, ..] => Ok(vec![0x7E]),
            [0x31, sub, rid_hi, rid_lo, ..] => {
                // routineControl: pretend every routine succeeds
                Ok(vec![0x71, *sub, *rid_hi, *rid_lo, 0x00])
            }
            [sid, ..] => Ok(vec![0x7F, *sid, 0x11]), // serviceNotSupported
            [] => Err(TransportError::BadFrame("empty payload".into())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// S3 drop: a non-default session with bus silence longer than the S3
    /// timeout reverts to default session on the next request.
    #[test]
    fn s3_timeout_reverts_non_default_session() {
        let mut sim = SimTransport::new();
        sim.set_s3_timeout(Duration::from_millis(100));
        sim.request(0x12, &[0x10, 0x03]).unwrap(); // extended session
        assert_eq!(sim.current_session(), 0x03);
        std::thread::sleep(Duration::from_millis(150)); // bus idle past S3
        // The next request lets the ECU notice the timeout.
        sim.request(0x12, &[0x1A, 0x80]).unwrap();
        assert_eq!(sim.current_session(), 0x01, "S3 timeout must revert to default session");
    }

    /// Tester Present frames reset the S3 timer: a session kept alive by
    /// periodic 3E survives many S3 windows of otherwise-idle time.
    #[test]
    fn tester_present_resets_s3_timer() {
        let mut sim = SimTransport::new();
        sim.set_s3_timeout(Duration::from_millis(200));
        sim.request(0x12, &[0x10, 0x03]).unwrap();
        for _ in 0..8 {
            std::thread::sleep(Duration::from_millis(100)); // half of S3
            sim.request(0x12, &[0x3E, 0x00]).unwrap();
        }
        assert_eq!(sim.current_session(), 0x03, "tester present must keep the session alive");
    }

    /// The S3 timer never fires while in the default session (there is
    /// nothing to revert), and no spurious state change occurs.
    #[test]
    fn s3_does_nothing_in_default_session() {
        let mut sim = SimTransport::new();
        sim.set_s3_timeout(Duration::from_millis(50));
        std::thread::sleep(Duration::from_millis(100));
        sim.request(0x12, &[0x1A, 0x80]).unwrap();
        assert_eq!(sim.current_session(), 0x01);
    }

    /// Default personality: UDS 22 F190 answers, and the DME also answers
    /// KWP 1A 90 (D-CAN E9x modules speak both).
    #[test]
    fn vin_default_mode_answers_uds_and_kwp() {
        let mut sim = SimTransport::new();
        let uds = sim.request(0x12, &[0x22, 0xF1, 0x90]).unwrap();
        assert_eq!(&uds[..3], &[0x62, 0xF1, 0x90]);
        assert_eq!(&uds[3..], SIM_VIN);
        let kwp = sim.request(0x12, &[0x1A, 0x90]).unwrap();
        assert_eq!(&kwp[..2], &[0x5A, 0x90]);
        assert_eq!(&kwp[2..], SIM_VIN);
    }

    /// E-series DME personality: UDS VIN read is rejected, KWP 1A 90 on the
    /// DME answers.
    #[test]
    fn vin_kwp_dme_mode_rejects_uds_answers_kwp() {
        let mut sim = SimTransport::new();
        sim.set_vin_mode(VinMode::KwpDme);
        let uds = sim.request(0x12, &[0x22, 0xF1, 0x90]).unwrap();
        assert_eq!(uds[0], 0x7F, "KWP personality must reject UDS VIN reads");
        let kwp = sim.request(0x12, &[0x1A, 0x90]).unwrap();
        assert_eq!(&kwp[..2], &[0x5A, 0x90]);
        assert_eq!(&kwp[2..], SIM_VIN);
    }

    /// E-series CAS-fallback personality: the DME has no VIN via either
    /// service; only the CAS (0x40) answers 1A 90.
    #[test]
    fn vin_kwp_cas_mode_only_cas_answers() {
        let mut sim = SimTransport::new();
        sim.set_vin_mode(VinMode::KwpCas);
        let dme_uds = sim.request(0x12, &[0x22, 0xF1, 0x90]).unwrap();
        assert_eq!(dme_uds[0], 0x7F);
        let dme_kwp = sim.request(0x12, &[0x1A, 0x90]).unwrap();
        assert_eq!(dme_kwp[0], 0x7F, "DME must have no VIN in KwpCas mode");
        let cas_kwp = sim.request(0x40, &[0x1A, 0x90]).unwrap();
        assert_eq!(&cas_kwp[..2], &[0x5A, 0x90]);
        assert_eq!(&cas_kwp[2..], SIM_VIN);
        // Non-VIN-owning modules never answer 1A 90.
        let other = sim.request(0x60, &[0x1A, 0x90]).unwrap();
        assert_eq!(other[0], 0x7F);
    }
}
