//! Runtime loading of community-contributed data from a `community/` folder.
//!
//! This is the on-ramp for non-Rust contributors: fault-code texts, live-data
//! profiles, and freeze-frame schemas can all be added as plain TOML files and
//! picked up at startup — no recompile. See `community/README.md` for the file
//! formats. Everything here is best-effort: a malformed file is reported and
//! skipped, never fatal.

use crate::data::{dtc, freeze, live};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Summary of what a load pass ingested, surfaced to the UI.
#[derive(Default, serde::Serialize, Clone)]
pub struct LoadReport {
    pub dir: Option<String>,
    pub dtc_texts: usize,
    pub profiles: usize,
    pub freeze_schemas: usize,
    pub warnings: Vec<String>,
}

/// Locate the community directory. Checked in order:
///   1. $BEEEMUU_COMMUNITY
///   2. ./community            (cwd — dev runs and portable installs)
///   3. ../community           (when cwd is src-tauri under `tauri dev`)
///   4. <exe dir>/community    (installed app)
fn find_dir() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("BEEEMUU_COMMUNITY") {
        let pb = PathBuf::from(p);
        if pb.is_dir() {
            return Some(pb);
        }
    }
    let mut candidates = vec![PathBuf::from("community"), PathBuf::from("../community")];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("community"));
        }
    }
    candidates.into_iter().find(|p| p.is_dir())
}

// ---- TOML shapes -----------------------------------------------------------

#[derive(Deserialize)]
struct DtcFile {
    #[serde(default)]
    dtc: std::collections::HashMap<String, String>,
}

#[derive(Deserialize)]
struct ProfilesFile {
    #[serde(default)]
    profile: Vec<ProfileToml>,
}

#[derive(Deserialize)]
struct ProfileToml {
    id: String,
    label: String,
    #[serde(default)]
    param: Vec<ParamToml>,
}

#[derive(Deserialize)]
struct ParamToml {
    id: String,
    label: String,
    unit: String,
    target: u8,
    query: String,
    decode: String,
    min: f64,
    max: f64,
}

#[derive(Deserialize)]
struct SchemasFile {
    #[serde(default)]
    schema: Vec<SchemaToml>,
}

#[derive(Deserialize)]
struct SchemaToml {
    address: u8,
    #[serde(default)]
    field: Vec<FieldToml>,
}

#[derive(Deserialize)]
struct FieldToml {
    label: String,
    unit: String,
    offset: usize,
    width: String,
    scale: f64,
    bias: f64,
    #[serde(default)]
    decimals: u8,
}

fn width_from_str(s: &str) -> Option<freeze::Width> {
    Some(match s {
        "u8" => freeze::Width::U8,
        "i8" => freeze::Width::I8,
        "u16" => freeze::Width::U16,
        "i16" => freeze::Width::I16,
        "u24" => freeze::Width::U24,
        _ => return None,
    })
}

// ---- File discovery --------------------------------------------------------

/// All TOML files for one category: the single top-level file (if present)
/// plus every `*.toml` in the matching subfolder, sorted for deterministic
/// load order. This lets each car live in its own file (e.g.
/// `community/profiles/e70_n62.toml`) so contributions don't collide.
fn category_files(dir: &Path, single: &str, subdir: &str) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let top = dir.join(single);
    if top.is_file() {
        files.push(top);
    }
    let sub = dir.join(subdir);
    if sub.is_dir() {
        if let Ok(rd) = std::fs::read_dir(&sub) {
            let mut subs: Vec<PathBuf> = rd
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("toml")))
                .collect();
            subs.sort();
            files.extend(subs);
        }
    }
    files
}

// ---- Shared builders (used by both file load and in-app import) ------------

/// Convert a parsed profile into a runtime profile, or an error naming the bad field.
fn build_profile(p: ProfileToml) -> Result<live::Profile, String> {
    let mut params = Vec::with_capacity(p.param.len());
    for pr in &p.param {
        let (Some(query), Some(decode)) =
            (live::query_from_str(&pr.query), live::decode_from_str(&pr.decode))
        else {
            return Err(format!(
                "profile '{}' param '{}': bad query '{}' or decode '{}'",
                p.id, pr.id, pr.query, pr.decode
            ));
        };
        params.push(live::LiveParam {
            id: pr.id.clone(),
            label: pr.label.clone(),
            unit: pr.unit.clone(),
            target: pr.target,
            query,
            decode,
            min: pr.min,
            max: pr.max,
        });
    }
    Ok(live::Profile { id: p.id, label: p.label, params })
}

fn build_schema(s: SchemaToml) -> Result<(u8, freeze::FreezeSchema), String> {
    let mut fields = Vec::with_capacity(s.field.len());
    for fl in &s.field {
        let Some(width) = width_from_str(&fl.width) else {
            return Err(format!("schema 0x{:02X}: bad width '{}'", s.address, fl.width));
        };
        // FreezeField holds &'static str; leak the owned strings (bounded by
        // the tiny number of community fields, one-time at startup/import).
        let label: &'static str = Box::leak(fl.label.clone().into_boxed_str());
        let unit: &'static str = Box::leak(fl.unit.clone().into_boxed_str());
        fields.push(freeze::FreezeField::new(
            label, unit, fl.offset, width, fl.scale, fl.bias, fl.decimals,
        ));
    }
    Ok((s.address, freeze::FreezeSchema { fields }))
}

// ---- Loaders ---------------------------------------------------------------

fn load_dtcs(dir: &Path, report: &mut LoadReport) {
    for path in category_files(dir, "dtc_texts.toml", "dtc") {
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        match toml::from_str::<DtcFile>(&text) {
            Ok(f) => {
                for (code, desc) in f.dtc {
                    dtc::set_text(&code, &desc);
                    report.dtc_texts += 1;
                }
            }
            Err(e) => report.warnings.push(format!("{}: {e}", path.display())),
        }
    }
}

fn load_profiles(dir: &Path, report: &mut LoadReport) {
    for path in category_files(dir, "profiles.toml", "profiles") {
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        let parsed = match toml::from_str::<ProfilesFile>(&text) {
            Ok(f) => f,
            Err(e) => {
                report.warnings.push(format!("{}: {e}", path.display()));
                continue;
            }
        };
        for p in parsed.profile {
            match build_profile(p) {
                Ok(prof) => {
                    live::add_profile(prof);
                    report.profiles += 1;
                }
                Err(w) => report.warnings.push(w),
            }
        }
    }
}

fn load_schemas(dir: &Path, report: &mut LoadReport) {
    for path in category_files(dir, "freeze_schemas.toml", "freeze") {
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        let parsed = match toml::from_str::<SchemasFile>(&text) {
            Ok(f) => f,
            Err(e) => {
                report.warnings.push(format!("{}: {e}", path.display()));
                continue;
            }
        };
        for s in parsed.schema {
            match build_schema(s) {
                Ok((addr, schema)) => {
                    freeze::registry().register_for(addr, schema);
                    report.freeze_schemas += 1;
                }
                Err(w) => report.warnings.push(w),
            }
        }
    }
}

/// Parse and add profiles from a TOML string (in-app import). Strict: any bad
/// profile fails the whole import. Returns the labels added.
pub fn import_profiles_str(text: &str) -> Result<Vec<String>, String> {
    let parsed: ProfilesFile = toml::from_str(text).map_err(|e| e.to_string())?;
    if parsed.profile.is_empty() {
        return Err("No [[profile]] entries found".into());
    }
    let mut labels = Vec::new();
    for p in parsed.profile {
        let prof = build_profile(p)?;
        labels.push(prof.label.clone());
        live::add_profile(prof);
    }
    Ok(labels)
}

static REPORT: OnceLock<LoadReport> = OnceLock::new();

/// Load everything from the community directory (if found). Safe to call once
/// at startup; caches a report for the Diagnostics tab.
pub fn load() -> LoadReport {
    let mut report = LoadReport::default();
    match find_dir() {
        Some(dir) => {
            report.dir = Some(dir.display().to_string());
            load_dtcs(&dir, &mut report);
            load_profiles(&dir, &mut report);
            load_schemas(&dir, &mut report);
        }
        None => report
            .warnings
            .push("No community/ directory found (using built-ins only).".into()),
    }
    let _ = REPORT.set(report.clone());
    report
}

/// The cached report from the startup load (or an empty one).
pub fn report() -> LoadReport {
    REPORT.get().cloned().unwrap_or_default()
}
