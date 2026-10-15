"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const d = require("../drive_cycle.js");

/* Build a {x, y} trace on a grid. */
function pts(ys, dt = 1, x0 = 0) {
  return ys.map((y, i) => ({ x: x0 + i * dt, y }));
}

/* Build merged cycle points the way segment() builds them. */
function cyc(rpms, coolants, dt = 1) {
  return rpms.map((r, i) => ({ x: i * dt, rpm: r, coolant: coolants ? coolants[i] : null }));
}

/* Twelve non-idling running samples, rpm from 900 (the idle boundary) upward. */
const RUNNING = [900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000];

const rpmSeries = ys => ({ rpm: { data: pts(ys), unit: "rpm" } });

/* ------------------------------------------------------------------ *
 * thresholds
 * ------------------------------------------------------------------ */

test("the exported thresholds are the ones the engine actually acts on", () => {
  assert.equal(d.MIN_SAMPLES, 8);
  assert.equal(d.STOP_HOLD_S, 3);
  assert.equal(d.ENGINE_START_RPM, 500);
  assert.equal(d.IDLE_RPM, 900);
  assert.equal(d.WARM_TARGET_C, 90);
  assert.equal(d.COLD_START_C, 60);
  assert.equal(d.LONG_IDLE_RATIO, 0.4);
  assert.equal(d.SLOW_WARMUP_S, 300);
});

/* ------------------------------------------------------------------ *
 * detectEngineStarts
 * ------------------------------------------------------------------ */

test("detectEngineStarts finds the rise from a dead engine to a running one", () => {
  const starts = d.detectEngineStarts(pts([0, 0, 0, 800, 1200, 1300]));
  assert.equal(starts.length, 1);
  assert.equal(starts[0].at_s, 3);
  assert.equal(starts[0].rpm, 800);
});

test("detectEngineStarts finds every start in a two-cycle log", () => {
  const starts = d.detectEngineStarts(pts([0, 0, 800, 900, 0, 0, 700, 900]));
  assert.equal(starts.length, 2);
  assert.equal(starts[0].at_s, 2);
  assert.equal(starts[1].at_s, 6);
});

test("detectEngineStarts returns nothing for a trace that never runs", () => {
  assert.deepEqual(d.detectEngineStarts(pts(Array(10).fill(0))), []);
});

test("detectEngineStarts tolerates a hole without inventing a start", () => {
  const starts = d.detectEngineStarts(pts([0, 0, NaN, 800]));
  assert.equal(starts.length, 1);
  assert.equal(starts[0].at_s, 3);
});

/* ------------------------------------------------------------------ *
 * segment
 * ------------------------------------------------------------------ */

test("segment finds one cycle between an engine start and a shutdown", () => {
  const r = d.segment(rpmSeries([0, 0, ...RUNNING, 0, 0, 0, 0]));
  assert.equal(r.cycles.length, 1);
  assert.equal(r.cycles[0].index, 0);
  assert.equal(r.cycles[0].start_s, 2);
  assert.equal(r.cycles[0].end_s, 13);
  assert.equal(r.cycles[0].duration_s, 11);
  assert.equal(r.cycles[0].open, false);
  assert.equal(r.cycles[0].points.length, 12);
});

test("segment finds several cycles in one log", () => {
  const r = d.segment(rpmSeries([0, 0, ...RUNNING, 0, 0, 0, 0, 0, 0, ...RUNNING, 0, 0, 0, 0]));
  assert.equal(r.cycles.length, 2);
  assert.equal(r.cycles[0].start_s, 2);
  assert.equal(r.cycles[0].end_s, 13);
  assert.equal(r.cycles[1].start_s, 20);
  assert.equal(r.cycles[1].end_s, 31);
});

test("segment marks a cycle that never shuts off as open", () => {
  const r = d.segment(rpmSeries([0, 0, ...RUNNING]));
  assert.equal(r.cycles.length, 1);
  assert.equal(r.cycles[0].open, true);
  assert.equal(r.cycles[0].end_s, 13);
});

test("segment keeps a cycle open until the trailer idle reaches STOP_HOLD_S", () => {
  const short = d.segment(rpmSeries([0, 0, ...RUNNING, 0, 0, 0]));
  assert.equal(short.cycles[0].open, true);
  const long = d.segment(rpmSeries([0, 0, ...RUNNING, 0, 0, 0, 0]));
  assert.equal(long.cycles[0].open, false);
});

test("segment reports a logging gap in the rpm trace", () => {
  const p = pts([0, 0, ...RUNNING, 0, 0, 0, 0]);
  // Shift the tail 12s forward so the cadence-1s trace opens a 13s hole at x=7.
  for (let i = 8; i < p.length; i++) p[i] = { x: p[i].x + 12, y: p[i].y };
  const r = d.segment({ rpm: { data: p } });
  assert.equal(r.gaps.length, 1);
  assert.equal(r.gaps[0].at_s, 7);
  assert.equal(r.gaps[0].dt, 13);
  assert.equal(r.cycles.length, 1);
});

test("segment carries the coolant trace onto each cycle point", () => {
  const ys = [0, 0, ...RUNNING, 0, 0, 0, 0];
  const series = { rpm: { data: pts(ys) }, coolant: { data: pts(ys.map((_, i) => 20 + i)) } };
  const r = d.segment(series);
  assert.equal(r.cycles[0].points[0].x, 2);
  assert.equal(r.cycles[0].points[0].rpm, 900);
  assert.equal(r.cycles[0].points[0].coolant, 22);
});

test("segment refuses without an rpm channel", () => {
  const r = d.segment({ coolant: { data: pts(RUNNING) } });
  assert.deepEqual(r.cycles, []);
  assert.match(r.reason, /no rpm channel/);
});

test("segment refuses when there are too few rpm samples for a verdict", () => {
  const r = d.segment(rpmSeries([1, 2]));
  assert.deepEqual(r.cycles, []);
  assert.match(r.reason, /too few to judge/);
});

test("segment refuses when the engine never starts", () => {
  const r = d.segment(rpmSeries(Array(10).fill(0)));
  assert.deepEqual(r.cycles, []);
  assert.match(r.reason, /no engine-start marker/);
});

test("segment honours a custom rpm channel name", () => {
  const series = { engine_speed: { data: pts([0, 0, ...RUNNING, 0, 0, 0, 0]) } };
  assert.equal(d.segment(series, { rpmChannel: "engine_speed" }).cycles.length, 1);
  assert.equal(d.segment(series).cycles.length, 0);
});

/* ------------------------------------------------------------------ *
 * warmUpSeconds
 * ------------------------------------------------------------------ */

test("warmUpSeconds measures from the cycle start, and is 0 when already warm", () => {
  assert.equal(d.warmUpSeconds(pts([20, 40, 60, 80, 90, 100])), 4);
  assert.equal(d.warmUpSeconds(pts([95, 96, 97])), 0);
});

test("warmUpSeconds returns null when the coolant never reaches the target", () => {
  assert.equal(d.warmUpSeconds(pts([20, 30, 40, 50, 60])), null);
});

test("warmUpSeconds honours a custom target", () => {
  assert.equal(d.warmUpSeconds(pts([20, 40, 60, 80, 90]), { warmTargetC: 80 }), 3);
});

test("warmUpSeconds returns null for empty and junk input", () => {
  assert.equal(d.warmUpSeconds([]), null);
  assert.equal(d.warmUpSeconds(null), null);
});

/* ------------------------------------------------------------------ *
 * idleRatio
 * ------------------------------------------------------------------ */

test("idleRatio is 1 for a fully idling cycle and 0 for a busy one", () => {
  assert.equal(d.idleRatio(cyc([0, 200, 600, 899], [])), 1);
  assert.equal(d.idleRatio(cyc([1200, 1500, 2000], [])), 0);
});

test("idleRatio counts the IDLE_RPM boundary as not idling, and nothing as 0", () => {
  assert.equal(d.idleRatio(cyc([900, 899, 901], [])), 1 / 3);
  assert.equal(d.idleRatio([]), 0);
});

/* ------------------------------------------------------------------ *
 * classify
 * ------------------------------------------------------------------ */

test("classify grades a warm, busy cycle ok with a perfect score", () => {
  const c = d.classify({ points: cyc(Array(12).fill(1200), Array(12).fill(90)) });
  assert.equal(c.cold_start, false);
  assert.equal(c.warm_up_s, 0);
  assert.equal(c.idle_ratio, 0);
  assert.equal(c.avg_rpm, 1200);
  assert.equal(c.max_rpm, 1200);
  assert.equal(c.verdict, "ok");
  assert.equal(c.score, 100);
  assert.deepEqual(c.evidence, []);
});

test("classify flags a cold start whose coolant never warms", () => {
  const c = d.classify({ points: cyc(Array(12).fill(700), Array(12).fill(20)) });
  assert.equal(c.cold_start, true);
  assert.equal(c.warm_up_s, null);
  assert.equal(c.idle_ratio, 1);
  assert.equal(c.verdict, "bad");
  assert.equal(c.score, 40);
  assert.match(c.evidence[0], /never reached/);
});

test("classify penalises a cold start that warms up too slowly", () => {
  const c = d.classify({
    points: cyc(Array(10).fill(1200), [20, 40, 60, 80, 90, 95, 96, 97, 98, 99], 100),
  });
  assert.equal(c.warm_up_s, 400);
  assert.equal(c.verdict, "warn");
  assert.equal(c.score, 75);
  assert.match(c.evidence[0], /took 400s/);
});

test("classify penalises a cycle spent mostly idling", () => {
  const c = d.classify({ points: cyc(Array(12).fill(600), Array(12).fill(90)) });
  assert.equal(c.idle_ratio, 1);
  assert.equal(c.score, 80);
  assert.match(c.evidence[0], /idled for 100%/);
});

test("classify refuses a stub cycle with too few samples", () => {
  const c = d.classify({ points: cyc([1200, 1200, 1200], [90, 90, 90]) });
  assert.equal(c.verdict, "unknown");
  assert.equal(c.score, null);
  assert.equal(c.confidence, 0);
  assert.match(c.evidence[0], /too few to judge/);
});

test("classify leaves cold_start unknown when the cycle carries no coolant", () => {
  const c = d.classify({ points: cyc(Array(12).fill(1000), Array(12).fill(null)) });
  assert.equal(c.cold_start, null);
  assert.equal(c.warm_up_s, null);
  assert.equal(c.verdict, "ok");
  assert.equal(c.score, 100);
});

/* ------------------------------------------------------------------ *
 * analyze
 * ------------------------------------------------------------------ */

/* A warm, busy first cycle followed by a cold, idling second one. */
function twoCycleSeries() {
  const rpmYs = [0, 0, ...RUNNING, 0, 0, 0, 0, 0, 0, ...Array(12).fill(700), 0, 0, 0, 0];
  const coolantYs = Array(rpmYs.length).fill(88);
  for (let i = 20; i < coolantYs.length; i++) coolantYs[i] = 20;
  return { rpm: { data: pts(rpmYs), unit: "rpm" }, coolant: { data: pts(coolantYs), unit: "°C" } };
}

test("analyze orders cycles worst first", () => {
  const r = d.analyze(twoCycleSeries());
  assert.equal(r.cycles.length, 2);
  assert.equal(r.cycles[0].index, 1);
  assert.equal(r.cycles[1].index, 0);
  assert.ok(r.cycles[0].score < r.cycles[1].score);
});

test("analyze summarises the cycles it found", () => {
  const r = d.analyze(twoCycleSeries());
  assert.equal(r.summary.n_cycles, 2);
  assert.equal(r.summary.cold_starts, 1);
  assert.equal(r.summary.cold_warmup_concerns, 1);
  assert.equal(r.summary.total_duration_s, 22);
  assert.equal(r.summary.total_idle_s, 11);
  assert.equal(r.summary.verdict, "bad");
  assert.equal(r.summary.score, 40);
  assert.match(r.summary.headline, /2 drive cycles/);
  assert.match(r.summary.headline, /1 cold start/);
});

test("analyze refuses a series with no rpm channel", () => {
  const r = d.analyze({ coolant: { data: pts(RUNNING) } });
  assert.deepEqual(r.cycles, []);
  assert.equal(r.summary.verdict, "no_cycles");
  assert.equal(r.summary.score, null);
  assert.equal(r.summary.confidence, 0);
  assert.match(r.summary.evidence[0], /no rpm channel/);
});

test("analyze refuses when there are too few rpm samples", () => {
  const r = d.analyze(rpmSeries([1, 2]));
  assert.deepEqual(r.cycles, []);
  assert.equal(r.summary.verdict, "no_cycles");
  assert.equal(r.summary.score, null);
  assert.equal(r.summary.confidence, 0);
  assert.match(r.summary.evidence[0], /too few to judge/);
});

test("analyze refuses an all-zero rpm log rather than inventing a cycle", () => {
  const r = d.analyze(rpmSeries(Array(20).fill(0)));
  assert.deepEqual(r.cycles, []);
  assert.equal(r.summary.n_cycles, 0);
  assert.equal(r.summary.score, null);
  assert.equal(r.summary.confidence, 0);
  assert.match(r.summary.evidence[0], /no engine-start marker/);
});

test("analyze tolerates junk series and channels without throwing", () => {
  assert.deepEqual(d.analyze(null).cycles, []);
  assert.equal(d.analyze({}).summary.n_cycles, 0);
  assert.equal(d.analyze({ rpm: { data: null } }).summary.verdict, "no_cycles");
  const nan = d.analyze({ rpm: { data: [null, { x: NaN, y: 1 }, { x: 1, y: Infinity }] } });
  assert.equal(nan.summary.verdict, "no_cycles");
  assert.match(nan.summary.evidence[0], /too few to judge/);
});

test("a healthy cycle scores better than a cold start with long idle", () => {
  const healthy = d.classify({ points: cyc(Array(12).fill(1200), Array(12).fill(90)) });
  const rough = d.classify({ points: cyc(Array(12).fill(700), Array(12).fill(20)) });
  assert.ok(healthy.score > rough.score);
  assert.equal(healthy.verdict, "ok");
  assert.equal(rough.verdict, "bad");
});
