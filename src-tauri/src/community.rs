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
    /// Optional `[profile.theme]` table: per-profile gauge colour scheme
    /// (key -> CSS colour string). `#[serde(default)]` keeps older TOML
    /// files (without this table) parsing cleanly. Keys the frontend
    /// doesn't recognise are ignored there; colour strings are validated
    /// in the UI layer (`CSS.supports`), not here — this is a pure
    /// pass-through. See docs/DECODE_FUNCTIONS.md § 9.
    #[serde(default)]
    theme: std::collections::HashMap<String, String>,
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
    /// Optional u8 -> label enum map used by `decode = "u8_enum"`.
    /// `#[serde(default)]` keeps older TOML files (without this key)
    /// parsing cleanly. The TOML key is `enum`; the Rust field is
    /// `enum_` because `enum` is a reserved word.
    ///
    /// We deserialize into `HashMap<String, String>` first because the
    /// `toml` crate's inline-table keys are typed as strings — there is
    /// no syntax that gives us u8 keys directly. `build_profile`
    /// parses the string keys into u8 and silently drops any key that
    /// doesn't parse as a byte value (e.g. `"256"`, `"-1"`,
    /// `"banana"`). See the test below for the expected user-facing
    /// TOML syntax.
    #[serde(default, rename = "enum")]
    enum_: std::collections::HashMap<String, String>,
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

/// Convert the TOML `enum = { ... }` map (string keys, as the `toml`
/// crate forces on us) into the runtime `HashMap<u8, String>` that
/// `decode_enum_string` expects. Keys that don't parse as a byte
/// (e.g. `"256"`, `"-1"`, `"banana"`) are dropped — they could only
/// have come from a typo in a community profile and silent dropping
/// matches the project's "best-effort, never fatal" stance on TOML
/// loading. Warnings would be nicer, but LoadReport doesn't expose a
/// per-field channel today; revisit if this becomes a real problem.
fn parse_enum_map(raw: &std::collections::HashMap<String, String>) -> std::collections::HashMap<u8, String> {
    let mut out = std::collections::HashMap::with_capacity(raw.len());
    for (k, v) in raw {
        if let Ok(byte) = k.parse::<u8>() {
            out.insert(byte, v.clone());
        }
    }
    out
}

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
        // Enum maps live per-parameter, not per-profile. Convert the
        // raw `HashMap<String, String>` from TOML into the
        // `HashMap<u8, String>` that the runtime uses.
        let enum_map = parse_enum_map(&pr.enum_);
        params.push(live::LiveParam {
            id: pr.id.clone(),
            label: pr.label.clone(),
            unit: pr.unit.clone(),
            target: pr.target,
            query,
            decode,
            min: pr.min,
            max: pr.max,
            enum_map,
        });
    }
    Ok(live::Profile { id: p.id, label: p.label, params, theme: p.theme })
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
    for path in category_files(dir, "freeze_schemas.toml", "schemas") {
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        match toml::from_str::<SchemasFile>(&text) {
            Ok(f) => {
                for s in f.schema {
                    match build_schema(s) {
                        Ok((address, schema)) => {
                            freeze::registry().register_for(address, schema);
                            report.freeze_schemas += 1;
                        }
                        Err(w) => report.warnings.push(w),
                    }
                }
            }
            Err(e) => report.warnings.push(format!("{}: {e}", path.display())),
        }
    }
}

static REPORT: OnceLock<LoadReport> = OnceLock::new();

pub fn load() -> LoadReport {
    let mut report = LoadReport::default();
    let Some(dir) = find_dir() else {
        let _ = REPORT.set(report.clone());
        return report;
    };
    report.dir = Some(dir.display().to_string());
    load_dtcs(&dir, &mut report);
    load_profiles(&dir, &mut report);
    load_schemas(&dir, &mut report);
    let _ = REPORT.set(report.clone());
    report
}

pub fn report() -> LoadReport {
    REPORT.get().cloned().unwrap_or_default()
}

pub fn import_profiles_str(content: &str) -> Result<Vec<String>, String> {
    let parsed: ProfilesFile = toml::from_str(content).map_err(|e| e.to_string())?;
    let mut added = Vec::new();
    for p in parsed.profile {
        let label = p.label.clone();
        let prof = build_profile(p)?;
        live::add_profile(prof);
        added.push(label);
    }
    Ok(added)
}

pub fn save_freeze_schema(address: u8, fields: &[freeze::FreezeField]) -> Result<(), String> {
    let dir = find_dir().unwrap_or_else(|| PathBuf::from("community"));
    let freeze_dir = dir.join("freeze");
    std::fs::create_dir_all(&freeze_dir).map_err(|e| e.to_string())?;
    let path = freeze_dir.join(format!("{address:02X}.toml"));
    let mut out = String::new();
    for f in fields {
        out.push_str("[[field]]\n");
        out.push_str(&format!("label = {:?}\n", f.label));
        out.push_str(&format!("unit = {:?}\n", f.unit));
        out.push_str(&format!("offset = {}\n", f.offset));
        out.push_str(&format!("width = {:?}\n", freeze::width_to_str(f.width)));
        out.push_str(&format!("scale = {}\n", f.scale));
        out.push_str(&format!("bias = {}\n", f.bias));
        out.push_str(&format!("decimals = {}\n\n", f.decimals));
    }
    std::fs::write(path, out).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A profile TOML with a `u8_enum` parameter and an `enum = { ... }`
    /// map must parse and surface the map on `ParamToml.enum_`. The
    /// `toml` crate types inline-table keys as strings, so we check
    /// the raw string-keyed view here. The `parse_enum_map` unit test
    /// verifies the `String -> u8` conversion downstream.
    #[test]
    fn enum_map_parses_from_toml() {
        let toml = r#"
[[profile]]
id = "test_enum"
label = "Enum test profile"

  [[profile.param]]
  id = "gear"
  label = "Gear position"
  unit = ""
  target = 0x12
  query = "did:DA0A"
  decode = "u8_enum"
  min = 0.0
  max = 15.0
  enum = { "0" = "P/N", "1" = "1", "15" = "Error" }
"#;
        let parsed: ProfilesFile = toml::from_str(toml).expect("TOML should parse");
        assert_eq!(parsed.profile.len(), 1);
        let profile = &parsed.profile[0];
        assert_eq!(profile.id, "test_enum");
        assert_eq!(profile.param.len(), 1);
        let param = &profile.param[0];
        assert_eq!(param.id, "gear");
        assert_eq!(param.enum_.get("0").map(String::as_str), Some("P/N"));
        assert_eq!(param.enum_.get("1").map(String::as_str), Some("1"));
        assert_eq!(param.enum_.get("15").map(String::as_str), Some("Error"));
        assert_eq!(param.enum_.get("7"), None);
    }

    /// Older TOML files without an `enum` key must still parse. This is
    /// the `#[serde(default)]` contract — adding the field must not
    /// break existing community profiles.
    #[test]
    fn legacy_toml_without_enum_key_still_parses() {
        let toml = r#"
[[profile]]
id = "legacy"
label = "Legacy profile"

  [[profile.param]]
  id = "rpm"
  label = "Engine speed"
  unit = "rpm"
  target = 0x12
  query = "obd:0C"
  decode = "u16_quarter"
  min = 0.0
  max = 8000.0
"#;
        let parsed: ProfilesFile = toml::from_str(toml).expect("legacy TOML should parse");
        let param = &parsed.profile[0].param[0];
        assert_eq!(param.id, "rpm");
        assert!(param.enum_.is_empty(), "legacy profiles must default to empty enum map");
    }

    /// `parse_enum_map` must drop keys that aren't valid u8 values.
    /// In practice this means out-of-range bytes (`"256"`, `"-1"`)
    /// and non-numeric strings (`"banana"`). They could only come
    /// from a typo in a community profile.
    #[test]
    fn parse_enum_map_drops_invalid_byte_keys() {
        let mut raw = std::collections::HashMap::new();
        raw.insert("0".to_string(), "P/N".to_string());
        raw.insert("1".to_string(), "1".to_string());
        // All of these must be dropped:
        raw.insert("256".to_string(), "Overflow".to_string());
        raw.insert("-1".to_string(), "Negative".to_string());
        raw.insert("banana".to_string(), "Fruit".to_string());
        raw.insert("3.14".to_string(), "Pi".to_string());

        let parsed = parse_enum_map(&raw);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed.get(&0).map(String::as_str), Some("P/N"));
        assert_eq!(parsed.get(&1).map(String::as_str), Some("1"));
        assert!(!parsed.values().any(|v| v == "Overflow" || v == "Negative"
            || v == "Fruit" || v == "Pi"));
    }

    /// A `[profile.theme]` table must parse and surface on
    /// `ProfileToml.theme` as a raw string->string map, and params
    /// declared after the theme table must still land on the same
    /// profile. Key/colour validation happens in the UI; the loader is
    /// a pass-through (v0.7.0, docs/DECODE_FUNCTIONS.md § 9).
    #[test]
    fn theme_parses_from_toml() {
        // NOTE: r##"..."## delimiters — the TOML contains `"#` (hex
        // colours), which would terminate an r#"..."# raw string early.
        let toml = r##"
[[profile]]
id = "themed"
label = "Themed profile"

[profile.theme]
arc = "#3ddc84"
needle = "orange"

  [[profile.param]]
  id = "rpm"
  label = "Engine speed"
  unit = "rpm"
  target = 0x12
  query = "obd:0C"
  decode = "u16_quarter"
  min = 0.0
  max = 8000.0
"##;
        let parsed: ProfilesFile = toml::from_str(toml).expect("TOML should parse");
        let profile = &parsed.profile[0];
        assert_eq!(profile.theme.get("arc").map(String::as_str), Some("#3ddc84"));
        assert_eq!(profile.theme.get("needle").map(String::as_str), Some("orange"));
        assert_eq!(profile.param.len(), 1, "params after [profile.theme] must still parse");
        assert_eq!(profile.param[0].id, "rpm");
    }

    /// Older TOML files without a `[profile.theme]` table must still
    /// parse, with an empty theme map — same `#[serde(default)]`
    /// contract as the `enum` key.
    #[test]
    fn legacy_toml_without_theme_still_parses() {
        let toml = r#"
[[profile]]
id = "legacy"
label = "Legacy profile"
"#;
        let parsed: ProfilesFile = toml::from_str(toml).expect("legacy TOML should parse");
        assert!(parsed.profile[0].theme.is_empty(), "legacy profiles must default to empty theme");
    }

    /// Repo root's `community/` directory (one level up from
    /// `src-tauri`, independent of the test runner's cwd).
    fn shipped_community_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri must have a parent directory")
            .join("community")
    }

    /// GATE (v0.8.0 PR #1): every shipped community TOML must parse.
    ///
    /// Rationale: `scripts/lint-toml.js` (CI build job) checks
    /// whitespace only, so `community/dtc_texts.toml` shipped
    /// truncated mid-string — the loader logged the error and
    /// silently loaded zero overlay entries. A data-file syntax
    /// break must fail `cargo test`, which CI already runs
    /// (`.github/workflows/test.yml`).
    ///
    /// This is a syntax gate (`toml::Value`), not a schema gate:
    /// it catches truncation and malformed files without needing
    /// per-category structs. Category shapes are covered by the
    /// loader and by `shipped_dtc_texts_parse_and_nonempty` below.
    #[test]
    fn shipped_community_tomls_parse() {
        let root = shipped_community_dir();
        assert!(root.is_dir(), "community dir missing at {root:?}");
        let mut stack = vec![root];
        let mut count = 0usize;
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir)
                .unwrap_or_else(|e| panic!("read_dir {dir:?}: {e}"))
            {
                let path = entry.expect("dir entry").path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                if path.extension().and_then(|e| e.to_str()) == Some("toml") {
                    let content = std::fs::read_to_string(&path)
                        .unwrap_or_else(|e| panic!("read {path:?}: {e}"));
                    content
                        .parse::<toml::Value>()
                        .unwrap_or_else(|e| panic!(
                            "shipped community TOML must parse: {path:?}: {e}"
                        ));
                    count += 1;
                }
            }
        }
        assert!(
            count >= 10,
            "gate should cover >= 10 shipped community TOMLs, saw {count}"
        );
    }

    /// The shipped `community/dtc_texts.toml` must parse into the
    /// loader's `DtcFile` shape, contain entries (a rescue rebuild
    /// that produced an empty table would still pass the syntax
    /// gate), and use the BMW-style 4/6-hex uppercase codes the
    /// read paths produce (see `protocol::Dtc.code`).
    #[test]
    fn shipped_dtc_texts_parse_and_nonempty() {
        let path = shipped_community_dir().join("dtc_texts.toml");
        let content = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read {path:?}: {e}"));
        let parsed: DtcFile = toml::from_str(&content)
            .unwrap_or_else(|e| panic!("dtc_texts.toml must fit DtcFile: {e}"));
        assert!(
            parsed.dtc.len() >= 100,
            "rescued corpus should carry >= 100 entries, saw {}",
            parsed.dtc.len()
        );
        for (code, text) in &parsed.dtc {
            assert!(
                (4..=6).contains(&code.len())
                    && code.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_lowercase()),
                "code {code:?} must be 4-6 uppercase hex"
            );
            assert!(!text.trim().is_empty(), "empty text for {code}");
        }
    }
}
