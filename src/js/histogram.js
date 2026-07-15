"use strict";

// Histogram binning for the Logging tab.
//
// Pure data layer — no DOM, no Chart.js. The UI layer (src/js/main.js
// + src/js/histogram-ui.js) consumes the output and renders it.
//
// Why a separate file: the bin-count and stats math is easy to get
// subtly wrong (off-by-one on bin edges, median of an even-length
// array, etc.) and is exactly the kind of logic that benefits from
// unit tests with concrete numerical assertions. The DOM rendering
// lives elsewhere and is verified manually in the simulator.

/**
 * Build a fixed-width histogram from an array of numeric values.
 *
 * @param {number[]} values - Raw samples. NaN/undefined/non-finite
 *   entries are silently dropped (failed reads leave holes in the
 *   log; the tuner doesn't want those to poison the distribution).
 * @param {number} [binCount=20] - Number of bins. Clamped to
 *   [1, 200] so a typo can't allocate a million bins.
 * @returns {{
 *   binEdges: number[],
 *   counts: number[],
 *   stats: { min: number, max: number, mean: number,
 *             median: number, stdDev: number, n: number },
 *   dropped: number
 * }}
 *   `binEdges.length === counts.length + 1`. Each bin is
 *   `[binEdges[i], binEdges[i+1])` — left-closed, right-open,
 *   matching numpy's default histogram behaviour. The max value
 *   is included in the last bin (`binEdges[N]` equals max exactly).
 */
function histogram(values, binCount = 20) {
  const cleaned = [];
  let dropped = 0;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) cleaned.push(v);
    else dropped++;
  }

  if (cleaned.length === 0) {
    return {
      binEdges: [],
      counts: [],
      stats: { min: NaN, max: NaN, mean: NaN, median: NaN, stdDev: NaN, n: 0 },
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

  // Population standard deviation (dividing by n, not n-1). For a
  // log of telemetry samples over a session we want the spread of
  // the data we actually recorded, not an unbiased estimator of
  // the car's long-run behaviour.
  let sqSum = 0;
  for (const v of cleaned) {
    const d = v - mean;
    sqSum += d * d;
  }
  const stdDev = Math.sqrt(sqSum / n);

  // Bins: fixed-width across [minVal, maxVal]. Edge case: all
  // values identical → one bin of width 0 holds all n entries.
  const requestedBins = Math.max(1, Math.min(200, Math.floor(binCount) || 1));
  const range = maxVal - minVal;
  const binWidth = range === 0 ? 1 : range / requestedBins;

  const counts = new Array(requestedBins).fill(0);
  const binEdges = new Array(requestedBins + 1);
  for (let i = 0; i <= requestedBins; i++) {
    binEdges[i] = minVal + i * binWidth;
  }
  // Force the last edge to equal maxVal exactly so the max sample
  // falls in the last bin even with floating-point drift.
  binEdges[requestedBins] = maxVal;

  if (range === 0) {
    counts[0] = n;
  } else {
    for (const v of cleaned) {
      let idx = Math.floor((v - minVal) / binWidth);
      if (idx === requestedBins) idx = requestedBins - 1; // max value
      counts[idx]++;
    }
  }

  return {
    binEdges,
    counts,
    stats: { min: minVal, max: maxVal, mean, median, stdDev, n },
    dropped,
  };
}

// Dual export — works under both `node --test` (CommonJS) and the
// Tauri webview (plain `<script>` tag, no module loader).
//
// In Node, `module.exports = …` attaches to the CommonJS module
// record and is reachable via `require()` from the test file.
//
// In the browser, `module` is undefined; the assignment would throw
// a ReferenceError. We guard with `typeof module`, and as a
// belt-and-suspenders fallback also expose `window.beeemuuHistogram`
// so the renderer (main.js) can call `beeemuuHistogram.histogram`
// without a module loader.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { histogram };
}
if (typeof window !== "undefined") {
  window.beeemuuHistogram = { histogram };
}
