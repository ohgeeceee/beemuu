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
pub fn find_dir() -> Option<PathBuf> {
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
pub(crate) struct FreezeFile {
    #[serde(default)]
    pub(crate) field: Vec<FieldToml>,
}

#[derive(Deserialize)]
pub(crate) struct FieldToml {
    pub(crate) label: String,
    pub(crate) unit: String,
    pub(crate) offset: usize,
    pub(crate) width: String,
    pub(crate) scale: f64,
    pub(crate) bias: f64,
    #[serde(default)]
    pub(crate) decimals: u8,
}

fn width_from_str(s: &str) -> Option<freeze::Width> {
    freeze::width_from_str(s)
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
                Err(w) => report.warnings.pus