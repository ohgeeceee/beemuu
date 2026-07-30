"use strict";

// v0.14.2 slice 2 — Live Data panel UX polish.
//
// Pure helper module extracted from main.js so the polling-rate
// selector, peak-tracking render, snapshot-CSV serialiser, and
// NRC-error parsing can be unit-tested under `node --test` without
// a webview. The actual DOM wiring + Gauge rendering stays in
// main.js; this module owns the policy:
//
//   1. Polling rate — translate the user-visible `<select>` value
//      (100 / 250 / 500 / 1000 ms) into a setInterval delay.
//   2. Peak tracking — given a `LiveValue` array, return the highest
//      numeric value seen per `id` since `resetPeaks()`. Text/enum
//      points are skipped (they're discrete, not numeric).
//   3. Snapshot CSV — render a single-row CSV of the latest values
//      with a units row, matching the v0.11.0 export format.
//   4. NRC error parsing — given the error string the
//      `read_live_data` Tauri command throws, extract the (sid, nrc)
//      pair so the panel can dim the affected gauge and offer a
//      one-click removal of the offending PID.
//
// No new Tauri command, no new crate, no `transport/**` touch.
// Patterned after live_gauges.js (v0.14.0) — controller-mirror-tests
// split, same dual-export pattern.

const POLL_RATE_MS_OPTIONS = Object.freeze([100, 250, 500, 1000]);
const DEFAULT_POLL_RATE_MS = 250;
const SNAPSHOT_HEADER_VERSION = "1";

// ---------------------------------------------------------------------------
// Polling rate
// ---------------------------------------------------------------------------

// Resolve a `select` value (or already-parseable number) to a valid
// delay, falling back to the default when the value is unknown or
// out-of-range. The setInterval delay is the sole thing this controls.
function resolvePollRateMs(value) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_POLL_RATE_MS;
  if (!POLL_RATE_MS_OPTIONS.includes(parsed)) return DEFAULT_POLL_RATE_MS;
  return parsed;
}

// ---------------------------------------------------------------------------
// Peak tracking
// ---------------------------------------------------------------------------

// Pure peak-tracking reducer. Tracks the highest numeric value seen
// per `id` since `start()` (or `resetPeaks()`). Returns a fresh
// object each call so the consumer can render it without state
// sharing. Text/enum points (those with `text` set) are skipped —
// you can't meaningfully peak a discrete label.
//
// Args:
//   state  — current peaks map. May be empty / null on first call.
//   values — iterable of `LiveValue` shaped like the backend response.
//
// Returns a new peaks map. The caller decides when to reset.
function applyValuesToPeaks(state, values) {
  if (!Array.isArray(values)) return state || {};
  const next = { ...(state || {}) };
  for (const v of values) {
    if (!v || typeof v !== "object") continue;
    if (v.text !== undefined && v.text !== null) continue;
    const current = next[v.id];
    const numeric = Number(v.value);
    if (!Number.isFinite(numeric)) continue;
    if (current === undefined || numeric > current) {
      next[v.id] = numeric;
    }
  }
  return next;
}

// Format a peak value for the small "peak: 95" label under each
// gauge. Floats: 1 decimal place. Integers: no decimals. Mirrors
// the formatter live_gauges.js uses for its peak labels.
function formatPeakForLabel(value, unit) {
  if (!Number.isFinite(value)) return "—";
  const integerUnits = new Set(["rpm", "km/h", "%"]);
  if (integerUnits.has(unit)) return Math.round(value).toString();
  return value.toFixed(1);
}

// ---------------------------------------------------------------------------
// Snapshot CSV
// ---------------------------------------------------------------------------

// Build a CSV snapshot of the current live values. Shape mirrors the
// v0.11.0 logging export:
//
//   row 1: metadata header line (comment)
//   row 2: column headers (id, label, unit, value, text)
//   row 3: one data row per live value
//
// The unit row above the data row is what gives the v0.11.0 CSV its
// human-readable Excel shape. We keep the same choice here so the
// snapshot is loadable by `src/js/csv_log_export.js`.
function buildSnapshotCsv(values, profileLabel) {
  const safe = Array.isArray(values) ? values : [];
  const meta = `# beemuu live snapshot v${SNAPSHOT_HEADER_VERSION} profile=${JSON.stringify(profileLabel || "")} timestamp=${new Date().toISOString()}`;
  const header = ["id", "label", "unit", "value", "text"];
  const rows = [meta, header.join(",")];
  for (const v of safe) {
    if (!v || typeof v !== "object") continue;
    const text = v.text !== undefined && v.text !== null ? JSON.stringify(String(v.text)) : "";
    const value = Number.isFinite(Number(v.value)) ? Number(v.value).toFixed(2) : "";
    rows.push(
      [
        JSON.stringify(v.id || ""),
        JSON.stringify(v.label || ""),
        JSON.stringify(v.unit || ""),
        value,
        text,
      ].join(",")
    );
  }
  return rows.join("\n") + "\n";
}

// Filename for the snapshot CSV. Matches the project's
// `beeemuu-<kind>-<stamp>.csv` convention used by `beeemuu-log-…`,
// `beeemuu-dtcs-…`, etc. (see main.js around line 2204).
function snapshotCsvFilename(stamp) {
  const now = stamp instanceof Date ? stamp : new Date();
  const iso = now.toISOString().replace(/[:.]/g, "-");
  return `beeemuu-live-snapshot-${iso}.csv`;
}

// ---------------------------------------------------------------------------
// NRC error parsing
// ---------------------------------------------------------------------------

// Parse the `read_live_data` Tauri error string into a `{ sid, nrc }`
// pair. The error format is the one produced by
// `src-tauri/src/protocol/mod.rs::service`:
//
//   "ECU rejected service 22: conditionsNotCorrect (NRC 22)"
//
// Returns `null` when the error is not a recognized NRC pattern —
// the caller then falls back to the existing `log()` behavior.
function parseNrcError(message) {
  if (typeof message !== "string" || message.length === 0) return null;
  // Match the "(NRC XX)" tail case-insensitively.
  const nrcMatch = message.match(/\(NRC\s+([0-9A-Fa-f]{2})\)/);
  if (!nrcMatch) return null;
  const nrc = Number.parseInt(nrcMatch[1], 16);
  // Match the leading "service XX" token so we can surface the SID.
  const sidMatch = message.match(/service\s+([0-9A-Fa-f]{2})/i);
  const sid = sidMatch ? Number.parseInt(sidMatch[1], 16) : null;
  if (!Number.isFinite(nrc)) return null;
  return { sid, nrc, raw: message };
}

// The set of NRCs that mean "this PID is not supported on this ECU"
// — the canonical case where the user wants to drop the offending
// PID from the profile. Anything else (e.g. NRC 31 / conditionsNotCorrect)
// is transient and should not trigger the "remove" UI.
const UNSUPPORTED_NRCS = Object.freeze(new Set([
  0x11, // serviceNotSupported
  0x12, // subFunctionNotSupported
  0x31, // requestOutOfRange — requests a DID that doesn't exist on this ECU
  0x14, // responseTooLong (sometimes reported for unsupported PIDs)
]));

function isUnsupportedNrc(parsed) {
  return parsed && UNSUPPORTED_NRCS.has(parsed.nrc);
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

const api = {
  POLL_RATE_MS_OPTIONS,
  DEFAULT_POLL_RATE_MS,
  resolvePollRateMs,
  applyValuesToPeaks,
  formatPeakForLabel,
  buildSnapshotCsv,
  snapshotCsvFilename,
  parseNrcError,
  isUnsupportedNrc,
  UNSUPPORTED_NRCS,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof window !== "undefined") {
  window.beeemuuLiveDataPanel = api;
}
