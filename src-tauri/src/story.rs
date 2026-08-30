//! Diagnostic Story Mode — auto-generated mechanic narratives from snapshots.
//!
//! One-click generation of a human-readable diagnostic report from any
//! `SessionSnapshot`.  Reads like a master technician's notes, synthesizing
//! DTCs, freeze frames, vehicle info, and engine-specific knowledge into
//! actionable advice.
//!
//! v1 is a deterministic, rule-based template engine that works entirely
//! offline.  v2 may add an optional LLM layer.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

// ------------------------------------------------------------------
// Public data types
// ------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct Story {
    pub title: String,
    pub summary: String,
    pub vehicle_summary: String,
    pub severity: Severity,
    pub findings: Vec<Finding>,
    pub recommendations: Vec<Recommendation>,
    pub estimated_cost_min: u32,
    pub estimated_cost_max: u32,
}

#[derive(Serialize, Clone, Debug)]
pub struct Finding {
    pub dtc_code: String,
    pub dtc_text: String,
    pub context: String,
    pub engine_note: Option<String>,
    pub severity: Severity,
}

#[derive(Serialize, Clone, Debug)]
pub struct Recommendation {
    pub priority: u8,
    pub action: String,
    pub rationale: String,
    pub diy_difficulty: String,
    pub estimated_cost: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    Info,
    Warning,
    Critical,
}

impl Severity {
    fn from_str(s: &str) -> Self {
        match s {
            "critical" => Severity::Critical,
            "warning" => Severity::Warning,
            _ => Severity::Info,
        }
    }
}

// ------------------------------------------------------------------
// Story engine input
// ------------------------------------------------------------------

/// Everything the story engine needs.
pub struct StoryInput {
    pub vehicle: crate::commands::VehicleInfo,
    pub modules: Vec<crate::commands::SessionModule>,
    pub engine_family: String,
}

// ------------------------------------------------------------------
// Knowledge base — loaded from community TOML
// ------------------------------------------------------------------

/// One narrative template for a specific DTC on a specific engine.
#[derive(Deserialize, Clone, Debug)]
struct DtcStory {
    code: String,
    #[serde(default)]
    engine: String, // "n55", "n54", "b58", or "generic"
    template: String,
    #[serde(default = "default_severity")]
    severity: String,
    #[serde(default = "default_diy")]
    diy: String,
    #[serde(default)]
    first_check: String,
    #[serde(default)]
    rationale: String,
    #[serde(default)]
    estimated_cost: String,
}

fn default_severity() -> String { "warning".into() }
fn default_diy() -> String { "moderate".into() }

#[derive(Deserialize, Debug)]
struct StoryFile {
    #[serde(default)]
    dtc_story: Vec<DtcStory>,
}

struct StoryKb {
    /// (code_upper, engine_lower) -> DtcStory
    entries: HashMap<(String, String), DtcStory>,
    /// code_upper -> generic DtcStory (engine = "generic")
    generic: HashMap<String, DtcStory>,
}

static STORY_KB: OnceLock<RwLock<StoryKb>> = OnceLock::new();

fn kb() -> &'static RwLock<StoryKb> {
    STORY_KB.get_or_init(|| {
        RwLock::new(StoryKb {
            entries: HashMap::new(),
            generic: HashMap::new(),
        })
    })
}

// ------------------------------------------------------------------
// Loading
// ------------------------------------------------------------------

/// Load all `community/stories/*.toml` files at startup.
pub fn load() -> usize {
    let dir = match crate::community::find_dir() {
        Some(d) => d.join("stories"),
        None => return 0,
    };
    if !dir.is_dir() {
        return 0;
    }

    let mut kb = match kb().write() {
        Ok(k) => k,
        Err(_) => return 0,
    };
    kb.entries.clear();
    kb.generic.clear();

    let mut loaded = 0usize;
    let Ok(entries) = std::fs::read_dir(&dir) else { return loaded; };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("toml")) {
            continue;
        }
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let file: StoryFile = match toml::from_str(&text) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("Story: bad TOML in {}: {}", path.display(), e);
                continue;
            }
        };
        for s in file.dtc_story {
            let code = s.code.to_uppercase();
            let engine = s.engine.to_lowercase();
            if engine == "generic" || engine.is_empty() {
                kb.generic.insert(code.clone(), s.clone());
            }
            kb.entries.insert((code, engine), s);
            loaded += 1;
        }
    }
    loaded
}

// ------------------------------------------------------------------
// Generation
// ------------------------------------------------------------------

pub fn generate(input: &StoryInput) -> Story {
    let kb = match kb().read() {
        Ok(k) => k,
        Err(_) => {
            return Story {
                title: "Diagnostic Story".into(),
                summary: "Story knowledge base is not available.".into(),
                vehicle_summary: format_vehicle(&input.vehicle),
                severity: Severity::Info,
                findings: vec![],
                recommendations: vec![],
                estimated_cost_min: 0,
                estimated_cost_max: 0,
            }
        }
    };

    let mut findings = Vec::new();
    let mut recs = Vec::new();
    let mut cost_min = 0u32;
    let mut cost_max = 0u32;

    // Collect all DTCs from all modules
    for m in &input.modules {
        for dtc in &m.dtcs {
            let key = (dtc.code.to_uppercase(), input.engine_family.to_lowercase());
            let story = kb.entries.get(&key)
                .or_else(|| kb.generic.get(&dtc.code.to_uppercase()));

            if let Some(st) = story {
                let context = build_context(&dtc.code, &input);
                let sev = Severity::from_str(&st.severity);
                findings.push(Finding {
                    dtc_code: dtc.code.clone(),
                    dtc_text: dtc.text.clone(),
                    context,
                    engine_note: Some(st.template.clone()),
                    severity: sev.clone(),
                });

                recs.push(Recommendation {
                    priority: priority_for(&sev),
                    action: st.first_check.clone(),
                    rationale: st.rationale.clone(),
                    diy_difficulty: st.diy.clone(),
                    estimated_cost: if st.estimated_cost.is_empty() { None } else { Some(st.estimated_cost.clone()) },
                });

                // Rough cost parsing: "~$150" or "$150-300"
                if let Some(c) = parse_cost_range(&st.estimated_cost) {
                    cost_min += c.0;
                    cost_max += c.1;
                }
            } else {
                // No story template — generic finding
                findings.push(Finding {
                    dtc_code: dtc.code.clone(),
                    dtc_text: dtc.text.clone(),
                    context: build_context(&dtc.code, &input),
                    engine_note: None,
                    severity: Severity::Info,
                });
            }
        }
    }

    // Sort findings by severity (critical first)
    findings.sort_by(|a, b| b.severity.cmp(&a.severity));
    recs.sort_by(|a, b| a.priority.cmp(&b.priority));

    let max_sev = findings.iter().map(|f| &f.severity).max().cloned().unwrap_or(Severity::Info);

    let summary = if findings.is_empty() {
        "No faults were found in any control unit. The vehicle appears healthy.".into()
    } else {
        let critical = findings.iter().filter(|f| f.severity == Severity::Critical).count();
        let warning = findings.iter().filter(|f| f.severity == Severity::Warning).count();
        let mut parts = Vec::new();
        if critical > 0 { parts.push(format!("{} critical issue(s)", critical)); }
        if warning > 0 { parts.push(format!("{} warning(s)", warning)); }
        if parts.is_empty() { parts.push(format!("{} informational note(s)", findings.len())); }
        format!(
            "This {} has {} fault(s) across scanned modules. {}. Estimated repair range: ${}–${}.",
            input.engine_family.to_uppercase(),
            findings.len(),
            parts.join("; "),
            cost_min,
            cost_max.max(cost_min + 50)
        )
    };

    Story {
        title: format!(
            "Diagnostic Story — {} {}",
            input.vehicle.decode.as_ref().map(|d| d.manufacturer.clone()).unwrap_or_default(),
            input.vehicle.vin.as_ref().map(|v| v[..v.len().min(8)].to_string()).unwrap_or_default()
        ),
        summary,
        vehicle_summary: format_vehicle(&input.vehicle),
        severity: max_sev,
        findings,
        recommendations: recs,
        estimated_cost_min: cost_min,
        estimated_cost_max: cost_max.max(cost_min + 50),
    }
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

fn format_vehicle(v: &crate::commands::VehicleInfo) -> String {
    let mut parts = Vec::new();
    if let Some(decode) = &v.decode {
        let year = decode.model_year.map(|y| y.to_string()).unwrap_or_default();
        parts.push(format!("{} {} ({}, {})", decode.manufacturer, year, decode.plant, decode.wmi));
    }
    if let Some(vin) = &v.vin {
        parts.push(format!("VIN: {}", vin));
    }
    if let Some(mileage) = v.mileage_km {
        parts.push(format!("Mileage: {} km / {} mi", mileage, (mileage as f64 / 1.609).round()));
    }
    if parts.is_empty() {
        "Vehicle information unavailable".into()
    } else {
        parts.join(" · ")
    }
}

fn build_context(code: &str, input: &StoryInput) -> String {
    // Look for freeze frame data for this DTC
    for m in &input.modules {
        for dtc in &m.dtcs {
            if dtc.code == code {
                if !dtc.freeze_frame.is_empty() {
                    let mut ctx = String::from("Freeze frame: ");
                    for item in &dtc.freeze_frame {
                        ctx.push_str(&format!("{} = {}; ", item.label, item.value));
                    }
                    return ctx;
                }
            }
        }
    }
    "No freeze frame data available.".into()
}

fn priority_for(sev: &Severity) -> u8 {
    match sev {
        Severity::Critical => 1,
        Severity::Warning => 2,
        Severity::Info => 3,
    }
}

fn parse_cost_range(s: &str) -> Option<(u32, u32)> {
    // Very rough parser: "~$150", "$150", "$150-300", "$150–300"
    let s = s.replace('~', "").replace('$', "").replace('–', "-").trim().to_string();
    if let Some(dash) = s.find('-') {
        let a = s[..dash].trim().parse::<u32>().ok()?;
        let b = s[dash + 1..].trim().parse::<u32>().ok()?;
        Some((a, b))
    } else {
        let v = s.parse::<u32>().ok()?;
        Some((v, v))
    }
}

// =====================================================================
// Tests
// =====================================================================
//
// v0.14.4 cycle closeout — story.rs shipped with zero unit tests
// despite being a user-facing feature (one-click "Generate Story"
// modal in src/index.html:513, + renderStory modal in main.js:2961).
// These tests pin the pure-function surface so future snapshot-shape
// changes don't silently break the story pipeline.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{
        SessionDtc, SessionModule, SessionSnapshot, SessionVehicleInfo, VehicleInfo,
    };

    /// Build a minimal empty snapshot (no DTCs, no vehicle info).
    fn empty_snapshot() -> SessionSnapshot {
        SessionSnapshot {
            version: 1,
            exported_at: "2026-07-31T00:00:00Z".into(),
            transport_name: "test".into(),
            vehicle_info: None,
            modules: vec![],
            traffic: vec![],
        }
    }

    /// Build a snapshot with vehicle info populated.
    fn snapshot_with_vehicle(vin: Option<&str>, profile: Option<&str>, mileage_km: Option<u32>) -> SessionSnapshot {
        let mut s = empty_snapshot();
        s.vehicle_info = Some(SessionVehicleInfo {
            vin: vin.map(String::from),
            decode: None,
            mileage_km,
            suggested_profile: profile.map(String::from),
        });
        s
    }

    /// Build a single DTC entry.
    fn dtc(code: &str, text: &str) -> SessionDtc {
        SessionDtc {
            code: code.into(),
            status: 0,
            status_text: "stored".into(),
            text: text.into(),
            freeze_frame: vec![],
        }
    }

    /// Build a DTC with a freeze frame.
    fn dtc_with_freeze(code: &str, freeze: Vec<(&str, &str)>) -> SessionDtc {
        SessionDtc {
            code: code.into(),
            status: 0,
            status_text: "stored".into(),
            text: format!("{}: some text", code),
            freeze_frame: freeze
                .into_iter()
                .map(|(l, v)| crate::data::freeze::FreezeItem {
                    label: l.into(),
                    value: v.into(),
                })
                .collect(),
        }
    }

    fn story_input(snapshot: &SessionSnapshot, engine: &str) -> StoryInput {
        // SessionModule doesn't derive Clone, so we re-build each module
        // field-by-field rather than .clone() the whole snapshot. This
        // keeps the test fixture construction decoupled from the public
        // SessionModule API.
        StoryInput {
            vehicle: VehicleInfo {
                vin: snapshot.vehicle_info.as_ref().and_then(|v| v.vin.clone()),
                decode: snapshot.vehicle_info.as_ref().and_then(|v| v.decode.clone()),
                mileage_km: snapshot.vehicle_info.as_ref().and_then(|v| v.mileage_km),
                suggested_profile: snapshot
                    .vehicle_info
                    .as_ref()
                    .and_then(|v| v.suggested_profile.clone()),
            },
            modules: snapshot
                .modules
                .iter()
                .map(|m| SessionModule {
                    address: m.address,
                    name: m.name.clone(),
                    description: m.description.clone(),
                    ident: m.ident.clone(),
                    present: m.present,
                    fault_count: m.fault_count,
                    dtcs: m
                        .dtcs
                        .iter()
                        .map(|d| SessionDtc {
                            code: d.code.clone(),
                            status: d.status,
                            status_text: d.status_text.clone(),
                            text: d.text.clone(),
                            freeze_frame: d.freeze_frame.clone(),
                        })
                        .collect(),
                })
                .collect(),
            engine_family: engine.into(),
        }
    }

    // -----------------------------------------------------------------
    // Severity bucketing
    // -----------------------------------------------------------------

    #[test]
    fn severity_from_str_critical() {
        assert_eq!(Severity::from_str("critical"), Severity::Critical);
    }

    #[test]
    fn severity_from_str_warning() {
        assert_eq!(Severity::from_str("warning"), Severity::Warning);
    }

    #[test]
    fn severity_from_str_unknown_falls_back_to_info() {
        // Unknown / unparseable severity strings must default to Info
        // (the safest fallback for the user-facing story modal).
        assert_eq!(Severity::from_str("info"), Severity::Info);
        assert_eq!(Severity::from_str(""), Severity::Info);
        assert_eq!(Severity::from_str("nonsense"), Severity::Info);
    }

    #[test]
    fn severity_ordering_critical_beats_warning_beats_info() {
        assert!(Severity::Critical > Severity::Warning);
        assert!(Severity::Warning > Severity::Info);
        assert!(Severity::Critical > Severity::Info);
    }

    // -----------------------------------------------------------------
    // Priority helper
    // -----------------------------------------------------------------

    #[test]
    fn priority_for_critical_is_1() {
        assert_eq!(priority_for(&Severity::Critical), 1);
    }

    #[test]
    fn priority_for_warning_is_2() {
        assert_eq!(priority_for(&Severity::Warning), 2);
    }

    #[test]
    fn priority_for_info_is_3() {
        assert_eq!(priority_for(&Severity::Info), 3);
    }

    // -----------------------------------------------------------------
    // parse_cost_range — the rough cost-string parser
    // -----------------------------------------------------------------

    #[test]
    fn parse_cost_range_single_value() {
        assert_eq!(parse_cost_range("$150"), Some((150, 150)));
    }

    #[test]
    fn parse_cost_range_with_tilde() {
        assert_eq!(parse_cost_range("~$150"), Some((150, 150)));
    }

    #[test]
    fn parse_cost_range_hyphen_range() {
        assert_eq!(parse_cost_range("$150-300"), Some((150, 300)));
    }

    #[test]
    fn parse_cost_range_en_dash_range() {
        // The TOML files use en-dash (–); the parser must normalise it.
        assert_eq!(parse_cost_range("$150–300"), Some((150, 300)));
    }

    #[test]
    fn parse_cost_range_with_whitespace() {
        assert_eq!(parse_cost_range("  $150 - 300  "), Some((150, 300)));
    }

    #[test]
    fn parse_cost_range_empty_returns_none() {
        assert_eq!(parse_cost_range(""), None);
        assert_eq!(parse_cost_range("$"), None);
    }

    #[test]
    fn parse_cost_range_garbage_returns_none() {
        // Non-numeric values must NOT panic.
        assert_eq!(parse_cost_range("expensive"), None);
        assert_eq!(parse_cost_range("$abc-def"), None);
    }

    // -----------------------------------------------------------------
    // format_vehicle
    // -----------------------------------------------------------------

    #[test]
    fn format_vehicle_empty() {
        let v = VehicleInfo {
            vin: None,
            decode: None,
            mileage_km: None,
            suggested_profile: None,
        };
        assert_eq!(format_vehicle(&v), "Vehicle information unavailable");
    }

    #[test]
    fn format_vehicle_with_vin_only() {
        let v = VehicleInfo {
            vin: Some("WBAJB1C50JB084923".into()),
            decode: None,
            mileage_km: None,
            suggested_profile: None,
        };
        let s = format_vehicle(&v);
        assert!(s.contains("VIN: WBAJB1C50JB084923"), "got: {s}");
        assert!(!s.contains("Mileage"), "got: {s}");
    }

    #[test]
    fn format_vehicle_with_mileage_converts_km_to_miles() {
        let v = VehicleInfo {
            vin: None,
            decode: None,
            mileage_km: Some(16093), // 16093/1.609 ≈ 10001.86 → rounds to 10002
            suggested_profile: None,
        };
        let s = format_vehicle(&v);
        assert!(s.contains("16093 km"), "got: {s}");
        assert!(s.contains("10002 mi"), "got: {s}");
    }

    #[test]
    fn format_vehicle_with_decode_includes_year_and_manufacturer() {
        let v = VehicleInfo {
            vin: None,
            decode: Some(crate::data::vin::VinDecode {
                wmi: "WBA".into(),
                manufacturer: "BMW AG (passenger car, Germany)".into(),
                model_year: Some(2018),
                plant: "Munich".into(),
                serial: "084923".into(),
            }),
            mileage_km: None,
            suggested_profile: None,
        };
        let s = format_vehicle(&v);
        assert!(s.contains("BMW AG"), "got: {s}");
        assert!(s.contains("2018"), "got: {s}");
        assert!(s.contains("WBA"), "got: {s}");
    }

    // -----------------------------------------------------------------
    // build_context — freeze frame to display string
    // -----------------------------------------------------------------

    #[test]
    fn build_context_no_freeze_frame_returns_default_message() {
        let s = empty_snapshot();
        let input = story_input(&s, "n55");
        let ctx = build_context("29E0", &input);
        assert_eq!(ctx, "No freeze frame data available.");
    }

    #[test]
    fn build_context_with_freeze_frame_lists_label_value_pairs() {
        let mut s = empty_snapshot();
        s.modules = vec![SessionModule {
            address: 0x12,
            name: "DME".into(),
            description: "Digital Motor Electronics".into(),
            ident: None,
            present: true,
            fault_count: Some(1),
            dtcs: vec![dtc_with_freeze(
                "29E0",
                vec![("RPM", "850"), ("Coolant", "92°C")],
            )],
        }];
        let input = story_input(&s, "n55");
        let ctx = build_context("29E0", &input);
        assert!(ctx.starts_with("Freeze frame: "), "got: {ctx}");
        assert!(ctx.contains("RPM = 850"), "got: {ctx}");
        assert!(ctx.contains("Coolant = 92°C"), "got: {ctx}");
    }

    #[test]
    fn build_context_ignores_freeze_frames_for_other_codes() {
        let mut s = empty_snapshot();
        s.modules = vec![SessionModule {
            address: 0x12,
            name: "DME".into(),
            description: "DME".into(),
            ident: None,
            present: true,
            fault_count: Some(1),
            dtcs: vec![dtc_with_freeze("29E0", vec![("RPM", "850")])],
        }];
        let input = story_input(&s, "n55");
        // Looking for a code that doesn't have a freeze frame → default.
        assert_eq!(build_context("2A82", &input), "No freeze frame data available.");
    }

    // -----------------------------------------------------------------
    // generate — full pipeline (uses the live community/stories/*.toml)
    // -----------------------------------------------------------------

    /// Force the story KB to reload from the community/stories directory
    /// before each integration-style test. Cheap (TOML is tiny).
    fn reload_kb() {
        load();
    }

    #[test]
    fn generate_empty_snapshot_returns_info_story() {
        reload_kb();
        let s = empty_snapshot();
        let input = story_input(&s, "generic");
        let story = generate(&input);
        assert_eq!(story.severity, Severity::Info);
        assert!(story.findings.is_empty());
        assert!(story.recommendations.is_empty());
        // No DTCs → both costs start at 0. The pipeline enforces a
        // minimum max of `min + 50` so the summary never shows
        // "Estimated repair range: $0–$0".
        assert_eq!(story.estimated_cost_min, 0);
        assert_eq!(story.estimated_cost_max, 50);
        assert!(story.summary.contains("No faults"), "got: {}", story.summary);
    }

    #[test]
    fn generate_with_unknown_dtc_creates_generic_info_finding() {
        reload_kb();
        let mut s = empty_snapshot();
        s.modules = vec![SessionModule {
            address: 0x12,
            name: "DME".into(),
            description: "DME".into(),
            ident: None,
            present: true,
            fault_count: Some(1),
            dtcs: vec![dtc("P9999", "Made-up DTC for test")],
        }];
        let input = story_input(&s, "generic");
        let story = generate(&input);
        assert_eq!(story.findings.len(), 1);
        assert_eq!(story.findings[0].dtc_code, "P9999");
        // Generic (unknown) DTC → Info severity, no engine note.
        assert_eq!(story.findings[0].severity, Severity::Info);
        assert!(story.findings[0].engine_note.is_none());
    }

    #[test]
    fn generate_with_n55_specific_dtc_uses_engine_template() {
        // 2A82 (VANOS intake fault) is in community/stories/n55.toml.
        reload_kb();
        let mut s = empty_snapshot();
        s.modules = vec![SessionModule {
            address: 0x12,
            name: "DME".into(),
            description: "DME".into(),
            ident: None,
            present: true,
            fault_count: Some(1),
            dtcs: vec![dtc("2A82", "VANOS intake control fault")],
        }];
        let input = story_input(&s, "n55");
        let story = generate(&input);
        assert_eq!(story.findings.len(), 1);
        let f = &story.findings[0];
        assert_eq!(f.dtc_code, "2A82");
        // n55.toml has severity = "warning" + a specific engine note.
        assert_eq!(f.severity, Severity::Warning);
        assert!(f.engine_note.is_some(), "n55 engine note missing");
        let note = f.engine_note.as_ref().unwrap();
        assert!(note.contains("VANOS"), "engine note wrong: {note}");
    }

    #[test]
    fn generate_falls_back_to_generic_template_when_engine_specific_missing() {
        // P0171 is in community/stories/generic.toml only.
        reload_kb();
        let mut s = empty_snapshot();
        s.modules = vec![SessionModule {
            address: 0x12,
            name: "DME".into(),
            description: "DME".into(),
            ident: None,
            present: true,
            fault_count: Some(1),
            dtcs: vec![dtc("P0171", "System too lean (Bank 1)")],
        }];
        let input = story_input(&s, "n55");
        let story = generate(&input);
        assert_eq!(story.findings.len(), 1);
        // P0171 has no n55-specific template, but the generic template
        // applies. The finding should still carry severity + engine note.
        assert_eq!(story.findings[0].severity, Severity::Warning);
        assert!(story.findings[0].engine_note.is_some());
    }

    #[test]
    fn generate_severity_is_max_of_all_findings() {
        reload_kb();
        let mut s = empty_snapshot();
        s.modules = vec![SessionModule {
            address: 0x12,
            name: "DME".into(),
            description: "DME".into(),
            ident: None,
            present: true,
            fault_count: Some(2),
            dtcs: vec![
                // Generic warning:
                dtc("P0420", "Catalyst efficiency below threshold"),
                // n55 critical (2E81):
                dtc("2E81", "Electric coolant pump speed deviation"),
            ],
        }];
        let input = story_input(&s, "n55");
        let story = generate(&input);
        assert_eq!(story.findings.len(), 2);
        // Findings are sorted critical-first:
        assert_eq!(story.findings[0].severity, Severity::Critical);
        assert_eq!(story.findings[1].severity, Severity::Warning);
        // Top-level severity = max of findings = Critical.
        assert_eq!(story.severity, Severity::Critical);
    }

    #[test]
    fn generate_recommendations_are_sorted_by_priority() {
        reload_kb();
        let mut s = empty_snapshot();
        s.modules = vec![SessionModule {
            address: 0x12,
            name: "DME".into(),
            description: "DME".into(),
            ident: None,
            present: true,
            fault_count: Some(2),
            dtcs: vec![
                dtc("P0420", "Catalyst efficiency"), // warning → priority 2
                dtc("2E81", "Coolant pump"),          // critical → priority 1
            ],
        }];
        let input = story_input(&s, "n55");
        let story = generate(&input);
        assert_eq!(story.recommendations.len(), 2);
        // Sorted ascending by priority (1 = critical first).
        assert!(story.recommendations[0].priority <= story.recommendations[1].priority);
        assert_eq!(story.recommendations[0].priority, 1);
    }

    #[test]
    fn generate_cost_range_sums_across_findings() {
        reload_kb();
        let mut s = empty_snapshot();
        s.modules = vec![SessionModule {
            address: 0x12,
            name: "DME".into(),
            description: "DME".into(),
            ident: None,
            present: true,
            fault_count: Some(2),
            dtcs: vec![
                // $80–220 + $350–500 (from n55.toml 29CC + 2E81).
                dtc("29CC", "Misfire"),
                dtc("2E81", "Coolant pump"),
            ],
        }];
        let input = story_input(&s, "n55");
        let story = generate(&input);
        // 80 + 350 = 430 min; 220 + 500 = 720 max.
        assert_eq!(story.estimated_cost_min, 430);
        assert_eq!(story.estimated_cost_max, 720);
    }

    #[test]
    fn generate_max_cost_is_at_least_min_plus_fifty() {
        // Invariant: even when all ranges collapse to a single value, the
        // top-level max is min + 50 to avoid the summary showing
        // "Estimated repair range: $X–$X".
        reload_kb();
        let mut s = empty_snapshot();
        s.modules = vec![SessionModule {
            address: 0x12,
            name: "DME".into(),
            description: "DME".into(),
            ident: None,
            present: true,
            fault_count: Some(1),
            dtcs: vec![dtc("P0171", "Lean")], // $100–250 (asymmetric)
        }];
        let input = story_input(&s, "generic");
        let story = generate(&input);
        assert_eq!(story.estimated_cost_min, 100);
        // 250 is already > 100+50, so max stays at 250.
        assert_eq!(story.estimated_cost_max, 250);
        // But if all DTCs were $50–50, max should bump to $100.
        let mut s2 = empty_snapshot();
        s2.modules = vec![SessionModule {
            address: 0x12,
            name: "DME".into(),
            description: "DME".into(),
            ident: None,
            present: true,
            fault_count: Some(1),
            dtcs: vec![dtc("P0171", "Lean")], // reused
        }];
        let input2 = story_input(&s2, "generic");
        let story2 = generate(&input2);
        assert!(story2.estimated_cost_max >= story2.estimated_cost_min + 50);
    }

    #[test]
    fn generate_dtc_code_case_insensitive_lookup() {
        // TOML stories are stored uppercase; the engine must also find
        // them when the snapshot DTC is lowercase or mixed-case.
        reload_kb();
        let mut s = empty_snapshot();
        s.modules = vec![SessionModule {
            address: 0x12,
            name: "DME".into(),
            description: "DME".into(),
            ident: None,
            present: true,
            fault_count: Some(1),
            dtcs: vec![dtc("2a82", "lowercase vanos code")],
        }];
        let input = story_input(&s, "n55");
        let story = generate(&input);
        // The DTC is preserved as the user provided it (lowercase), but
        // the engine note is the template from the KB (uppercase lookup).
        assert_eq!(story.findings.len(), 1);
        assert_eq!(story.findings[0].dtc_code, "2a82");
        assert!(story.findings[0].engine_note.is_some());
    }

    #[test]
    fn generate_summary_counts_critical_and_warning() {
        reload_kb();
        let mut s = empty_snapshot();
        s.modules = vec![SessionModule {
            address: 0x12,
            name: "DME".into(),
            description: "DME".into(),
            ident: None,
            present: true,
            fault_count: Some(3),
            dtcs: vec![
                dtc("2E81", "Coolant pump critical"),
                dtc("P0420", "Catalyst warning"),
                dtc("P0171", "Lean warning"),
            ],
        }];
        let input = story_input(&s, "n55");
        let story = generate(&input);
        // Summary should mention 1 critical + 2 warning.
        assert!(story.summary.contains("1 critical"), "got: {}", story.summary);
        assert!(story.summary.contains("2 warning"), "got: {}", story.summary);
        assert!(story.summary.contains("N55"), "got: {}", story.summary);
    }

    #[test]
    fn generate_title_uses_manufacturer_and_vin_prefix() {
        reload_kb();
        let s = snapshot_with_vehicle(Some("WBAJB1C50JB084923"), Some("n55"), None);
        let input = story_input(&s, "n55");
        let story = generate(&input);
        // VIN-prefix-first-8 (no decode attached → manufacturer empty).
        assert!(story.title.contains("WBAJB1C5"), "got: {}", story.title);
        assert!(story.title.contains("Diagnostic Story"), "got: {}", story.title);
    }
}
