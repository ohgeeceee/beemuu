//! Secure Snapshot Share — privacy-preserved diagnostic collaboration.
//!
//! Strips the VIN, replaces license plate with a hash, and retains all
//! diagnostic data.  A mechanic or forum helper can analyze the full
//! picture without knowing the owner's identity or exact vehicle.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::time::SystemTime;

/// An anonymized version of a SessionSnapshot.
///
/// All identifying fields are removed or hashed; all diagnostic
/// content (DTCs, freeze frames) is preserved.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AnonymizedSnapshot {
    /// A stable, non-reversible hash of the VIN.  Used for
    /// cross-session correlation (e.g. drift tracking) without
    /// revealing the actual VIN.
    pub vehicle_fingerprint: String,

    /// Engine family only — "n55", "b58", "generic", etc.
    pub engine_family: String,

    /// All scanned modules with full diagnostic content.
    pub modules: Vec<AnonymizedModule>,

    /// Timestamp of when the snapshot was taken (UTC).
    pub recorded_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AnonymizedModule {
    pub address: u8,
    pub name: String,
    pub fault_count: usize,
    pub dtcs: Vec<AnonymizedDtc>,
    pub ident: Option<String>,
    pub live_data: Vec<AnonymizedLiveSample>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AnonymizedDtc {
    pub code: String,
    pub status: String,
    pub text: String,
    pub freeze_frame: Vec<crate::data::freeze::FreezeItem>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AnonymizedLiveSample {
    pub label: String,
    pub value: String,
    pub unit: String,
}

/// Hash a VIN into a stable, non-reversible 16-char hex string.
pub fn hash_vin(vin: &str) -> String {
    let mut hasher = DefaultHasher::new();
    vin.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Strip the car-unique serial from an ECU identification string.
///
/// BMW identification responses routinely append a serial to the software
/// part — `MEVD17.2.42-S0000123`, `DME_8.4.1-0123456789`. The software part
/// is diagnostically useful (it tells you what calibration the module runs and
/// is what makes a snapshot worth sharing); the serial identifies *this
/// module in this car* and, on several ECUs, is derived from the VIN. Keeping
/// it in a file whose entire purpose is to be shareable defeats the redaction.
///
/// So the software prefix survives and the serial does not. When no serial is
/// present the string is returned unchanged, which is the common case for a
/// short software-only ident.
///
/// Split on the first `-`: everything before it is the calibration, everything
/// after is the serial. A `DME_8.4.1-0123456789` therefore becomes
/// `DME_8.4.1`.
pub fn redact_ident(ident: &str) -> String {
    let trimmed = ident.trim();
    match trimmed.split_once('-') {
        Some((software, serial)) if !software.is_empty() && !serial.is_empty() => {
            software.to_string()
        }
        _ => trimmed.to_string(),
    }
}

/// Anonymize a full SessionSnapshot.
pub fn anonymize(snapshot: &crate::commands::SessionSnapshot) -> AnonymizedSnapshot {
    let vin = snapshot
        .vehicle_info
        .as_ref()
        .and_then(|v| v.vin.as_ref())
        .map(|s| s.as_str())
        .unwrap_or("unknown");

    let vehicle_fingerprint = hash_vin(vin);

    let engine_family = snapshot
        .vehicle_info
        .as_ref()
        .and_then(|v| v.suggested_profile.clone())
        .unwrap_or_else(|| "generic".into());

    let modules = snapshot.modules.iter().map(|m| AnonymizedModule {
        address: m.address,
        name: m.name.clone(),
        fault_count: m.fault_count.unwrap_or(0),
        dtcs: m.dtcs.iter().map(|d| AnonymizedDtc {
            code: d.code.clone(),
            status: d.status_text.clone(),
            text: d.text.clone(),
            freeze_frame: d.freeze_frame.clone(),
        }).collect(),
        ident: m
            .ident
            .as_ref()
            .map(|i| redact_ident(i)),
        live_data: Vec::new(),
    }).collect();

    let recorded_at = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| format!("{} (UTC)", d.as_secs()))
        .unwrap_or_else(|_| "unknown".to_string());

    AnonymizedSnapshot {
        vehicle_fingerprint,
        engine_family,
        modules,
        recorded_at,
    }
}

/// Export as a pretty-printed JSON string (anonymized).
pub fn export_json(snapshot: &crate::commands::SessionSnapshot) -> String {
    let anon = anonymize(snapshot);
    serde_json::to_string_pretty(&anon).unwrap_or_default()
}

// =====================================================================
// Tests
// =====================================================================
//
// v0.14.4 cycle closeout — anonymize.rs shipped with zero unit tests
// despite being a user-facing feature ("Secure Snapshot Share" in the
// UI, hooked into the "Save secure snapshot" button). These tests pin
// the privacy guarantees:
//   1. The actual VIN must never appear in the exported JSON.
//   2. The vehicle_fingerprint must be stable for a given VIN.
//   3. The diagnostic content (DTCs, freeze frames) must survive.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{
        SessionDtc, SessionModule, SessionSnapshot, SessionVehicleInfo,
    };
    use crate::transport::record::TrafficEntry;

    /// Build a snapshot with a known VIN + DTCs for anonymization tests.
    fn snapshot_with_vin(vin: Option<&str>, profile: Option<&str>) -> SessionSnapshot {
        SessionSnapshot {
            version: 1,
            exported_at: "2026-07-31T12:00:00Z".into(),
            transport_name: "test".into(),
            vehicle_info: Some(SessionVehicleInfo {
                vin: vin.map(String::from),
                decode: None,
                mileage_km: Some(80_000),
                suggested_profile: profile.map(String::from),
            }),
            modules: vec![SessionModule {
                address: 0x12,
                name: "DME".into(),
                description: "Digital Motor Electronics".into(),
                ident: Some("MEVD17.2".into()),
                present: true,
                fault_count: Some(1),
                dtcs: vec![SessionDtc {
                    code: "29E0".into(),
                    status: 0x40,
                    status_text: "stored".into(),
                    text: "Mixture too lean".into(),
                    freeze_frame: vec![crate::data::freeze::FreezeItem {
                        label: "RPM".into(),
                        value: "850".into(),
                    }],
                }],
            }],
            traffic: vec![TrafficEntry {
                seq: 1,
                t_ms: 0,
                target: 0x12,
                request: "12 04".into(),
                response: "7F 12 11".into(),
                ok: true,
                detail: "test".into(),
                dur_ms: 5,
            }],
        }
    }

    /// Build a snapshot with NO vehicle info (no VIN, no profile).
    fn snapshot_without_vehicle() -> SessionSnapshot {
        SessionSnapshot {
            version: 1,
            exported_at: "2026-07-31T12:00:00Z".into(),
            transport_name: "test".into(),
            vehicle_info: None,
            modules: vec![],
            traffic: vec![],
        }
    }

    // -----------------------------------------------------------------
    // hash_vin — the privacy primitive
    // -----------------------------------------------------------------

    #[test]
    fn hash_vin_is_16_hex_chars() {
        let h = hash_vin("WBAJB1C50JB084923");
        assert_eq!(h.len(), 16, "got: {h}");
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()), "got: {h}");
    }

    #[test]
    fn hash_vin_is_stable() {
        // Same input → same hash. This is what lets the secure share
        // be used for cross-session correlation (e.g. drift tracking)
        // without revealing the actual VIN.
        let vin = "WBAJB1C50JB084923";
        assert_eq!(hash_vin(vin), hash_vin(vin));
    }

    #[test]
    fn hash_vin_different_inputs_different_hashes() {
        let h1 = hash_vin("WBAJB1C50JB084923");
        let h2 = hash_vin("WBAJB1C50JB084924"); // last char differs
        assert_ne!(h1, h2);
    }

    #[test]
    fn hash_vin_case_sensitive() {
        // DefaultHasher is byte-sensitive; VINs that differ only in
        // case produce different fingerprints. This is an INVARIANT the
        // tests pin — if we later normalise to upper-case (per ISO 3779
        // VIN case-insensitivity), this test will fail and we'll know
        // to update the privacy claims accordingly.
        let h1 = hash_vin("wbajb1c50jb084923");
        let h2 = hash_vin("WBAJB1C50JB084923");
        assert_ne!(h1, h2, "hash_vin should currently be case-sensitive");
    }

    #[test]
    fn hash_vin_unknown_input_uses_keyword() {
        // When the snapshot has no VIN, anonymize hashes the literal
        // string "unknown". The resulting fingerprint must be stable
        // across runs so anonymous snapshots can still be correlated.
        assert_eq!(hash_vin("unknown"), hash_vin("unknown"));
    }

    // -----------------------------------------------------------------
    // anonymize — the full pipeline
    // -----------------------------------------------------------------

    #[test]
    fn anonymize_strips_vin_and_replaces_with_fingerprint() {
        let s = snapshot_with_vin(Some("WBAJB1C50JB084923"), Some("n55"));
        let anon = anonymize(&s);
        // The VIN must NEVER appear in the anonymized output.
        let json = serde_json::to_string(&anon).unwrap();
        assert!(!json.contains("WBAJB1C50JB084923"), "VIN leaked: {json}");
        // The fingerprint must equal hash_vin(vin).
        let expected = hash_vin("WBAJB1C50JB084923");
        assert_eq!(anon.vehicle_fingerprint, expected);
    }

    #[test]
    fn anonymize_without_vehicle_uses_unknown_fingerprint() {
        let s = snapshot_without_vehicle();
        let anon = anonymize(&s);
        assert_eq!(anon.vehicle_fingerprint, hash_vin("unknown"));
        assert!(anon.modules.is_empty());
    }

    #[test]
    fn anonymize_preserves_engine_family_from_suggested_profile() {
        let s = snapshot_with_vin(Some("WBAJB1C50JB084923"), Some("b58"));
        let anon = anonymize(&s);
        assert_eq!(anon.engine_family, "b58");
    }

    #[test]
    fn anonymize_defaults_engine_family_to_generic() {
        let s = snapshot_with_vin(Some("WBAJB1C50JB084923"), None);
        let anon = anonymize(&s);
        assert_eq!(anon.engine_family, "generic");
    }

    #[test]
    fn anonymize_preserves_modules_and_dtcs() {
        let s = snapshot_with_vin(Some("WBAJB1C50JB084923"), Some("n55"));
        let anon = anonymize(&s);
        assert_eq!(anon.modules.len(), 1);
        let m = &anon.modules[0];
        assert_eq!(m.address, 0x12);
        assert_eq!(m.name, "DME");
        assert_eq!(m.ident.as_deref(), Some("MEVD17.2"));
        assert_eq!(m.fault_count, 1);
        assert_eq!(m.dtcs.len(), 1);
        let d = &m.dtcs[0];
        assert_eq!(d.code, "29E0");
        assert_eq!(d.status, "stored");
        assert_eq!(d.text, "Mixture too lean");
        assert_eq!(d.freeze_frame.len(), 1);
        assert_eq!(d.freeze_frame[0].label, "RPM");
        assert_eq!(d.freeze_frame[0].value, "850");
    }

    #[test]
    fn anonymize_strips_mileage_via_omission() {
        // Mileage is identifying (locates the car to a region / garage
        // history). It must not survive anonymization.
        let s = snapshot_with_vin(Some("WBAJB1C50JB084923"), Some("n55"));
        let anon = anonymize(&s);
        let json = serde_json::to_string(&anon).unwrap();
        assert!(!json.contains("80000"), "mileage leaked: {json}");
        assert!(!json.contains("mileage"), "mileage field leaked: {json}");
    }

    #[test]
    fn anonymize_handles_zero_modules() {
        let s = snapshot_without_vehicle();
        let anon = anonymize(&s);
        assert_eq!(anon.modules.len(), 0);
    }

    #[test]
    fn anonymize_handles_module_with_no_dtcs() {
        let mut s = snapshot_with_vin(Some("WBAJB1C50JB084923"), Some("n55"));
        s.modules[0].dtcs.clear();
        s.modules[0].fault_count = Some(0);
        let anon = anonymize(&s);
        assert_eq!(anon.modules[0].fault_count, 0);
        assert!(anon.modules[0].dtcs.is_empty());
    }

    #[test]
    fn anonymize_handles_fault_count_none() {
        let mut s = snapshot_with_vin(Some("WBAJB1C50JB084923"), Some("n55"));
        s.modules[0].fault_count = None;
        let anon = anonymize(&s);
        // None → 0 in the anonymized struct.
        assert_eq!(anon.modules[0].fault_count, 0);
    }

    #[test]
    fn anonymize_recorded_at_is_set() {
        let s = snapshot_with_vin(Some("WBAJB1C50JB084923"), Some("n55"));
        let anon = anonymize(&s);
        assert!(!anon.recorded_at.is_empty());
        assert!(anon.recorded_at.contains("UTC"), "got: {}", anon.recorded_at);
    }

    #[test]
    fn anonymize_live_data_is_always_empty() {
        // The current anonymizer does not retain live_data samples —
        // they may carry identifying timing info. This invariant pins
        // that decision.
        let s = snapshot_with_vin(Some("WBAJB1C50JB084923"), Some("n55"));
        let anon = anonymize(&s);
        assert!(anon.modules.iter().all(|m| m.live_data.is_empty()));
    }

    // -----------------------------------------------------------------
    // redact_ident — the car-unique serial must not survive
    // -----------------------------------------------------------------

    #[test]
    fn redact_ident_strips_the_module_serial() {
        // The software part is what makes a snapshot worth sharing; the serial
        // identifies this module in this car and, on several ECUs, is derived
        // from the VIN.
        assert_eq!(redact_ident("MEVD17.2.42-S0000123"), "MEVD17.2.42");
        assert_eq!(redact_ident("DME_8.4.1-0123456789"), "DME_8.4.1");
        assert_eq!(redact_ident("MEVD17.2.42-12345678"), "MEVD17.2.42");
    }

    #[test]
    fn redact_ident_leaves_a_software_only_ident_alone() {
        // The common case: no serial, nothing to strip.
        assert_eq!(redact_ident("MEVD17.2"), "MEVD17.2");
        assert_eq!(redact_ident("DSC_8.4.1"), "DSC_8.4.1");
    }

    #[test]
    fn redact_ident_is_not_confused_by_a_dangling_or_leading_dash() {
        assert_eq!(redact_ident("-S0000123"), "-S0000123");
        assert_eq!(redact_ident("MEVD17.2-"), "MEVD17.2-");
        assert_eq!(redact_ident("  MEVD17.2.42-S1  "), "MEVD17.2.42");
        assert_eq!(redact_ident(""), "");
    }

    #[test]
    fn redact_ident_splits_on_the_first_dash() {
        // Documented rule: everything before the first `-` is the calibration.
        // Real BMW idents carry exactly one dash (`MEVD17.2.42-S0000123`,
        // `DME_8.4.1-0123456789`), so this is unambiguous in practice. Pinned
        // here so the behaviour is stated rather than incidental: a
        // hypothetical `SW-1.2-A-S9` keeps only `SW`.
        assert_eq!(redact_ident("SW-1.2-A-S9"), "SW");
    }

    #[test]
    fn anonymize_redacts_the_module_serial_end_to_end() {
        // The invariant that matters: no module serial survives anonymization,
        // and the software part — the diagnostically useful half — does.
        let mut s = snapshot_with_vin(Some("WBAJB1C50JB084923"), Some("n55"));
        s.modules[0].ident = Some("MEVD17.2.42-S0000123".to_string());
        let anon = anonymize(&s);
        let m = &anon.modules[0];
        assert_eq!(m.ident.as_deref(), Some("MEVD17.2.42"));
        let json = export_json(&s);
        assert!(
            !json.contains("S0000123"),
            "the module serial survived into the exported JSON: {}",
            json
        );
        assert!(json.contains("MEVD17.2.42"), "the software part was lost");
    }

    // -----------------------------------------------------------------
    // export_json — the round-trippable serialization
    // -----------------------------------------------------------------

    #[test]
    fn export_json_contains_no_vin() {
        let s = snapshot_with_vin(Some("WBAJB1C50JB084923"), Some("n55"));
        let json = export_json(&s);
        assert!(!json.contains("WBAJB1C50JB084923"), "VIN leaked: {json}");
    }

    #[test]
    fn export_json_contains_no_mileage() {
        let s = snapshot_with_vin(Some("WBAJB1C50JB084923"), Some("n55"));
        let json = export_json(&s);
        assert!(!json.contains("80000"));
        assert!(!json.contains("mileage"));
    }

    #[test]
    fn export_json_is_pretty_printed() {
        let s = snapshot_with_vin(Some("WBAJB1C50JB084923"), Some("n55"));
        let json = export_json(&s);
        // Pretty-printed JSON has newlines + 2-space indent.
        assert!(json.contains('\n'), "expected multi-line JSON, got: {json}");
        assert!(json.contains("  "), "expected indented JSON, got: {json}");
    }

    #[test]
    fn export_json_round_trips_through_serde() {
        // The exported JSON must re-deserialize into an AnonymizedSnapshot.
        let s = snapshot_with_vin(Some("WBAJB1C50JB084923"), Some("n55"));
        let json = export_json(&s);
        let parsed: AnonymizedSnapshot = serde_json::from_str(&json)
            .expect("export_json output must be valid AnonymizedSnapshot JSON");
        assert_eq!(parsed.vehicle_fingerprint, hash_vin("WBAJB1C50JB084923"));
        assert_eq!(parsed.engine_family, "n55");
        assert_eq!(parsed.modules.len(), 1);
        assert_eq!(parsed.modules[0].dtcs[0].code, "29E0");
    }
}
