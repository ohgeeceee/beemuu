/* v3 IIFE wrapper — see scripts/wrap_v3_iife.py. Every classic
 * tag shares one global lexical scope, so a bare top-level `const` in
 * one file is a redeclaration error in the next. */
(function () {
"use strict";

/* Signal Integrity Scoring — v3.8.0 feature 1.
 *
 * Every v3 engine before this one treats a channel's *values* as true. None of
 * them asks whether the channel itself can be believed. A coolant trace that
 * sat at exactly 84.0 °C for two minutes, a lambda that dropped to zero for
 * three samples, an RPM channel missing a four-second hole — these are sensor
 * and logging faults, and every downstream verdict built on them is wrong in
 * a way that looks like a real finding.
 *
 * This module audits the channels first. For each one it measures the failure
 * modes that actually occur in BMW logging:
 *
 *   - frozen    : one constant value for the whole log (a disconnected or
 *                 default-filled sensor).
 *   - flatline  : a long run of one repeated value inside an otherwise live
 *                 trace (a stuck sensor, or a hold-last-value fallback).
 *   - dropouts  : gaps between samples far wider than the channel's own
 *                 cadence (a bus drop, a paused poll).
 *   - steps     : a single-sample excursion of a large fraction of the whole
 *                 range (a corrupt frame, a unit glitch).
 *   - noise     : successive-sample jitter large relative to the range (a
 *                 ground or wiring fault).
 *
 * It is pure: no DOM, no Tauri, no transport. It reads the same series shape
 * every other v3 engine reads (`{ data: [{x, y}, ...] }`) and returns metrics
 * plus a 0–100 score, a verdict and the *evidence* for each penalty. A channel
 * with too few samples to judge returns verdict `unknown` and confidence 0
 * rather than a passing grade it has not earned.
 *
 * Dual export: `require()` under node --test, plain <script> in the webview.
 */

/* ------------------------------------------------------------------ *
 * Thresholds. Exported so the panel can label a row with the same
 * numbers the engine acted on, and so the tests pin the real values.
 * ------------------------------------------------------------------ */
const MIN_SAMPLES = 8;        // below this no verdict is possible
const FLAT_EPS = 1e-9;        // two reads are "the same" below this
const FLAT_MIN_RUN = 5;       // a flatline is >= 5 consecutive equal reads
const FLAT_BAD_RUN = 20;      // ... and this many is a fault on its own
const FLAT_WARN_RATIO = 0.2;  // or this share of the whole trace being flat
const FLAT_BAD_RATIO = 0.5;
const GAP_FACTOR = 3;         // a dropout is > 3 median sample intervals ...
const GAP_MIN_S = 0.5;        // ... and longer than half a second
const STEP_FACTOR = 8;        // a step is > 8x the robust diff scale ...
const STEP_MIN_RANGE = 0.25;  // ... and at least a quarter of the range
const NOISE_WARN = 0.05;      // median |diff| / range
const WARN_SCORE = 80;        // verdict bands
const BAD_SCORE = 50;

/* ------------------------------------------------------------------ *
 * Series plumbing. Accepts a Map or a plain object, the same two
 * shapes main.js has held over the years.
 * ------------------------------------------------------------------ */
function seriesEntries(series) {
  if (!series) return [];
  if (typeof series.entries === "function") return [...series.entries()];
  if (typeof series === "object") return Object.entries(series);
  return [];
}

function pointsOf(channel) {
  if (!channel) return [];
  if (Array.isArray(channel)) return channel;
  if (Array.isArray(channel.data)) return channel.data;
  if (Array.isArray(channel.points)) return channel.points;
  return [];
}

/* Drop anything that is not a finite (x, y) pair, then sort by x and keep the
 * last reading at a duplicated timestamp. A channel is judged on what it can
 * actually represent; unrepresentable samples are counted, not clamped. */
function cleanPoints(points) {
  const out = [];
  let dropped = 0;
  for (const p of points || []) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) { dropped++; continue; }
    out.push({ x: p.x, y: p.y });
  }
  out.sort((a, b) => a.x - b.x);
  const uniq = [];
  for (const p of out) {
    if (uniq.length && uniq[uniq.length - 1].x === p.x) uniq[uniq.length - 1] = p;
    else uniq.push(p);
  }
  // `dropped` counts samples that could not be represented at all; a repeated
  // timestamp is collapsed to its last read, which is counted separately.
  return { points: uniq, dropped, collapsed: out.length - uniq.length };
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stats(values) {
  const n = values.length;
  if (!n) return { n: 0, min: null, max: null, mean: null, range: null, stddev: null };
  let sum = 0, min = Infinity, max = -Infinity;
  for (const v of values) { sum += v; if (v < min) min = v; if (v > max) max = v; }
  const mean = sum / n;
  let sq = 0;
  for (const v of values) sq += (v - mean) * (v - mean);
  return { n, min, max, mean, range: max - min, stddev: Math.sqrt(sq / n) };
}

/* ------------------------------------------------------------------ *
 * Failure-mode detectors. Each is independent and returns a shape a
 * test can pin without going through the scorer.
 * ------------------------------------------------------------------ */

/* Longest run of consecutive reads that equal the one before them. */
function flatline(points) {
  let run = 0, longest = 0, flatPoints = 0;
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i].y - points[i - 1].y) <= FLAT_EPS) {
      run++;
      flatPoints++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  const n = points.length;
  return {
    longest_run: longest,
    flat_points: flatPoints,
    ratio: n > 1 ? flatPoints / (n - 1) : 0,
    frozen: n >= MIN_SAMPLES && flatPoints === n - 1 && longest === n - 1,
  };
}

/* Gaps wider than GAP_FACTOR median intervals and longer than GAP_MIN_S. */
function dropouts(points) {
  const gaps = [];
  const dts = [];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].x - points[i - 1].x;
    if (dt > 0) dts.push(dt);
  }
  if (!dts.length) return { count: 0, longest_s: 0, gaps: [], median_dt: null };
  const sorted = [...dts].sort((a, b) => a - b);
  const med = median(sorted);
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].x - points[i - 1].x;
    if (dt > GAP_FACTOR * med && dt > GAP_MIN_S) gaps.push({ at_s: points[i - 1].x, dt });
  }
  return {
    count: gaps.length,
    longest_s: gaps.reduce((a, g) => Math.max(a, g.dt), 0),
    gaps,
    median_dt: med,
  };
}

/* Single-sample excursions of a large share of the range. A smooth ramp has a
 * near-zero robust diff scale, which would make every sample a "step"; the
 * guard below declines to flag a channel with no jitter to measure against. */
function stepOutliers(points) {
  if (points.length < 4) return { count: 0, steps: [], scale: 0 };
  const diffs = [];
  for (let i = 1; i < points.length; i++) diffs.push(points[i].y - points[i - 1].y);
  const abs = diffs.map(Math.abs).sort((a, b) => a - b);
  const scale = median(abs);
  const range = stats(points.map(p => p.y)).range;
  const threshold = Math.max(STEP_FACTOR * scale, STEP_MIN_RANGE * (range || 0));
  const steps = [];
  // Only when there is something to exceed. A constant channel has range 0 and
  // a smooth ramp has a non-zero robust scale, so neither is flagged; a spike
  // in an otherwise flat trace has scale 0 but a real range, and is caught by
  // the range floor.
  if (threshold > 0) {
    for (let i = 0; i < diffs.length; i++) {
      if (Math.abs(diffs[i]) > threshold) {
        steps.push({ at_s: points[i + 1].x, delta: diffs[i] });
      }
    }
  }
  return { count: steps.length, steps, scale };
}

/* Successive-sample jitter relative to the range. */
function jitter(points) {
  if (points.length < 3) return 0;
  const diffs = [];
  for (let i = 1; i < points.length; i++) diffs.push(Math.abs(points[i].y - points[i - 1].y));
  const sorted = [...diffs].sort((a, b) => a - b);
  const range = stats(points.map(p => p.y)).range;
  if (!range) return 0;
  return median(sorted) / range;
}

/* ------------------------------------------------------------------ *
 * Scoring. A score is only meaningful with evidence; every penalty
 * pushes a plain-language reason so a user can audit the grade.
 * ------------------------------------------------------------------ */
function scoreChannel(metrics) {
  let score = 100;
  const evidence = [];

  if (metrics.flatline.frozen) {
    score -= 55;
    evidence.push(`value never changes across ${metrics.n} reads — sensor frozen or default-filled`);
  } else if (metrics.flatline.longest_run >= FLAT_BAD_RUN || metrics.flatline.ratio >= FLAT_BAD_RATIO) {
    score -= 30;
    evidence.push(`flat for ${metrics.flatline.longest_run} consecutive reads (${Math.round(metrics.flatline.ratio * 100)}% of the trace)`);
  } else if (metrics.flatline.longest_run >= FLAT_MIN_RUN || metrics.flatline.ratio >= FLAT_WARN_RATIO) {
    score -= 12;
    evidence.push(`repeated value run of ${metrics.flatline.longest_run} reads`);
  }

  if (metrics.dropouts.count > 0) {
    score -= Math.min(30, 10 * metrics.dropouts.count);
    evidence.push(`${metrics.dropouts.count} dropout${metrics.dropouts.count === 1 ? "" : "s"} (longest ${metrics.dropouts.longest_s.toFixed(1)}s)`);
  }

  if (metrics.steps.count > 0) {
    score -= Math.min(25, 8 * metrics.steps.count);
    evidence.push(`${metrics.steps.count} implausible single-sample step${metrics.steps.count === 1 ? "" : "s"}`);
  }

  if (metrics.noise >= NOISE_WARN) {
    score -= 15;
    evidence.push(`successive-sample jitter is ${Math.round(metrics.noise * 100)}% of range`);
  }

  score = Math.max(0, Math.min(100, score));
  return { score, evidence };
}

function verdictFor(score) {
  if (score < BAD_SCORE) return "bad";
  if (score < WARN_SCORE) return "warn";
  return "ok";
}

/* ------------------------------------------------------------------ *
 * Public entry points
 * ------------------------------------------------------------------ */
function analyzeChannel(name, rawPoints, opts = {}) {
  const { points, dropped, collapsed } = cleanPoints(pointsOf(rawPoints));
  const base = {
    name,
    n: points.length,
    dropped,
    collapsed,
    span_s: points.length > 1 ? points[points.length - 1].x - points[0].x : 0,
    unit: opts.unit || null,
  };

  if (points.length < MIN_SAMPLES) {
    return Object.assign(base, {
      verdict: "unknown",
      score: null,
      confidence: 0,
      evidence: [`only ${points.length} usable samples — too few to judge (need ${MIN_SAMPLES})`],
      stats: stats(points.map(p => p.y)),
      flatline: flatline(points),
      dropouts: dropouts(points),
      steps: stepOutliers(points),
      noise: jitter(points),
    });
  }

  const flat = flatline(points);
  const gaps = dropouts(points);
  const steps = stepOutliers(points);
  const noise = jitter(points);
  const valueStats = stats(points.map(p => p.y));
  const metric = {
    n: points.length,
    flatline: flat,
    dropouts: gaps,
    steps,
    noise,
  };
  const { score, evidence } = scoreChannel(metric);
  // Confidence rises with sample count and falls when a channel is mostly
  // padding: 200 reads that are 90% flatline are not a confident clean read.
  const coverage = Math.min(1, points.length / 60);
  const confidence = Number((coverage * (1 - Math.min(0.6, flat.ratio))).toFixed(3));

  return Object.assign(base, {
    verdict: verdictFor(score),
    score,
    confidence,
    evidence,
    stats: valueStats,
    flatline: flat,
    dropouts: gaps,
    steps,
    noise,
    median_dt: gaps.median_dt,
  });
}

/* Audit every channel in a session, worst first. */
function analyze(series, opts = {}) {
  const channels = [];
  for (const [name, channel] of seriesEntries(series)) {
    channels.push(analyzeChannel(name, channel, {
      unit: channel && typeof channel === "object" && !Array.isArray(channel) ? channel.unit : null,
      ...opts,
    }));
  }
  channels.sort((a, b) => {
    const rank = c => (c.score == null ? 1000 : c.score);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.name.localeCompare(b.name);
  });
  const summary = {
    channels: channels.length,
    ok: channels.filter(c => c.verdict === "ok").length,
    warn: channels.filter(c => c.verdict === "warn").length,
    bad: channels.filter(c => c.verdict === "bad").length,
    unknown: channels.filter(c => c.verdict === "unknown").length,
    dropouts_total: channels.reduce((a, c) => a + c.dropouts.count, 0),
  };
  // One line a panel can show without re-deriving anything.
  summary.headline = summary.bad > 0
    ? `${summary.bad} channel${summary.bad === 1 ? "" : "s"} untrustworthy`
    : summary.warn > 0
      ? `${summary.warn} channel${summary.warn === 1 ? "" : "s"} degraded`
      : "all channels healthy";
  summary.is_trustworthy = summary.bad === 0;
  return { channels, summary };
}

const api = {
  MIN_SAMPLES,
  FLAT_MIN_RUN,
  FLAT_BAD_RUN,
  GAP_FACTOR,
  GAP_MIN_S,
  STEP_FACTOR,
  STEP_MIN_RANGE,
  NOISE_WARN,
  WARN_SCORE,
  BAD_SCORE,
  cleanPoints,
  seriesEntries,
  stats,
  median,
  flatline,
  dropouts,
  stepOutliers,
  jitter,
  scoreChannel,
  verdictFor,
  analyzeChannel,
  analyze,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuSignalQuality = api;
})();
