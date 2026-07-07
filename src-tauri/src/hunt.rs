//! Parameter Hunt — gamified reverse engineering.
//!
//! Turns the Parameter Explorer into a game: users earn points for
//! discovering responding identifiers, mapping unknown bytes to physical
//! values, and contributing freeze-frame schemas. Point events fire
//! automatically from the explorer commands (see `commands.rs`).
//!
//! Offline-first, matching the Oracle/Story pattern:
//!   - Local score ledger persists to `<home>/beeemuu-exports/hunt_state.json`.
//!   - Leaderboard + monthly challenges ship as static files in
//!     `community/hunt/` and are updated via pull requests. Merged-PR
//!     points (+500 each) arrive through the leaderboard file: an entry
//!     whose alias matches yours adds its `merged_points` to your score.
//!   - Discoveries made on the simulator are logged as *practice* and
//!     award 0 points — only a real car scores.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

// ------------------------------------------------------------------
// Point values (single source of truth — mirrored in the Hunt tab UI)
// ------------------------------------------------------------------

pub const PTS_DISCOVER_ID: u32 = 10; // new responding local ident / DID / PID
pub const PTS_MAP_PARAM: u32 = 50; // unknown byte mapped to a physical value
pub const PTS_FREEZE_SCHEMA: u32 = 100; // confirmed freeze-frame schema saved
pub const PTS_MERGED_PR: u32 = 500; // contribution merged into a release

// ------------------------------------------------------------------
// Persistent local state
// ------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HuntEvent {
    /// "discover" | "map" | "schema"
    pub kind: String,
    /// Human-readable detail, e.g. "DME local:2C" or "Freeze schema 0x12".
    pub detail: String,
    pub points: u32,
    /// True when earned on the simulator (no points, but logged).
    #[serde(default)]
    pub practice: bool,
    /// Unix seconds.
    pub at: u64,
}

#[derive(Serialize, Deserialize, Default)]
struct HuntState {
    #[serde(default)]
    alias: String,
    #[serde(default)]
    points: u64,
    /// Dedupe keys "addr:mode:id" — an identifier only scores once.
    #[serde(default)]
    seen_ids: HashSet<String>,
    #[serde(default)]
    mapped: HashSet<String>,
    #[serde(default)]
    schemas: HashSet<String>,
    /// Rolling event log, newest last (capped).
    #[serde(default)]
    events: Vec<HuntEvent>,
}

const EVENT_CAP: usize = 300;

static STATE: OnceLock<Mutex<HuntState>> = OnceLock::new();

fn state() -> &'static Mutex<HuntState> {
    STATE.get_or_init(|| Mutex::new(load_state()))
}

fn state_path() -> Option<PathBuf> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    Some(PathBuf::from(home).join("beeemuu-exports").join("hunt_state.json"))
}

fn load_state() -> HuntState {
    let Some(path) = state_path() else { return HuntState::default() };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save_state(s: &HuntState) {
    let Some(path) = state_path() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(s) {
        let _ = std::fs::write(&path, json);
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn push_event(s: &mut HuntState, kind: &str, detail: String, points: u32, practice: bool) {
    if !practice {
        s.points += points as u64;
    }
    s.events.push(HuntEvent {
        kind: kind.to_string(),
        detail,
        points: if practice { 0 } else { points },
        practice,
        at: now_secs(),
    });
    if s.events.len() > EVENT_CAP {
        let drop = s.events.len() - EVENT_CAP;
        s.events.drain(..drop);
    }
}

// ------------------------------------------------------------------
// Award hooks (called from commands.rs)
// ------------------------------------------------------------------

/// Award points for identifiers that answered a probe sweep. Each
/// `addr:mode:id` scores only once, ever. Returns points awarded now.
pub fn record_discoveries(address: u8, mode: &str, ids: &[u16], practice: bool) -> u32 {
    let mut s = state().lock().unwrap();
    let mut awarded = 0u32;
    for &id in ids {
        let key = format!("{address:02X}:{mode}:{id:04X}");
        if s.seen_ids.insert(key) {
            push_event(
                &mut s,
                "discover",
                format!("New responding {} 0x{:02X} on ECU 0x{:02X}", mode, id, address),
                PTS_DISCOVER_ID,
                practice,
            );
            if !practice {
                awarded += PTS_DISCOVER_ID;
            }
        }
    }
    if awarded > 0 || !ids.is_empty() {
        save_state(&s);
    }
    awarded
}

/// Award points for mapping an identifier to a labelled physical value.
pub fn record_mapping(address: u8, mode: &str, id: u16, label: &str) -> u32 {
    let mut s = state().lock().unwrap();
    let key = format!("{address:02X}:{mode}:{id:04X}");
    let mut awarded = 0;
    if s.mapped.insert(key) {
        push_event(
            &mut s,
            "map",
            format!("Mapped {} 0x{:02X} on ECU 0x{:02X} → \"{}\"", mode, id, address, label),
            PTS_MAP_PARAM,
            false,
        );
        awarded = PTS_MAP_PARAM;
    }
    save_state(&s);
    awarded
}

/// Award points for saving a confirmed freeze-frame schema.
pub fn record_schema(address: u8) -> u32 {
    let mut s = state().lock().unwrap();
    let key = format!("{address:02X}");
    let mut awarded = 0;
    if s.schemas.insert(key) {
        push_event(
            &mut s,
            "schema",
            format!("Freeze-frame schema saved for ECU 0x{:02X}", address),
            PTS_FREEZE_SCHEMA,
            false,
        );
        awarded = PTS_FREEZE_SCHEMA;
    }
    save_state(&s);
    awarded
}

// ------------------------------------------------------------------
// Badges
// ------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct Badge {
    pub id: String,
    pub icon: String,
    pub title: String,
    pub description: String,
    pub earned: bool,
}

fn badges_for(s: &HuntState, merged: u32) -> Vec<Badge> {
    let d = s.seen_ids.len();
    let m = s.mapped.len();
    let f = s.schemas.len();
    let p = s.points + (merged as u64) * (PTS_MERGED_PR as u64);
    let mk = |id: &str, icon: &str, title: &str, desc: &str, earned: bool| Badge {
        id: id.into(),
        icon: icon.into(),
        title: title.into(),
        description: desc.into(),
        earned,
    };
    vec![
        mk("first_contact", "📡", "First Contact", "Discover your first responding identifier", d >= 1),
        mk("cartographer", "🗺️", "Cartographer", "Discover 10 identifiers", d >= 10),
        mk("deep_scan", "🛰️", "Deep Scan", "Discover 50 identifiers", d >= 50),
        mk("decoder", "🔍", "Decoder", "Map your first byte to a physical value", m >= 1),
        mk("translator", "🈯", "Translator", "Map 5 parameters", m >= 5),
        mk("archivist", "🗄️", "Archivist", "Save your first freeze-frame schema", f >= 1),
        mk("librarian", "📚", "Librarian", "Save 3 freeze-frame schemas", f >= 3),
        mk("contributor", "🤝", "Contributor", "Get a contribution merged into a release", merged >= 1),
        mk("rookie", "🐝", "Rookie Hunter", "Reach 100 points", p >= 100),
        mk("veteran", "🏅", "Veteran Hunter", "Reach 500 points", p >= 500),
        mk("legend", "👑", "Hunt Legend", "Reach 1,000 points", p >= 1000),
    ]
}

// ------------------------------------------------------------------
// Community files: leaderboard + challenges (static, PR-updated)
// ------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct LeaderboardEntry {
    pub alias: String,
    #[serde(default)]
    pub points: u64,
    /// Count of merged contributions (each worth PTS_MERGED_PR).
    #[serde(default)]
    pub merged: u32,
    #[serde(default)]
    pub note: String,
    /// Filled in at query time — never stored.
    #[serde(default, skip_deserializing)]
    pub you: bool,
}

#[derive(Deserialize, Default)]
struct LeaderboardFile {
    #[serde(default)]
    updated: String,
    #[serde(default)]
    entries: Vec<LeaderboardEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Challenge {
    pub id: String,
    pub title: String,
    pub description: String,
    /// "YYYY-MM" — challenge counts events within this month; empty = always on.
    #[serde(default)]
    pub month: String,
    /// "discover" | "map" | "schema"
    pub kind: String,
    pub target: u32,
    pub reward: u32,
    /// Filled in at query time.
    #[serde(default, skip_deserializing)]
    pub progress: u32,
    #[serde(default, skip_deserializing)]
    pub complete: bool,
}

#[derive(Deserialize, Default)]
struct ChallengesFile {
    #[serde(default)]
    challenge: Vec<Challenge>,
}

fn hunt_dir() -> Option<PathBuf> {
    crate::community::find_dir().map(|d| d.join("hunt"))
}

fn load_leaderboard() -> LeaderboardFile {
    let Some(path) = hunt_dir().map(|d| d.join("leaderboard.json")) else {
        return LeaderboardFile::default();
    };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn load_challenges() -> Vec<Challenge> {
    let Some(path) = hunt_dir().map(|d| d.join("challenges.json")) else {
        return Vec::new();
    };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<ChallengesFile>(&t).ok())
        .map(|f| f.challenge)
        .unwrap_or_default()
}

/// Number of files in `community/hunt/` — for the startup report line.
pub fn load() -> usize {
    let lb = load_leaderboard().entries.len();
    let ch = load_challenges().len();
    // Touch local state so a corrupt file surfaces at startup, not mid-game.
    let _ = state().lock().map(|s| s.points).unwrap_or(0);
    lb + ch
}

/// "YYYY-MM" for a unix timestamp (UTC, no external deps).
fn month_of(secs: u64) -> String {
    // Civil-from-days algorithm (Howard Hinnant), months are all we need.
    let days = (secs / 86_400) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}", y, m)
}

fn challenge_progress(s: &HuntState, c: &Challenge) -> u32 {
    s.events
        .iter()
        .filter(|e| !e.practice && e.kind == c.kind)
        .filter(|e| c.month.is_empty() || month_of(e.at) == c.month)
        .count() as u32
}

// ------------------------------------------------------------------
// Status queries (Tauri command surface)
// ------------------------------------------------------------------

#[derive(Serialize)]
pub struct HuntStatus {
    pub alias: String,
    /// Local points + merged-PR points from the leaderboard file.
    pub points: u64,
    pub discovered: usize,
    pub mapped: usize,
    pub schemas: usize,
    pub merged: u32,
    pub badges: Vec<Badge>,
    pub challenges: Vec<Challenge>,
    /// Newest first.
    pub recent: Vec<HuntEvent>,
    pub rank: Option<usize>,
    pub current_month: String,
}

pub fn status() -> HuntStatus {
    let s = state().lock().unwrap();
    let lb = load_leaderboard();
    let merged = lb
        .entries
        .iter()
        .find(|e| !s.alias.is_empty() && e.alias.eq_ignore_ascii_case(&s.alias))
        .map(|e| e.merged)
        .unwrap_or(0);
    let points = s.points + (merged as u64) * (PTS_MERGED_PR as u64);

    let mut challenges = load_challenges();
    let now_month = month_of(now_secs());
    challenges.retain(|c| c.month.is_empty() || c.month == now_month);
    for c in &mut challenges {
        c.progress = challenge_progress(&s, c).min(c.target);
        c.complete = c.progress >= c.target;
    }

    let rank = {
        let mut all: Vec<u64> = lb
            .entries
            .iter()
            .filter(|e| !e.alias.eq_ignore_ascii_case(&s.alias))
            .map(|e| e.points + (e.merged as u64) * (PTS_MERGED_PR as u64))
            .collect();
        all.push(points);
        all.sort_unstable_by(|a, b| b.cmp(a));
        all.iter().position(|&p| p == points).map(|i| i + 1)
    };

    let mut recent: Vec<HuntEvent> = s.events.iter().rev().take(20).cloned().collect();
    recent.shrink_to_fit();

    HuntStatus {
        alias: s.alias.clone(),
        points,
        discovered: s.seen_ids.len(),
        mapped: s.mapped.len(),
        schemas: s.schemas.len(),
        merged,
        badges: badges_for(&s, merged),
        challenges,
        recent,
        rank,
        current_month: now_month,
    }
}

/// Community leaderboard merged with the local hunter (marked `you`).
pub fn leaderboard() -> Vec<LeaderboardEntry> {
    let s = state().lock().unwrap();
    let lb = load_leaderboard();
    let _ = &lb.updated; // reserved for UI use later
    let mut merged_pts: HashMap<String, LeaderboardEntry> = HashMap::new();
    for e in lb.entries {
        merged_pts.insert(e.alias.to_lowercase(), e);
    }
    let alias = if s.alias.is_empty() { "you (set an alias)".to_string() } else { s.alias.clone() };
    let key = alias.to_lowercase();
    let entry = merged_pts.entry(key).or_insert_with(|| LeaderboardEntry {
        alias: alias.clone(),
        ..Default::default()
    });
    // Local ledger is authoritative for your own score; the published file
    // entry is just your last-submitted snapshot. Never double-count.
    entry.points = entry.points.max(s.points);
    entry.you = true;

    let mut out: Vec<LeaderboardEntry> = merged_pts.into_values().collect();
    for e in &mut out {
        e.points += (e.merged as u64) * (PTS_MERGED_PR as u64);
    }
    out.sort_by(|a, b| b.points.cmp(&a.points));
    out
}

pub fn set_alias(alias: &str) -> Result<(), String> {
    let trimmed = alias.trim();
    if trimmed.len() > 32 {
        return Err("Alias too long (max 32 characters)".into());
    }
    let mut s = state().lock().unwrap();
    s.alias = trimmed.to_string();
    save_state(&s);
    Ok(())
}
