//! Community Oracle — crowdsourced DTC pattern intelligence.
//!
//! When a user scans faults, we build a privacy-preserving fingerprint
//! (sorted DTC codes + engine family — no VIN) and look it up in a
//! bundled community knowledge base.  The knowledge base ships as JSON
//! files in `community/oracle/` and is loaded at startup.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::{OnceLock, RwLock};

// ------------------------------------------------------------------
// Public data types
// ------------------------------------------------------------------

/// Privacy-preserving hash of a DTC set.  No VIN, no mileage.
#[derive(Serialize, Clone, Debug)]
pub struct DtcFingerprint {
    /// Stable hash string (first 16 hex chars of a 64-bit hash).
    pub hash: String,
    /// e.g. "n55", "b58", "n54", "generic"
    pub engine_family: String,
    pub dtc_count: usize,
    /// Sorted DTC codes (upper-case hex).
    pub dtcs: Vec<String>,
}

/// One known fix / outcome contributed by the community.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PatternOutcome {
    pub fix_category: String,
    #[serde(default)]
    pub part_numbers: Vec<String>,
    #[serde(default)]
    pub cost_estimate_usd: Option<u32>,
    /// 0-100, higher = more community confirmations.
    #[serde(default)]
    pub confidence: u8,
    /// Short rationale / source note.
    #[serde(default)]
    pub note: String,
}

/// A link to a forum thread or external resource.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ForumLink {
    pub title: String,
    pub url: String,
}

/// Result handed back to the frontend.
#[derive(Serialize, Clone, Debug)]
pub struct OracleResult {
    pub match_count: usize,
    pub exact_matches: usize,
    pub outcomes: Vec<PatternOutcome>,
    #[serde(default)]
    pub forum_threads: Vec<ForumLink>,
    pub offline: bool,
}

// ------------------------------------------------------------------
// Internal knowledge-base representation
// ------------------------------------------------------------------

/// One entry in the on-disk JSON — keyed by fingerprint hash.
#[derive(Deserialize, Debug)]
struct OracleEntry {
    #[serde(default)]
    engine_family: String,
    #[serde(default)]
    dtcs: Vec<String>,
    #[serde(default)]
    outcomes: Vec<PatternOutcome>,
    #[serde(default)]
    forum_threads: Vec<ForumLink>,
}

/// The in-memory knowledge base.
struct KnowledgeBase {
    /// Primary index: exact fingerprint hash → entry.
    by_hash: HashMap<String, OracleEntry>,
    /// Secondary index: engine family → list of hashes (for partial matching).
    by_engine: HashMap<String, Vec<String>>,
}

static KB: OnceLock<RwLock<KnowledgeBase>> = OnceLock::new();

fn kb() -> &'static RwLock<KnowledgeBase> {
    KB.get_or_init(|| {
        RwLock::new(KnowledgeBase {
            by_hash: HashMap::new(),
            by_engine: HashMap::new(),
        })
    })
}

// ------------------------------------------------------------------
// Fingerprinting
// ------------------------------------------------------------------

/// Build a stable, privacy-preserving fingerprint from a DTC list.
///
/// The canonical string is `<engine>:<sorted-dtcs>`; we hash that
/// with the std hasher and return the first 16 hex chars.
pub fn fingerprint(dtcs: &[crate::protocol::Dtc], engine_profile: &str) -> DtcFingerprint {
    let mut codes: Vec<String> = dtcs.iter().map(|d| d.code.to_uppercase()).collect();
    codes.sort();
    codes.dedup();

    let canonical = format!("{}:{}", engine_profile.to_lowercase(), codes.join(","));
    let mut hasher = DefaultHasher::new();
    canonical.hash(&mut hasher);
    let hash64 = hasher.finish();
    let hash = format!("{:016x}", hash64);

    DtcFingerprint {
        hash,
        engine_family: engine_profile.to_lowercase(),
        dtc_count: codes.len(),
        dtcs: codes,
    }
}

// ------------------------------------------------------------------
// Query engine
// ------------------------------------------------------------------

/// Query the knowledge base for a fingerprint.
///
/// Falls back to partial matching (same engine, overlapping DTCs)
/// when no exact match exists.
pub fn query(fp: &DtcFingerprint) -> Result<OracleResult, String> {
    let kb = kb().read().map_err(|_| "Oracle lock poisoned")?;

    let mut exact = 0usize;
    let mut outcomes = Vec::new();
    let mut forums = Vec::new();

    // 1. Exact hash match
    if let Some(entry) = kb.by_hash.get(&fp.hash) {
        exact += 1;
        outcomes.extend(entry.outcomes.clone());
        forums.extend(entry.forum_threads.clone());
    }

    // 2. Partial matches: same engine, any overlapping DTC
    let mut match_count = exact;
    if let Some(hashes) = kb.by_engine.get(&fp.engine_family) {
        for h in hashes {
            if h == &fp.hash {
                continue; // already counted
            }
            if let Some(entry) = kb.by_hash.get(h) {
                let overlap = fp.dtcs.iter().filter(|c| entry.dtcs.contains(c)).count();
                if overlap > 0 {
                    match_count += 1;
                    // Only include outcomes that are generic enough
                    // (confidence > 50 or explicitly marked as "generic")
                    for o in &entry.outcomes {
                        if o.confidence >= 50 {
                            outcomes.push(o.clone());
                        }
                    }
                }
            }
        }
    }

    // Deduplicate outcomes by fix_category, keeping highest confidence
    let mut dedup: HashMap<String, PatternOutcome> = HashMap::new();
    for o in outcomes {
        dedup.entry(o.fix_category.clone())
            .and_modify(|e| {
                if o.confidence > e.confidence {
                    *e = o.clone();
                }
            })
            .or_insert(o);
    }
    let mut outcomes: Vec<PatternOutcome> = dedup.into_values().collect();
    outcomes.sort_by(|a, b| b.confidence.cmp(&a.confidence));

    Ok(OracleResult {
        match_count,
        exact_matches: exact,
        outcomes,
        forum_threads: forums,
        offline: true, // v1 is always offline; cloud API can be added later
    })
}

// ------------------------------------------------------------------
// Loading
// ------------------------------------------------------------------

/// Load all `.json` files from `community/oracle/` into memory.
/// Called once at startup in `lib.rs`.
pub fn load() -> usize {
    let dir = match crate::community::find_dir() {
        Some(d) => d.join("oracle"),
        None => return 0,
    };
    if !dir.is_dir() {
        return 0;
    }

    let mut kb = match kb().write() {
        Ok(k) => k,
        Err(_) => return 0,
    };
    kb.by_hash.clear();
    kb.by_engine.clear();

    let mut loaded = 0usize;
    let Ok(entries) = std::fs::read_dir(&dir) else { return loaded; };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("json")) {
            continue;
        }
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };

        // Each file is a JSON object mapping fingerprint hash → OracleEntry
        let map: HashMap<String, OracleEntry> = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("Oracle: bad JSON in {}: {}", path.display(), e);
                continue;
            }
        };

        for (hash, entry) in map {
            let engine = entry.engine_family.clone().to_lowercase();
            kb.by_engine.entry(engine).or_default().push(hash.clone());
            kb.by_hash.insert(hash, entry);
            loaded += 1;
        }
    }

    loaded
}
