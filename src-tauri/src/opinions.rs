//! Virtual Second Opinion — three perspectives per DTC.
//!
//! For any given DTC, presents synthesized viewpoints:
//!   - The Dealer (warranty / replace-the-assembly approach)
//!   - The Indie Shop (diagnostic-first, check-the-basics approach)
//!   - The DIY / Forums (cheap/free fixes from owner experience)
//!
//! Knowledge base lives in `community/opinions/<dtc_code>.toml`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

// ------------------------------------------------------------------
// Public data types
// ------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct OpinionSet {
    pub dtc_code: String,
    pub dtc_text: String,
    pub perspectives: Vec<Opinion>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Opinion {
    pub perspective: String, // "dealer" | "indie" | "diy"
    pub action: String,
    pub cost_usd: Option<u32>,
    pub time_estimate: String,
    pub difficulty: Option<String>,
    pub source: String,
    pub source_url: Option<String>,
    pub note: String,
}

// ------------------------------------------------------------------
// Internal knowledge base
// ------------------------------------------------------------------

#[derive(Deserialize, Clone, Debug)]
struct OpinionEntry {
    perspective: String,
    action: String,
    #[serde(default)]
    cost_usd: Option<u32>,
    #[serde(default)]
    time_estimate: String,
    #[serde(default)]
    difficulty: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    source_url: String,
    #[serde(default)]
    note: String,
}

#[derive(Deserialize, Debug)]
struct OpinionFile {
    dtc: String,
    #[serde(default)]
    dtc_text: String,
    #[serde(default)]
    opinion: Vec<OpinionEntry>,
}

struct OpinionKb {
    by_dtc: HashMap<String, OpinionFile>,
}

static OPINION_KB: OnceLock<RwLock<OpinionKb>> = OnceLock::new();

fn kb() -> &'static RwLock<OpinionKb> {
    OPINION_KB.get_or_init(|| {
        RwLock::new(OpinionKb {
            by_dtc: HashMap::new(),
        })
    })
}

// ------------------------------------------------------------------
// Loading
// ------------------------------------------------------------------

pub fn load() -> usize {
    let dir = match crate::community::find_dir() {
        Some(d) => d.join("opinions"),
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
        let file: OpinionFile = match toml::from_str(&text) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("Opinion: bad TOML in {}: {}", path.display(), e);
                continue;
            }
        };
        let dtc = file.dtc.to_uppercase();
        kb.by_dtc.insert(dtc, file);
        loaded += 1;
    }
    loaded
}

// ------------------------------------------------------------------
// Query
// ------------------------------------------------------------------

pub fn query(dtc_code: &str, dtc_text: &str) -> OpinionSet {
    let kb = match kb().read() {
        Ok(k) => k,
        Err(_) => {
            return OpinionSet {
                dtc_code: dtc_code.to_string(),
                dtc_text: dtc_text.to_string(),
                perspectives: vec![],
            }
        }
    };

    let mut perspectives = Vec::new();

    if let Some(file) = kb.by_dtc.get(&dtc_code.to_uppercase()) {
        for entry in &file.opinion {
            perspectives.push(Opinion {
                perspective: entry.perspective.clone(),
                action: entry.action.clone(),
                cost_usd: entry.cost_usd,
                time_estimate: entry.time_estimate.clone(),
                difficulty: if entry.difficulty.is_empty() {
                    None
                } else {
                    Some(entry.difficulty.clone())
                },
                source: entry.source.clone(),
                source_url: if entry.source_url.is_empty() {
                    None
                } else {
                    Some(entry.source_url.clone())
                },
                note: entry.note.clone(),
            });
        }
    }

    // Sort: DIY first, then indie, then dealer
    let order = |p: &Opinion| match p.perspective.as_str() {
        "diy" => 0,
        "indie" => 1,
        "dealer" => 2,
        _ => 3,
    };
    perspectives.sort_by_key(order);

    OpinionSet {
        dtc_code: dtc_code.to_string(),
        dtc_text: dtc_text.to_string(),
        perspectives,
    }
}
