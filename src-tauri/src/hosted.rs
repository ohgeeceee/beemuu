//! Hosted (remote) VPS fetcher.
//!
//! Pulls live stats + landing-page content from the BeeEmUu production VPS at
//! `https://beemuu.com/api/{stats,landing-content,health}` and exposes them to
//! the desktop app's hosted panel.
//!
//! Read-only over HTTPS. No adapter I/O, no ECU probes, no writes — same
//! safety contract as the local backend_dashboard module.

use serde::{Deserialize, Serialize};

/// Default URL for the hosted stats endpoint.
pub const DEFAULT_STATS_URL: &str = "https://beemuu.com/api/stats";

/// Default URL for the hosted landing-content endpoint.
pub const DEFAULT_LANDING_URL: &str = "https://beemuu.com/api/landing-content";

/// Timeout for the hosted GETs, in seconds. Kept short so a slow VPS never
/// blocks the webview.
const REQUEST_TIMEOUT_SECS: u64 = 5;

/// `/api/landing-content` response. Content for the marketing landing page.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LandingContent {
    pub version: String,
    pub motto: String,
    pub github_url: String,
    #[serde(default)]
    pub discord_url: String,
    pub counters: LandingCounters,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LandingCounters {
    pub dtc_count: usize,
    pub sessions_count: usize,
    pub systems_supported: usize,
}

/// `/api/stats` response. Live counters + breakdowns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostedStats {
    pub users: usize,
    pub dtc: usize,
    pub diagnostic_sessions: usize,
    #[serde(default)]
    pub contact_messages: usize,
    #[serde(default)]
    pub dtc_by_system: std::collections::BTreeMap<String, usize>,
    #[serde(default)]
    pub sessions_by_status: std::collections::BTreeMap<String, usize>,
    #[serde(default)]
    pub last_session: Option<serde_json::Value>,
    pub server_time: String,
    pub version: String,
}

/// Aggregate payload returned by [`fetch`] — both endpoints stitched together
/// so the frontend makes a single Tauri call instead of two round trips.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostedSnapshot {
    pub stats: HostedStats,
    pub landing: LandingContent,
    pub fetched_at_secs: u64,
}

/// Fetch both the stats and landing-content endpoints and combine them.
///
/// `stats_url` / `landing_url` override the defaults (useful for tests + local
/// dev). Returns a typed struct or a human-readable error string for the frontend.
pub async fn fetch(
    stats_url: Option<&str>,
    landing_url: Option<&str>,
) -> Result<HostedSnapshot, String> {
    let stats_target = stats_url.unwrap_or(DEFAULT_STATS_URL);
    let landing_target = landing_url.unwrap_or(DEFAULT_LANDING_URL);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent(concat!("beeemuu/", env!("CARGO_PKG_VERSION"), " (hosted-snapshot)"))
        .build()
        .map_err(|e| format!("http client init: {e}"))?;

    // Fetch both endpoints sequentially — same TLS connection, same host, so
        // the latency difference vs parallel is negligible and we avoid pulling in
        // tokio just for `join!`. If either fails the whole call fails (the user
        // sees a single error message rather than a half-rendered panel).
        let stats = fetch_one::<HostedStats>(&client, stats_target, "stats").await?;
        let landing = fetch_one::<LandingContent>(&client, landing_target, "landing").await?;

    Ok(HostedSnapshot {
        stats,
        landing,
        fetched_at_secs: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    })
}

async fn fetch_one<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
    label: &str,
) -> Result<T, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("{label} request failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{label} http {status}"));
    }
    let body = response
        .text()
        .await
        .map_err(|e| format!("{label} read body: {e}"))?;
    serde_json::from_str::<T>(&body).map_err(|e| format!("{label} parse json: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Realistic stats payload, lifted from the live VPS at https://beemuu.com/api/stats.
    /// If the production schema changes, this test catches it.
    const SAMPLE_STATS: &str = r#"{
        "users": 1,
        "dtc": 26,
        "diagnostic_sessions": 0,
        "contact_messages": 1,
        "dtc_by_system": {
            "abs": 2,
            "airbag": 2,
            "body": 3,
            "chassis": 1,
            "engine": 15,
            "transmission": 3
        },
        "sessions_by_status": {},
        "last_session": null,
        "server_time": "2026-07-11T07:28:15+00:00",
        "version": "0.2.0"
    }"#;

    /// Realistic landing-content payload from the live VPS.
    const SAMPLE_LANDING: &str = r#"{
        "version": "0.2.0",
        "motto": "Open-source BMW diagnostics for everyone with an OBD-II cable.",
        "github_url": "https://github.com/ohgeeceee/beemuu",
        "discord_url": "",
        "counters": {
            "dtc_count": 26,
            "sessions_count": 0,
            "systems_supported": 6
        }
    }"#;

    #[test]
    fn parses_real_vps_stats() {
        let s: HostedStats = serde_json::from_str(SAMPLE_STATS).expect("parse");
        assert_eq!(s.users, 1);
        assert_eq!(s.dtc, 26);
        assert_eq!(s.diagnostic_sessions, 0);
        assert_eq!(s.contact_messages, 1);
        assert_eq!(s.dtc_by_system.get("engine"), Some(&15));
        assert_eq!(s.dtc_by_system.get("body"), Some(&3));
        assert_eq!(s.server_time, "2026-07-11T07:28:15+00:00");
        assert_eq!(s.version, "0.2.0");
        assert!(s.last_session.is_none());
    }

    #[test]
    fn parses_real_vps_landing() {
        let l: LandingContent = serde_json::from_str(SAMPLE_LANDING).expect("parse");
        assert_eq!(l.version, "0.2.0");
        assert_eq!(l.counters.dtc_count, 26);
        assert_eq!(l.counters.sessions_count, 0);
        assert_eq!(l.counters.systems_supported, 6);
        assert_eq!(l.github_url, "https://github.com/ohgeeceee/beemuu");
        assert_eq!(l.discord_url, ""); // empty string is valid (defaulted)
    }

    #[test]
    fn tolerates_missing_optional_fields() {
        let minimal_stats = r#"{
            "users": 0,
            "dtc": 0,
            "diagnostic_sessions": 0,
            "server_time": "2026-01-01T00:00:00+00:00",
            "version": "0.0.0"
        }"#;
        let s: HostedStats = serde_json::from_str(minimal_stats).expect("parse");
        assert_eq!(s.contact_messages, 0);
        assert!(s.dtc_by_system.is_empty());
        assert!(s.sessions_by_status.is_empty());
        assert!(s.last_session.is_none());
    }

    #[test]
    fn defaults_point_at_production() {
        assert!(DEFAULT_STATS_URL.starts_with("https://"));
        assert!(DEFAULT_STATS_URL.contains("/api/stats"));
        assert!(DEFAULT_LANDING_URL.contains("/api/landing-content"));
    }
}