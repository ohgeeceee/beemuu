"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const t = require("../tuning_fingerprint.js");

/* A 2x2 rpm/load baseline grid. `rpm_bins` has 3 edges -> 2 rpm cells, and
 * `load_bins` has 3 edges -> 2 load cells, so exactly four cells are
 * reachable: (0,0) (0,1) (1,0) (1,1). The four sample positions below were
 * chosen to land in four *distinct* cells — two of them sharing a cell is the
 * mistake that made an earlier version of this file disagree with itself. */
function baseline(over) {
  return Object.assign({
    param_id: "ignition",
    label: "Ignition timing",
    unit: "deg",
    rpm_bins: [1000, 3000, 5000],
    load_bins: [20, 60, 100],
    means: [
      [12, 14],
      [16, 20],
    ],
    stddevs: [
      [1, 1],
      [1, 1],
    ],
  }, over);
}

/* n samples at one (rpm, load) point. */
function cell(rpm, load, n, value) {
  return Array.from({ length: n }, () => ({ rpm, load, value }));
}

/* One sample set per reachable cell: low/low, low/high, high/low, high/high. */
function allCells(perCell, values) {
  const v = values || [12, 14, 16, 20];
  return [
    ...cell(2000, 30, perCell, v[0]),
    ...cell(2000, 90, perCell, v[1]),
    ...cell(4000, 30, perCell, v[2]),
    ...cell(4000, 90, perCell, v[3]),
  ];
}

test("mean and stddev handle the degenerate cases", () => {
  assert.equal(t.mean([2, 4, 6]), 4);
  assert.equal(t.mean([]), null);
  // One sample has no spread; reporting 0 would let it pass as a measurement.
  assert.equal(t.stddev([5]), null);
  assert.equal(t.stddev([]), null);
  assert.equal(t.stddev([2, 4, 6]), 2);
});

test("binObservations groups by rpm and load cell", () => {
  const b = baseline();
  const cells = t.binObservations([
    { rpm: 2000, load: 30, value: 13 },
    { rpm: 2100, load: 40, value: 13.5 },
    { rpm: 4000, load: 70, value: 17 },
  ], b.rpm_bins, b.load_bins);
  assert.equal(cells.get("0,0").length, 2);
  assert.equal(cells.get("1,1").length, 1);
  assert.equal(cells.size, 2);
});

test("samples outside the baseline range are dropped, not clamped into the top cell", () => {
  // Clamping would pile full-throttle pulls into a cell the stock grid never
  // sampled, and the z-score would be an artifact of the binning.
  const b = baseline();
  const cells = t.binObservations([
    { rpm: 900, load: 30, value: 1 },
    { rpm: 6000, load: 30, value: 1 },
    { rpm: 2000, load: 30, value: 13 },
  ], b.rpm_bins, b.load_bins);
  assert.deepEqual([...cells.keys()], ["0,0"]);
});

test("a stock log reports no deviation", () => {
  const d = t.divergenceFor(allCells(20, [12.1, 14.1, 16.1, 20.1]), baseline());
  assert.equal(d.diverged, false);
  assert.ok(d.max_abs_z < t.Z_THRESHOLD, `max z was ${d.max_abs_z}`);
  assert.equal(d.cells_compared, 4);
  assert.equal(d.cells_skipped, 0);
  assert.match(d.note, /No evidence of a calibration change/);
});

test("a shifted calibration is detected and names the deviant cell", () => {
  // High-rpm high-load pulled back 6 degrees: timing removed for knock margin,
  // confined to one region of the map.
  const d = t.divergenceFor(allCells(20, [12, 14, 16, 14]), baseline());
  assert.equal(d.diverged, true);
  assert.ok(Math.abs(d.max_abs_z) >= t.Z_THRESHOLD);
  assert.equal(d.stock_mean, 20);
  assert.equal(d.observed_mean, 14);
  assert.deepEqual(d.worst_cell, { rpm: 3000, load: 60, samples: 20 });
  assert.match(d.note, /standard deviations/);
});

test("a single deviation is not averaged away by the cells that matched stock", () => {
  // One retuned cell out of four is still a retuned calibration. A mean-across-
  // -cells score would report ~1.5 sigma here and call it stock.
  const d = t.divergenceFor(allCells(20, [12, 14, 16, 8]), baseline());
  assert.equal(d.diverged, true);
  assert.equal(d.observed_mean, 8);
});

test("a single sample cannot manufacture a tuning verdict", () => {
  // The core sparse-data case: one reading in a cell has a mean, and a stock
  // sigma of 1 would turn any offset into a "confirmed tune" verdict.
  const d = t.divergenceFor([{ rpm: 4000, load: 90, value: 99 }], baseline());
  assert.equal(d.cells_compared, 0);
  assert.equal(d.diverged, false);
  assert.equal(d.confidence, 0);
  assert.match(d.note, /fewer than 8 samples/);
});

test("a below-floor cell is counted as skipped, not silently dropped", () => {
  const d = t.divergenceFor([...cell(2000, 30, 20, 12), ...cell(4000, 90, 2, 20)], baseline());
  assert.equal(d.cells_compared, 1);
  assert.equal(d.cells_skipped, 1);
});

test("a stock cell with zero variance does not produce an unbounded z-score", () => {
  const b = baseline({ stddevs: [[0, 0], [0, 0]] });
  // A 0.0005 degree offset against a floored sigma of 0.001 is z=0.5, not the
  // z=1000 an unfloored division would produce.
  const d = t.divergenceFor(allCells(20, [12.0005, 14, 16, 20]), b);
  assert.ok(Number.isFinite(d.max_abs_z), `z was ${d.max_abs_z}`);
  assert.ok(d.max_abs_z < 2, `a 0.0005 offset produced z=${d.max_abs_z}`);
});

test("a large offset from a zero-variance stock cell is still caught", () => {
  // Flooring sigma must not become a blind spot: a real 6-degree change is
  // still far outside any plausible noise band.
  const b = baseline({ stddevs: [[0, 0], [0, 0]] });
  const d = t.divergenceFor(allCells(20, [12, 14, 16, 14]), b);
  assert.equal(d.diverged, true);
});

test("an empty or out-of-range log explains itself instead of reporting tuned", () => {
  const b = baseline();
  const none = t.divergenceFor([], b);
  assert.equal(none.cells_compared, 0);
  assert.equal(none.diverged, false);
  assert.match(none.note, /No samples fell inside/);

  const offMap = t.divergenceFor(cell(8000, 30, 20, 15), b);
  assert.equal(offMap.cells_compared, 0);
  assert.match(offMap.note, /No samples fell inside/);
});

test("a baseline with no cells is reported, not divided by", () => {
  // (0 - 1) * (0 - 1) is 1, so an empty grid has to be rejected on the edge
  // count rather than the cell product.
  for (const bins of [
    { rpm_bins: [], load_bins: [] },
    { rpm_bins: [1000], load_bins: [] },
    { rpm_bins: [], load_bins: [20] },
  ]) {
    const d = t.divergenceFor(cell(2000, 30, 20, 12), baseline(bins));
    assert.equal(d.cells_compared, 0);
    assert.equal(d.diverged, false);
    assert.match(d.note, /no rpm\/load cells/);
  }
});

test("confidence rises with coverage and sample depth", () => {
  const b = baseline();
  const shallow = t.divergenceFor(cell(2000, 30, 8, 12), b);
  const deep = t.divergenceFor(allCells(40), b);
  assert.ok(deep.confidence > shallow.confidence,
    `expected ${deep.confidence} > ${shallow.confidence}`);
  assert.ok(deep.confidence <= 100 && shallow.confidence >= 0);
});

test("analyze refuses to call a calibration when coverage is too low", () => {
  const b = baseline();
  // One cell of four, at the sample floor: real divergence, but the log says
  // almost nothing about the calibration as a whole.
  const r = t.analyze({ ignition: b }, { ignition: cell(2000, 30, 8, 40) });
  assert.equal(r.is_tuned, false);
  assert.ok(r.overall_confidence < t.MIN_CONFIDENCE);
  assert.match(r.note, /Coverage too low/);
});

test("analyze reports tuned on a well-covered deviating log", () => {
  const r = t.analyze({ ignition: baseline() }, { ignition: allCells(40, [12, 14, 16, 8]) });
  assert.equal(r.is_tuned, true);
  assert.ok(r.overall_confidence >= t.MIN_CONFIDENCE);
  assert.match(r.note, /changed from stock/);
});

test("analyze reports stock on a well-covered clean log", () => {
  const r = t.analyze({ ignition: baseline() }, { ignition: allCells(40, [12, 14, 16, 20]) });
  assert.equal(r.is_tuned, false);
  assert.match(r.note, /looks stock/);
});

test("analyze never names a tuning platform", () => {
  // The data supports "this deviated", not "who did it" — a wrong accusation
  // aimed at a seller is a real harm.
  const r = t.analyze({ ignition: baseline() }, { ignition: allCells(40, [12, 14, 16, 8]) });
  assert.equal(r.is_tuned, true);
  assert.equal(r.suspected_platform, null);
});

test("analyze handles no baselines and no logs at all", () => {
  assert.equal(t.analyze(null, null).is_tuned, false);
  assert.match(t.analyze(null, null).note, /No parameter had enough samples/);
  assert.equal(t.analyze({}, {}).divergences.length, 0);
  // A baseline with no matching log must not be silently omitted.
  const r = t.analyze({ ignition: baseline() }, {});
  assert.equal(r.divergences.length, 1);
  assert.equal(r.is_tuned, false);
});

test("analyze orders the most deviant parameter first", () => {
  const mk = (id, shift) => baseline({
    param_id: id, label: id,
    means: [[0, 0], [0, 0]], stddevs: [[1, 1], [1, 1]],
  });
  const logs = {
    small: allCells(20, [2, 2, 2, 2]),
    big: allCells(20, [20, 20, 20, 20]),
  };
  const r = t.analyze({ small: mk("small", 2), big: mk("big", 20) }, logs);
  assert.deepEqual(r.divergences.map(x => x.param_id), ["big", "small"]);
});

test("binIndex rejects out-of-range and non-numeric input", () => {
  assert.equal(t.binIndex([0, 10, 20], 5), 0);
  assert.equal(t.binIndex([0, 10, 20], 15), 1);
  assert.equal(t.binIndex([0, 10, 20], 20), 1);
  assert.equal(t.binIndex([0, 10, 20], 21), -1);
  assert.equal(t.binIndex([0, 10, 20], NaN), -1);
  assert.equal(t.binIndex([], 5), -1);
  assert.equal(t.binIndex(null, 5), -1);
});
