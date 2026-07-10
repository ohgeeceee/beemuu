//! Hosted (remote) dashboard fetcher.
//!
//! Pulls repo/build health from the BeeEmUu VPS at
//! `https://beemuu.montanablotter.com/api/dashboard` so the desktop app can
//! show "what's deployed upstream" alongside its own local backend_dashboard.
//!
//! Read-only over HTTPS. No adapter I/O, no ECU probes, no writes — same
//! safety contract as the local backend_dashboard module.

use serde::{Deserialize, Serialize};

/// Default URL for the hosted dashboard endpoint.
pub const DEFAULT_URL: &str = "https://beemuu.montanablotter.com/api/dashboard";

/// Timeout for the hosted GET, in seconds. Kept short so a slow VPS never
/// blocks the webview.
const REQUEST_TIMEOUT_SECS: u64 = 5;

/// Top-level JSON shape returned by the VPS `/api/dashboard` endpoint.
///
/// Field names match the VPS payload byte-for-byte — see
/// `backend/app.py::build_dashboard` on the VPS side.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostedDashboard {
    pub service: String,
    pub generated_at_secs: u64,
    pub repo: HostedRepo,
    pub counts: HostedCounts,
    #[serde(default)]
    pub artifacts: Vec<String>,
    pub runtime: HostedRuntime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostedRepo {
    pub root: String,
    pub branch: Option<String>,
    pub commit: Option<String>,
    #[serde(default)]
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostedCounts {
    #[serde(default)]
    pub community_profiles: usize,
    #[serde(default)]
    pub exports: usize,
    #[serde(default)]
    pub bundles: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostedRuntime {
    pub mode: String,
    #[serde(default)]
    pub vehicle_connected: bool,
    #[serde(default)]
    pub note: String,
}

/// Fetch and parse the hosted dashboard.
///
/// `url` overrides the default endpoint (useful for tests + local dev).
/// Returns a typed struct or a human-readable error string for the frontend.
pub async fn fetch(url: Option<&str>) -> Result<HostedDashboard, String> {
    let target = url.unwrap_or(DEFAULT_URL);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent(concat!("beeemuu/", env!("CARGO_PKG_VERSION"), " (hosted-dashboard)"))
        .build()
        .map_err(|e| format!("http client init: {e}"))?;

    let response = client
        .get(target)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("http {status}"));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("read body: {e}"))?;

    serde_json::from_str::<HostedDashboard>(&body)
        .map_err(|e| format!("parse json: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A realistic payload, lifted from the live VPS. If the schema changes,
    /// this test catches it.
    const SAMPLE: &str = r#"{
        "service": "beemuu-api",
        "generated_at_secs": 1783715579,
        "repo": {
            "root": "/root/beemuu",
            "branch": "main",
            "commit": "e5a7103",
            "dirty": false
        },
        "counts": {
            "community_profiles": 6,
            "exports": 0,
            "bundles": 3
        },
        "artifacts": [
            "src-tauri/target/release/bundle/deb/BeeEmUu_0.2.0_amd64.deb",
            "src-tauri/target/release/bundle/rpm/BeeEmUu-0.2.0-1.x86_64.rpm",
            "src-tauri/target/release/bundle/appimage/BeeEmUu_0.2.0_amd64.AppImage"
        ],
        "runtime": {
            "mode": "vps-web",
            "vehicle_connected": false,
            "note": "Hosted dashboard is read-only; desktop app handles real adapter I/O."
        }
    }"#;

    #[test]
    fn parses_real_vps_payload() {
        let d: HostedDashboard = serde_json::from_str(SAMPLE).expect("parse");
        assert_eq!(d.service, "beemuu-api");
        assert_eq!(d.repo.branch.as_deref(), Some("main"));
        assert_eq!(d.repo.commit.as_deref(), Some("e5a7103"));
        assert!(!d.repo.dirty);
        assert_eq!(d.counts.community_profiles, 6);
        assert_eq!(d.counts.bundles, 3);
        assert_eq!(d.artifacts.len(), 3);
        assert_eq!(d.runtime.mode, "vps-web");
        assert!(!d.runtime.vehicle_connected);
    }

    #[test]
    fn tolerates_missing_optional_fields() {
        // The frontend should still render something useful if the VPS adds
        // new fields or drops optional ones (e.g. artifacts list).
        let minimal = r#"{
            "service": "beemuu-api",
            "generated_at_secs": 0,
            "repo": {"root": "/x", "branch": null, "commit": null, "dirty": false},
            "counts": {},
            "runtime": {"mode": "vps-web"}
        }"#;
        let d: HostedDashboard = serde_json::from_str(minimal).expect("parse");
        assert_eq!(d.counts.community_profiles, 0);
        assert_eq!(d.counts.bundles, 0);
        assert!(d.artifacts.is_empty());
    }
}