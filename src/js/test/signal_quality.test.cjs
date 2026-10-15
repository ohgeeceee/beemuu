"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const q = require("../signal_quality.js");

/* Build points from a list of y values on a unit-second grid. */
function pts(ys, dt = 1, x0 = 0) {
  return ys.map((y, i) => ({ x: x0 + i * dt, y }));
}

/* A healthy rising coolant trace: 20 → 100 °C over 41 reads. */
function healthy() {
  return pts(Array.from({ length: 41 }, (_, i) => 20 + 2 * i));
}

/* ------------------------------------------------------------------ *
 * plumbing
 * ------------------------------------------------------------------ */

test("cleanPoints drops unrepresentable samples instead of clamping them", () => {
  const r = q.cleanPoints([
    { x: 2, y: 20 }, { x: 1, y: 10 }, { x: 1, y: 11 }, { x: 3, y: NaN },
  ]);
  assert.equal(r.dropped, 1);
  assert.deepEqual(r.points, [{ x: 1, y: 11 }, { x: 2, y: 20 }]);
});

test("cleanPoints sorts by x and keeps the last read at a duplicate timestamp", () => {
  const r = q.cleanPoints([{ x: 5, y: 1 }, { x: 1, y: 9 }, { x: 5, y: 7 }]);
  assert.deepEqual(r.points, [{ x: 1, y: 9 }, { x: 5, y: 7 }]);
  assert.equal(r.dropped, 0);
  assert.equal(r.collapsed, 1);
});

test("cleanPoints tolerates null and junk input", () => {
  assert.deepEqual(q.cleanPoints(null).points, []);
  assert.deepEqual(q.cleanPoints([null, {}, { x: 1 }]).points, []);
});

test("seriesEntries accepts a Map and a plain object, and nothing else", () => {
  assert.equal(q.seriesEntries(new Map([["a", {}]])).length, 1);
  assert.equal(q.seriesEntries({ a: {}, b: {} }).length, 2);
  assert.deepEqual(q.seriesEntries(null), []);
  assert.deepEqual(q.seriesEntries(42), []);
});

test("stats reports n, extremes, mean, range and stddev", () => {
  const s = q.stats([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(s.n, 8);
  assert.equal(s.min, 2);
  assert.equal(s.max, 9);
  assert.equal(s.mean, 5);
  assert.equal(s.range, 7);
  assert.equal(s.stddev, 2);
});

test("stats on no values returns nulls, not zeros", () => {
  const s = q.stats([]);
  assert.equal(s.n, 0);
  assert.equal(s.mean, null);
  assert.equal(s.range, null);
});

test("median handles odd, even and empty inputs", () => {
  assert.equal(q.median([1, 2, 3]), 2);
  assert.equal(q.median([1, 2, 3, 4]), 2.5);
  assert.equal(q.median([]), null);
});

/* ------------------------------------------------------------------ *
 * flatline
 * ------------------------------------------------------------------ */

test("flatline finds the longest run of a repeated value", () => {
  const f = q.flatline(pts([1, 2, 2, 2, 2, 5, 5, 5, 9]));
  assert.equal(f.longest_run, 3);
  assert.equal(f.flat_points, 5);
  assert.equal(f.ratio, 5 / 8);
  assert.equal(f.frozen, false);
});

test("flatline calls a wholly constant trace frozen only with enough reads", () => {
  assert.equal(q.flatline(pts([5, 5, 5, 5, 5])).frozen, false); // 5 < MIN_SAMPLES
  const f = q.flatline(pts(Array(10).fill(5)));
  assert.equal(f.frozen, true);
  assert.equal(f.longest_run, 9);
});

test("flatline reports nothing for a live trace", () => {
  const f = q.flatline(healthy());
  assert.equal(f.longest_run, 0);
  assert.equal(f.flat_points, 0);
  assert.equal(f.frozen, false);
});

/* ------------------------------------------------------------------ *
 * dropouts
 * ------------------------------------------------------------------ */

test("dropouts flags a gap wider than the channel's own cadence", () => {
  const d = q.dropouts(pts([1, 2, 3, 4, 5], 1).map((p, i) => (i === 4 ? { x: 10, y: p.y } : p)));
  assert.equal(d.count, 1);
  assert.equal(d.longest_s, 7);
  assert.equal(d.gaps[0].at_s, 3);
  assert.equal(d.median_dt, 1);
});

test("dropouts tolerates an irregular but unbroken cadence", () => {
  assert.equal(q.dropouts(pts([1, 2, 3, 4, 5], 1.2)).count, 0);
  // dt values 2,2,2,14 → median 2 → only the 14 is a gap.
  const d = q.dropouts([{ x: 0, y: 1 }, { x: 2, y: 2 }, { x: 4, y: 3 }, { x: 6, y: 4 }, { x: 20, y: 5 }]);
  assert.equal(d.count, 1);
  assert.equal(d.longest_s, 14);
});

test("dropouts finds nothing in a clean trace, and nulls out on a single point", () => {
  assert.equal(q.dropouts(healthy()).count, 0);
  assert.equal(q.dropouts([{ x: 0, y: 1 }]).median_dt, null);
});

/* ------------------------------------------------------------------ *
 * stepOutliers
 * ------------------------------------------------------------------ */

test("stepOutliers catches a spike in an otherwise flat trace", () => {
  const s = q.stepOutliers(pts([10, 10, 10, 90, 10, 10]));
  assert.equal(s.count, 2); // the up-jump and the down-jump
  assert.equal(s.steps[0].delta, 80);
  assert.equal(s.steps[1].delta, -80);
});

test("stepOutliers does not flag a smooth ramp", () => {
  const s = q.stepOutliers(pts(Array.from({ length: 20 }, (_, i) => i)));
  assert.equal(s.count, 0);
  assert.equal(s.scale, 1);
});

test("stepOutliers does not flag a constant channel", () => {
  const s = q.stepOutliers(pts(Array(10).fill(7)));
  assert.equal(s.count, 0);
  assert.equal(s.scale, 0);
});

/* ------------------------------------------------------------------ *
 * jitter
 * ------------------------------------------------------------------ */

test("jitter is zero on a flat trace and one on a full-range alternation", () => {
  assert.equal(q.jitter(pts(Array(10).fill(3))), 0);
  assert.equal(q.jitter(pts([0, 1, 0, 1, 0, 1])), 1);
});

test("jitter is small on a real sensor sweep", () => {
  assert.ok(q.jitter(healthy()) < 0.05);
});

/* ------------------------------------------------------------------ *
 * scoring
 * ------------------------------------------------------------------ */

test("a clean channel scores 100 with no evidence against it", () => {
  const c = q.analyzeChannel("coolant", healthy());
  assert.equal(c.verdict, "ok");
  assert.equal(c.score, 100);
  assert.deepEqual(c.evidence, []);
});

test("a frozen channel is scored bad and says why", () => {
  const c = q.analyzeChannel("coolant", pts(Array(12).fill(84)));
  assert.equal(c.verdict, "bad");
  assert.equal(c.score, 45);
  assert.match(c.evidence[0], /never changes/);
});

test("verdictFor maps the bands", () => {
  assert.equal(q.verdictFor(100), "ok");
  assert.equal(q.verdictFor(80), "ok");
  assert.equal(q.verdictFor(79), "warn");
  assert.equal(q.verdictFor(50), "warn");
  assert.equal(q.verdictFor(49), "bad");
});

test("a channel with dropouts scores below a clean one but stays usable", () => {
  const y = Array.from({ length: 10 }, (_, i) => 20 + 2 * i);
  const p = pts(y);
  p[8] = { x: 20, y: p[8].y }; // a 13-second hole
  const c = q.analyzeChannel("lambda", p);
  assert.equal(c.dropouts.count, 1);
  assert.equal(c.verdict, "warn");
  assert.ok(c.score < 100);
  assert.match(c.evidence.join(" "), /dropout/);
});

/* ------------------------------------------------------------------ *
 * refusals
 * ------------------------------------------------------------------ */

test("too few samples yields unknown, a null score and zero confidence", () => {
  const c = q.analyzeChannel("rpm", pts([1, 2, 3]));
  assert.equal(c.verdict, "unknown");
  assert.equal(c.score, null);
  assert.equal(c.confidence, 0);
  assert.match(c.evidence[0], /too few to judge/);
});

test("confidence falls when a channel is mostly padding", () => {
  const live = q.analyzeChannel("live", healthy());
  const flat = q.analyzeChannel("flat", pts(Array(41).fill(5)));
  assert.ok(live.confidence > flat.confidence);
});

/* ------------------------------------------------------------------ *
 * analyze
 * ------------------------------------------------------------------ */

test("analyze orders channels worst first and summarises the session", () => {
  const series = new Map([
    ["coolant", { data: healthy() }],
    ["boost", { data: pts(Array(10).fill(0)) }], // frozen
  ]);
  const r = q.analyze(series);
  assert.equal(r.channels[0].name, "boost");
  assert.equal(r.summary.bad, 1);
  assert.equal(r.summary.ok, 1);
  assert.equal(r.summary.headline, "1 channel untrustworthy");
  assert.equal(r.summary.is_trustworthy, false);
});

test("analyze accepts a plain object and carries the channel unit through", () => {
  const r = q.analyze({ coolant: { data: healthy(), unit: "°C" } });
  assert.equal(r.channels[0].unit, "°C");
  assert.equal(r.channels[0].name, "coolant");
});

test("analyze counts unjudgeable channels as unknown", () => {
  const r = q.analyze({ a: { data: healthy() }, b: { data: pts([1, 2]) } });
  assert.equal(r.summary.unknown, 1);
  assert.equal(r.summary.ok, 1);
});

test("analyze tolerates junk series without throwing", () => {
  assert.deepEqual(q.analyze(null).channels, []);
  assert.equal(q.analyze({}).summary.channels, 0);
  assert.equal(q.analyze({ junk: null }).summary.unknown, 1);
});

test("analyze reports span and median sample interval", () => {
  const r = q.analyze({ coolant: { data: healthy() } });
  assert.equal(r.channels[0].span_s, 40);
  assert.equal(r.channels[0].median_dt, 1);
});
