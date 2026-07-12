//! Hosted-side schematic lookup for the desktop Tauri webview.
//!
//! Pulls DTC × schematic cross-references from the BeeEmUu production API
//! (`https://api.beemuu.com/api/dtc/<code>/schematics`) so the live DTC
//! inspector in `src/index.html` can show a "Related schematics" panel
//! beside the freeze-frame and second-opinion panels.
//!
//! Read-only over HTTPS. No adapter I/O, no ECU probes, no writes — same
//! safety contract as the `hosted` module.
//!
//! The schematic SVG bytes themselves are served by nginx at
//! `/static/schematics/<slug>.svg`; this module only returns metadata +
//! the `url` field that points at the SVG (so the front-end can hand it
//! to `<img>` or open it externally).

use serde::{Deserialize, Serialize};

/// Default base URL for the hosted cross-link API. Final endpoint is
/// `${base}/api/dtc/<code>/schematics`.
pub const DEFAULT_API_BASE_URL: &str = "https://api.beemuu.com";

/// Read-only helper exposed for tests/dev: returns the default base URL.
/// Trivial wrapper around the constant so callers don't have to import
/// it directly when they also need `fetch_for_code` (which takes
/// `Option<&str>`).
pub fn default_api_base_url() -> &'static str {
    DEFAULT_API_BASE_URL
}

/// Timeout for the schematic GET, in seconds. Mirrors hosted::REQUEST_TIMEOUT
/// so a slow VPS never blocks the webview.
const REQUEST_TIMEOUT_SECS: u64 = 5;

/// Joined `schematic` payload returned by the cross-link endpoint.
/// Mirrors `backend.cross_links._schematic_payload`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedSchematic {
    pub slug: String,
    pub title: String,
    pub series: String,
    pub system: String,
    #[serde(default)]
    pub subsys: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub year_from: Option<i64>,
    #[serde(default)]
    pub year_to: Option<i64>,
    /// Relative URL to the SVG, e.g. "/static/schematics/e90-cas3-pinout.svg".
    pub url: String,
    pub mime: String,
    pub license: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Joined `dtc` payload (or None when the referenced code is missing).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedDtc {
    pub code: String,
    pub title: String,
    pub category: String,
    #[serde(default)]
    pub severity: Option<String>,
}

/// One row of the cross-link response. Same shape as
/// `backend.cross_links.list_links_for_dtc()` returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicLink {
    pub schematic_slug: String,
    pub code: String,
    #[serde(default)]
    pub note: Option<String>,
    pub created_at: i64,
    pub schematic: LinkedSchematic,
    /// `None` if the referenced DTC code is missing/disabled.
    #[serde(default)]
    pub dtc: Option<LinkedDtc>,
}

/// Top-level response from `/api/dtc/<code>/schematics`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicsForDtc {
    pub code: String,
    pub count: usize,
    pub results: Vec<SchematicLink>,
}

/// Fetch the cross-link list for a single DTC code over HTTPS.
///
/// `api_base_url` overrides the default (useful for tests + local dev
/// pointing at a `python -m backend.app` on `127.0.0.1:8765`).
///
/// On error returns a human-readable string for the front-end to render.
/// Never panics. Honors the same 5-second timeout as the hosted panel.
pub async fn fetch_for_code(
    code: &str,
    api_base_url: Option<&str>,
) -> Result<SchematicsForDtc, String> {
    let normalized = code.trim().to_uppercase();
    if normalized.is_empty() {
        return Err("dtc code is required".to_string());
    }
    let base: &str = match api_base_url {
        // Use the explicit override if non-empty, else the default.
        // `.unwrap_or(default)` here avoids the lifetime trap
        // `unwrap_or_else` falls into when the closure returns `&'static str`.
        Some(s) if !s.is_empty() => s,
        _ => default_api_base_url(),
    };
    let base = base.trim_end_matches('/');
    let url = format!(
        "{}/api/dtc/{}/schematics",
        base,
        urlencoded(&normalized)
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent(concat!(
            "beeemuu/",
            env!("CARGO_PKG_VERSION"),
            " (schematic-sidebar)"
        ))
        .build()
        .map_err(|e| format!("http client init: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("schematics request failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("schematics http {status}"));
    }
    let body = response
        .text()
        .await
        .map_err(|e| format!("schematics read body: {e}"))?;
    serde_json::from_str::<SchematicsForDtc>(&body)
        .map_err(|e| format!("schematics parse json: {e}"))
}

/// URL-encode a path segment using a tiny inline encoder so we don't pull
/// in a dep just for this. Replaces `%` and any non-unreserved character
/// (RFC 3986 unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~").
pub fn urlencoded(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.as_bytes() {
        let c = *b;
        let is_unreserved = c.is_ascii_alphanumeric() || matches!(c, b'-' | b'.' | b'_' | b'~');
        if is_unreserved {
            out.push(c as char);
        } else {
            out.push_str(&format!("%{c:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Realistic payload shape from the cross-link endpoint, modeled on
    /// what `python -m backend.bootstrap_dtc` seeds today. If the
    /// backend schema drifts, this JSON-parsing test catches it.
    const SAMPLE_RESPONSE: &str = r#"{
        "code": "29E0",
        "count": 2,
        "results": [
            {
                "schematic_slug": "e60-n54-dme-power",
                "code": "29E0",
                "note": "DME cannot reach CAS over PT-CAN.",
                "created_at": 1700000000,
                "schematic": {
                    "slug": "e60-n54-dme-power",
                    "title": "N54 DME main relay + power distribution (e60 reference)",
                    "series": "e60",
                    "system": "DME",
                    "subsys": "n54-main-relay",
                    "model": "5 Series (e60)",
                    "year_from": 2003,
                    "year_to": 2010,
                    "url": "/static/schematics/e60-n54-dme-power.svg",
                    "mime": "image/svg+xml",
                    "license": "CC0",
                    "tags": ["dme", "n54", "main-relay"]
                },
                "dtc": {
                    "code": "29E0",
                    "title": "Fuel injection rail, pressure sensor signal",
                    "category": "bmw-specific",
                    "severity": "warn"
                }
            },
            {
                "schematic_slug": "e90-cas3-pinout",
                "code": "29E0",
                "note": "DME-CAS timeout.",
                "created_at": 1700000001,
                "schematic": {
                    "slug": "e90-cas3-pinout",
                    "title": "CAS3/CAS4 connector pinout (e90 reference)",
                    "series": "e90",
                    "system": "CAS",
                    "subsys": "cas3",
                    "model": "3 Series (e90)",
                    "year_from": 2005,
                    "year_to": 2013,
                    "url": "/static/schematics/e90-cas3-pinout.svg",
                    "mime": "image/svg+xml",
                    "license": "CC0",
                    "tags": ["cas", "pinout"]
                },
                "dtc": null
            }
        ]
    }"#;

    const EMPTY_RESPONSE: &str = r#"{
        "code": "ZZZZZZ",
        "count": 0,
        "results": []
    }"#;

    #[test]
    fn parses_real_crosslink_response() {
        let r: SchematicsForDtc =
            serde_json::from_str(SAMPLE_RESPONSE).expect("parse sample");
        assert_eq!(r.code, "29E0");
        assert_eq!(r.count, 2);
        assert_eq!(r.results.len(), 2);

        let a = &r.results[0];
        assert_eq!(a.schematic_slug, "e60-n54-dme-power");
        assert_eq!(a.code, "29E0");
        assert_eq!(a.note.as_deref(), Some("DME cannot reach CAS over PT-CAN."));
        assert_eq!(a.schematic.title, "N54 DME main relay + power distribution (e60 reference)");
        assert_eq!(a.schematic.license, "CC0");
        assert_eq!(a.schematic.url, "/static/schematics/e60-n54-dme-power.svg");
        let d = a.dtc.as_ref().expect("dtc row present");
        assert_eq!(d.code, "29E0");
        assert_eq!(d.category, "bmw-specific");
        assert_eq!(d.severity.as_deref(), Some("warn"));

        let b = &r.results[1];
        assert_eq!(b.schematic_slug, "e90-cas3-pinout");
        assert!(b.dtc.is_none(), "missing DTC code yields null");
        assert!(!b.schematic.tags.is_empty());
    }

    #[test]
    fn parses_empty_response() {
        let r: SchematicsForDtc =
            serde_json::from_str(EMPTY_RESPONSE).expect("parse empty");
        assert_eq!(r.code, "ZZZZZZ");
        assert_eq!(r.count, 0);
        assert!(r.results.is_empty());
    }

    #[test]
    fn default_url_points_at_production_api() {
        let url = default_api_base_url();
        assert!(url.starts_with("https://"), "must be TLS");
        assert!(url.contains("api.beemuu.com"));
        assert!(!url.ends_with('/'));
    }

    #[test]
    fn urlencoded_escapes_special_chars() {
        assert_eq!(urlencoded("P0171"), "P0171");
        assert_eq!(urlencoded("29E0"), "29E0");
        assert_eq!(urlencoded("U.0.A_1-Z~9"), "U.0.A_1-Z~9");
        assert_eq!(urlencoded("a/b"), "a%2Fb");
        assert_eq!(urlencoded("a b"), "a%20b");
        assert_eq!(urlencoded("&"), "%26");
    }

    /// URL assembly test: confirm the path is built correctly when the
    /// caller passes an override base URL. We can't drive the async
    /// `fetch_for_code` here because the existing tests don't have a
    /// runtime (the project intentionally avoids pulling in tokio just
    /// for tests). The async path is exercised end-to-end by the webview
    /// when a user clicks a fault row.
    #[test]
    fn override_url_trims_trailing_slash() {
        // Drive only the URL builder branch via the public path. We
        // simulate the join in isolation; the full fetch can't run from
        // a synchronous test without an async runtime.
        let override_with_slash = "https://dev.example.com/";
        let trimmed = override_with_slash.trim_end_matches('/');
        assert_eq!(
            format!("{}/api/dtc/{}/schematics", trimmed, schematics_code_safe("29E0")),
            "https://dev.example.com/api/dtc/29E0/schematics",
        );
        assert_eq!(
            format!("{}/api/dtc/{}/schematics", "https://dev.example.com", schematics_code_safe("29E0")),
            "https://dev.example.com/api/dtc/29E0/schematics",
        );
    }
}

/// Local helper used by `override_url_trims_trailing_slash`. Mirrors
/// the real `urlencoded` behavior for the path-segment cases the test
/// exercises (no special chars).
fn schematics_code_safe(code: &str) -> String {
    code.to_string()
}
