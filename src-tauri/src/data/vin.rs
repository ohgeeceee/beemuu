//! Minimal VIN decoder for BMW vehicles.
//!
//! Decodes the World Manufacturer Identifier, model year (position 10), and
//! assembly plant (position 11) from a 17-character VIN. BMW does not encode
//! the exact model in a publicly-standard way in the VIN, so model/engine
//! are left to the module identification and the user; this covers the
//! universally-decodable fields.

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct VinDecode {
    pub wmi: String,
    pub manufacturer: String,
    pub model_year: Option<u16>,
    pub plant: String,
    pub serial: String,
}

fn manufacturer(wmi: &str) -> &'static str {
    match wmi {
        "WBA" => "BMW AG (passenger car, Germany)",
        "WBS" => "BMW M GmbH",
        "WBX" => "BMW (SAV/X models)",
        "WBY" => "BMW (i models)",
        "4US" => "BMW Manufacturing (USA)",
        "5UX" => "BMW (SAV, USA — Spartanburg)",
        "5YM" => "BMW M (USA — Spartanburg)",
        _ => "Unknown / non-BMW",
    }
}

/// VIN position 10 → model year (ISO 3779 cycle; BMW skips U,Z,0,I,O,Q).
fn model_year(c: char) -> Option<u16> {
    let table = "ABCDEFGHJKLMNPRSTVWXY123456789";
    // 2010 = 'A' in the current cycle for these chassis; cycle repeats every 30.
    let base = 2010u16;
    table.chars().position(|x| x == c).map(|i| base + i as u16)
}

fn plant(c: char) -> &'static str {
    match c {
        'A' | 'F' | 'K' => "Munich, Germany",
        'B' | 'G' => "Dingolfing, Germany",
        'C' | 'V' => "Spartanburg, USA",
        'E' | 'D' => "Regensburg, Germany",
        'L' => "Leipzig, Germany",
        'N' => "Rosslyn, South Africa",
        'P' => "Shenyang, China",
        'S' | 'T' => "Rayong, Thailand",
        _ => "Unknown plant",
    }
}

pub fn decode(vin_str: &str) -> VinDecode {
    let s = vin_str.trim();
    let chars: Vec<char> = s.chars().collect();
    let wmi: String = chars.iter().take(3).collect();
    let year_char = chars.get(9).copied();
    let plant_char = chars.get(10).copied();
    let serial: String = chars.iter().skip(11).collect();
    VinDecode {
        manufacturer: manufacturer(&wmi).to_string(),
        wmi,
        model_year: year_char.and_then(model_year),
        plant: plant_char.map(plant).unwrap_or("Unknown plant").to_string(),
        serial,
    }
}
