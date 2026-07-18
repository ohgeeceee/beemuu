//! Tester Present keep-alive worker (issue #87, CLAUDE.md timing invariant).
//!
//! Real ECUs drop a non-default diagnostic session (extended, programming,
//! SecurityAccess-unlocked) when their S3server timer expires — typically
//! 5000 ms of bus silence (ISO 14229-2). While the app holds a non-default
//! session open, this worker sends Tester Present on a fixed cadence so
//! reading/thinking time in the UI doesn't kill the session.
//!
//! Frame choice — `3E 00`, deliberately not `3E 80`:
//! `3E 80` (suppress-positive-response) is the classic fire-and-forget
//! keep-alive, but the `Transport` trait is strictly request/response — it
//! has no send-without-reply path. On a real K+DCAN cable a `3E 80` frame
//! gets no `7E`, so `request()` would burn the full 1 s read timeout
//! *while holding the transport lock* on every tick — exactly the stall
//! this worker must never cause. `3E 00` answers immediately with `7E`,
//! which doubles as a liveness check: an error means the ECU or bus is
//! gone and the worker stops itself. If a fire-and-forget send API is
//! ever added to the transport layer, switching to `3E 80` is a one-line
//! change here.
//!
//! Lock discipline: the worker is a task on `tauri::async_runtime`. It
//! never blocks waiting for the transport mutex — each tick uses
//! `try_lock`. A busy lock means another command is mid-transaction, and
//! that traffic itself resets the ECU's S3 timer, so skipping the tick is
//! safe. This is what makes the keep-alive un-stallable even though long
//! operations (e.g. `scan_modules`) hold the single transport mutex for
//! their whole duration: the keep-alive is only *needed* when the bus is
//! idle, and an idle bus means an uncontended lock.

use crate::transport::Transport;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, TryLockError};
use std::time::Duration;

/// Keep-alive cadence. ISO 14229 allows 2000–4000 ms between Tester Present
/// frames against a ~5000 ms S3server; 3000 ms sits mid-window.
pub(crate) const INTERVAL: Duration = Duration::from_millis(3000);

/// UDS Tester Present (0x3E), sub-function 0x00 (positive response wanted —
/// see module docs for why suppress-positive-response 0x80 is not used).
pub(crate) const FRAME: [u8; 2] = [0x3E, 0x00];

/// Handle to a running worker. `stop` terminates it.
pub(crate) struct KeepAlive {
    stop: Arc<AtomicBool>,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl KeepAlive {
    pub(crate) fn stop(self) {
        self.stop.store(true, Ordering::SeqCst);
        // The task's only yield point is the sleep, so abort can never land
        // mid-frame with the transport lock held.
        self.task.abort();
    }
}

/// Spawn a worker that sends Tester Present to `target` every `interval`
/// until it is stopped, the frame errors, or the transport slot empties
/// (`NotConnected`). `transport` is the app's shared transport slot; each
/// tick holds the lock only for the duration of one request/response.
pub(crate) fn spawn<T>(transport: Arc<Mutex<T>>, target: u8, interval: Duration) -> KeepAlive
where
    T: Transport + 'static,
{
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = Arc::clone(&stop);
    let task = tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(interval).await;
            if worker_stop.load(Ordering::SeqCst) {
                break;
            }
            let alive = match transport.try_lock() {
                Ok(mut t) => t.request(target, &FRAME).is_ok(),
                // Busy lock ⇒ another command is transacting right now, and
                // that traffic resets S3 by itself. Skip this tick.
                Err(TryLockError::WouldBlock) => continue,
                Err(TryLockError::Poisoned(_)) => false,
            };
            if !alive {
                // Transport error or disconnected: nothing left to keep alive.
                break;
            }
        }
    });
    KeepAlive { stop, task }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::record::{RecordingTransport, SharedLog};
    use crate::transport::sim::SimTransport;

    const TICK: Duration = Duration::from_millis(40);

    fn count_frames(log: &SharedLog) -> Vec<u128> {
        log.lock()
            .unwrap()
            .snapshot()
            .into_iter()
            .filter(|e| e.target == 0x12 && e.request == "3E 00")
            .map(|e| e.t_ms)
            .collect()
    }

    /// Cadence: while the worker runs, Tester Present frames appear at the
    /// configured interval; after `stop`, no further frames are sent.
    #[test]
    fn sends_tester_present_on_cadence_and_stops_cleanly() {
        let log: SharedLog = Default::default();
        let rec = RecordingTransport::new(Box::new(SimTransport::new()), Arc::clone(&log));
        let transport = Arc::new(Mutex::new(rec));

        let ka = spawn(Arc::clone(&transport), 0x12, TICK);
        std::thread::sleep(Duration::from_millis(350)); // ~8 ticks
        ka.stop();

        let times = count_frames(&log);
        assert!(
            times.len() >= 5,
            "expected at least 5 keep-alive frames in 350 ms at a 40 ms tick, got {}",
            times.len()
        );
        // Inter-frame gaps must track the tick; 4× headroom for CI jitter.
        for pair in times.windows(2) {
            let gap = pair[1] - pair[0];
            assert!(
                gap > 0 && gap <= 4 * TICK.as_millis(),
                "keep-alive gap {gap} ms outside expected cadence"
            );
        }

        // Stopped worker must go silent (3× tick headroom for a straggler).
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!(
            times.len(),
            count_frames(&log).len(),
            "keep-alive frame sent after stop"
        );
    }

    /// Survival: with the worker active, a non-default session survives a
    /// >30 s idle period against the S3-enforcing sim. Time is compressed
    /// 25×: sim S3 = 200 ms stands in for 5 s, so 1200 ms of wall time
    /// stands in for 30 s.
    #[test]
    fn non_default_session_survives_compressed_idle_with_keepalive() {
        let mut sim = SimTransport::new();
        sim.set_s3_timeout(Duration::from_millis(200));
        let transport = Arc::new(Mutex::new(sim));
        transport.lock().unwrap().request(0x12, &[0x10, 0x03]).unwrap(); // extended

        let ka = spawn(Arc::clone(&transport), 0x12, TICK);
        std::thread::sleep(Duration::from_millis(1200)); // ">30 s" compressed
        ka.stop();

        assert_eq!(
            transport.lock().unwrap().current_session(),
            0x03,
            "session must survive a >30 s (compressed) idle period with keep-alive active"
        );
    }

    /// Drop: once the worker stops, no more Tester Present frames flow, the
    /// sim's S3 timeout fires, and the session reverts to default.
    #[test]
    fn session_drops_after_keepalive_stops() {
        let mut sim = SimTransport::new();
        sim.set_s3_timeout(Duration::from_millis(150));
        let transport = Arc::new(Mutex::new(sim));
        transport.lock().unwrap().request(0x12, &[0x10, 0x03]).unwrap();

        let ka = spawn(Arc::clone(&transport), 0x12, TICK);
        std::thread::sleep(Duration::from_millis(120)); // a couple of ticks
        ka.stop();
        std::thread::sleep(Duration::from_millis(250)); // S3 expires (150 ms)

        // Any request lets the sim notice the timeout.
        transport.lock().unwrap().request(0x12, &[0x1A, 0x80]).unwrap();
        assert_eq!(
            transport.lock().unwrap().current_session(),
            0x01,
            "without keep-alive the S3 timeout must revert the session to default"
        );
    }

    /// Transport error: the worker stops itself instead of spamming a dead
    /// bus — exactly one frame is attempted against an absent ECU.
    #[test]
    fn worker_stops_itself_on_transport_error() {
        let log: SharedLog = Default::default();
        let rec = RecordingTransport::new(Box::new(SimTransport::new()), Arc::clone(&log));
        let transport = Arc::new(Mutex::new(rec));

        let ka = spawn(Arc::clone(&transport), 0x99, TICK); // no ECU at 0x99
        std::thread::sleep(Duration::from_millis(200)); // ~5 ticks if it kept going
        ka.stop();

        let frames = log
            .lock()
            .unwrap()
            .snapshot()
            .into_iter()
            .filter(|e| e.request == "3E 00")
            .count();
        assert_eq!(frames, 1, "worker must stop after the first transport error");
    }
}
