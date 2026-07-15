"use strict";

// Log-session diff helpers for the v0.6.0 "Compare logs" UI.
//
// Pure helpers — no DOM, no Chart.js. The Logging tab's
// "Compare logs" modal in `src/js/main.js` consumes the output
// and renders it. The math is the same logic the histogram
// viewer uses to compute stats, generalised to two samples so
// the delta is meaningful.
//
// Why a separate file: the stats math is easy to get subtly
// wrong (off-by-one on paired timestamps, mean of empty array,
// std-dev with one sample) and is exactly the kind of logic
// that benefits from unit tests with concrete numerical
// assertions. DOM rendering is verified manually in the
// simulator; this file is verified by `node --test`.
//
// Dual export: works under `node --test` (CommonJS) and as a
// plain `<script>` in the Tauri webview (where `module` is
// undefined).

/**
 * Compute summary statistics for a single array of numeric
 * y-values. NaN / Infinity / non-finite entries are silently
 * dropped (failed reads leave holes in the log; the user
 * doesn't want those to poison the diff).
 *
 * @param {number[]} values - Raw samples.
 * @returns {{n: number, min: number, max: number, mean: number,
 *            median: number, stdDev: number, dropped: number}}
 *   For empty input, all stats are NaN and `dropped` is 0.
 */
function stats(values) {
  const cleaned = [];
  let dropped = 0;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) cleaned.push(v);
    else dropped++;
  }

  if (cleaned.length === 0) {
    return {
      n: 0,
      min: NaN,
      max: NaN,
      mean: NaN,
      median: NaN,
      stdDev: NaN,
      dropped,
    };
  }

  const n = cleaned.length;
  let sum = 0;
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const v of cleaned) {
    sum += v;
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }
  const mean = sum / n;

  // Median: sort a copy so the input array isn't mutated.
  const sorted = [...cleaned].sort((a, b) => a - b);
  const median = (n % 2 === 1)
    ? sorted[(n - 1) >> 1]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

  // Population std-dev (divide by n, not n-1). Same rationale
  // as src-tauri/src/data/live.rs::histogram: the user wants
  // the spread of the data they actually recorded, not an
  // unbiased estimator of the car's long-run behaviour.
  let sqSum = 0;
  for (const v of cleaned) {
    const d = v - mean;
    sqSum += d * d;
  }
  const stdDev = Math.sqrt(sqSum / n);

  return { n, min: minVal, max: maxVal, mean, median, stdDev, dropped };
}

/**
 * Pair two log series by index (i.e. position in the array,
 * not timestamp). The Logging tab's "Compare logs" modal
 * aligns samples by sample-number — this matches how the
 * existing CSV exporter works (`enabled[0][1].getAllData()[i]`)
 * and avoids the complexity of timestamp matching when the
 * two logs have different start times or different sample
 * rates.
 *
 * Returns a per-sample delta array (`{x, dy}`) and per-series
 * stats. The UI can render both.
 *
 * @param {Array<{x: number, y: number}>} aPoints - Series A.
 * @param {Array<{x: number, y: number}>} bPoints - Series B.
 * @returns {{
 *   deltas: Array<{x: number, dy: number, ay: number, by: number}>,
 *   statsA: ReturnType<typeof stats>,
 *   statsB: ReturnType<typeof stats>,
 *   paired: number,            // how many samples were actually paired
 *   unequal: number,           // how many samples were in only one series (truncated)
 * }}
 */
function diffSeries(aPoints, bPoints) {
  const aYs = aPoints.map((p) => p.y);
  const bYs = bPoints.map((p) => p.y);
  const statsA = stats(aYs);
  const statsB = stats(bYs);

  const n = Math.min(aPoints.length, bPoints.length);
  const deltas = [];
  for (let i = 0; i < n; i++) {
    deltas.push({
      x: i,
      ay: aPoints[i].y,
      by: bPoints[i].y,
      dy: aPoints[i].y - bPoints[i].y,
    });
  }
  const unequal = Math.abs(aPoints.length - bPoints.length);

  return {
    deltas,
    statsA,
    statsB,
    paired: n,
    unequal,
  };
}

/**
 * Compact stats-delta summary for the modal's per-channel
 * rows. Computes mean / std-dev / max / count deltas between
 * the two stats objects with formatting that respects unitless
 * numeric inputs.
 *
 * Returns null when either side has zero samples — there's no
 * meaningful delta to display, and the UI should show "—".
 *
 * @param {ReturnType<typeof stats>} a
 * @param {ReturnType<typeof stats>} b
 * @returns {null | {meanΔ: number, stdDevΔ: number, maxΔ: number,
 *                    countΔ: number}}
 */
function statsDelta(a, b) {
  if (a.n === 0 || b.n === 0) return null;
  return {
    meanΔ: a.mean - b.mean,
    stdDevΔ: a.stdDev - b.stdDev,
    maxΔ: a.max - b.max,
    countΔ: a.n - b.n,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { stats, diffSeries, statsDelta };
}
if (typeof window !== "undefined") {
  window.LogDiff = { stats, diffSeries, statsDelta };
}
