/* v3 IIFE wrapper — see scripts/wrap_v3_iife.py. Every classic
 * tag shares one global lexical scope, so a bare top-level `const` in
 * one file is a redeclaration error in the next. */
(function () {
"use strict";

/* Service Provenance — v4.1.0 feature 1.
 *
 * A service history is a story told with dates and odometers. It does not have
 * to be forged to be wrong. A re-keyed odometer makes the mileage run backwards;
 * a stalled car gets "serviced" before the visit that is supposed to precede it;
 * an invoice gets entered twice; one line item costs ten times every other.
 * Each line looks plausible on its own and the story only collapses when the
 * arithmetic is done across the whole history.
 *
 * This module does that arithmetic, read-only. It walks the entries a garage
 * already holds and reports the places where the story stops adding up:
 * odometer reversals, back-dated visits, duplicate invoices, cost outliers,
 * implausible mileage gaps, and entries dated in the future. Every finding
 * names the entry indices involved and says in plain language what looks off,
 * so a person can go and check the paperwork rather than trust a number.
 *
 * The most important thing here is what it refuses to say. A history of two
 * entries is not "clean" — it is unjudgeable, and this module returns verdict
 * `insufficient` rather than a pass it has not earned. An unparseable date or a
 * missing odometer is a finding in its own right, never silently skipped, and a
 * history carrying one is never reported as consistent. And nothing here ever
 * calls a history real: the strongest claim the module can make is that it
 * found no inconsistency, which is a statement about arithmetic and not about
 * honesty.
 *
 * It is pure: no DOM, no Tauri, no transport, no clock. "Today" is injected as
 * an option so every verdict is reproducible.
 *
 * Dual export: `require()` under node --test, plain <script> in the webview.
 */

/* ------------------------------------------------------------------ *
 * Thresholds. Exported so a panel can explain a verdict with the same
 * numbers the engine acted on, and so the tests pin the real values.
 * ------------------------------------------------------------------ */
const MIN_ENTRIES = 3;        // below this a history cannot be judged at all
const MAX_GAP_KM = 40000;     // a longer unbroken mileage gap is implausible
const MIN_COST_ENTRIES = 5;   // below this many priced entries, costs stay unjudged
const MAD_K = 3.5;            // modified z-score beyond this is a cost outlier
const MAD_SCALE = 0.6745;     // 0.75 quantile of the standard normal
const DAY_MS = 86400000;
const MAX_FUTURE_DAYS = 1;    // an entry dated past this is future-dated
const PENALTY = { high: 30, medium: 10, low: 5, info: 0 };

/* ------------------------------------------------------------------ *
 * Field plumbing. An entry is { date, odometer_km, cost, items, ... }.
 * Anything unrepresentable becomes null and is reported later as an
 * unparseable finding — never clamped, never guessed at.
 * ------------------------------------------------------------------ */

/* yyyy-mm-dd (or an ISO string starting with one) to UTC midnight ms. The
 * calendar is validated by round-tripping, so 2026-02-30 is rejected rather
 * than silently rolling over into March. */
function parseDate(value) {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return ms;
}

/* A usable odometer is a finite number and nothing else. Numeric strings,
 * nulls and NaN are treated as missing, which is reported, not assumed. */
function parseOdometer(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCost(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* A reference "now": either an epoch-ms number or an ISO day. Absent or
 * unparseable, it is null and the future check declines to run. */
function parseNow(now) {
  if (typeof now === "number" && Number.isFinite(now)) return now;
  return parseDate(now);
}

/* Canonical form of an entry's items so two invoices can be compared: an
 * array is sorted and joined, a scalar is stringified, absent is empty. */
function canonItems(items) {
  if (items == null) return "";
  if (Array.isArray(items)) return items.map((x) => String(x).trim()).sort().join("|");
  return String(items).trim();
}

/* Non-object entries (null, numbers, strings) become a blank row so they are
 * counted and reported rather than crashing the walk. */
function parseRows(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return list.map((raw, index) => {
    const e = raw && typeof raw === "object" ? raw : {};
    return {
      index,
      date: typeof e.date === "string" ? e.date : null,
      dateMs: parseDate(e.date),
      odometer: parseOdometer(e.odometer_km),
      cost: parseCost(e.cost),
      items: e.items == null ? null : e.items,
    };
  });
}

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Checks. Each returns an array of findings — { kind, severity,
 * indices, detail } — and nothing else, so a test can pin one check
 * without going through the scorer.
 * ------------------------------------------------------------------ */

/* Dates and odometers that could not be read are their own kind of problem:
 * an unreadable line is a hole in the evidence, not a line that passed. */
function unparseable(entries) {
  const out = [];
  for (const row of parseRows(entries)) {
    const noDate = row.dateMs === null;
    const noOdo = row.odometer === null;
    if (!noDate && !noOdo) continue;
    const what = noDate && noOdo
      ? "neither a usable date nor a usable odometer reading"
      : noDate
        ? "no usable date"
        : "no usable odometer reading";
    out.push({
      kind: "unparseable",
      severity: "high",
      indices: [row.index],
      detail: `entry ${row.index} has ${what}`,
    });
  }
  return out;
}

/* An odometer that falls between two consecutive readings is the classic
 * re-key signature. Equal readings are not a decrease — a same-day return
 * shows the same mileage — so only a strict drop is flagged. */
function monotonicOdometer(entries) {
  const out = [];
  let last = null;
  for (const row of parseRows(entries)) {
    if (row.odometer === null) continue;
    if (last && row.odometer < last.odometer) {
      out.push({
        kind: "odometer_reversal",
        severity: "high",
        indices: [last.index, row.index],
        detail: `odometer falls from ${last.odometer} km at entry ${last.index} to ${row.odometer} km at entry ${row.index}`,
      });
    }
    last = row;
  }
  return out;
}

/* An entry dated before a preceding one means the history is not in time
 * order; a visit cannot have happened before the visit it follows. Equal
 * dates are fine (two lines from one day). */
function chronological(entries) {
  const out = [];
  let max = null;
  for (const row of parseRows(entries)) {
    if (row.dateMs === null) continue;
    if (max && row.dateMs < max.dateMs) {
      out.push({
        kind: "back_dated",
        severity: "high",
        indices: [max.index, row.index],
        detail: `entry ${row.index} dated ${isoDay(row.dateMs)} is earlier than entry ${max.index} dated ${isoDay(max.dateMs)}`,
      });
    }
    if (!max || row.dateMs > max.dateMs) max = row;
  }
  return out;
}

/* The same visit entered more than once: identical date, odometer and items.
 * Identical date and odometer with different items is a real second line item
 * on the same day and is not flagged. */
function duplicateEntries(entries) {
  const groups = new Map();
  for (const row of parseRows(entries)) {
    if (row.dateMs === null || row.odometer === null) continue;
    const key = `${row.dateMs}|${row.odometer}|${canonItems(row.items)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const out = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    out.push({
      kind: "duplicate",
      severity: "high",
      indices: rows.map((r) => r.index),
      detail: `${rows.length} entries repeat the ${isoDay(rows[0].dateMs)} / ${rows[0].odometer} km reading with the same items`,
    });
  }
  return out;
}

/* Cost outliers use a robust median-absolute-deviation rule, and only once
 * there are enough priced entries for a spread to mean anything. Below the
 * floor the check refuses: costs are unjudged, which is not the same as clean.
 * When every cost is (near) identical the MAD is zero and the modified z-score
 * is undefined — the rule then declines to invent an outlier. */
function costOutliers(entries) {
  const priced = [];
  for (const row of parseRows(entries)) {
    if (row.cost !== null) priced.push(row);
  }
  if (priced.length < MIN_COST_ENTRIES) {
    return [{
      kind: "cost_unjudged",
      severity: "medium",
      indices: priced.map((r) => r.index),
      detail: `only ${priced.length} priced entr${priced.length === 1 ? "y" : "ies"} — at least ${MIN_COST_ENTRIES} are needed to judge costs`,
    }];
  }
  const costs = priced.map((r) => r.cost).sort((a, b) => a - b);
  const med = median(costs);
  const mad = median(costs.map((c) => Math.abs(c - med)).sort((a, b) => a - b));
  if (mad === 0) return [];
  const out = [];
  for (const row of priced) {
    const z = (MAD_SCALE * (row.cost - med)) / mad;
    if (Math.abs(z) > MAD_K) {
      out.push({
        kind: "cost_outlier",
        severity: "high",
        indices: [row.index],
        detail: `cost of ${row.cost} at entry ${row.index} sits far from the ${med} median of ${priced.length} priced entries`,
      });
    }
  }
  return out;
}

/* A mileage jump larger than the plausibility limit between two readings means
 * work went unrecorded or the odometer was tampered with. Only positive jumps
 * qualify; a drop is the reversal check's job. */
function mileageGaps(entries) {
  const out = [];
  let prev = null;
  for (const row of parseRows(entries)) {
    if (row.odometer === null) continue;
    if (prev && row.odometer - prev.odometer > MAX_GAP_KM) {
      out.push({
        kind: "gap",
        severity: "high",
        indices: [prev.index, row.index],
        detail: `${row.odometer - prev.odometer} km between entry ${prev.index} and entry ${row.index} exceeds the ${MAX_GAP_KM} km limit`,
      });
    }
    prev = row;
  }
  return out;
}

/* An entry dated ahead of the reference date is not a service that happened;
 * it is a keystroke from the future, and it invalidates the run it sits in. */
function implausibleIntervals(entries, now) {
  const nowMs = parseNow(now);
  if (nowMs === null) return [];
  const limit = nowMs + MAX_FUTURE_DAYS * DAY_MS;
  const out = [];
  for (const row of parseRows(entries)) {
    if (row.dateMs === null || row.dateMs <= limit) continue;
    const days = Math.round((row.dateMs - nowMs) / DAY_MS);
    out.push({
      kind: "implausible_interval",
      severity: "high",
      indices: [row.index],
      detail: `entry ${row.index} dated ${isoDay(row.dateMs)} is ${days} day${days === 1 ? "" : "s"} ahead of the reference date`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Scoring and verdict
 * ------------------------------------------------------------------ */
function median(sorted) {
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function spanDays(rows) {
  const days = rows.filter((r) => r.dateMs !== null).map((r) => r.dateMs);
  if (days.length < 2) return 0;
  return Math.round((Math.max(...days) - Math.min(...days)) / DAY_MS);
}

function spanKm(rows) {
  const km = rows.filter((r) => r.odometer !== null).map((r) => r.odometer);
  if (km.length < 2) return 0;
  return Math.max(...km) - Math.min(...km);
}

function headlineFor(verdict, findings) {
  if (verdict === "suspect") {
    const k = findings.filter((f) => f.severity === "high").length;
    return `${k} inconsistenc${k === 1 ? "y" : "ies"} detected in the service history`;
  }
  if (findings.some((f) => f.kind === "cost_unjudged")) {
    return `no inconsistency detected; costs could not be assessed from fewer than ${MIN_COST_ENTRIES} priced entries`;
  }
  return "no inconsistency detected in the service history";
}

/* ------------------------------------------------------------------ *
 * Public entry point
 * ------------------------------------------------------------------ */
function analyze(entries, opts = {}) {
  const rows = parseRows(entries);
  const n = rows.length;
  const summary = {
    n_entries: n,
    span_days: spanDays(rows),
    span_km: spanKm(rows),
    headline: null,
  };

  if (n < MIN_ENTRIES) {
    summary.headline = `service history has ${n} entr${n === 1 ? "y" : "ies"} — at least ${MIN_ENTRIES} are needed to judge it`;
    return {
      verdict: "insufficient",
      score: null,
      confidence: 0,
      findings: [{
        kind: "insufficient",
        severity: "info",
        indices: rows.map((r) => r.index),
        detail: `only ${n} entr${n === 1 ? "y" : "ies"} — at least ${MIN_ENTRIES} entries are needed before a history can be judged`,
      }],
      summary,
    };
  }

  const findings = [].concat(
    unparseable(entries),
    monotonicOdometer(entries),
    chronological(entries),
    duplicateEntries(entries),
    costOutliers(entries),
    mileageGaps(entries),
    implausibleIntervals(entries, opts.now),
  );

  const verdict = findings.some((f) => f.severity === "high") ? "suspect" : "consistent";

  let score = 100;
  for (const f of findings) score -= PENALTY[f.severity] || 0;
  score = Math.max(0, Math.min(100, score));

  // Confidence rises with how much history there is and falls with how much of
  // it could not be read: an unreadable entry is one fewer entry to reason on.
  const unreadable = new Set(
    findings.filter((f) => f.kind === "unparseable").flatMap((f) => f.indices),
  );
  const coverage = Math.min(1, n / 8);
  const confidence = Number((coverage * (1 - Math.min(0.5, unreadable.size / n))).toFixed(3));

  summary.headline = headlineFor(verdict, findings);
  return { verdict, score, confidence, findings, summary };
}

const api = {
  MIN_ENTRIES,
  MAX_GAP_KM,
  MIN_COST_ENTRIES,
  MAD_K,
  MAX_FUTURE_DAYS,
  parseDate,
  parseOdometer,
  parseCost,
  parseNow,
  canonItems,
  parseRows,
  unparseable,
  monotonicOdometer,
  chronological,
  duplicateEntries,
  costOutliers,
  mileageGaps,
  implausibleIntervals,
  spanDays,
  spanKm,
  analyze,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuServiceProvenance = api;
})();
