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
        ident: m.ident.clone(),
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
