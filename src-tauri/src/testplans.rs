//! Guided fault-finding test plans — branching diagnostic walkthroughs.
//!
//! For a given DTC, returns a `TestPlan`: an ordered set of `[[step]]`
//! nodes forming a graph (task steps with measurement verbs and
//! `on_pass`/`on_fail`/`next` branch edges, terminating in conclusion
//! nodes). The frontend interprets the graph interactively — this module
//! is a stateless loader + lookup, no traversal state machine in Rust.
//! Branch traversal is the UI's job (see `docs/v0.9.0_plan.md` PR #3:
//! keeping the query read-only and stateless keeps the command surface
//! trivially reviewable).
//!
//! Knowledge base lives in `community/testplans/<dtc_code>.toml`. Schema
//! contract: `docs/testplans.md`. Branch integrity is CI-gated by
//! `community::tests::shipped_testplans_branch_integrity`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

// ------------------------------------------------------------------
// Public data types (serialized to the frontend)
// ------------------------------------------------------------------

/// A full test plan for one DTC.
#[derive(Serialize, Clone, Debug)]
pub struct TestPlan {
    pub dtc: String,
    pub title: String,
    pub engine_family: Option<String>,
    /// Plan-level verification state from `[meta].verified` in the TOML:
    /// `"needs verification"` (default for every plan) or `"verified"`
    /// once a real-car walk confirms it (see `docs/validation/testplans.md`).
    /// `None` if the field is absent. Surfaced to the UI as a badge.
    pub verified: Option<String>,
    pub steps: Vec<TestStep>,
}

/// One node in the walkthrough graph.
#[derive(Serialize, Clone, Debug)]
pub struct TestStep {
    pub id: String,
    pub instruction: Option<String>,
    pub measurement: Option<Measurement>,
    pub on_pass: Option<String>,
    pub on_fail: Option<String>,
    pub next: Option<String>,
    pub conclusion: Option<String>,
    pub source: String,
}

/// The "measure" verb of a step: a live-data DID poll, or a manual
/// yes/no observation. Mirrors `docs/testplans.md` § Measurement.
#[derive(Serialize, Clone, Debug)]
pub struct Measurement {
    pub kind: String, // "did" | "manual"
    pub did: Option<String>,
    pub label: Option<String>,
    pub expected_min: Option<f64>,
    pub expected_max: Option<f64>,
    pub question: Option<String>,
}

// ------------------------------------------------------------------
// On-disk TOML shapes
// ------------------------------------------------------------------

#[derive(Deserialize, Debug)]
struct PlanFile {
    dtc: String,
    #[serde(default)]
    meta: PlanMeta,
    #[serde(default)]
    step: Vec<StepToml>,
}

#[derive(Deserialize, Debug, Default)]
struct PlanMeta {
    #[serde(default)]
    title: String,
    #[serde(default)]
    engine_family: String,
    /// Plan-level verification state — `"needs verification"` by default
    /// on every authored plan; `"verified"` only after a real-car walk
    /// via the harness in `docs/validation/testplans.md`. Optional so
    /// pre-PR-#5 plans (no marker) still parse as `None`.
    #[serde(default)]
    verified: Option<String>,
    /// Presence marks a known-missing placeholder — suppressed from
    /// lookup results (mirrors the gate's handling in `community.rs`).
    #[serde(default)]
    suppressed: Option<toml::Value>,
}

#[derive(Deserialize, Debug)]
struct StepToml {
    id: String,
    #[serde(default)]
    instruction: String,
    #[serde(default)]
    measurement: Option<MeasurementToml>,
    #[serde(default)]
    on_pass: Option<String>,
    #[serde(default)]
    on_fail: Option<String>,
    #[serde(default)]
    next: Option<String>,
    #[serde(default)]
    conclusion: Option<String>,
    #[serde(default)]
    source: String,
}

#[derive(Deserialize, Debug)]
struct MeasurementToml {
    kind: String,
    #[serde(default)]
    did: Option<String>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    expected_min: Option<f64>,
    #[serde(default)]
    expected_max: Option<f64>,
    #[serde(default)]
    question: Option<String>,
}

// ------------------------------------------------------------------
// Internal knowledge base
// ------------------------------------------------------------------

struct TestPlanKb {
    by_dtc: HashMap<String, TestPlan>,
}

static KB: OnceLock<RwLock<TestPlanKb>> = OnceLock::new();

fn kb() -> &'static RwLock<TestPlanKb> {
    KB.get_or_init(|| {
        RwLock::new(TestPlanKb {
            by_dtc: HashMap::new(),
        })
    })
}

// ------------------------------------------------------------------
// Loading
// ------------------------------------------------------------------

fn to_plan(file: PlanFile) -> TestPlan {
    let steps = file
        .step
        .into_iter()
        .map(|s| TestStep {
            id: s.id,
            instruction: non_empty(s.instruction),
            measurement: s.measurement.map(|m| Measurement {
                kind: m.kind,
                did: m.did,
                label: m.label,
                expected_min: m.expected_min,
                expected_max: m.expected_max,
                question: m.question,
            }),
            on_pass: s.on_pass,
            on_fail: s.on_fail,
            next: s.next,
            conclusion: s.conclusion,
            source: s.source,
        })
        .collect();
    TestPlan {
        dtc: file.dtc.to_uppercase(),
        title: file.meta.title,
        engine_family: non_empty(file.meta.engine_family),
        verified: file.meta.verified,
        steps,
    }
}

fn non_empty(s: String) -> Option<String> {
    if s.trim().is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Load every `community/testplans/*.toml` into memory. Called once at
/// startup in `lib.rs`. Best-effort: a malformed or suppressed file is
/// skipped (the branch-integrity gate is the real validator at CI time).
/// Returns the number of plans loaded.
pub fn load() -> usize {
    let dir = match crate::community::find_dir() {
        Some(d) => d.join("testplans"),
        None => return 0,
    };
    if !dir.is_dir() {
        return 0;
    }

    let mut kb = match kb().write() {
        Ok(k) => k,
        Err(_) => return 0,
    };
    kb.by_dtc.clear();

    let mut loaded = 0usize;
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return loaded;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("toml")) {
            continue;
        }
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let file: PlanFile = match toml::from_str(&text) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("TestPlan: bad TOML in {}: {}", path.display(), e);
                continue;
            }
        };
        // Skip known-missing placeholders — they carry no usable plan.
        if file.meta.suppressed.is_some() {
            continue;
        }
        let plan = to_plan(file);
        kb.by_dtc.insert(plan.dtc.clone(), plan);
        loaded += 1;
    }
    loaded
}

// ------------------------------------------------------------------
// Query
// ------------------------------------------------------------------

/// Look up the test plan for a DTC code (case-insensitive). Returns
/// `None` when no plan is authored — the frontend degrades gracefully
/// (no walkthrough panel), exactly like `get_opinions` on an empty DTC.
pub fn query(dtc_code: &str) -> Option<TestPlan> {
    let kb = kb().read().ok()?;
    kb.by_dtc.get(&dtc_code.to_uppercase()).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
dtc = "2A82"

[meta]
title = "VANOS intake solenoid fault"
engine_family = "n55"
verified = "needs verification"

[[step]]
id = "s1"
instruction = "Inspect the solenoid for sludge."
measurement = { kind = "manual", question = "Is it clogged?" }
on_pass = "s2"
on_fail = "s3"
source = "community/stories/n55.toml"

[[step]]
id = "s2"
instruction = "Clean and re-fit."
conclusion = "Cleaned successfully."
source = "community/opinions/2A82.toml"

[[step]]
id = "s3"
instruction = "Replace the solenoid."
conclusion = "Replaced."
source = "community/oracle/n55.json"
"#;

    #[test]
    fn parse_roundtrip_maps_all_fields() {
        let file: PlanFile = toml::from_str(SAMPLE).expect("sample must parse");
        let plan = to_plan(file);
        assert_eq!(plan.dtc, "2A82");
        assert_eq!(plan.title, "VANOS intake solenoid fault");
        assert_eq!(plan.engine_family.as_deref(), Some("n55"));
        assert_eq!(plan.steps.len(), 3);

        // Plan-level verification marker threads through to the UI.
        assert_eq!(plan.verified.as_deref(), Some("needs verification"));

        let s1 = &plan.steps[0];
        assert_eq!(s1.id, "s1");
        assert_eq!(s1.on_pass.as_deref(), Some("s2"));
        assert_eq!(s1.on_fail.as_deref(), Some("s3"));
        let m = s1.measurement.as_ref().expect("s1 has a measurement");
        assert_eq!(m.kind, "manual");
        assert_eq!(m.question.as_deref(), Some("Is it clogged?"));

        // Conclusion nodes carry conclusion text and no branch edges.
        let s2 = &plan.steps[1];
        assert_eq!(s2.conclusion.as_deref(), Some("Cleaned successfully."));
        assert!(s2.on_pass.is_none() && s2.on_fail.is_none());
    }

    #[test]
    fn did_measurement_parses_range() {
        let toml = r#"
dtc = "29E0"
[meta]
title = "Fuel rail pressure"

[[step]]
id = "s1"
instruction = "Read rail pressure."
measurement = { kind = "did", did = "0x5AC3", label = "Rail pressure", expected_min = 40.0, expected_max = 200.0 }
next = "s2"
source = "research/bmw_diag_dim04_uds_dids.md"

[[step]]
id = "s2"
conclusion = "Done."
source = "community/opinions/29E0.toml"
"#;
        let file: PlanFile = toml::from_str(toml).expect("did plan must parse");
        let plan = to_plan(file);
        let m = plan.steps[0].measurement.as_ref().expect("did measurement");
        assert_eq!(m.kind, "did");
        assert_eq!(m.did.as_deref(), Some("0x5AC3"));
        assert_eq!(m.expected_min, Some(40.0));
        assert_eq!(m.expected_max, Some(200.0));
    }

    #[test]
    fn query_is_case_insensitive_and_missing_is_none() {
        // Seed the KB directly (avoids depending on on-disk files here).
        {
            let mut k = kb().write().unwrap();
            let file: PlanFile = toml::from_str(SAMPLE).unwrap();
            let plan = to_plan(file);
            k.by_dtc.insert(plan.dtc.clone(), plan);
        }
        assert!(query("2a82").is_some(), "lookup must be case-insensitive");
        assert!(query("2A82").is_some());
        assert!(query("XXXX").is_none(), "unknown DTC returns None");
    }

    /// The shipped corpus must actually load through this module (not just
    /// pass the CI gate's own parser). Guards against a schema drift between
    /// the gate's structs and the production loader.
    #[test]
    fn shipped_corpus_loads() {
        let n = load();
        assert!(
            n >= 10,
            "expected the PR #2 corpus (>=10 plans) to load, got {n}"
        );
        // A known plan resolves and has a reachable-looking shape.
        let plan = query("2A82").expect("2A82 plan must load from disk");
        assert!(!plan.steps.is_empty());
        assert!(plan.steps.iter().any(|s| s.conclusion.is_some()));
    }
}
