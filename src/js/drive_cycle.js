/* v3 IIFE wrapper — see scripts/wrap_v3_iife.py. Every classic
 * tag shares one global lexical scope, so a bare top-level `const` in
 * one file is a redeclaration error in the next. */
(function () {
"use strict";

/* Drive Cycle Analyst — v3.9.0 feature 1.
 *
 * Every other v3 engine answers a question about one channel or one interval.
 * This one answers the question a BMW owner actually asks: "how did this drive
 * go, and was that first start from cold?"
 *
 * A drive cycle is the span between an engine start and the point the engine
 * is switched off — rpm leaves zero, does whatever the driver asked of it,
 * then returns to zero for long enough that it can be called a shutdown rather
 * than a stall, a blip, or one quiet sample on a noisy bus. Everything the
 * module reports is scoped to those spans, because an idle ratio or a warm-up
 * time measured across an unstarted log is arithmetic about nothing.
 *
 * For each cycle it measures:
 *
 *   - idle_ratio : the share of the cycle spent below IDLE_RPM — the metric
 *                  that separates a motorway run from twenty minutes of
 *                  driveway idling, which is what actually soots a diesel and
 *                  dilutes the oil on any engine.
 *   - warm_up_s  : seconds from the cycle's first sample until the coolant
 *                  first reaches WARM_TARGET_C. A cold engine that never gets
 *                  there is a thermostat or a short-trip pattern; a warm
 *                  engine reports 0 and is not a finding at all.
 *   - cold_start : whether the coolant was below COLD_START_C when the engine
 *                  caught. `null` — not `false` — when there is no coolant
 *                  channel, because "we did not measure it" is not "it did not
 *                  happen".
 *
 * It refuses to grade what it cannot see. No rpm channel, too few samples to
 * find edges, or an rpm trace that never leaves zero all produce an explicit
 * `no_cycles` verdict with a null score, zero confidence and the plain-language
 * reason in `summary.evidence` — never a fabricated cycle, and never a grade
 * invented from arithmetic over an empty span. That refusal is the point of
 * the module as much as the scoring is.
 *
 * It is pure: no DOM, no Tauri, no transport, no timers, no randomness. It
 * reads the same series shape every other v3 engine reads — a Map or a plain
 * object of name -> { data: [{x, y}, ...] } — and returns numbers that trace
 * back to the named constants at the top of this file.
 *
 * Dual export: `require()` under node --test, plain <script> in the webview.
 */

/* ------------------------------------------------------------------ *
 * Thresholds. Exported so the panel can label a cycle with the same
 * numbers the engine acted on, and so the tests pin the real values.
 * ------------------------------------------------------------------ */
const MIN_SAMPLES = 8;         // below this no verdict is possible
const STOP_HOLD_S = 3;         // rpm must sit at zero this long to end a cycle
const ENGINE_START_RPM = 500;  // rpm at or above this is a running engine
const IDLE_RPM = 900;          // below this the engine is idling
const WARM_TARGET_C = 90;      // coolant is "warm" at or above this
const COLD_START_C = 60;       // coolant below this at a start is a cold start
const LONG_IDLE_RATIO = 0.4;   // more than this share idling is a finding
const SLOW_WARMUP_S = 300;     // a cold start slower than this to warm is a finding
const GAP_FACTOR = 3;          // a logging gap is > 3 median sample intervals ...
const GAP_MIN_S = 0.5;         // ... and longer than half a second
const WARN_SCORE = 80;         // verdict bands
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
 * last reading at a duplicated timestamp. Samples that cannot be represented
 * are counted, not clamped. */
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

/* rpm and coolant read out of either the raw channel points ({x, y}) or the
 * merged cycle points segment() builds ({x, rpm, coolant}). */
function rpmOf(p) {
  if (typeof p === "number") return p;
  if (!p || typeof p !== "object") return null;
  if (p.rpm !== undefined) return p.rpm;
  return p.y !== undefined ? p.y : null;
}

function coolantOf(p) {
  if (!p || typeof p !== "object") return null;
  if (p.coolant !== undefined) return p.coolant;
  if (p.rpm !== undefined) return null; // a merged point that carries no coolant
  return p.y !== undefined ? p.y : null;
}

function channelByName(series, name) {
  for (const [n, ch] of seriesEntries(series)) if (n === name) return ch;
  return null;
}

function coolantPointsOf(series, opts) {
  const name = opts.coolantChannel || "coolant";
  const ch = channelByName(series, name);
  if (!ch) return [];
  return cleanPoints(pointsOf(ch)).points;
}

/* Carry the most recent coolant reading at or before x onto a cycle point. */
function coolantAt(coolantPts, x) {
  let value = null;
  for (const c of coolantPts) {
    if (c.x > x) break;
    value = c.y;
  }
  return value;
}

/* Sample intervals far wider than the channel's own cadence — a paused poll or
 * a bus drop. A cycle may still be reconstructed across one, but the hole is
 * reported rather than papered over. */
function dropouts(points, opts = {}) {
  const factor = Number.isFinite(opts.gapFactor) ? opts.gapFactor : GAP_FACTOR;
  const dts = [];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].x - points[i - 1].x;
    if (dt > 0) dts.push(dt);
  }
  if (!dts.length) return [];
  const med = median([...dts].sort((a, b) => a - b));
  const gaps = [];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].x - points[i - 1].x;
    if (dt > factor * med && dt > GAP_MIN_S) gaps.push({ at_s: points[i - 1].x, dt });
  }
  return gaps;
}

/* ------------------------------------------------------------------ *
 * Engine-start detection. An engine start is a sample at or above
 * ENGINE_START_RPM whose predecessor was below it (or invisible), so
 * a log that opens mid-drive still reports the start it can see.
 * ------------------------------------------------------------------ */
function detectEngineStarts(points, opts = {}) {
  const thr = Number.isFinite(opts.engineStartRpm) ? opts.engineStartRpm : ENGINE_START_RPM;
  const arr = Array.isArray(points) ? points : [];
  const starts = [];
  let prev = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const rpm = rpmOf(arr[i]);
    if (!Number.isFinite(rpm)) continue; // a hole is not a transition
    if (rpm >= thr && prev < thr) starts.push({ at_s: arr[i].x, rpm, index: i });
    prev = rpm;
  }
  return starts;
}

/* ------------------------------------------------------------------ *
 * Segmentation
 * ------------------------------------------------------------------ */
function makeCycle(index, rpmPts, coolantPts, open) {
  const points = rpmPts.map(p => ({ x: p.x, rpm: p.y, coolant: coolantAt(coolantPts, p.x) }));
  const start_s = points.length ? points[0].x : 0;
  const end_s = points.length ? points[points.length - 1].x : 0;
  return { index, start_s, end_s, duration_s: end_s - start_s, points, open: !!open };
}

/* Split the rpm trace into drive cycles: an engine start opens one, a run of
 * zero rpm held for at least STOP_HOLD_S closes it. A trace that never shuts
 * off yields a single `open` cycle that runs to the end of the log — a finding,
 * not a failure. A trace with nothing to segment yields no cycles and a reason. */
function segment(series, opts = {}) {
  const rpmName = opts.rpmChannel || "rpm";
  const channel = channelByName(series, rpmName);
  if (!channel) {
    return { cycles: [], gaps: [], reason: `no rpm channel named "${rpmName}" — a drive cycle cannot be found without engine speed` };
  }
  const { points } = cleanPoints(pointsOf(channel));
  if (points.length < MIN_SAMPLES) {
    return { cycles: [], gaps: [], reason: `only ${points.length} rpm samples — too few to judge (need ${MIN_SAMPLES})` };
  }
  const gaps = dropouts(points, opts);
  const starts = detectEngineStarts(points, opts);
  if (!starts.length) {
    return { cycles: [], gaps, reason: `no engine-start marker — rpm never reached ${ENGINE_START_RPM} rpm` };
  }
  const coolantPts = coolantPointsOf(series, opts);
  const stopHold = Number.isFinite(opts.stopHoldS) ? opts.stopHoldS : STOP_HOLD_S;

  const cycles = [];
  let cursor = 0;
  for (const start of starts) {
    const si = start.index;
    if (si < cursor) continue; // a dip-and-recover inside a cycle we already took
    let endIdx = -1;
    let zeroStart = -1;
    for (let i = si + 1; i < points.length; i++) {
      const rpm = points[i].y;
      if (rpm <= 0) {
        if (zeroStart < 0) zeroStart = i;
        if (points[i].x - points[zeroStart].x >= stopHold) { endIdx = zeroStart - 1; break; }
      } else {
        zeroStart = -1;
      }
    }
    let open = false;
    if (endIdx < 0) { endIdx = points.length - 1; open = true; }
    if (endIdx < si) endIdx = si;
    cycles.push(makeCycle(cycles.length, points.slice(si, endIdx + 1), coolantPts, open));
    cursor = endIdx + 1;
  }
  if (!cycles.length) {
    return { cycles: [], gaps, reason: "engine starts were found but none produced a usable cycle" };
  }
  const plural = cycles.length === 1 ? "" : "s";
  return {
    cycles,
    gaps,
    reason: `${cycles.length} drive cycle${plural} found${gaps.length ? ` (${gaps.length} logging gap${gaps.length === 1 ? "" : "s"})` : ""}`,
  };
}

/* ------------------------------------------------------------------ *
 * Per-cycle metrics
 * ------------------------------------------------------------------ */

/* Seconds from the cycle's first sample until coolant first reaches the target.
 * `null` when it never does — that is a finding (a stuck thermostat, a
 * short-trip pattern), not an error, so it is reported and never thrown. */
function warmUpSeconds(points, opts = {}) {
  const target = Number.isFinite(opts.warmTargetC) ? opts.warmTargetC : WARM_TARGET_C;
  const arr = Array.isArray(points) ? points : [];
  if (!arr.length) return null;
  const x0 = arr[0] && Number.isFinite(arr[0].x) ? arr[0].x : 0;
  for (const p of arr) {
    const c = coolantOf(p);
    if (Number.isFinite(c) && c >= target) return p.x - x0;
  }
  return null;
}

/* Share of the cycle's rpm samples strictly below IDLE_RPM. A reading exactly
 * at IDLE_RPM counts as running, not idling. */
function idleRatio(points, opts = {}) {
  const idleRpm = Number.isFinite(opts.idleRpm) ? opts.idleRpm : IDLE_RPM;
  const arr = Array.isArray(points) ? points : [];
  let total = 0, idle = 0;
  for (const p of arr) {
    const rpm = rpmOf(p);
    if (!Number.isFinite(rpm)) continue;
    total++;
    if (rpm < idleRpm) idle++;
  }
  if (!total) return 0;
  return idle / total;
}

function verdictFor(score) {
  if (score < BAD_SCORE) return "bad";
  if (score < WARN_SCORE) return "warn";
  return "ok";
}

/* Grade one cycle. Every penalty pushes a plain-language reason, and a cycle
 * with too few samples refuses rather than guessing. */
function classify(cycle, opts = {}) {
  const points = cycle && Array.isArray(cycle.points) ? cycle.points : [];
  if (points.length < MIN_SAMPLES) {
    return {
      cold_start: null,
      warm_up_s: null,
      idle_ratio: null,
      avg_rpm: null,
      max_rpm: null,
      verdict: "unknown",
      score: null,
      confidence: 0,
      evidence: [`only ${points.length} samples in this cycle — too few to judge (need ${MIN_SAMPLES})`],
    };
  }
  const rpms = points.map(rpmOf).filter(Number.isFinite);
  const rpmStats = stats(rpms);
  const idle = idleRatio(points, opts);
  const warm = warmUpSeconds(points, opts);

  let firstCoolant = null;
  for (const p of points) {
    const c = coolantOf(p);
    if (Number.isFinite(c)) { firstCoolant = c; break; }
  }
  const cold = firstCoolant == null ? null : firstCoolant < COLD_START_C;

  let score = 100;
  const evidence = [];
  if (cold === true) {
    if (warm == null) {
      score -= 40;
      evidence.push(`cold start but coolant never reached ${WARM_TARGET_C} °C`);
    } else if (warm > SLOW_WARMUP_S) {
      score -= 25;
      evidence.push(`cold start took ${Math.round(warm)}s to reach ${WARM_TARGET_C} °C (target ${SLOW_WARMUP_S}s)`);
    }
  }
  if (idle > LONG_IDLE_RATIO) {
    score -= 20;
    evidence.push(`idled for ${Math.round(idle * 100)}% of the cycle (limit ${Math.round(LONG_IDLE_RATIO * 100)}%)`);
  }
  score = Math.max(0, Math.min(100, score));

  const coverage = Math.min(1, points.length / 60);
  return {
    cold_start: cold,
    warm_up_s: warm,
    idle_ratio: idle,
    avg_rpm: rpmStats.mean,
    max_rpm: rpmStats.max,
    verdict: verdictFor(score),
    score,
    confidence: Number(coverage.toFixed(3)),
    evidence,
    n: points.length,
  };
}

/* ------------------------------------------------------------------ *
 * Public entry point
 * ------------------------------------------------------------------ */
function analyze(series, opts = {}) {
  const seg = segment(series, opts);
  if (!seg.cycles.length) {
    return {
      cycles: [],
      reason: seg.reason,
      summary: {
        n_cycles: 0,
        cold_starts: 0,
        total_duration_s: 0,
        total_idle_s: 0,
        cold_warmup_concerns: 0,
        headline: seg.reason,
        verdict: "no_cycles",
        score: null,
        confidence: 0,
        evidence: [seg.reason],
      },
    };
  }

  const cycles = seg.cycles.map(c => Object.assign({}, c, classify(c, opts)));
  cycles.sort((a, b) => {
    const ra = a.score == null ? 1000 : a.score;
    const rb = b.score == null ? 1000 : b.score;
    if (ra !== rb) return ra - rb;
    return a.index - b.index;
  });

  const n_cycles = cycles.length;
  const cold_starts = cycles.filter(c => c.cold_start === true).length;
  const cold_warmup_concerns = cycles
    .filter(c => c.cold_start === true && (c.warm_up_s == null || c.warm_up_s > SLOW_WARMUP_S))
    .length;
  const total_duration_s = cycles.reduce((a, c) => a + c.duration_s, 0);
  const total_idle_s = Number(
    cycles.reduce((a, c) => a + (c.idle_ratio || 0) * c.duration_s, 0).toFixed(3),
  );
  const worst = cycles[0];
  const confidence = Number((cycles.reduce((a, c) => a + c.confidence, 0) / n_cycles).toFixed(3));

  const headlineParts = [`${n_cycles} drive cycle${n_cycles === 1 ? "" : "s"}`];
  if (cold_starts) headlineParts.push(`${cold_starts} cold start${cold_starts === 1 ? "" : "s"}`);
  if (cold_warmup_concerns) {
    headlineParts.push(`${cold_warmup_concerns} warm-up concern${cold_warmup_concerns === 1 ? "" : "s"}`);
  }

  return {
    cycles,
    reason: seg.reason,
    summary: {
      n_cycles,
      cold_starts,
      total_duration_s,
      total_idle_s,
      cold_warmup_concerns,
      headline: headlineParts.join(", "),
      verdict: worst.verdict,
      score: worst.score,
      confidence,
      evidence: cycles.flatMap(c => c.evidence),
    },
  };
}

const api = {
  MIN_SAMPLES,
  STOP_HOLD_S,
  ENGINE_START_RPM,
  IDLE_RPM,
  WARM_TARGET_C,
  COLD_START_C,
  LONG_IDLE_RATIO,
  SLOW_WARMUP_S,
  GAP_FACTOR,
  GAP_MIN_S,
  WARN_SCORE,
  BAD_SCORE,
  seriesEntries,
  pointsOf,
  cleanPoints,
  median,
  stats,
  rpmOf,
  coolantOf,
  dropouts,
  detectEngineStarts,
  segment,
  warmUpSeconds,
  idleRatio,
  verdictFor,
  classify,
  analyze,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuDriveCycle = api;
})();
