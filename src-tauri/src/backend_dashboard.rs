//! Backend dashboard aggregation.
//!
//! Read-only health snapshot for the UI. Keep this file boring: no adapter I/O,
//! no ECU probes, no writes.

use crate::community::LoadReport;
use crate::hunt::HuntStatus;
use crate::transport::record::TrafficEntry;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
pub struct TrafficSummary {
    pub entries: usize,
    pub ok: usize,
    pub failed: usize,
    pub avg_ms: u64,
    pub last_target: Option<u8>,
    pub last_detail: Option<String>,
}

#[derive(Serialize)]
pub struct BackendDashboard {
    pub generated_at_secs: u64,
    pub connected: bool,
    pub transport_name: Option<String>,
    pub profile_count: usize,
    pub export_count: usize,
    pub traffic: TrafficSummary,
    pub community: LoadReport,
    pub hunt: HuntStatus,
}

pub fn summarize_traffic(entries: &[TrafficEntry]) -> TrafficSummary {
    let ok = entries.iter().filter(|e| e.ok).count();
    let failed = entries.len().saturating_sub(ok);
    let total_ms: u64 = entries.iter().map(|e| e.dur_ms).sum();
    let avg_ms = if entries.is_empty() { 0 } else { total_ms / entries.len() as u64 };
    let last = entries.last();

    TrafficSummary {
        entries: entries.len(),
        ok,
        failed,
        avg_ms,
        last_target: last.map(|e| e.target),
        last_detail: last.and_then(|e| if e.detail.is_empty() { None } else { Some(e.detail.clone()) }),
    }
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(seq: u64, ok: bool, dur_ms: u64) -> TrafficEntry {
        TrafficEntry {
            seq,
            t_ms: seq as u128,
            target: 0x12,
            request: "3E 00".into(),
            response: if ok { "7E 00".into() } else { String::new() },
            ok,
            detail: if ok { String::new() } else { "timeout".into() },
            dur_ms,
        }
    }

    #[test]
    fn summarize_traffic_counts_failures_and_latency() {
        let summary = summarize_traffic(&[entry(1, true, 10), entry(2, false, 30)]);

        assert_eq!(summary.entries, 2);
        assert_eq!(summary.ok, 1);
        assert_eq!(summary.failed, 1);
        assert_eq!(summary.avg_ms, 20);
        assert_eq!(summary.last_target, Some(0x12));
        assert_eq!(summary.last_detail.as_deref(), Some("timeout"));
    }
}
