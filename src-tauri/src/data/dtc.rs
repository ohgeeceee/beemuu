//! Fault-code text lookup.
//!
//! NOTE: BMW's official fault texts ship inside ISTA's proprietary database
//! and cannot be redistributed. This table carries community-known
//! descriptions for common codes; unknown codes fall back to a generic
//! label. Extend this table freely — format is (hex code, text).

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

pub fn lookup(code: &str) -> &'static str {
    DTC_TEXTS
        .iter()
        .find(|(c, _)| *c == code)
        .map(|(_, t)| *t)
        .unwrap_or("No description in local database — look up code in module documentation")
}
