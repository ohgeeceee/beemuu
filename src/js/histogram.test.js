"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { histogram } = require("../../src/js/histogram.js");

function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

test("empty input returns empty bins and NaN stats", () => {
  const r = histogram([]);
  assert.deepEqual(r.binEdges, []);
  assert.deepEqual(r.counts, []);
  assert.equal(r.stats.n, 0);
  assert.equal(r.dropped, 0);
  assert.ok(Number.isNaN(r.stats.mean));
  assert.ok(Number.isNaN(r.stats.median));
});

test("all-non-finite input is treated as empty", () => {
  const r = histogram([NaN, Infinity, -Infinity, undefined, null, "x"]);
  assert.equal(r.stats.n, 0);
  assert.equal(r.dropped, 6);
});

test("single value lands in one bin", () => {
  const r = histogram([42]);
  assert.equal(r.counts.length, 20);
  // All values equal → one bin holds all of them.
  assert.equal(r.counts.reduce((s, c) => s + c, 0), 1);
  assert.equal(r.binEdges[0], 42);
  assert.equal(r.binEdges[20], 42);
  assert.equal(r.stats.min, 42);
  assert.equal(r.stats.max, 42);
  assert.equal(r.stats.mean, 42);
  assert.equal(r.stats.median, 42);
  assert.equal(r.stats.stdDev, 0);
  assert.equal(r.dropped, 0);
});

test("stats are correct on a simple sequence 1..5", () => {
  const r = histogram([1, 2, 3, 4, 5]);
  assert.equal(r.stats.n, 5);
  assert.equal(r.stats.min, 1);
  assert.equal(r.stats.max, 5);
  assert.equal(r.stats.mean, 3);
  assert.equal(r.stats.median, 3);
  // sqrt((1+1+1+1+1)/5) = sqrt(2)
  assert.ok(approx(r.stats.stdDev, Math.sqrt(2)));
});

test("median of an even-length array is the average of the two middle values", () => {
  const r = histogram([1, 2, 3, 4]);
  assert.equal(r.stats.median, 2.5);
});

test("max value falls in the last bin even with floating-point drift", () => {
  // 0..1 in 5 bins → edges at 0, 0.2, 0.4, 0.6, 0.8, 1.0
  const r = histogram([0, 0.25, 0.5, 0.75, 1.0], 5);
  assert.equal(r.counts.length, 5);
  // Last bin must include the 1.0 sample
  assert.ok(r.counts[4] >= 1, "max value 1.0 should land in the last bin");
  // Sum of counts equals n
  assert.equal(r.counts.reduce((s, c) => s + c, 0), 5);
});

test("NaN and undefined entries are dropped, finite entries are kept", () => {
  const r = histogram([1, NaN, 2, undefined, 3, Infinity, 4]);
  assert.equal(r.stats.n, 4);
  assert.equal(r.dropped, 3);
  assert.equal(r.stats.min, 1);
  assert.equal(r.stats.max, 4);
});

test("input array is not mutated", () => {
  const input = [3, 1, 4, 1, 5, 9, 2, 6];
  const snapshot = [...input];
  histogram(input);
  assert.deepEqual(input, snapshot);
});

test("binCount is clamped to [1, 200]", () => {
  // 0 → 1 bin
  const r0 = histogram([1, 2, 3], 0);
  assert.equal(r0.counts.length, 1);
  assert.equal(r0.counts[0], 3);
  // negative → 1 bin
  const rNeg = histogram([1, 2, 3], -5);
  assert.equal(rNeg.counts.length, 1);
  // huge → 200 bins
  const rBig = histogram([1, 2, 3], 100000);
  assert.equal(rBig.counts.length, 200);
  // non-integer → floored
  const rFloat = histogram([1, 2, 3], 7.9);
  assert.equal(rFloat.counts.length, 7);
  // NaN → 1 bin (Math.floor(NaN) is NaN, then `|| 1` kicks in)
  const rNaN = histogram([1, 2, 3], NaN);
  assert.equal(rNaN.counts.length, 1);
});

test("counts always sum to n when input has only finite values", () => {
  const r = histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4);
  assert.equal(r.counts.reduce((s, c) => s + c, 0), 10);
});

test("binEdges has one more entry than counts", () => {
  const r = histogram([1, 2, 3, 4, 5], 7);
  assert.equal(r.binEdges.length, r.counts.length + 1);
});

test("all-identical values put every count in the first bin", () => {
  const r = histogram([7, 7, 7, 7, 7]);
  assert.equal(r.counts.length, 20);
  // With range=0, only counts[0] is filled (range === 0 branch).
  assert.equal(r.counts[0], 5);
  for (let i = 1; i < r.counts.length; i++) {
    assert.equal(r.counts[i], 0);
  }
});

test("typical log distribution — boost pressure 80 samples", () => {
  // Simulate a session where boost hovers around 150 kPa with
  // occasional spikes up to 220 kPa. Tuner wants to see the spike
  // tail clearly in the histogram.
  const values = [];
  for (let i = 0; i < 70; i++) values.push(140 + Math.random() * 20); // 140..160
  for (let i = 0; i < 8; i++) values.push(180 + Math.random() * 20);  // 180..200
  for (let i = 0; i < 2; i++) values.push(210 + Math.random() * 10);  // 210..220
  const r = histogram(values, 20);
  assert.equal(r.stats.n, 80);
  assert.ok(r.stats.min >= 140 && r.stats.min <= 145);
  assert.ok(r.stats.max >= 210 && r.stats.max <= 220);
  // The bin containing the spike tail (last few bins) must have
  // non-zero counts.
  const tail = r.counts.slice(-3).reduce((s, c) => s + c, 0);
  assert.ok(tail >= 2, "spike tail should populate the last few bins");
});
