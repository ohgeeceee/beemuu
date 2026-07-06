//! Simulated vehicle — a virtual E90 (N52) that answers KWP2000/UDS
//! requests so the whole app can be developed and demoed without a car.
//!
//! Supported services per simulated ECU:
//!   1A 80        readEcuIdentification  -> 5A 80 <ident string>
//!   18 02 FF FF  readDTCByStatus (KWP)  -> 58 <count> [hi lo status]*
//!   14 FF FF     clearDTC               -> 54
//!   22 <DID:2>   readDataByIdentifier   -> 62 <DID:2> <data>
//!   3E ..        testerPresent          -> 7E
//!   31 ..        routineControl (service functions) -> 71 ..

use super::{Result, Transport, TransportError};
use std::time::Instant;

struct SimEcu {
    address: u8,
    ident: &'static str,
    /// (dtc_hi, dtc_lo, status)
    dtcs: Vec<(u8, u8, u8)>,
}

pub struct SimTransport {
    ecus: Vec<SimEcu>,
    started: Instant,
}

impl SimTransport {
    pub fn new() -> Self {
        let ecus = vec![
            SimEcu { address: 0x12, ident: "DME MSV70 7558449 hw04 sw11.32 ci08", dtcs: vec![(0x2A, 0x82, 0x24), (0x30, 0xFF, 0x20)] },
            SimEcu { address: 0x18, ident: "EGS GS19D 7566999 hw02 sw09.10 ci03", dtcs: vec![] },
            SimEcu { address: 0x29, ident: "DSC MK60E5 6778239 hw05 sw06.40 ci04", dtcs: vec![(0x5D, 0xF0, 0x22)] },
            SimEcu { address: 0x40, ident: "CAS3 9147193 hw03 sw05.60 ci11", dtcs: vec![] },
            SimEcu { address: 0x60, ident: "KOMBI L6 9187068 hw01 sw10.02 ci06", dtcs: vec![] },
            SimEcu { address: 0x72, ident: "FRM2 9241322 hw22 sw16.10 ci07", dtcs: vec![(0x9C, 0xBA, 0x21)] },
            SimEcu { address: 0x78, ident: "IHKA 9226613 hw02 sw08.30 ci02", dtcs: vec![] },
            SimEcu { address: 0x01, ident: "ACSM2 9166087 hw04 sw03.21 ci05", dtcs: vec![] },
        ];
        Self { ecus, started: Instant::now() }
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
            0xF190 => b"WBAVA31050NL12345".to_vec(),
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
            [0x14, ..] => {
                ecu.dtcs.clear();
                Ok(vec![0x54])
            }
            [0x22, _, _] => {
                let mut r = vec![0x62, payload[1], payload[2]];
                r.extend_from_slice(&live.unwrap());
                Ok(r)
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
