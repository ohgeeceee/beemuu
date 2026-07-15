"use strict";

// Tests for `src/js/log_diff.js` — pure helpers used by the
// v0.6.0 Log-merge / comparison modal. Run with
// `npm run test:js` (which calls
// `node --test src/js/test/*.test.cjs`).
//
// Conventions mirror `live_format.test.cjs`: dual export so
// the helpers run under both Node (CommonJS) and the browser
// (plain <script>). Only Node is tested here; the browser
// path is verified manually in the simulator.

const test = require("node:test");
const assert = require("node:assert/strict");

const { stats, diffSeries, statsDelta } = require("../log_diff.js");

function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

function fmt(v) {
  return Number.isFinite(v) ? v.toFixed(2) : "—";
}

// ---- stats ---------------------------------------------------------------

test("stats — empty input returns n=0 and NaN stats", () => {
  const r = stats([]);
  assert.equal(r.n, 0);
  assert.ok(Number.isNaN(r.min));
  assert.ok(Number.isNaN(r.max));
  assert.ok(Number.isNaN(r.mean));
  assert.ok(Number.isNaN(r.median));
  assert.ok(Number.isNaN(r.stdDev));
  assert.equal(r.dropped, 0);
});

test("stats — all-non-finite input is treated as empty + dropped=N", () => {
  const r = stats([NaN, Infinity, -Infinity, undefined, null, "x"]);
  assert.equal(r.n, 0);
  assert.equal(r.dropped, 6);
});

test("stats — single value: min=max=mean=median, stdDev=0", () => {
  const r = stats([42]);
  assert.equal(r.n, 1);
  assert.equal(r.min, 42);
  assert.equal(r.max, 42);
  assert.equal(r.mean, 42);
  assert.equal(r.median, 42);
  assert.equal(r.stdDev, 0);
  assert.equal(r.dropped, 0);
});

test("stats — 1..5 stats correctness", () => {
  const r = stats([1, 2, 3, 4, 5]);
  assert.equal(r.n, 5);
  assert.equal(r.min, 1);
  assert.equal(r.max, 5);
  assert.equal(r.mean, 3);
  assert.equal(r.median, 3);
  // sqrt(2) — population stdDev of [1,2,3,4,5] (divides by n, not n-1)
  assert.ok(approx(r.stdDev, Math.sqrt(2)));
});

test("stats — median of even-length array is average of middle two", () => {
  const r = stats([1, 2, 3, 4]);
  assert.equal(r.median, 2.5);
});

test("stats — filters out non-finite finite-input entries", () => {
  const r = stats([1, NaN, 2, undefined, 3, Infinity, 4]);
  assert.equal(r.n, 4);
  assert.equal(r.dropped, 3);
  assert.equal(r.min, 1);
  assert.equal(r.max, 4);
});

test("stats — input array is not mutated", () => {
  const input = [3, 1, 4, 1, 5, 9, 2, 6];
  const snapshot = [...input];
  stats(input);
  assert.deepEqual(input, snapshot);
});

// ---- diffSeries -----------------------------------------------------------

test("diffSeries — empty + empty gives empty deltas, stats NaN", () => {
  const r = diffSeries([], []);
  assert.deepEqual(r.deltas, []);
  assert.equal(r.paired, 0);
  assert.equal(r.unequal, 0);
  assert.equal(r.statsA.n, 0);
  assert.equal(r.statsB.n, 0);
});

test("diffSeries — equal-length series: one delta per index, paired=N", () => {
  const a = [
    { x: 0, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 3 },
  ];
  const b = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ];
  const r = diffSeries(a, b);
  assert.equal(r.deltas.length, 3);
  assert.equal(r.deltas[0].dy, 1);
  assert.equal(r.deltas[1].dy, 1);
  assert.equal(r.deltas[2].dy, 1);
  assert.equal(r.paired, 3);
  assert.equal(r.unequal, 0);
});

test("diffSeries — different lengths: pairsto min, unequal=|Δlen|", () => {
  const a = [
    { x: 0, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 3 },
    { x: 3, y: 4 },
    { x: 4, y: 5 },
  ];
  const b = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
  ];
  const r = diffSeries(a, b);
  assert.equal(r.deltas.length, 3); // paired to min
  assert.equal(r.paired, 3);
  assert.equal(r.unequal, 2); // 5 - 3 = 2 truncated
});

test("diffSeries — statsA and statsB computed independently", () => {
  const a = [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }];
  const b = [{ x: 0, y: 2 }, { x: 1, y: 4 }, { x: 2, y: 6 }];
  const r = diffSeries(a, b);
  assert.equal(r.statsA.mean, 3);
  assert.equal(r.statsB.mean, 4);
});

test("diffSeries — input arrays are not mutated", () => {
  const a = [{ x: 0, y: 3 }, { x: 1, y: 1 }, { x: 2, y: 2 }];
  const b = [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }];
  const aSnap = a.map((p) => ({ ...p }));
  const bSnap = b.map((p) => ({ ...p }));
  diffSeries(a, b);
  assert.deepEqual(a, aSnap);
  assert.deepEqual(b, bSnap);
});

// ---- statsDelta -----------------------------------------------------------

test("statsDelta — both sides have data", () => {
  const a = {
    n: 100, min: 100, max: 110, mean: 105, median: 105,
    stdDev: 2.5, dropped: 0,
  };
  const b = {
    n: 80, min: 105, max: 110, mean: 107.5, median: 107.5,
    stdDev: 1.5, dropped: 0,
  };
  const r = statsDelta(a, b);
  assert.equal(r.meanΔ, -2.5);
  assert.equal(r.stdDevΔ, 1);
  assert.equal(r.maxΔ, 0);
  assert.equal(r.countΔ, 20);
});

test("statsDelta — returns null when either side empty", () => {
  const a = {
    n: 0, min: NaN, max: NaN, mean: NaN, median: NaN,
    stdDev: NaN, dropped: 0,
  };
  const b = {
    n: 5, min: 1, max: 5, mean: 3, median: 3, stdDev: 1, dropped: 0,
  };
  assert.equal(statsDelta(a, b), null);
  assert.equal(statsDelta(b, a), null);
});

test("statsDelta — zero deltas when both sides identical", () => {
  const a = {
    n: 10, min: 100, max: 110, mean: 105, median: 105,
    stdDev: 3, dropped: 0,
  };
  const b = {
    n: 10, min: 100, max: 110, mean: 105, median: 105,
    stdDev: 3, dropped: 0,
  };
  const r = statsDelta(a, b);
  assert.equal(r.meanΔ, 0);
  assert.equal(r.stdDevΔ, 0);
  assert.equal(r.maxΔ, 0);
  assert.equal(r.countΔ, 0);
});

// ---- integration: realistic before/after tune scenario ------------------

test("realistic: before/after tune — fuel trim improvement", () => {
  // Before: STFT hovers around +8% (vacuum leak symptom).
  // After fix: hovers around +1%.
  // Diff should show a negative meanΔ of ~ -7 (improvement).
  const before = [];
  for (let i = 0; i < 100; i++) before.push({ x: i, y: 7.5 + Math.sin(i / 7) * 1.2 });
  const after = [];
  for (let i = 0; i < 100; i++) after.push({ x: i, y: 1.0 + Math.cos(i / 5) * 0.5 });
  const r = diffSeries(before, after);
  const rDelta = statsDelta(r.statsA, r.statsB);
  assert.ok(rDelta.meanΔ > 5, `meanΔ should be positive (before > after); got ${rDelta.meanΔ.toFixed(3)}`);
  assert.equal(r.paired, 100);
  assert.equal(r.unequal, 0);
});
