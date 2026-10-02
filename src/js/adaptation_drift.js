"use strict";

/* Adaptation Drift Tracker — v3.0.0 feature 2.
 *
 * A DME keeps a running opinion about itself: long-term fuel trims, idle
 * learnings, throttle adaptations, injector pulse widths. Those values are the
 * earliest honest signal the engine gives — they start moving months before a
 * code is ever set. ISTA stores them per session; consumer apps store them per
 * session; nobody trends them across sessions, which is the only way to see a
 * value walking steadily toward a limit.
 *
 * This module does the trending. It is deliberately read-only and pure: it
 * takes a set of recorded adaptation observations and reports slope, baseline,
 * current value, and an alert when a series is heading somewhere bad. It never
 * writes to an ECU and never invents a reading.
 *
 * Honesty rules baked in, because a drift number that overstates itself causes
 * a needless teardown:
 *   - A series with fewer than MIN_SAMPLES points is reported as
 *     `insufficient_data`, not as "stable". Flat because you measured it twice
 *     is not the same claim as flat because it is flat.
 *   - `predictCrossing` is null unless the slope is statistically meaningful
 *     AND the series actually has history to project from. A "due in 3 days"
 *     built on two samples is worse than no date at all.
 *   - Severity comes from the *community* threshold for that parameter, not
 *     from a number invented here. An unknown parameter gets `watch` at most,
 *     because we do not know what "bad" means for it.
 *
 * Dual export: `require()` under node --test, plain <script> in the webview.
 */

/* Below this many observations a trend is not a trend. */
const MIN_SAMPLES = 3;

/* |Pearson r| needed before a slope is allowed to predict anything. At r=0.7
 * the fit is weak but real; below it the line is mostly noise and any
 * projected date would be fiction. */
const MIN_CORRELATION = 0.7;

/* A parameter whose absolute value is already past its limit is "act" now,
 * regardless of slope. */
const SEVERITIES = { ok: "ok", watch: "watch", act: "act" };

function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/* ------------------------------------------------------------------ *
 * Statistics
 * ------------------------------------------------------------------ */

/* Least-squares fit of value against time. Time is centered internally so the
 * arithmetic stays well-conditioned for epoch-millisecond timestamps, which
 * would otherwise square to ~1e24 and lose every digit of precision in the
 * slope. Returns null when there is nothing to fit.
 *
 * Points go through `normalizePoint`, so an ISO-string or Date timestamp works
 * exactly as well as epoch millis — callers hand over whatever the session
 * recorded without having to convert first. */
function linearFit(points) {
  const pts = (Array.isArray(points) ? points : []).map(normalizePoint).filter(Boolean);
  const n = pts.length;
  if (n < 2) return null;
  const t0 = pts[0].t;
  const xs = pts.map(p => p.t - t0);
  const ys = pts.map(p => p.value);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return null; // every sample at the same instant
  const slope = sxy / sxx;          // units per millisecond
  const intercept = meanY - slope * meanX;
  // Pearson r: how much of the movement the line actually explains.
  const r = syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
  return { slope, intercept, r, n, t0, meanX, meanY };
}

/* Least-squares line through a fit, evaluated at an absolute time. */
function predictAt(fit, t) {
  return fit.intercept + fit.slope * (t - fit.t0);
}

/* ------------------------------------------------------------------ *
 * Series analysis
 * ------------------------------------------------------------------ */

/* Normalize one observation to {t, value}, accepting a Date, an ISO string, or
 * epoch millis. Returns null for anything unparseable rather than guessing. */
function normalizePoint(p) {
  if (!p) return null;
  const t = p.t != null ? p.t : (p.date != null ? p.date : p.at);
  const value = p.value != null ? p.value : p.y;
  let ms = null;
  if (t instanceof Date) ms = t.getTime();
  else if (typeof t === "number") ms = t;
  else if (typeof t === "string") ms = Date.parse(t);
  if (ms == null || !Number.isFinite(ms) || !finite(value)) return null;
  return { t: ms, value };
}

/* How far outside its limit the current value sits, as a fraction. 1.0 means
 * exactly at the limit; >1 means past it. */
function limitRatio(value, threshold) {
  if (threshold == null || !finite(threshold) || threshold === 0) return null;
  return Math.abs(value / threshold);
}

/* Analyze one parameter's observation history.
 *
 * @param {Array}  observations  [{t, value}, ...] in any order
 * @param {Object} opts
 * @param {string} [opts.id]
 * @param {string} [opts.label]
 * @param {string} [opts.unit]
 * @param {number} [opts.threshold]     community-known limit, if any
 * @param {number} [opts.now]           epoch ms for the projection (injectable)
 * @returns {Object} drift report
 */
function analyzeSeries(observations, opts) {
  const o = opts || {};
  const id = o.id || "";
  const label = o.label || id || "parameter";
  const unit = o.unit || "";
  const points = (observations || []).map(normalizePoint).filter(Boolean)
    .sort((a, b) => a.t - b.t);

  const base = {
    id,
    label,
    unit,
    samples: points.length,
    threshold: finite(o.threshold) ? o.threshold : null,
  };

  if (points.length < MIN_SAMPLES) {
    return Object.assign(base, {
      status: "insufficient_data",
      current: points.length ? points[points.length - 1].value : null,
      slope_per_day: null,
      correlation: null,
      severity: SEVERITIES.ok,
      message: `${points.length} reading${points.length === 1 ? "" : "s"} — need ${MIN_SAMPLES} before a trend means anything.`,
    });
  }

  const fit = linearFit(points);
  if (!fit) {
    return Object.assign(base, {
      status: "insufficient_data",
      current: points[points.length - 1].value,
      slope_per_day: null,
      correlation: null,
      severity: SEVERITIES.ok,
      message: "All readings share one timestamp — no trend to measure.",
    });
  }

  const first = points[0].value;
  const current = points[points.length - 1].value;
  const slopePerDay = fit.slope * 86400000;
  const baseline = predictAt(fit, points[0].t);
  const drift = current - baseline;

  // Only project a crossing when the line explains enough of the movement and
  // there is real history behind it. Otherwise `null`, always.
  let predictCrossing = null;
  const meaningful = Math.abs(fit.r) >= MIN_CORRELATION && points.length >= MIN_SAMPLES;
  if (meaningful && finite(o.threshold) && o.threshold !== 0 && slopePerDay !== 0) {
    const t = o.now != null && Number.isFinite(o.now) ? o.now : points[points.length - 1].t;
    const targetT = (o.threshold - fit.intercept) / fit.slope + fit.t0;
    const days = (targetT - t) / 86400000;
    // A crossing in the past is not news — the severity already says the limit
    // is behind us — and a projection centuries out is not a useful date. In
    // both cases report the direction and let the severity carry the message.
    if (days > 0 && days < 3650) {
      predictCrossing = {
        at: new Date(targetT).toISOString(),
        days_from_now: Math.round(days),
      };
    }
  }

  const ratio = limitRatio(current, o.threshold);
  let severity = SEVERITIES.ok;
  if (ratio != null && ratio >= 1) severity = SEVERITIES.act;
  else if (ratio != null && ratio >= 0.9) severity = SEVERITIES.watch;
  else if (o.threshold == null && Math.abs(fit.r) >= MIN_CORRELATION && slopePerDay !== 0) {
    // A real trend in a parameter nobody has published a limit for. We do not
    // know what "bad" means here, so this can never escalate past `watch` — and
    // it is deliberately not raised when we DO have a threshold and the value
    // is comfortably inside it. A trim settling back down toward normal is
    // the ECU recovering, not a problem.
    severity = SEVERITIES.watch;
  }

  return Object.assign(base, {
    status: "ok",
    current,
    first,
    baseline,
    drift,
    slope_per_day: slopePerDay,
    correlation: fit.r,
    limit_ratio: ratio,
    predict_crossing: predictCrossing,
    severity,
    message: messageFor({ label, unit, slopePerDay, current, ratio, severity, predictCrossing }),
  });
}

function messageFor({ label, unit, slopePerDay, current, ratio, severity, predictCrossing }) {
  const u = unit ? ` ${unit}` : "";
  if (severity === SEVERITIES.act) {
    return `${label} is at ${round(current)}${u}, already past its limit. Act on this now — the trend is a symptom, not a warning.`;
  }
  if (severity === SEVERITIES.watch && ratio != null && ratio >= 0.9) {
    const when = predictCrossing
      ? ` On this trend it reaches the limit in about ${predictCrossing.days_from_now} day${predictCrossing.days_from_now === 1 ? "" : "s"}.`
      : "";
    return `${label} is at ${round(current)}${u}, within 10% of its limit.${when}`;
  }
  if (severity === SEVERITIES.watch) {
    return `${label} is moving ${round(Math.abs(slopePerDay))}${u} per day and no community threshold exists for it yet. Worth watching, not yet actionable.`;
  }
  return `${label} is steady at ${round(current)}${u}.`;
}

function round(n) {
  if (!finite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 1) return n.toFixed(2);
  return n.toFixed(3);
}

/* ------------------------------------------------------------------ *
 * Whole-vehicle report
 * ------------------------------------------------------------------ */

/* Analyze every parameter in a set of histories.
 *
 * @param {Object|Map} histories  paramId -> [{t, value}, ...]
 * @param {Object} meta           {id, label, unit, threshold} per param
 * @param {Object} opts           {now}
 * @returns {{reports: Array, summary: Object}}
 *
 * Reports are ordered worst-first, so the panel leads with whatever needs
 * attention rather than with whatever happens to sort alphabetically.
 */
function analyzeAll(histories, meta, opts) {
  const m = meta || {};
  const now = opts && opts.now;
  const entries = [];
  if (histories instanceof Map) {
    for (const [id, points] of histories) entries.push([id, points, m[id] || {}]);
  } else if (histories && typeof histories === "object") {
    for (const id of Object.keys(histories)) entries.push([id, histories[id], m[id] || {}]);
  }

  const reports = entries
    .map(([id, points, spec]) => analyzeSeries(points, Object.assign({ id, now }, spec)))
    .sort(severityRank);

  const summary = {
    total: reports.length,
    act: reports.filter(r => r.severity === SEVERITIES.act).length,
    watch: reports.filter(r => r.severity === SEVERITIES.watch).length,
    insufficient: reports.filter(r => r.status === "insufficient_data").length,
  };
  return { reports, summary };
}

function severityRank(a, b) {
  // A parameter with too little history is not "fine" — it is unmeasured, and
  // it belongs at the bottom where a user cannot mistake it for a clean bill of
  // health. Sorting it among the `ok` reports would imply a trend was checked.
  if (a.status === "insufficient_data") return b.status === "insufficient_data" ? 0 : 1;
  if (b.status === "insufficient_data") return -1;
  const order = { act: 0, watch: 1, ok: 2 };
  const d = (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
  if (d !== 0) return d;
  // Within a severity, the steeper absolute trend first: the fastest-moving
  // parameter is the one a user would want to see at the top.
  const sa = Math.abs(a.slope_per_day || 0);
  const sb = Math.abs(b.slope_per_day || 0);
  if (sb !== sa) return sb - sa;
  return String(a.id).localeCompare(String(b.id));
}

/* Merge a newly-recorded observation into an existing history, replacing any
 * reading at the same instant. Re-recording the same session must not create a
 * duplicate point, which would flatter the correlation and invent a trend that
 * did not happen. */
function recordObservation(history, point) {
  const p = normalizePoint(point);
  if (!p) return (history || []).slice();
  const next = (history || [])
    .map(normalizePoint)
    .filter(Boolean)
    .filter(q => q.t !== p.t);
  next.push(p);
  next.sort((a, b) => a.t - b.t);
  return next;
}

const api = {
  MIN_SAMPLES,
  MIN_CORRELATION,
  SEVERITIES,
  analyzeAll,
  analyzeSeries,
  linearFit,
  normalizePoint,
  predictAt,
  recordObservation,
  limitRatio,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuAdaptationDrift = api;
