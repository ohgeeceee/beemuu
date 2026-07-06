//! Payload analysis — stateful engines that turn repeated raw reads into
//! insight about which bytes carry live signals.

/// Tracks, per byte offset, how a payload mutates across successive polls.
///
/// The idea: when hunting for an unknown parameter, poll one identifier
/// repeatedly while the value physically changes (rev the engine, warm it up).
/// Bytes that flip often are live signals; bytes that never move are static
/// config or padding. `volatility` (fraction of samples in which a byte
/// changed) ranks candidates, and min/max bound the observed range so you can
/// sanity-check a scaling hypothesis.
#[derive(Default)]
pub struct ByteWatcher {
    samples: u32,
    bytes: Vec<ByteStat>,
}

#[derive(Clone, Copy)]
struct ByteStat {
    last: u8,
    changes: u32,
    min: u8,
    max: u8,
    /// Sum of |delta| between consecutive samples, for an activity measure
    /// that distinguishes a noisy sensor from a slow monotonic drift.
    total_abs_delta: u64,
}

impl ByteStat {
    fn seed(v: u8) -> Self {
        Self { last: v, changes: 0, min: v, max: v, total_abs_delta: 0 }
    }

    fn update(&mut self, v: u8) {
        if v != self.last {
            self.changes += 1;
            self.total_abs_delta += (v as i16 - self.last as i16).unsigned_abs() as u64;
        }
        self.last = v;
        self.min = self.min.min(v);
        self.max = self.max.max(v);
    }
}

/// Serializable per-byte summary handed to the frontend.
#[derive(serde::Serialize)]
pub struct ByteStatOut {
    pub offset: usize,
    pub last: u8,
    pub changes: u32,
    pub min: u8,
    pub max: u8,
    /// Fraction of transitions in which this byte changed (0.0–1.0).
    pub volatility: f64,
    /// Mean absolute change per transition — high for noisy/fast signals.
    pub mean_delta: f64,
}

#[derive(serde::Serialize)]
pub struct WatchSnapshot {
    pub samples: u32,
    pub bytes: Vec<ByteStatOut>,
}

impl ByteWatcher {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed one freshly-read payload. Handles length changes by growing the
    /// tracked set; bytes that appear later simply have fewer samples behind
    /// their stats, which is fine for a relative ranking.
    pub fn feed(&mut self, data: &[u8]) {
        if data.len() > self.bytes.len() {
            // extend with seeds from the current data
            for &v in &data[self.bytes.len()..] {
                self.bytes.push(ByteStat::seed(v));
            }
        }
        if self.samples == 0 {
            // first sample: seed every position, count no changes
            for (i, &v) in data.iter().enumerate() {
                self.bytes[i] = ByteStat::seed(v);
            }
        } else {
            for (i, &v) in data.iter().enumerate() {
                self.bytes[i].update(v);
            }
        }
        self.samples += 1;
    }

    /// Snapshot the current statistics. `volatility` and `mean_delta` are
    /// computed against the number of transitions (samples − 1).
    pub fn snapshot(&self) -> WatchSnapshot {
        let transitions = self.samples.saturating_sub(1).max(1) as f64;
        let bytes = self
            .bytes
            .iter()
            .enumerate()
            .map(|(offset, s)| ByteStatOut {
                offset,
                last: s.last,
                changes: s.changes,
                min: s.min,
                max: s.max,
                volatility: s.changes as f64 / transitions,
                mean_delta: if s.changes > 0 {
                    s.total_abs_delta as f64 / s.changes as f64
                } else {
                    0.0
                },
            })
            .collect();
        WatchSnapshot { samples: self.samples, bytes }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_bytes_have_zero_volatility() {
        let mut w = ByteWatcher::new();
        for _ in 0..5 {
            w.feed(&[0x10, 0x20]);
        }
        let snap = w.snapshot();
        assert_eq!(snap.samples, 5);
        assert_eq!(snap.bytes[0].volatility, 0.0);
        assert_eq!(snap.bytes[0].changes, 0);
    }

    #[test]
    fn changing_byte_tracks_range_and_volatility() {
        let mut w = ByteWatcher::new();
        w.feed(&[0x00]);
        w.feed(&[0x05]);
        w.feed(&[0x0A]);
        w.feed(&[0x0A]); // no change this transition
        let snap = w.snapshot();
        // 4 samples => 3 transitions; changed on 2 of them
        assert_eq!(snap.bytes[0].changes, 2);
        assert!((snap.bytes[0].volatility - 2.0 / 3.0).abs() < 1e-9);
        assert_eq!(snap.bytes[0].min, 0x00);
        assert_eq!(snap.bytes[0].max, 0x0A);
        assert!((snap.bytes[0].mean_delta - 5.0).abs() < 1e-9); // deltas 5 and 5
    }

    #[test]
    fn growing_payload_extends_tracking() {
        let mut w = ByteWatcher::new();
        w.feed(&[0x01]);
        w.feed(&[0x01, 0x02]); // second byte appears later
        let snap = w.snapshot();
        assert_eq!(snap.bytes.len(), 2);
    }
}
