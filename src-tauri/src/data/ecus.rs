//! BMW diagnostic ECU addresses — one-byte target addresses probed by the
//! ISTA-style module scan (`commands::scan_modules`). The same u8 addressing
//! model works on E-series K+DCAN and on F/G-series ENET (HSFZ frames carry
//! one-byte src/tgt; the ZGW routes them) — see
//! `docs/hardware/addressing-model.md`. The scanner probes each entry;
//! absent modules simply time out, so every address here should be one a
//! real car can plausibly answer.
//!
//! Provenance (kept honest — v0.8.0 audit):
//!   * 0x12, 0x18, 0x29, 0x40, 0x60: confirmed in-repo by the OBDb-verified
//!     DIDs in `research/bmw_diag_dim04_uds_dids.md` and by simulator idents.
//!   * 0x01, 0x72, 0x78: no OBDb DID coverage, but confirmed by the
//!     simulator plus the DTC text corpus (`data/dtc.rs` FRM 9CBA/9CBB/A0B4;
//!     `community/dtc_texts.toml` IHKA 9Cxx / ACSM 93xx ranges).
//!   * 0x30, 0x64, 0x65, 0x70: standard E-series assignments carried since
//!     the first scan table; no in-repo DID or DTC evidence yet. Kept
//!     because absent modules only cost one timeout.
//!   * 0x07, 0x0D, 0x19, 0x56, 0x63: F/G-series additions grounded in the
//!     OBDb-verified DIDs of `research/bmw_diag_dim04_uds_dids.md` (noted
//!     per entry).

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
    // F/G-series additions (sources: research/bmw_diag_dim04_uds_dids.md).
    // Chassis-variant DSC target: 5-Series/X5 answer the same wheel-speed
    // DID DBE4 at 0x19 where 3/4-Series/X3/Z4 use 0x29 (dim04 did:DBE4 note,
    // plus did:DB32/did:DFE7 at 0x19). A given car has one or the other.
    EcuDef { address: 0x19, name: "DSC",   description: "Dynamic stability control, 5-Series/X5 chassis variant of 0x29" },
    // Body-domain module (FRM/JBE successor role): door/hood/trunk/lock
    // states via did:DCDD on 3/4/5-Series, X3/X5, Z4 (2012+).
    EcuDef { address: 0x56, name: "Body",  description: "Body-domain module, F-series FRM/JBE successor role (doors, locks)" },
    // Current-gear DID D031 answers here on 5-Series/Z4 (dim04 labels the
    // target "Other") — likely an EGS/GWS variant address; exact module
    // naming unconfirmed.
    EcuDef { address: 0x63, name: "GWS",   description: "Gear selector / transmission variant (current-gear DID; module naming unconfirmed)" },
    // Second instrument-cluster target: vehicle speed did:D240 answers
    // here independently of 0x60/D107 across 3/4/5-Series, X3/X5.
    EcuDef { address: 0x0D, name: "KOMBI", description: "Instrument cluster, secondary target (vehicle speed)" },
    // HV battery management (SME) — PHEV/BEV variants only (X5/5-Series
    // hybrid DIDs 6335/DD69/DDBC/…). Gasoline cars just time out here.
    EcuDef { address: 0x07, name: "SME",   description: "HV battery management (PHEV/BEV only)" },
];

pub fn name_for(address: u8) -> (&'static str, &'static str) {
    ECUS.iter()
        .find(|e| e.address == address)
        .map(|e| (e.name, e.description))
        .unwrap_or(("UNKNOWN", "Unknown module"))
}
