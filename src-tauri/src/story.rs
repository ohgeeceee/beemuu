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
