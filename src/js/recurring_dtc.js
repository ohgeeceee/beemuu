"use strict";

// Recurring-DTC callout (v0.12.0 "Fault Memory", slice 5).
//
// When the user reads faults and the local history already contains
// past occurrences of the same code, surface them in a banner under
// the DTC table. This is the **headline UI moment** of the cycle:
// the answer to "is this the same fault I cleared last week?".
//
// Pure data layer: `computeCallout(dtcs, summary, nowMs)` returns
// either `null` (no banner) or a list of `CalloutEntry` rows that
// the UI renders into `#fault-history-callout`. The shape is stable
// enough to test without a DOM. `main.js` is the caller.
//
// Why a separate module: same pattern as the other dtc-history-
// adjacent slices (`csv_log_export`, `walkthrough_bundle`,
// `svg_export`). Keeps the matching/grouping math Node-testable
// and out of `main.js`. The DOM rendering still lives in `main.js`.
//
// Dual export: CommonJS for `node --test`, browser via
// `window.beeemuuRecurringDtc` for the renderer.

/** Default lookback window in milliseconds — 14 days. */
const DEFAULT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} CalloutEntry
 * @property {string} code
 * @property {number} occurrences  - count of past occurrences (>=1)
 * @property {string} last_seen_iso
 * @property {string} last_seen_human  - relative-time string ("today", "yesterday", "3d ago")
 * @property {string} first_seen_iso
 * @property {string} first_seen_human
 * @property {boolean} same_address  - true if the past entry was on the same module address
 */

/**
 * Format a millisecond-relative time string. Mirrors the human-friendly
 * shape an owner expects: "just now" (< 1 min), "Nm ago" (< 60 min),
 * "Nh ago" (< 24 h), "today" (same UTC day), "yesterday" (one UTC day back),
 * "Nd ago" (< window), or the ISO date otherwise.
 *
 * @param {number} ts_ms  - the timestamp in milliseconds since epoch
 * @param {number} now_ms - the reference "now" in ms
 * @returns {string}
 */
function relativeTimeLabel(ts_ms, now_ms) {
  if (!Number.isFinite(ts_ms) || !Number.isFinite(now_ms)) return "—";
  const delta = now_ms - ts_ms;
  if (delta < 0) return "just now";
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (delta < min) return "just now";
  if (delta < hr) return Math.floor(delta / min) + "m ago";
  // Day-relative labels first — "today"/"yesterday" carry more
  // information than "Nh ago" (an 11-hour-old timestamp is more
  // usefully described as "yesterday" if it crossed midnight UTC).
  // Compare on UTC dates so DST doesn't shift boundaries.
  const tsDate = new Date(ts_ms);
  const nowDate = new Date(now_ms);
  const dayDelta = Math.floor((Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate()) - Date.UTC(tsDate.getUTCFullYear(), tsDate.getUTCMonth(), tsDate.getUTCDate())) / day);
  if (dayDelta === 0) return "today";
  if (dayDelta === 1) return "yesterday";
  if (dayDelta > 1 && dayDelta < 14) return dayDelta + "d ago";
  // Older — fall back to the YYYY-MM-DD slice of the ISO string.
  return ts_ms ? new Date(ts_ms).toISOString().slice(0, 10) : "—";
}

/**
 * Parse an ISO-8601 timestamp string into Unix milliseconds. Returns
 * `null` for unparseable input so the caller can conservatively skip.
 */
function isoToMs(iso) {
  if (typeof iso !== "string" || iso.length === 0) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Compute the recurring-DTC callout rows.
 *
 * @param {Array<{code: string, address?: number}>} currentDtcs
 *   The DTCs the user just read. Pass `address` when known so the
 *   callout can flag "same module" vs "different module on the same car".
 * @param {{entries: Array<{code: string, address: number, occurrences: number, last_seen_iso: string, first_seen_iso: string}>}|null|undefined} history
 *   The grouped history summary (from `query_dtc_history`). `null` /
 *   `undefined` mean the query failed or no history exists — both
 *   produce no banner.
 * @param {number} [nowMs=Date.now()] - Reference timestamp for relative labels.
 * @param {{windowMs?: number}} [opts] - Overrides (mainly for tests).
 * @returns {CalloutEntry[]|null} Sorted by most recent first. `null` when nothing to show.
 */
function computeCallout(currentDtcs, history, nowMs, opts) {
  if (!Array.isArray(currentDtcs) || currentDtcs.length === 0) return null;
  if (!history || !Array.isArray(history.entries) || history.entries.length === 0) return null;
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const windowMs = (opts && typeof opts.windowMs === "number") ? opts.windowMs : DEFAULT_WINDOW_MS;
  const cutoff = now - windowMs;

  const byCode = new Map();
  for (const dtc of currentDtcs) {
    if (!dtc || typeof dtc.code !== "string" || dtc.code.length === 0) continue;
    byCode.set(dtc.code, dtc);
  }
  if (byCode.size === 0) return null;

  const rows = [];
  for (const entry of history.entries) {
    if (!entry || !byCode.has(entry.code)) continue;
    const lastMs = isoToMs(entry.last_seen_iso);
    if (lastMs === null) continue;
    // The history is grouped by (code, address) — but for the
    // callout we want one row per code, summed across addresses.
    const key = entry.code;
    const existing = rows.find((r) => r.code === key);
    if (existing) {
      existing.occurrences += entry.occurrences;
      // Keep the most-recent last_seen across addresses.
      if (lastMs > isoToMs(existing.last_seen_iso)) {
        existing.last_seen_iso = entry.last_seen_iso;
      }
      if (isoToMs(entry.first_seen_iso) < isoToMs(existing.first_seen_iso)) {
        existing.first_seen_iso = entry.first_seen_iso;
      }
    } else {
      rows.push({
        code: entry.code,
        occurrences: entry.occurrences,
        last_seen_iso: entry.last_seen_iso,
        first_seen_iso: entry.first_seen_iso,
        same_address: currentDtcs.some((d) => d.code === entry.code && d.address === entry.address),
      });
    }
  }

  // Filter by lookback window — only surface DTCs that appeared
  // within the past 14 days. Older ones are still in the file but
  // aren't relevant to "is this the same one I cleared last week?".
  const fresh = rows.filter((r) => {
    const ms = isoToMs(r.last_seen_iso);
    return ms !== null && ms >= cutoff;
  });
  if (fresh.length === 0) return null;

  // Sort most-recent-first.
  fresh.sort((a, b) => (isoToMs(b.last_seen_iso) || 0) - (isoToMs(a.last_seen_iso) || 0));

  // Decorate with human labels.
  for (const r of fresh) {
    r.last_seen_human = relativeTimeLabel(isoToMs(r.last_seen_iso), now);
    r.first_seen_human = relativeTimeLabel(isoToMs(r.first_seen_iso), now);
  }
  return fresh;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeCallout, relativeTimeLabel, isoToMs, DEFAULT_WINDOW_MS };
}
if (typeof window !== "undefined") {
  window.beeemuuRecurringDtc = { computeCallout, relativeTimeLabel, isoToMs, DEFAULT_WINDOW_MS };
}
