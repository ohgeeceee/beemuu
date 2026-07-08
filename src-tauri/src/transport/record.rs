//! Traffic recorder — a `Transport` decorator that logs every request and
//! response as timestamped hex. Wrapping any transport makes the whole bus
//! conversation inspectable and exportable, which is the raw material both
//! for good bug reports and for reverse-engineering new parameter mappings.

use super::{Result, Transport};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// One logged request/response pair.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct TrafficEntry {
    pub seq: u64,
    /// Milliseconds since the log started.
    pub t_ms: u128,
    pub target: u8,
    pub request: String,
    pub response: String,
    pub ok: bool,
    pub detail: String,
    pub dur_ms: u64,
}

/// A bounded ring buffer of traffic entries.
pub struct TrafficLog {
    start: Option<Instant>,
    seq: u64,
    entries: VecDeque<TrafficEntry>,
    cap: usize,
}

impl Default for TrafficLog {
    fn default() -> Self {
        Self { start: None, seq: 0, entries: VecDeque::new(), cap: 2000 }
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" ")
}

impl TrafficLog {
    fn record(&mut self, target: u8, req: &[u8], res: &Result<Vec<u8>>, dur: std::time::Duration) {
        let start = *self.start.get_or_insert_with(Instant::now);
        let (response, ok, detail) = match res {
            Ok(r) => (hex(r), true, String::new()),
            Err(e) => (String::new(), false, e.to_string()),
        };
        self.seq += 1;
        self.entries.push_back(TrafficEntry {
            seq: self.seq,
            t_ms: start.elapsed().as_millis(),
            target,
            request: hex(req),
            response,
            ok,
            detail,
            dur_ms: dur.as_millis() as u64,
        });
        while self.entries.len() > self.cap {
            self.entries.pop_front();
        }
    }

    /// Snapshot all entries (oldest first).
    pub fn snapshot(&self) -> Vec<TrafficEntry> {
        self.entries.iter().cloned().collect()
    }

    /// Clear the log and reset the time origin.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.start = None;
        self.seq = 0;
    }
}

/// Shared handle to a traffic log, cheap to clone.
pub type SharedLog = Arc<Mutex<TrafficLog>>;

pub struct RecordingTransport {
    inner: Box<dyn Transport>,
    log: SharedLog,
}

impl RecordingTransport {
    pub fn new(inner: Box<dyn Transport>, log: SharedLog) -> Self {
        Self { inner, log }
    }
}

impl Transport for RecordingTransport {
    fn name(&self) -> &'static str {
        self.inner.name()
    }

    fn request(&mut self, target: u8, payload: &[u8]) -> Result<Vec<u8>> {
        let t0 = Instant::now();
        let res = self.inner.request(target, payload);
        // Best-effort logging; never let a poisoned lock break diagnostics.
        if let Ok(mut log) = self.log.lock() {
            log.record(target, payload, &res, t0.elapsed());
        }
        res
    }

    fn disconnect(&mut self) {
        self.inner.disconnect();
    }
}
