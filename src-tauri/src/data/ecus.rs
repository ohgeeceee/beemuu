//! BMW diagnostic ECU addresses (E-series style addressing).
//! The scanner probes each of these; absent modules simply time out.

pub struct EcuDef {
    pub address: u8,
    pub name: &'static str,
    pub description: &'static str,
}

pub const ECUS: &[EcuDef] = &[
    EcuDef { address: 0x12, name: "DME",   description: "Engine control (Digital Motor Electronics)" },
    EcuDef { address: 0x18, name: "EGS",   description: "Transmission control" },
    EcuDef { address: 0x29, name: "DSC",   description: "Dynamic stability control (ABS/DSC)" },
    EcuDef { address: 0x40, name: "CAS",   description: "Car access system (immobiliser, keys)" },
    EcuDef { address: 0x60, name: "KOMBI", description: "Instrument cluster" },
    EcuDef { address: 0x72, name: "FRM",   description: "Footwell module (lighting)" },
    EcuDef { address: 0x78, name: "IHKA",  description: "Climate control" },
    EcuDef { address: 0x01, name: "ACSM",  description: "Crash safety module (airbags)" },
    EcuDef { address: 0x30, name: "EPS",   description: "Electric power steering" },
    EcuDef { address: 0x64, name: "PDC",   description: "Park distance control" },
    EcuDef { address: 0x65, name: "SZL",   description: "Steering column switch cluster" },
    EcuDef { address: 0x70, name: "RAD",   description: "Radio / head unit" },
];

pub fn name_for(address: u8) -> (&'static str, &'static str) {
    ECUS.iter()
        .find(|e| e.address == address)
        .map(|e| (e.name, e.description))
        .unwrap_or(("UNKNOWN", "Unknown module"))
}
