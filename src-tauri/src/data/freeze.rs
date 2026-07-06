//! Freeze-frame (environmental snapshot) schemas — declarative, per-ECU.
//!
//! A DTC's freeze frame is a variable-length blob whose byte layout differs
//! by ECU and firmware. Rather than hardcode a decode, each ECU registers a
//! `FreezeSchema`: an ordered list of fields, each mapping a byte offset +
//! width to a physical value via a linear transform (`raw * scale + bias`).
//!
//! ## Adding a schema for a real module
//!
//! ```ignore
//! use crate::data::freeze::{registry, FreezeField, FreezeSchema, Width};
//!
//! registry().register_for(0x12, FreezeSchema { fields: vec![
//!     FreezeField::new("Engine speed", "rpm", 0, Width::U16, 1.0, 0.0, 0),
//!     FreezeField::new("Coolant temp", "°C", 2, Width::U8, 1.0, -40.0, 0),
//!     // ...map offsets you confirmed with the Parameter Explorer
//! ]});
//! ```
//!
//! Unknown ECUs fall back to the default schema (the simulator's 9-byte
//! layout). If a schema's field runs past the payload, that field is skipped
//! rather than erroring, so a too-short frame still decodes what it can.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

/// One decoded freeze-frame value, ready for display.
#[derive(Debug, Serialize, Clone)]
pub struct FreezeItem {
    pub label: String,
    pub value: String,
}

/// Byte width + signedness of a raw field.
#[derive(Debug, Clone, Copy)]
pub enum Width {
    U8,
    I8,
    U16, // big-endian
    I16, // big-endian
    U24, // big-endian
}

impl Width {
    fn len(self) -> usize {
        match self {
            Width::U8 | Width::I8 => 1,
            Width::U16 | Width::I16 => 2,
            Width::U24 => 3,
        }
    }

    /// Read the raw integer at `offset`, or None if it doesn't fit.
    fn read(self, data: &[u8], offset: usize) -> Option<f64> {
        let end = offset + self.len();
        if end > data.len() {
            return None;
        }
        let s = &data[offset..end];
        Some(match self {
            Width::U8 => s[0] as f64,
            Width::I8 => s[0] as i8 as f64,
            Width::U16 => u16::from_be_bytes([s[0], s[1]]) as f64,
            Width::I16 => i16::from_be_bytes([s[0], s[1]]) as f64,
            Width::U24 => (((s[0] as u32) << 16) | ((s[1] as u32) << 8) | s[2] as u32) as f64,
        })
    }
}

/// A single field in a freeze-frame schema.
#[derive(Debug, Clone)]
pub struct FreezeField {
    pub label: &'static str,
    pub unit: &'static str,
    pub offset: usize,
    pub width: Width,
    pub scale: f64,
    pub bias: f64,
    pub decimals: u8,
}

impl FreezeField {
    pub const fn new(
        label: &'static str,
        unit: &'static str,
        offset: usize,
        width: Width,
        scale: f64,
        bias: f64,
        decimals: u8,
    ) -> Self {
        Self { label, unit, offset, width, scale, bias, decimals }
    }

    fn decode(&self, data: &[u8]) -> Option<FreezeItem> {
        let raw = self.width.read(data, self.offset)?;
        let v = raw * self.scale + self.bias;
        let num = format!("{:.*}", self.decimals as usize, v);
        let value = if self.unit.is_empty() { num } else { format!("{num} {}", self.unit) };
        Some(FreezeItem { label: self.label.to_string(), value })
    }
}

/// An ordered set of fields describing one ECU's freeze-frame layout.
#[derive(Debug, Clone)]
pub struct FreezeSchema {
    pub fields: Vec<FreezeField>,
}

impl FreezeSchema {
    /// Decode a payload, skipping fields that run past its end. Always
    /// appends the raw hex so nothing is hidden.
    pub fn decode(&self, data: &[u8]) -> Vec<FreezeItem> {
        let mut out: Vec<FreezeItem> = self.fields.iter().filter_map(|f| f.decode(data)).collect();
        out.push(FreezeItem {
            label: "Raw".to_string(),
            value: data.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" "),
        });
        out
    }
}

/// The simulator's 9-byte layout (also the fallback for unmapped ECUs):
/// rpm(u16), coolant(u8-40), speed(u8), load(u8), volts(u8/10), mileage(u24).
fn default_schema() -> FreezeSchema {
    FreezeSchema {
        fields: vec![
            FreezeField::new("Engine speed", "rpm", 0, Width::U16, 1.0, 0.0, 0),
            FreezeField::new("Coolant temp", "°C", 2, Width::U8, 1.0, -40.0, 0),
            FreezeField::new("Vehicle speed", "km/h", 3, Width::U8, 1.0, 0.0, 0),
            FreezeField::new("Engine load", "%", 4, Width::U8, 1.0, 0.0, 0),
            FreezeField::new("Battery voltage", "V", 5, Width::U8, 0.1, 0.0, 1),
            FreezeField::new("Mileage", "km", 6, Width::U24, 1.0, 0.0, 0),
        ],
    }
}

/// Per-ECU schema registry. `None` key = default fallback.
pub struct FreezeRegistry {
    map: RwLock<HashMap<Option<u8>, FreezeSchema>>,
}

impl FreezeRegistry {
    fn new() -> Self {
        Self { map: RwLock::new(HashMap::new()) }
    }

    /// Register (or replace) the schema for a specific ECU address.
    pub fn register_for(&self, address: u8, schema: FreezeSchema) {
        self.map.write().unwrap().insert(Some(address), schema);
    }

    /// Replace the default fallback schema.
    pub fn register_default(&self, schema: FreezeSchema) {
        self.map.write().unwrap().insert(None, schema);
    }

    /// Decode a payload using this ECU's schema, or the default.
    pub fn decode(&self, address: u8, data: &[u8]) -> Vec<FreezeItem> {
        let m = self.map.read().unwrap();
        let schema = m.get(&Some(address)).or_else(|| m.get(&None));
        match schema {
            Some(s) => s.decode(data),
            None => vec![FreezeItem {
                label: "Raw".to_string(),
                value: data.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" "),
            }],
        }
    }
}

/// Global freeze-frame registry, seeded with the default schema.
pub fn registry() -> &'static FreezeRegistry {
    static REG: OnceLock<FreezeRegistry> = OnceLock::new();
    REG.get_or_init(|| {
        let r = FreezeRegistry::new();
        r.register_default(default_schema());
        r
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_layout_decodes() {
        // rpm=750, coolant=90(=130-40), speed=0, load=20, volts=13.9(=139/10), mileage=123456
        let data = [0x02, 0xEE, 0x82, 0x00, 0x14, 0x8B, 0x01, 0xE2, 0x40];
        let items = registry().decode(0x12, &data);
        assert_eq!(items[0].value, "750 rpm");
        assert_eq!(items[1].value, "90 °C");
        assert_eq!(items[4].value, "13.9 V");
        assert_eq!(items[5].value, "123456 km");
    }

    #[test]
    fn short_payload_skips_missing_fields() {
        // Only rpm + coolant present; later fields skipped, raw still appended.
        let data = [0x02, 0xEE, 0x82];
        let items = registry().decode(0x12, &data);
        assert_eq!(items[0].value, "750 rpm");
        assert_eq!(items[1].value, "90 °C");
        assert_eq!(items.last().unwrap().label, "Raw");
    }

    #[test]
    fn signed_field_handles_negative() {
        let s = FreezeSchema { fields: vec![FreezeField::new("t", "°C", 0, Width::I8, 1.0, 0.0, 0)] };
        assert_eq!(s.decode(&[0xF6])[0].value, "-10 °C"); // 0xF6 = -10
    }
}
