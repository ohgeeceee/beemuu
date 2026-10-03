

/* v3 IIFE wrapper — see scripts/wrap_v3_iife.py. Every classic
 * tag shares one global lexical scope, so a bare top-level `const` in
 * one file is a redeclaration error in the next. */
(function () {
"use strict";
"use strict";

/* Tuning Fingerprint Detector — v3.0.0 feature 3.
 *
 * Answers one question read-only: has this engine's calibration been changed?
 *
 * The approach is a community baseline. Someone logs a confirmed-stock engine,
 * the community publishes the resulting (rpm bin x load bin) grid of means and
 * standard deviations, and this module bins a new log the same way and asks how
 * far each cell sits from stock in standard-deviation units. A z-score of 2 is
 * the classic "this is not noise" line; beyond that the calibration moved.
 *
 * What this is NOT, deliberately:
 *   - It is not a map browser. It never reads or writes calibration data.
 *   - It does not name a tuning platform. "bootmod3 stage 1" is a guess about
 *     provenance that this data cannot support, and a wrong accusation to a
 *     seller is expensive. The report says what deviated, never who did it.
 *   - It never writes to an ECU. Everything here is arithmetic over a log.
 *
 * The hardest design problem is honesty under sparse data. A single sample in a
 * cell has a mean and a standard deviation of zero, which against a stock grid
 * produces an infinite z-score — a "confirmed stage 2" verdict from one data
 * point. Every confidence figure here is a function of how much of the grid was
 * actually driven, and cells below the sample floor are excluded rather than
 * guessed at.
 *
 * Dual export: `require()` under node --test, plain <script> in the webview.
 */

/* A cell needs at least this many samples before its mean is trusted. Below it
 * the cell contributes to the coverage count but not to the divergence score. */
const MIN_CELL_SAMPLES = 8;

/* |z| at or above this counts as a real deviation. Two standard deviations is
 * the conventional line and is deliberately conservative: a false accusation
 * costs more than a missed one. */
const Z_THRESHOLD = 2.0;

/* Overall confidence floor. Below this the report refuses to say `is_tuned` at
 * all, because a log that covered a tenth of the operating range cannot speak
 * for the calibration. */
const MIN_CONFIDENCE = 40;

/* Stock standard deviations below this are treated as this value, so a stock
 * cell that never varied cannot produce a division by ~0 and a fabricated
 * z-score of thousands. */
const MIN_STOCK_SIGMA = 0.001;

function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/* Sample standard deviation (n-1). Returns null for a single sample: with one
 * point there is no spread, and reporting 0 would let a one-sample cell through
 * the confidence floor as if it were a solid measurement. */
function stddev(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  const ss = values.reduce((a, b) => a + (b - m) * (b - m), 0);
  return Math.sqrt(ss / (values.length - 1));
}

function binIndex(edges, v) {
  if (!finite(v) || !Array.isArray(edges) || edges.length < 2) return -1;
  if (v < edges[0] || v > edges[edges.length - 1]) return -1;
  for (let i = edges.length - 1; i > 0; i--) {
    if (v >= edges[i - 1]) return i - 1;
  }
  return 0;
}

/* ------------------------------------------------------------------ *
 * Binning
 * ------------------------------------------------------------------ */

/* Bin observations into the (rpm x load) cells a baseline is defined on.
 *
 * @param {Array}  observations  [{rpm, load, value}, ...]
 * @param {Array}  rpmBins
 * @param {Array}  loadBins
 * @returns {Map<string, number[]>} "rpmIdx,loadIdx" -> values
 *
 * Observations outside the baseline's range are dropped, not clamped. Clamping
 * a 7000 rpm sample into the top cell would pile full-throttle pulls into a
 * cell the stock grid never sampled, and the resulting z-score would be an
 * artifact of the binning rather than a fact about the calibration.
 */
function binObservations(observations, rpmBins, loadBins) {
  const cells = new Map();
  for (const o of observations || []) {
    if (!o) continue;
    const ri = binIndex(rpmBins, o.rpm);
    const li = binIndex(loadBins, o.load);
    if (ri < 0 || li < 0) continue;
    if (!finite(o.value)) continue;
    const key = `${ri},${li}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(o.value);
  }
  return cells;
}

/* ------------------------------------------------------------------ *
 * Divergence
 * ------------------------------------------------------------------ */

/* Compare one parameter's observations against its stock baseline.
 *
 * @param {Array}  observations  [{rpm, load, value}, ...]
 * @param {Object} baseline      {param_id, label, unit, rpm_bins, load_bins,
 *                                means: number[][], stddevs: number[][]}
 * @returns {Object} divergence report
 */
function divergenceFor(observations, baseline) {
  const b = baseline || {};
  const rpmBins = Array.isArray(b.rpm_bins) ? b.rpm_bins : [];
  const loadBins = Array.isArray(b.load_bins) ? b.load_bins : [];
  const paramId = b.param_id || b.id || "";
  const cells = binObservations(observations, rpmBins, loadBins);
  // `n` bin edges describe `n - 1` cells. Guarding on the edge count first
  // matters: with empty arrays, (0 - 1) * (0 - 1) is 1, which would let an
  // empty baseline sail past the check below and divide by nothing.
  const rpmCells = rpmBins.length - 1;
  const loadCells = loadBins.length - 1;
  const totalCells = rpmCells > 0 && loadCells > 0 ? rpmCells * loadCells : 0;

  const out = {
    param_id: paramId,
    label: b.label || paramId,
    unit: b.unit || "",
    sample_count: (observations || []).length,
    cells_compared: 0,
    cells_skipped: 0,
    max_abs_z: null,
    observed_mean: null,
    stock_mean: null,
    z: null,
    diverged: false,
    confidence: 0,
    note: "",
  };

  if (totalCells === 0) {
    out.note = "Baseline defines no rpm/load cells — nothing to compare against.";
    return out;
  }
  if (!cells.size) {
    out.note = "No samples fell inside this baseline's rpm and load range. The log does not cover the conditions this parameter describes.";
    return out;
  }
  const perCell = [];
  for (const [key, values] of cells) {
    const [ri, li] = key.split(",").map(Number);
    const stockMean = b.means && b.means[ri] ? b.means[ri][li] : null;
    const stockSd = b.stddevs && b.stddevs[ri] ? b.stddevs[ri][li] : null;
    if (!finite(stockMean)) {
      out.cells_skipped++;
      continue;
    }
    if (values.length < MIN_CELL_SAMPLES) {
      // Too few samples to call this cell. Counted as skipped so the coverage
      // figure stays honest, and excluded from the score so one lone reading
      // cannot manufacture a verdict.
      out.cells_skipped++;
      continue;
    }
    const m = mean(values);
    // A stock cell that never varied has sigma 0; dividing by it would produce
    // an unbounded z-score. Floor it, so a genuine large offset is still caught
    // but an unfalsifiable one is not manufactured.
    const sigma = Math.max(finite(stockSd) ? stockSd : 0, MIN_STOCK_SIGMA);
    const z = (m - stockMean) / sigma;
    perCell.push({ ri, li, n: values.length, observed: m, stock: stockMean, z });
  }

  out.cells_compared = perCell.length;
  out.cells_skipped = out.cells_skipped;
  out.coverage = perCell.length / totalCells;

  if (!perCell.length) {
    out.note = `Every cell in this baseline had fewer than ${MIN_CELL_SAMPLES} samples. Drive the range this parameter describes and log again.`;
    return out;
  }
  // The headline is the most deviant cell, not the mean across cells. A
  // calibration that moved hard in one region of the map has been changed,
  // and averaging that away with fifteen cells that matched stock would hide
  // the only thing the user needs to know.
  const worst = perCell.reduce((a, b2) => (Math.abs(b2.z) > Math.abs(a.z) ? b2 : a));
  out.max_abs_z = Math.abs(worst.z);
  out.z = worst.z;
  out.observed_mean = worst.observed;
  out.stock_mean = worst.stock;
  out.worst_cell = { rpm: rpmBins[worst.ri], load: loadBins[worst.li], samples: worst.n };
  out.diverged = out.max_abs_z >= Z_THRESHOLD;

  // Confidence is coverage first (did we drive the map?) and sample depth
  // second. A log that touched every cell once is not the same evidence as one
  // that swept the range for an hour.
  const depth = perCell.reduce((a, c) => a + c.n, 0) / perCell.length;
  const depthScore = Math.min(1, depth / 40);
  out.confidence = Math.round(out.coverage * 0.6 * 100 + depthScore * 0.4 * 100);

  out.note = out.diverged
    ? `Deviates from stock by ${out.max_abs_z.toFixed(1)} standard deviations at around ${worst.rpm} rpm and ${worst.load}% load (stock ${fmt(worst.stock, b.unit)}, observed ${fmt(worst.observed, b.unit)}).`
    : `Within ${Z_THRESHOLD} standard deviations of stock across ${perCell.length} cell${perCell.length === 1 ? "" : "s"}. No evidence of a calibration change.`;
  return out;
}

function fmt(v, unit) {
  if (!finite(v)) return "—";
  const s = Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return unit ? `${s} ${unit}` : s;
}

/* ------------------------------------------------------------------ *
 * Whole-vehicle report
 * ------------------------------------------------------------------ */

/* Analyze a log against every supplied baseline.
 *
 * @param {Object} baselines  param_id -> baseline grid
 * @param {Object} logs       param_id -> [{rpm, load, value}, ...]
 * @returns {Object} tuning report
 */
function analyze(baselines, logs) {
  const l = logs || {};
  const divergences = [];
  for (const id of Object.keys(baselines || {})) {
    divergences.push(divergenceFor(l[id], baselines[id]));
  }
  divergences.sort((a, b) => (b.max_abs_z || 0) - (a.max_abs_z || 0));

  const usable = divergences.filter(d => d.cells_compared > 0);
  const overall = usable.length
    ? Math.round(usable.reduce((a, d) => a + d.confidence, 0) / usable.length)
    : 0;

  const diverged = usable.filter(d => d.diverged);
  const report = {
    is_tuned: false,
    overall_confidence: overall,
    // Never a platform name. The data supports "this deviated", not "who did
    // it" — and a wrong accusation aimed at a seller is a real harm.
    suspected_platform: null,
    divergences,
    note: "",
  };

  if (!usable.length) {
    report.note = "No parameter had enough samples in its baseline range to compare. Log a full drive from idle to redline under load.";
    return report;
  }
  if (overall < MIN_CONFIDENCE) {
    report.note = `Coverage too low (${overall}% confidence) to call this calibration. Nothing here contradicts stock, but the log did not cover enough of the map to say so either way.`;
    return report;
  }
  if (!diverged.length) {
    report.is_tuned = false;
    report.note = `Nothing deviated from stock beyond ${Z_THRESHOLD} standard deviations, at ${overall}% confidence. This calibration looks stock.`;
    return report;
  }

  report.is_tuned = true;
  report.note = diverged.length === 1
    ? `${diverged[0].label} deviates from a stock baseline. This calibration has been changed from stock.`
    : `${diverged.length} parameters deviate from stock. This calibration has been changed from stock.`;
  return report;
}

const api = {
  MIN_CELL_SAMPLES,
  MIN_CONFIDENCE,
  Z_THRESHOLD,
  analyze,
  binObservations,
  binIndex,
  divergenceFor,
  mean,
  stddev,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuTuningFingerprint = api;
})();
