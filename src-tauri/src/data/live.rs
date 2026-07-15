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

#[derive(Clone, Copy, Debug, PartialEq)]
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
    /// u16 BE * 0.1 (BMW DIDs: battery V, HPFP MPa, boost kPa)
    U16Tenths,
    /// u16 BE * 0.01 (BMW DIDs: MAF kg/h, ambient kPa, torque Nm)
    U16Div100,
    /// i16 BE raw, two's complement (foundation for s16_div4/s16_div100)
    S16,
    /// i16 BE / 4 (DME temp °C, can be negative)
    S16Div4,
    /// i16 BE * 0.01 (engine torque Nm, ambient air °C; signed)
    S16Div100,
    /// u8 * 0.01 (lambda, injection ms)
    U8Div100,
    /// u8 / 4.0 (alternate DME temp scaling; u8 variant)
    U8Div4,
    /// u8 looked up against a per-parameter enum map (u8 -> label).
    /// Returns a string, not a number; see `decode_enum_string`.
    U8Enum,
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
    /// Optional per-parameter enum map used by [`Decode::U8Enum`].
    /// Empty for all numeric variants; only non-empty when the decode
    /// is [`Decode::U8Enum`].
    pub enum_map: std::collections::HashMap<u8, String>,
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
            // Built-in profiles never use enum maps; only community
            // TOML files can populate this. Empty map keeps
            // decode_enum_string as a no-op for built-ins.
            enum_map: std::collections::HashMap::new(),
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
    /// String label for enum-style parameters (gear position, engine
    /// state, knock state, etc.). `None` for numeric parameters.
    /// When present, the frontend should prefer this over `value`
    /// (which will be 0.0 for enums).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
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
        Decode::U8Div100 => data.first().map(|&b| b as f64 * 0.01),
        Decode::U8Div4 => data.first().map(|&b| b as f64 / 4.0),
        Decode::PercentA => data.first().map(|&b| b as f64 * 100.0 / 255.0),
        Decode::U16
        | Decode::U16Quarter
        | Decode::U16Milli
        | Decode::U16Times10
        | Decode::U16Tenths
        | Decode::U16Div100 => {
            if data.len() >= 2 {
                let raw = u16::from_be_bytes([data[0], data[1]]) as f64;
                Some(match decode {
                    Decode::U16Quarter => raw / 4.0,
                    Decode::U16Milli => raw / 1000.0,
                    Decode::U16Times10 => raw * 10.0,
                    Decode::U16Tenths => raw * 0.1,
                    Decode::U16Div100 => raw * 0.01,
                    _ => raw,
                })
            } else {
                None
            }
        }
        Decode::S16 | Decode::S16Div4 | Decode::S16Div100 => {
            if data.len() >= 2 {
                let raw = i16::from_be_bytes([data[0], data[1]]) as f64;
                Some(match decode {
                    Decode::S16Div4 => raw / 4.0,
                    Decode::S16Div100 => raw * 0.01,
                    _ => raw,
                })
            } else {
                None
            }
        }
        // U8Enum returns a string label, not a number. The numeric
        // pipeline always returns None for it; callers must use
        // `decode_enum_string` to resolve the label.
        Decode::U8Enum => None,
    }
}

/// Resolve a [`Decode::U8Enum`] (or future enum variants) against a
/// per-parameter label map. Returns `None` for any other variant, for
/// empty input, and for bytes that aren't in the map.
///
/// This deliberately stays separate from [`decode`] so the numeric
/// pipeline can keep returning `Option<f64>` without inventing a
/// string-or-number union type. The caller in `commands.rs::read_live_data`
/// branches on the variant and calls the right function.
pub fn decode_enum_string(
    decode: Decode,
    data: &[u8],
    enum_map: &std::collections::HashMap<u8, String>,
) -> Option<String> {
    if !matches!(decode, Decode::U8Enum) {
        return None;
    }
    let byte = data.first().copied()?;
    enum_map.get(&byte).cloned()
}

/// Parse a decode name from TOML (e.g. "temp_u8", "u16_quarter").
pub fn decode_from_str(s: &str) -> Option<Decode> {
    Some(match s {
        "temp_u8" => Decode::TempU8,
        "u16" => Decode::U16,
        "u8" => Decode::U8,
        "u8_tenths" => Decode::U8Tenths,
        "u8_div100" => Decode::U8Div100,
        "u8_div4" => Decode::U8Div4,
        "u16_quarter" => Decode::U16Quarter,
        "percent_a" => Decode::PercentA,
        "u16_milli" => Decode::U16Milli,
        "u16_times10" => Decode::U16Times10,
        "u16_tenths" => Decode::U16Tenths,
        "u16_div100" => Decode::U16Div100,
        "s16" => Decode::S16,
        "s16_div4" => Decode::S16Div4,
        "s16_div100" => Decode::S16Div100,
        "u8_enum" => Decode::U8Enum,
        _ => return None,
    })
}

/// Parse a query from TOML (e.g. "did:1000", "obd:0C", "local:01").
pub fn query_from_str(s: &str) -> Option<Query> {
    let (kind, val) = s.split_once(':')?;
    let n = u16::from_str_radix(val.trim(), 16).ok()?;
    Some(match kind.trim().to_ascii_lowercase().as_str() {
        "did" => Query::Did(n),
        "obd" => Query::Obd(u8::try_from(n).ok()?),
        "local" => Query::Local(u8::try_from(n).ok()?),
        _ => return None,
    })
}

fn query_to_str(q: Query) -> String {
    match q {
        Query::Did(n) => format!("did:{n:04X}"),
        Query::Obd(n) => format!("obd:{n:02X}"),
        Query::Local(n) => format!("local:{n:02X}"),
    }
}

fn decode_to_str(d: Decode) -> &'static str {
    match d {
        Decode::TempU8 => "temp_u8",
        Decode::U16 => "u16",
        Decode::U8 => "u8",
        Decode::U8Tenths => "u8_tenths",
        Decode::U8Div100 => "u8_div100",
        Decode::U8Div4 => "u8_div4",
        Decode::U16Quarter => "u16_quarter",
        Decode::PercentA => "percent_a",
        Decode::U16Milli => "u16_milli",
        Decode::U16Times10 => "u16_times10",
        Decode::U16Tenths => "u16_tenths",
        Decode::U16Div100 => "u16_div100",
        Decode::S16 => "s16",
        Decode::S16Div4 => "s16_div4",
        Decode::S16Div100 => "s16_div100",
        Decode::U8Enum => "u8_enum",
    }
}

pub fn add_param_to_profile(profile_id: &str, param: LiveParam) -> Option<()> {
    let mut s = store().write().ok()?;
    let profile = s.iter_mut().find(|p| p.id == profile_id)?;
    profile.params.push(param);
    Some(())
}

pub fn profile_to_toml(id: &str) -> Option<String> {
    let p = store().read().ok()?.iter().find(|p| p.id == id)?.clone();
    let mut out = format!("[[profile]]\nid = {:?}\nlabel = {:?}\n\n", p.id, p.label);
    for param in p.params {
        out.push_str("[[profile.param]]\n");
        out.push_str(&format!("id = {:?}\n", param.id));
        out.push_str(&format!("label = {:?}\n", param.label));
        out.push_str(&format!("unit = {:?}\n", param.unit));
        out.push_str(&format!("target = {}\n", param.target));
        out.push_str(&format!("query = {:?}\n", query_to_str(param.query)));
        out.push_str(&format!("decode = {:?}\n", decode_to_str(param.decode)));
        out.push_str(&format!("min = {}\n", param.min));
        out.push_str(&format!("max = {}\n\n", param.max));
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    // ---- pre-existing decoders (regression coverage) ----

    #[test]
    fn u8_passthrough() {
        assert!(approx(decode(Decode::U8, &[0x42]).unwrap(), 66.0));
        assert!(approx(decode(Decode::U8, &[0x00]).unwrap(), 0.0));
        assert!(approx(decode(Decode::U8, &[0xFF]).unwrap(), 255.0));
    }

    #[test]
    fn u16_passthrough() {
        assert!(approx(decode(Decode::U16, &[0x01, 0x2C]).unwrap(), 300.0));
        assert!(approx(decode(Decode::U16, &[0xFF, 0xFF]).unwrap(), 65535.0));
    }

    #[test]
    fn temp_u8_offset() {
        // 0x00 = -40, 0xFF = 215
        assert!(approx(decode(Decode::TempU8, &[0x00]).unwrap(), -40.0));
        assert!(approx(decode(Decode::TempU8, &[0xFF]).unwrap(), 215.0));
        assert!(approx(decode(Decode::TempU8, &[0x80]).unwrap(), 88.0));
    }

    #[test]
    fn u8_tenths() {
        assert!(approx(decode(Decode::U8Tenths, &[0x00]).unwrap(), 0.0));
        assert!(approx(decode(Decode::U8Tenths, &[0x64]).unwrap(), 10.0)); // 100 / 10
        assert!(approx(decode(Decode::U8Tenths, &[0xFF]).unwrap(), 25.5));
    }

    #[test]
    fn u16_scaled_decoders() {
        // 0x00FF / 4 = 63.75
        assert!(approx(decode(Decode::U16Quarter, &[0x00, 0xFF]).unwrap(), 63.75));
        // 0x0BB8 / 1000 = 3.000 (3000 mV = 3.0 V for module voltage)
        assert!(approx(decode(Decode::U16Milli, &[0x0B, 0xB8]).unwrap(), 3.0));
        // 0x0064 * 10 = 1000 (100 kPa fuel rail)
        assert!(approx(decode(Decode::U16Times10, &[0x00, 0x64]).unwrap(), 1000.0));
    }

    #[test]
    fn percent_a_obd() {
        // 0x00 -> 0%, 0xFF -> ~100%, 0x80 -> ~50.2%
        assert!(approx(decode(Decode::PercentA, &[0x00]).unwrap(), 0.0));
        assert!(approx(decode(Decode::PercentA, &[0xFF]).unwrap(), 100.0));
        assert!((decode(Decode::PercentA, &[0x80]).unwrap() - 50.196).abs() < 0.01);
    }

    // ---- v0.3.0 new decoders ----

    #[test]
    fn u16_tenths_basic() {
        // 0x012C * 0.1 = 30.0 (DID 4002 battery voltage: raw 300 = 30.0 V)
        assert!(approx(decode(Decode::U16Tenths, &[0x01, 0x2C]).unwrap(), 30.0));
        // 0x00FF * 0.1 = 25.5 (HPFP rail max)
        assert!(approx(decode(Decode::U16Tenths, &[0x00, 0xFF]).unwrap(), 25.5));
        // 0x0000 = 0
        assert!(approx(decode(Decode::U16Tenths, &[0x00, 0x00]).unwrap(), 0.0));
        // 0xFFFF = 6553.5
        assert!(approx(decode(Decode::U16Tenths, &[0xFF, 0xFF]).unwrap(), 6553.5));
    }

    #[test]
        fn u16_div100_basic() {
            // 0x044C * 0.01 = 11.00 (MAF 1100 raw -> 11.00 kg/h)
            assert!(approx(decode(Decode::U16Div100, &[0x04, 0x4C]).unwrap(), 11.0));
            // 0xFF9C = 65436 raw * 0.01 = 654.36 (high ambient pressure)
            assert!(approx(decode(Decode::U16Div100, &[0xFF, 0x9C]).unwrap(), 654.36));
            // 0xFFFF * 0.01 = 655.35
            assert!(approx(decode(Decode::U16Div100, &[0xFF, 0xFF]).unwrap(), 655.35));
            // 0x0000 = 0
            assert!(approx(decode(Decode::U16Div100, &[0x00, 0x00]).unwrap(), 0.0));
        }

    #[test]
    fn s16_basic_negative() {
        // Two's complement: 0x8000 = -32768 (i16 min)
        assert!(approx(decode(Decode::S16, &[0x80, 0x00]).unwrap(), -32768.0));
        // 0xFFFC = -4
        assert!(approx(decode(Decode::S16, &[0xFF, 0xFC]).unwrap(), -4.0));
        // 0x0004 = 4
        assert!(approx(decode(Decode::S16, &[0x00, 0x04]).unwrap(), 4.0));
        // 0x7FFF = 32767 (i16 max)
        assert!(approx(decode(Decode::S16, &[0x7F, 0xFF]).unwrap(), 32767.0));
    }

    #[test]
    fn s16_div4_dme_temp() {
        // DID 4001 DME temp: raw 4 = 1°C, raw -4 = -1°C
        assert!(approx(decode(Decode::S16Div4, &[0x00, 0x04]).unwrap(), 1.0));
        assert!(approx(decode(Decode::S16Div4, &[0xFF, 0xFC]).unwrap(), -1.0));
        // 0x0100 = 256 raw / 4 = 64°C (typical operating temp)
        assert!(approx(decode(Decode::S16Div4, &[0x01, 0x00]).unwrap(), 64.0));
        // 0x0000 = 0°C
        assert!(approx(decode(Decode::S16Div4, &[0x00, 0x00]).unwrap(), 0.0));
        // 0xFC00 = -1024 raw / 4 = -256°C (extreme low, fault territory)
        assert!(approx(decode(Decode::S16Div4, &[0xFC, 0x00]).unwrap(), -256.0));
    }

    #[test]
    fn s16_div100_engine_torque() {
        // DID 4500 engine torque: signed, range -327.68 .. +327.67 Nm
        // 0x8000 = -32768 raw * 0.01 = -327.68 Nm
        assert!(approx(decode(Decode::S16Div100, &[0x80, 0x00]).unwrap(), -327.68));
        // 0x0000 = 0 Nm
        assert!(approx(decode(Decode::S16Div100, &[0x00, 0x00]).unwrap(), 0.0));
        // 0x01F4 = 500 raw * 0.01 = 5.00 Nm (idle torque)
        assert!(approx(decode(Decode::S16Div100, &[0x01, 0xF4]).unwrap(), 5.0));
        // 0xFF38 = -200 raw * 0.01 = -2.00 Nm (mild engine braking)
        assert!(approx(decode(Decode::S16Div100, &[0xFF, 0x38]).unwrap(), -2.0));
    }

    #[test]
    fn u8_div100_lambda_and_injection() {
        // DID 400B lambda: 0x64 = 100 * 0.01 = 1.00 (stoichiometric)
        assert!(approx(decode(Decode::U8Div100, &[0x64]).unwrap(), 1.0));
        // 0x46 = 70 * 0.01 = 0.70 (rich)
        assert!(approx(decode(Decode::U8Div100, &[0x46]).unwrap(), 0.70));
        // 0x82 = 130 * 0.01 = 1.30 (lean)
        assert!(approx(decode(Decode::U8Div100, &[0x82]).unwrap(), 1.30));
        // 0xFF = 2.55 (max or sensor error)
        assert!(approx(decode(Decode::U8Div100, &[0xFF]).unwrap(), 2.55));
        // DID 4363 injection: 0x32 = 50 * 0.01 = 0.50 ms
        assert!(approx(decode(Decode::U8Div100, &[0x32]).unwrap(), 0.50));
    }

    #[test]
    fn u8_div4_dme_temp_alternate() {
        // DID 4001 alternate scaling: raw 4 = 1°C
        assert!(approx(decode(Decode::U8Div4, &[0x04]).unwrap(), 1.0));
        // 0x80 = 128 / 4 = 32°C
        assert!(approx(decode(Decode::U8Div4, &[0x80]).unwrap(), 32.0));
        // 0x00 = 0°C
        assert!(approx(decode(Decode::U8Div4, &[0x00]).unwrap(), 0.0));
        // 0xFF = 63.75°C (u8 max, no negatives possible)
        assert!(approx(decode(Decode::U8Div4, &[0xFF]).unwrap(), 63.75));
    }

    // ---- short-buffer safety: every decoder must return None for too few bytes ----

    #[test]
    fn u16_family_short_buffer() {
        assert_eq!(decode(Decode::U16, &[0x01]), None);
        assert_eq!(decode(Decode::U16Quarter, &[0x01]), None);
        assert_eq!(decode(Decode::U16Milli, &[]), None);
        assert_eq!(decode(Decode::U16Times10, &[0x01]), None);
        assert_eq!(decode(Decode::U16Tenths, &[0x01]), None);
        assert_eq!(decode(Decode::U16Div100, &[]), None);
        assert_eq!(decode(Decode::S16, &[0x01]), None);
        assert_eq!(decode(Decode::S16Div4, &[0x01]), None);
        assert_eq!(decode(Decode::S16Div100, &[]), None);
    }

    #[test]
    fn u8_family_empty_buffer() {
        // u8-family should all return None on empty input
        assert_eq!(decode(Decode::U8, &[]), None);
        assert_eq!(decode(Decode::TempU8, &[]), None);
        assert_eq!(decode(Decode::U8Tenths, &[]), None);
        assert_eq!(decode(Decode::U8Div100, &[]), None);
        assert_eq!(decode(Decode::U8Div4, &[]), None);
        assert_eq!(decode(Decode::PercentA, &[]), None);
    }

    // ---- TOML round-trip: every decode string parses and serializes back ----

    #[test]
    fn decode_from_str_to_str_roundtrip() {
        let names = [
            "temp_u8", "u16", "u8", "u8_tenths", "u8_div100", "u8_div4",
            "u16_quarter", "percent_a", "u16_milli", "u16_times10",
            "u16_tenths", "u16_div100", "s16", "s16_div4", "s16_div100",
        ];
        for name in names {
            let d = decode_from_str(name)
                .unwrap_or_else(|| panic!("decode_from_str failed for {name}"));
            let back = decode_to_str(d);
            assert_eq!(back, name, "round-trip mismatch for {name}");
        }
    }

    #[test]
    fn decode_from_str_unknown_returns_none() {
        assert_eq!(decode_from_str("not_a_real_decoder"), None);
        assert_eq!(decode_from_str(""), None);
        assert_eq!(decode_from_str("U16_TENTHS"), None); // case-sensitive
    }

    // ---- u8_enum decoder (v0.4.0) ----
    //
    // Enums are resolved against a per-parameter map (u8 -> label) loaded
    // from TOML. Unknown bytes map to None (the caller can fall back to
    // showing the raw hex if it wants). The variant is gated so non-u8
    // decoders cannot accidentally be used as enums.

    fn gear_map() -> std::collections::HashMap<u8, String> {
        let mut m = std::collections::HashMap::new();
        m.insert(0x00, "P/N".to_string());
        m.insert(0x01, "1".to_string());
        m.insert(0x02, "2".to_string());
        m.insert(0x03, "3".to_string());
        m.insert(0x04, "4".to_string());
        m.insert(0x05, "5".to_string());
        m.insert(0x06, "6".to_string());
        m.insert(0x0F, "Error".to_string());
        m
    }

    #[test]
    fn u8_enum_known_byte_resolves_to_label() {
        let m = gear_map();
        // DID DA0A (gear position): 0x00 = P/N
        assert_eq!(
            decode_enum_string(Decode::U8Enum, &[0x00], &m),
            Some("P/N".to_string())
        );
        // 0x03 = "3"
        assert_eq!(
            decode_enum_string(Decode::U8Enum, &[0x03], &m),
            Some("3".to_string())
        );
        // 0x0F = "Error"
        assert_eq!(
            decode_enum_string(Decode::U8Enum, &[0x0F], &m),
            Some("Error".to_string())
        );
    }

    #[test]
    fn u8_enum_unknown_byte_returns_none() {
        // Byte not in the enum map -> None (caller can fall back to hex)
        let m = gear_map();
        assert_eq!(decode_enum_string(Decode::U8Enum, &[0x07], &m), None);
        assert_eq!(decode_enum_string(Decode::U8Enum, &[0xAB], &m), None);
    }

    #[test]
    fn u8_enum_empty_buffer_returns_none() {
        let m = gear_map();
        assert_eq!(decode_enum_string(Decode::U8Enum, &[], &m), None);
    }

    #[test]
    fn u8_enum_empty_map_returns_none_for_any_byte() {
        // No entries at all -> every byte is unknown
        let m = std::collections::HashMap::new();
        assert_eq!(decode_enum_string(Decode::U8Enum, &[0x00], &m), None);
        assert_eq!(decode_enum_string(Decode::U8Enum, &[0xFF], &m), None);
    }

    #[test]
    fn u8_enum_only_applies_to_u8_enum_variant() {
        // Even with a populated enum map, asking a numeric decoder for its
        // "enum string" must return None — the variant gates the behaviour.
        let m = gear_map();
        assert_eq!(decode_enum_string(Decode::U8, &[0x00], &m), None);
        assert_eq!(decode_enum_string(Decode::U16, &[0x00, 0x00], &m), None);
        assert_eq!(decode_enum_string(Decode::U8Div100, &[0x64], &m), None);
    }

    #[test]
    fn u8_enum_roundtrips_via_decode_from_str_and_to_str() {
        let d = decode_from_str("u8_enum")
            .expect("decode_from_str(\"u8_enum\") should succeed");
        assert_eq!(d, Decode::U8Enum);
        assert_eq!(decode_to_str(Decode::U8Enum), "u8_enum");
    }
}
