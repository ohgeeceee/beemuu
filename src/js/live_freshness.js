"use strict";

// Update 2 (connection health and recovery), second slice — profile gauge
// grid freshness.
//
// The DID-backed Live Gauges panel already tracks the age of each channel
// and says Stale / Waiting / Stopped instead of presenting a cached number
// as current (docs/connection-recovery.md, first slice). The profile gauge
// grid on the Live Data tab (main.js::pollOnce) had no equivalent: a PID
// that stopped answering mid-sweep kept showing its last value forever, and
// a systemic failure left every gauge looking live after polling stopped.
//
// This module is the pure policy half: a tracker records, per parameter id,
// when the last successful reading arrived and when the last explicit
// parameter error was seen, plus whether the sweep loop is running. The DOM
// rendering (cell class + freshness line) stays in main.js; this module owns
// the status decision so it can be unit-tested under `node --test`.
//
// Semantics mirror the Live Gauges source:
//   - an explicit parameter error marks the channel stale immediately;
//   - otherwise a channel becomes stale once its age passes the threshold;
//   - the threshold is a presentation choice, not a transport timeout.
//
// Dual export: CommonJS for tests, window.beeemuuLiveFreshness for the app.
// Wrapped in the root/factory IIFE (the wiring_detect.js pattern) because
// every classic <script> shares one global lexical scope — a bare top-level
// `const` here would collide with the other helper modules.

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.beeemuuLiveFreshness = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

const DEFAULT_STALE_MS = 5000;

const STATUS = Object.freeze({
  LIVE: "live",
  STALE: "stale",
  WAITING: "waiting",
  STOPPED: "stopped",
});

// Create a tracker. `now` is injectable so tests are deterministic.
// `staleMs` is the presentation threshold; zero or negative disables
// age-based staleness (only explicit errors and stop() mark a channel).
function createTracker(opts) {
  const options = opts || {};
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const staleMs = Number.isFinite(options.staleMs)
    ? options.staleMs
    : DEFAULT_STALE_MS;

  // id -> { lastOk: number|null, lastError: number|null }
  const channels = new Map();
  let stopped = false;

  function entry(id) {
    let e = channels.get(id);
    if (!e) {
      e = { lastOk: null, lastError: null };
      channels.set(id, e);
    }
    return e;
  }

  // A successful reading. Clears the stopped flag: a value arriving means
  // the sweep loop is alive again.
  function noteValue(id) {
    entry(id).lastOk = now();
    stopped = false;
  }

  // An explicit per-parameter error (the sweep ran; this PID rejected the
  // read). Records the error timestamp; per the Live Gauges semantics an
  // explicit error marks the channel stale immediately.
  function noteError(id) {
    entry(id).lastError = now();
  }

  // The sweep loop stopped (user toggle, systemic failure, disconnect).
  // Everything reports "stopped" until the next successful value.
  function stop() {
    stopped = true;
  }

  // Profile or connection changed: nothing previously learned applies.
  function reset() {
    channels.clear();
    stopped = false;
  }

  // The status decision for one channel, in priority order:
  //   stopped  — the loop is not running; nothing is current
  //   stale    — an explicit error is newer than the last value, or the
  //              last value is older than the threshold
  //   waiting  — the loop runs but this channel has never answered
  //   live     — a fresh value is on screen
  function status(id) {
    if (stopped) return STATUS.STOPPED;
    const e = channels.get(id);
    if (!e) return STATUS.WAITING;
    if (e.lastError !== null && (e.lastOk === null || e.lastError >= e.lastOk)) {
      return STATUS.STALE;
    }
    if (e.lastOk === null) return STATUS.WAITING;
    if (staleMs > 0 && now() - e.lastOk > staleMs) return STATUS.STALE;
    return STATUS.LIVE;
  }

  // Short human-readable line for the gauge cell. Live renders empty so a
  // healthy grid has no extra ink; the caller decides where to show it.
  function label(id) {
    const st = status(id);
    switch (st) {
      case STATUS.STOPPED:
        return { status: st, text: "polling stopped" };
      case STATUS.STALE: {
        const e = channels.get(id);
        if (e && e.lastOk !== null) {
          const ageS = Math.max(0, Math.round((now() - e.lastOk) / 1000));
          return { status: st, text: "stale — last read " + ageMsText(ageS) };
        }
        return { status: st, text: "stale — read rejected" };
      }
      case STATUS.WAITING:
        return { status: st, text: "waiting for first read" };
      default:
        return { status: st, text: "" };
    }
  }

  function ageMsText(ageS) {
    return ageS + " s ago";
  }

  return { noteValue, noteError, stop, reset, status, label };
}

return { DEFAULT_STALE_MS, STATUS, createTracker };

});
