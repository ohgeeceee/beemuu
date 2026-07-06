//! Live-data parameter definitions, organised as engine profiles.
//!
//! Profiles live in a runtime store seeded with the built-ins below and
//! extended at startup from `community/profiles.toml` (see `crate::community`),
//! so contributors can add engine-specific parameter maps without touching
//! Rust. A profile is a named set of parameters for one engine/vehicle variant.

use serde::Serialize;
use std::sync::{OnceLock, RwLock};

#[derive(Clone, Copy)]
pub enum Query {
    /// readDataByIdentifier 22 <did:2>
    Did(u16),
    /// OBD-II mode 01 <pid>
    Obd(u8),
    /// KWP readDataByLocalIdentifier 21 <id>
    Local(u8),
}

#[derive(Clone, Copy)]
pub enum Decode {
    /// u8: raw - 40 (°C)
    TempU8,
    /// u16 BE raw
    U16,
    /// u8 raw
    U8,
    /// u8 / 10.0
    U8Tenths,
    /// u16 BE / 4 (OBD RPM)
    U16Quarter,
    /// u8 * 100 / 255 (OBD percent)
    PercentA,
    /// u16 BE / 1000 (OBD module voltage)
    U16Milli,
    /// u16 BE * 10 (OBD fuel rail pressure, kPa)
    U16Times10,
}

#[derive(Clone)]
pub struct LiveParam {
    pub id: String,
    pub label: String,
    pub unit: String,
    pub target: u8,
    pub query: Query,
    pub decode: Decode,
    pub min: f64,
    pub max: f64,
}

impl LiveParam {
    /// Convenience constructor for the built-in tables.
    fn new(
        id: &str,
        label: &str,
        unit: &str,
        target: u8,
        query: Query,
        decode: Decode,
        min: f64,
        max: f64,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            unit: unit.into(),
            target,
            query,
            decode,
            min,
            max,
        }
    }
}

#[derive(Serialize)]
pub struct LiveValue {
    pub id: String,
    pub label: String,
    pub unit: String,
    pub value: f64,
    pub min: f64,
    pub max: f64,
}

#[derive(Clone)]
pub struct Profile {
    pub id: String,
    pub label: String,
    pub params: Vec<LiveParam>,
}

fn builtin_profiles() -> Vec<Profile> {
    use Decode::*;
    use Query::*;
    let obd2 = Profile {
        id: "obd2".into(),
        label: "Generic OBD-II (any 2007+ car)".into(),
        params: vec![
            LiveParam::new("rpm", "Engine speed", "rpm", 0x12, Obd(0x0C), U16Quarter, 0.0, 8000.0),
            LiveParam::new("coolant", "Coolant temp", "°C", 0x12, Obd(0x05), TempU8, -40.0, 150.0),
            LiveParam::new("iat", "Intake air temp", "°C", 0x12, Obd(0x0F), TempU8, -40.0, 80.0),
            LiveParam::new("speed", "Vehicle speed", "km/h", 0x12, Obd(0x0D), U8, 0.0, 300.0),
            LiveParam::new("load", "Engine load", "%", 0x12, Obd(0x04), PercentA, 0.0, 100.0),
            LiveParam::new("throttle", "Throttle position", "%", 0x12, Obd(0x11), PercentA, 0.0, 100.0),
            LiveParam::new("map", "Manifold pressure", "kPa", 0x12, Obd(0x0B), U8, 0.0, 255.0),
            LiveParam::new("fuel", "Fuel level", "%", 0x12, Obd(0x2F), PercentA, 0.0, 100.0),
            LiveParam::new("volt", "Module voltage", "V", 0x12, Obd(0x42), U16Milli, 8.0, 16.0),
            LiveParam::new("ambient", "Ambient temp", "°C", 0x12, Obd(0x46), TempU8, -40.0, 60.0),
            LiveParam::new("timing", "Timing advance", "°", 0x12, Obd(0x0E), U8, 0.0, 128.0),
        ],
    };
    let sim = Profile {
        id: "sim".into(),
        label: "Simulator (virtual E90)".into(),
        params: vec![
            LiveParam::new("rpm", "Engine speed", "rpm", 0x12, Did(0x1000), U16, 0.0, 8000.0),
            LiveParam::new("coolant", "Coolant temp", "°C", 0x12, Did(0x1001), TempU8, -40.0, 150.0),
            LiveParam::new("oil", "Oil temp", "°C", 0x12, Did(0x1002), TempU8, -40.0, 160.0),
            LiveParam::new("iat", "Intake air temp", "°C", 0x12, Did(0x1003), TempU8, -40.0, 80.0),
            LiveParam::new("batt", "Battery voltage", "V", 0x12, Did(0x1004), U8Tenths, 8.0, 16.0),
            LiveParam::new("speed", "Vehicle speed", "km/h", 0x12, Did(0x1005), U8, 0.0, 300.0),
            LiveParam::new("load", "Engine load", "%", 0x12, Did(0x1006), U8, 0.0, 100.0),
            LiveParam::new("fuel", "Fuel level", "%", 0x12, Did(0x1007), U8, 0.0, 100.0),
            LiveParam::new("ambient", "Ambient temp", "°C", 0x12, Did(0x1008), TempU8, -40.0, 60.0),
            LiveParam::new("map", "Manifold pressure", "mbar", 0x12, Did(0x1009), U16, 0.0, 3000.0),
        ],
    };
    vec![obd2, sim]
}

fn store() -> &'static RwLock<Vec<Profile>> {
    static STORE: OnceLock<RwLock<Vec<Profile>>> = OnceLock::new();
    STORE.get_or_init(|| RwLock::new(builtin_profiles()))
}

/// Add or replace a profile (same `id` replaces). Used by the TOML loader.
pub fn add_profile(profile: Profile) {
    let mut s = store().write().unwrap();
    if let Some(existing) = s.iter_mut().find(|p| p.id == profile.id) {
        *existing = profile;
    } else {
        s.push(profile);
    }
}

/// (id, label) pairs for the profile selector.
pub fn profile_list() -> Vec<(String, String)> {
    store().read().unwrap().iter().map(|p| (p.id.clone(), p.label.clone())).collect()
}

/// Clone one profile's parameters by id.
pub fn profile_params(id: &str) -> Option<Vec<LiveParam>> {
    store().read().unwrap().iter().find(|p| p.id == id).map(|p| p.params.clone())
}

pub fn decode(decode: Decode, data: &[u8]) -> Option<f64> {
    match decode {
        Decode::TempU8 => data.first().map(|&b| b as f64 - 40.0),
        Decode::U8 => data.first().map(|&b| b as f64),
        Decode::U8Tenths => data.first().map(|&b| b as f64 / 10.0),
        Decode::PercentA => data.first().map(|&b| b as f64 * 100.0 / 255.0),
        Decode::U16 | Decode::U16Quarter | Decode::U16Milli | Decode::U16Times10 => {
            if data.len() >= 2 {
                let raw = u16::from_be_bytes([data[0], data[1]]) as f64;
                Some(match decode {
                    Decode::U16Quarter => raw / 4.0,
                    Decode::U16Milli => raw / 1000.0,
                    Decode::U16Times10 => raw * 10.0,
                    _ => raw,
                })
            } else {
                None
            }
        }
    }
}

/// Parse a decode name from TOML (e.g. "temp_u8", "u16_quarter").
pub fn decode_from_str(s: &str) -> Option<Decode> {
    Some(match s {
        "temp_u8" => Decode::TempU8,
        "u16" => Decode::U16,
        "u8" => Decode::U8,
        "u8_tenths" => Decode::U8Tenths,
        "u16_quarter" => Decode::U16Quarter,
        "percent_a" => Decode::PercentA,
        "u16_milli" => Decode::U16Milli,
        "u16_times10" => Decode::U16Times10,
        _ => return None,
    })
}

/// Parse a query from TOML (e.g. "did:1000", "obd:0C", "local:01").
pub fn query_from_str(s: &str) -> Option<Query> {
    let (kind, val) = s.split_once(':')?;
    let n = u16::from_str_radix(val.trim(), 16).ok()?;
    Some(match kind.trim() {
        "did" => Query::Did(n),
        "obd" => Query::Obd(n as u8),
        "local" => Query::Local(n as u8),
        _ => return None,
    })
}

/// Inverse of `query_from_str`, for exporting a profile.
pub fn query_to_str(q: Query) -> String {
    match q {
        Query::Did(n) => format!("did:{n:04X}"),
        Query::Obd(n) => format!("obd:{n:02X}"),
        Query::Local(n) => format!("local:{n:02X}"),
    }
}

/// Inverse of `decode_from_str`, for exporting a profile.
pub fn decode_to_str(d: Decode) -> &'static str {
    match d {
        Decode::TempU8 => "temp_u8",
        Decode::U16 => "u16",
        Decode::U8 => "u8",
        Decode::U8Tenths => "u8_tenths",
        Decode::U16Quarter => "u16_quarter",
        Decode::PercentA => "percent_a",
        Decode::U16Milli => "u16_milli",
        Decode::U16Times10 => "u16_times10",
    }
}

/// Add a parameter to an existing profile (or replace one with the same id).
pub fn add_param_to_profile(id: &str, param: LiveParam) -> Option<()> {
    let mut s = store().write().unwrap();
    let p = s.iter_mut().find(|p| p.id == id)?;
    p.params.retain(|pr| pr.id != param.id);
    p.params.push(param);
    Some(())
}
pub fn profile_to_toml(id: &str) -> Option<String> {
    let s = store().read().unwrap();
    let p = s.iter().find(|p| p.id == id)?;
    let mut out = String::new();
    out.push_str("[[profile]]\n");
    out.push_str(&format!("id = {:?}\n", p.id));
    out.push_str(&format!("label = {:?}\n", p.label));
    for pr in &p.params {
        out.push_str("\n  [[profile.param]]\n");
        out.push_str(&format!("  id = {:?}\n", pr.id));
        out.push_str(&format!("  label = {:?}\n", pr.label));
        out.push_str(&format!("  unit = {:?}\n", pr.unit));
        out.push_str(&format!("  target = 0x{:02X}\n", pr.target));
        out.push_str(&format!("  query = {:?}\n", query_to_str(pr.query)));
        out.push_str(&format!("  decode = {:?}\n", decode_to_str(pr.decode)));
        out.push_str(&format!("  min = {:?}\n", pr.min));
        out.push_str(&format!("  max = {:?}\n", pr.max));
    }
    Some(out)
}
