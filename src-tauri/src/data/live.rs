//! Live-data parameter definitions, organised as engine profiles.
//!
//! A profile is a named set of parameters for one engine/vehicle variant.
//! Two profiles ship today:
//!   - "sim"  : DIDs matching the built-in simulator
//!   - "obd2" : standard OBD-II mode 01 PIDs — works on any 2007+ car,
//!              including the E70 X5 4.8i (N62B48), as the guaranteed baseline
//! BMW-specific profiles (proper N62 idents) get added here once mapped
//! with the Parameter Explorer on the real car.

use serde::Serialize;

#[derive(Clone, Copy)]
pub enum Query {
    /// readDataByIdentifier 22 <did:2>
    Did(u16),
    /// OBD-II mode 01 <pid>
    Obd(u8),
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
}

pub struct LiveParamDef {
    pub id: &'static str,
    pub label: &'static str,
    pub unit: &'static str,
    pub target: u8,
    pub query: Query,
    pub decode: Decode,
    pub min: f64,
    pub max: f64,
}

#[derive(Serialize)]
pub struct LiveValue {
    pub id: &'static str,
    pub label: &'static str,
    pub unit: &'static str,
    pub value: f64,
    pub min: f64,
    pub max: f64,
}

pub struct Profile {
    pub id: &'static str,
    pub label: &'static str,
    pub params: &'static [LiveParamDef],
}

const SIM_PARAMS: &[LiveParamDef] = &[
    LiveParamDef { id: "rpm",     label: "Engine speed",      unit: "rpm",  target: 0x12, query: Query::Did(0x1000), decode: Decode::U16,      min: 0.0,   max: 8000.0 },
    LiveParamDef { id: "coolant", label: "Coolant temp",      unit: "°C",   target: 0x12, query: Query::Did(0x1001), decode: Decode::TempU8,   min: -40.0, max: 150.0 },
    LiveParamDef { id: "oil",     label: "Oil temp",          unit: "°C",   target: 0x12, query: Query::Did(0x1002), decode: Decode::TempU8,   min: -40.0, max: 160.0 },
    LiveParamDef { id: "iat",     label: "Intake air temp",   unit: "°C",   target: 0x12, query: Query::Did(0x1003), decode: Decode::TempU8,   min: -40.0, max: 80.0 },
    LiveParamDef { id: "batt",    label: "Battery voltage",   unit: "V",    target: 0x12, query: Query::Did(0x1004), decode: Decode::U8Tenths, min: 8.0,   max: 16.0 },
    LiveParamDef { id: "speed",   label: "Vehicle speed",     unit: "km/h", target: 0x12, query: Query::Did(0x1005), decode: Decode::U8,       min: 0.0,   max: 300.0 },
    LiveParamDef { id: "load",    label: "Engine load",       unit: "%",    target: 0x12, query: Query::Did(0x1006), decode: Decode::U8,       min: 0.0,   max: 100.0 },
    LiveParamDef { id: "fuel",    label: "Fuel level",        unit: "%",    target: 0x12, query: Query::Did(0x1007), decode: Decode::U8,       min: 0.0,   max: 100.0 },
    LiveParamDef { id: "ambient", label: "Ambient temp",      unit: "°C",   target: 0x12, query: Query::Did(0x1008), decode: Decode::TempU8,   min: -40.0, max: 60.0 },
    LiveParamDef { id: "map",     label: "Manifold pressure", unit: "mbar", target: 0x12, query: Query::Did(0x1009), decode: Decode::U16,      min: 0.0,   max: 3000.0 },
];

/// Standard OBD-II mode 01 — emissions-mandated, so every 2007+ BMW DME
/// answers these regardless of variant.
const OBD2_PARAMS: &[LiveParamDef] = &[
    LiveParamDef { id: "rpm",     label: "Engine speed",     unit: "rpm",  target: 0x12, query: Query::Obd(0x0C), decode: Decode::U16Quarter, min: 0.0,   max: 8000.0 },
    LiveParamDef { id: "coolant", label: "Coolant temp",     unit: "°C",   target: 0x12, query: Query::Obd(0x05), decode: Decode::TempU8,     min: -40.0, max: 150.0 },
    LiveParamDef { id: "iat",     label: "Intake air temp",  unit: "°C",   target: 0x12, query: Query::Obd(0x0F), decode: Decode::TempU8,     min: -40.0, max: 80.0 },
    LiveParamDef { id: "speed",   label: "Vehicle speed",    unit: "km/h", target: 0x12, query: Query::Obd(0x0D), decode: Decode::U8,         min: 0.0,   max: 300.0 },
    LiveParamDef { id: "load",    label: "Engine load",      unit: "%",    target: 0x12, query: Query::Obd(0x04), decode: Decode::PercentA,   min: 0.0,   max: 100.0 },
    LiveParamDef { id: "throttle",label: "Throttle position",unit: "%",    target: 0x12, query: Query::Obd(0x11), decode: Decode::PercentA,   min: 0.0,   max: 100.0 },
    LiveParamDef { id: "map",     label: "Manifold pressure",unit: "kPa",  target: 0x12, query: Query::Obd(0x0B), decode: Decode::U8,         min: 0.0,   max: 255.0 },
    LiveParamDef { id: "fuel",    label: "Fuel level",       unit: "%",    target: 0x12, query: Query::Obd(0x2F), decode: Decode::PercentA,   min: 0.0,   max: 100.0 },
    LiveParamDef { id: "volt",    label: "Module voltage",   unit: "V",    target: 0x12, query: Query::Obd(0x42), decode: Decode::U16Milli,   min: 8.0,   max: 16.0 },
    LiveParamDef { id: "ambient", label: "Ambient temp",     unit: "°C",   target: 0x12, query: Query::Obd(0x46), decode: Decode::TempU8,     min: -40.0, max: 60.0 },
    LiveParamDef { id: "timing",  label: "Timing advance",   unit: "°",    target: 0x12, query: Query::Obd(0x0E), decode: Decode::U8,         min: 0.0,   max: 128.0 },
];

pub const PROFILES: &[Profile] = &[
    Profile { id: "obd2", label: "Generic OBD-II (any 2007+ car)", params: OBD2_PARAMS },
    Profile { id: "sim",  label: "Simulator (virtual E90)",        params: SIM_PARAMS },
];

pub fn profile(id: &str) -> Option<&'static Profile> {
    PROFILES.iter().find(|p| p.id == id)
}

pub fn decode(def: &LiveParamDef, data: &[u8]) -> Option<f64> {
    match def.decode {
        Decode::TempU8 => data.first().map(|&b| b as f64 - 40.0),
        Decode::U8 => data.first().map(|&b| b as f64),
        Decode::U8Tenths => data.first().map(|&b| b as f64 / 10.0),
        Decode::PercentA => data.first().map(|&b| b as f64 * 100.0 / 255.0),
        Decode::U16 | Decode::U16Quarter | Decode::U16Milli => {
            if data.len() >= 2 {
                let raw = u16::from_be_bytes([data[0], data[1]]) as f64;
                Some(match def.decode {
                    Decode::U16Quarter => raw / 4.0,
                    Decode::U16Milli => raw / 1000.0,
                    _ => raw,
                })
            } else {
                None
            }
        }
    }
}
