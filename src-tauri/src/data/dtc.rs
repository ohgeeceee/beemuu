//! Fault-code text lookup.
//!
//! NOTE: BMW's official fault texts ship inside ISTA's proprietary database
//! and cannot be redistributed. This table carries community-known
//! descriptions for common codes; unknown codes fall back to a generic
//! label. Contributors can add codes here, or — without recompiling — via
//! `community/dtc_texts.toml`, which is merged into a runtime overlay that
//! takes precedence over this built-in table.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

fn overlay() -> &'static RwLock<HashMap<String, String>> {
    static OVERLAY: OnceLock<RwLock<HashMap<String, String>>> = OnceLock::new();
    OVERLAY.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Add or replace a community fault text (called by the TOML loader).
/// Codes are stored upper-case so lookups are case-insensitive.
pub fn set_text(code: &str, text: &str) {
    overlay().write().unwrap().insert(code.to_uppercase(), text.to_string());
}

/// Number of community-supplied texts currently loaded.
pub fn overlay_count() -> usize {
    overlay().read().unwrap().len()
}

const DTC_TEXTS: &[(&str, &str)] = &[
    ("2A82", "VANOS intake: control fault, camshaft stuck"),
    ("2A87", "VANOS exhaust: control fault, camshaft stuck"),
    ("30FF", "Charge-air pressure control: pressure too low"),
    ("30F0", "Charge-air pressure control: plausibility"),
    ("2E81", "Electric coolant pump: speed deviation"),
    ("2E82", "Electric coolant pump: cutoff"),
    ("29CC", "Misfire, several cylinders"),
    ("29CD", "Misfire cylinder 1"),
    ("29CE", "Misfire cylinder 2"),
    ("29CF", "Misfire cylinder 3"),
    ("29D0", "Misfire cylinder 4"),
    ("29D1", "Misfire cylinder 5"),
    ("29D2", "Misfire cylinder 6"),
    ("2C9C", "Fuel low-pressure sensor: signal"),
    ("2FBF", "Oil pressure control: static"),
    ("278A", "Valvetronic: guard-band violation"),
    ("2DED", "Mass air flow sensor: signal"),
    ("5DF0", "DSC: hydraulic pump, mechanical fault"),
    ("5E20", "DSC: wheel-speed sensor front left"),
    ("5E21", "DSC: wheel-speed sensor front right"),
    ("9CBA", "FRM: rear left turn indicator, open circuit"),
    ("9CBB", "FRM: rear right turn indicator, open circuit"),
    ("A0B4", "FRM: headlight driver, low beam left"),
    ("9312", "CAS: terminal 15 wake-up line"),
    ("D354", "EGS: gear monitoring, gear 4"),
    ("4F81", "EGS: ratio monitoring, clutch A"),
    ("930B", "KOMBI: fuel sender, right, implausible"),
];

/// Look up fault text: community overlay first, then the built-in table,
/// then a generic fallback. Case-insensitive on the hex code.
pub fn lookup(code: &str) -> String {
    let upper = code.to_uppercase();
    if let Some(t) = overlay().read().unwrap().get(&upper) {
        return t.clone();
    }
    DTC_TEXTS
        .iter()
        .find(|(c, _)| c.eq_ignore_ascii_case(&upper))
        .map(|(_, t)| t.to_string())
        .unwrap_or_else(|| {
            "No description in local database — look up code in module documentation".to_string()
        })
}
