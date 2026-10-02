"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const cs = require("../cold_start.js");

const S = 1000;
const MIN = 60 * S;
const T0 = 0;

/* Drive a monitor through a list of [seconds, running, coolant] observations. */
function run(monitor, script) {
  const out = [];
  for (const [s, running, coolant] of script) {
    out.push(monitor.tick({ t: T0 + s * S, running, coolant }));
  }
  return out;
}

function actions(results) {
  return results.map(r => r.action).filter(a => a !== cs.ACTIONS.none);
}

test("a cold engine left off arms, and the start opens a capture", () => {
  const m = cs.createMonitor();
  const r = run(m, [
    [0, false, 12],      // key on, engine off, stone cold
    [90, false, 12],     // off long enough to count as cold and settled
    [120, true, 12],     // driver turns the key
    [130, true, 14],
  ]);
  assert.deepEqual(actions(r), [cs.ACTIONS.armed, cs.ACTIONS.start]);
  assert.equal(r[1].action, cs.ACTIONS.armed);
  assert.match(r[1].reason, /off and cold for 90s/);
  assert.equal(r[2].last_start_temp, 12);
  assert.equal(m.captureCount(), 1);
});

test("a warm engine left off never arms", () => {
  // Arming on a warm engine would promise a cold-start capture the car is not
  // going to produce, and the log would be a lie about what happened.
  const m = cs.createMonitor();
  const r = run(m, [
    [0, false, 85],
    [300, false, 85],
    [310, true, 85],
    [400, true, 88],
  ]);
  assert.deepEqual(actions(r), []);
  assert.equal(m.isArmed(), false);
  assert.equal(m.captureCount(), 0);
});

test("a missing coolant reading does not arm either", () => {
  // The dangerous variant: with no temperature, "is this engine cold?" cannot
  // be answered, and defaulting the answer to yes would arm on *every* engine
  // whose DID 0x1008 read failed — which is most of them on an E46. The only
  // safe default is no.
  const m = cs.createMonitor();
  const r = run(m, [
    [0, false, null],
    [300, false, null],
    [310, true, null],
    [400, true, 20],
  ]);
  assert.deepEqual(actions(r), []);
  assert.equal(m.isArmed(), false);
  assert.equal(m.captureCount(), 0);
  assert.match(r[1].reason, /engine off$/);
});

test("a brief stop in traffic does not arm", () => {
  // A stop-start at a junction is the opposite of a cold start. Arming on one
  // would open a capture window labelled "cold start" on a warm engine.
  const m = cs.createMonitor();
  const r = run(m, [
    [0, false, 20],
    [10, false, 20],     // only 10s off: not a cold soak
    [12, true, 20],
    [100, true, 25],
  ]);
  assert.deepEqual(actions(r), []);
  assert.equal(m.captureCount(), 0);
});

test("a cold start with no prior cold observation is not claimed", () => {
  // We were not watching when the engine went cold, so we cannot say we saw a
  // cold start. This is the case that stops a warm idle being logged as one.
  const m = cs.createMonitor();
  const r = run(m, [
    [0, true, 15],       // already running and cold, monitor just attached
    [10, true, 16],
    [200, true, 40],
  ]);
  assert.deepEqual(actions(r), []);
  assert.match(r[0].reason, /not armed/);
  assert.equal(m.captureCount(), 0);
});

test("the capture closes when the engine reaches full temperature", () => {
  const m = cs.createMonitor();
  const r = run(m, [
    [0, false, 12],
    [90, false, 12],
    [100, true, 12],
    [120, true, 30],
    [300, true, 72],     // fully warm: window definitively over
    [310, true, 75],
  ]);
  assert.deepEqual(actions(r), [cs.ACTIONS.armed, cs.ACTIONS.start, cs.ACTIONS.stop]);
  assert.match(r[4].reason, /full temperature/);
  assert.equal(m.isLogging(), false);
  assert.equal(m.isArmed(), false);
});

test("the capture closes on the time limit even while still warming", () => {
  // A cold engine in cold weather may not reach 70C inside five minutes. The
  // interesting part of a cold start is over regardless.
  const m = cs.createMonitor();
  const r = run(m, [
    [0, false, 10],
    [90, false, 10],
    [100, true, 10],
    [200, true, 30],
    [290, true, 55],     // still climbing at 190s...
    [400, true, 62],     // ...and past the 300s window
  ]);
  const stops = r.filter(x => x.action === cs.ACTIONS.stop);
  assert.equal(stops.length, 1);
  assert.match(stops[0].reason, /window of 300s elapsed/);
});

test("a custom window and temperature thresholds are honoured", () => {
  const m = cs.createMonitor({ window_ms: 30 * S, warm_temp: 50, cold_temp: 20 });
  const r = run(m, [
    [0, false, 15],
    [90, false, 15],
    [100, true, 15],
    [125, true, 45],
    [140, true, 55],     // past the custom warm threshold
  ]);
  assert.equal(r[4].action, cs.ACTIONS.stop);
  assert.match(r[4].reason, /full temperature/);
});

test("stopping the engine mid-capture closes it without arming again", () => {
  const m = cs.createMonitor();
  const r = run(m, [
    [0, false, 12],
    [90, false, 12],
    [100, true, 12],
    [200, true, 30],
    [210, false, 30],    // stalled or switched off mid-capture
    [220, false, 30],
  ]);
  const stop = r.find(x => x.action === cs.ACTIONS.stop);
  assert.match(stop.reason, /stopped during capture/);
  assert.equal(m.isLogging(), false);
  // ...and it does not immediately re-arm, because the engine is no longer cold.
  assert.equal(m.isArmed(), false);
});

test("a stall in traffic does not re-arm from the pre-start soak clock", () => {
  // The subtle one: the engine had been off and cold for 90s *before* the
  // start, so the soak clock still holds that old value. If a mid-capture stop
  // does not restart it, the very next sample re-arms instantly and a stall at
  // a junction becomes a log labelled "cold start".
  const m = cs.createMonitor();
  const r = run(m, [
    [0, false, 12],
    [90, false, 12],
    [100, true, 12],     // capture opens
    [200, true, 30],
    [210, false, 30],    // stall
    [215, false, 30],    // 5s later: must NOT re-arm off the stale clock
    [400, false, 30],    // 190s later: a genuine cold soak, so arming is right
  ]);
  const armedAt = r.filter(x => x.action === cs.ACTIONS.armed);
  // The critical assertion: not armed at t=215, only at t=400. A stale soak
  // clock would have armed it at t=215, five seconds after a stall in traffic.
  // `armed_at` is the epoch-ms instant the soak began, so the first arming
  // points at t=0 and the second at t=210s (the stall), not t=400.
  assert.deepEqual(armedAt.map(x => x.armed_at), [0, 210 * S]);
  assert.equal(r[5].action, cs.ACTIONS.none);
  assert.match(r[5].reason, /waiting to settle/);
  assert.deepEqual(actions(r), [cs.ACTIONS.armed, cs.ACTIONS.start, cs.ACTIONS.stop, cs.ACTIONS.armed]);
});

test("a second cold start the next morning is armed fresh", () => {
  // The disarm-on-warm-up matters: without it the monitor would only ever
  // produce one capture in the life of a car.
  const m = cs.createMonitor();
  const day1 = run(m, [
    [0, false, 12], [90, false, 12], [100, true, 12], [300, true, 75],
  ]);
  const day2 = run(m, [
    [86400, false, 11], [86490, false, 11], [86500, true, 11], [86700, true, 74],
  ]);
  assert.deepEqual(actions(day1), [cs.ACTIONS.armed, cs.ACTIONS.start, cs.ACTIONS.stop]);
  assert.deepEqual(actions(day2), [cs.ACTIONS.armed, cs.ACTIONS.start, cs.ACTIONS.stop]);
  assert.equal(m.captureCount(), 2);
});

test("staying running after arming does not re-fire the capture", () => {
  // Once disarmed, further running samples must not re-open the window.
  const m = cs.createMonitor();
  const r = run(m, [
    [0, false, 12], [90, false, 12], [100, true, 12],
    [110, true, 13], [120, true, 14], [130, true, 15],
  ]);
  assert.equal(r.filter(x => x.action === cs.ACTIONS.start).length, 1);
  assert.equal(m.captureCount(), 1);
});

test("a sample with no coolant reading still tracks the run transition", () => {
  // Engine state alone is enough to open the capture once armed; only the
  // arming decision needs a temperature.
  const m = cs.createMonitor();
  const r = run(m, [
    [0, false, 12], [90, false, 12],
    [100, true, null],
    [110, true, null],
  ]);
  assert.equal(r[2].action, cs.ACTIONS.start);
  assert.match(r[2].reason, /coolant unknown/);
  assert.equal(r[2].last_start_temp, null);
});

test("a sample with no timestamp declines to act rather than guessing", () => {
  // The monitor cannot reason about elapsed time without a clock, and a capture
  // window it cannot bound is worse than no capture.
  const m = cs.createMonitor();
  const r = m.tick({ running: true, coolant: 12 });
  assert.equal(r.action, cs.ACTIONS.none);
  assert.match(r.reason, /no timestamp/);
  assert.equal(m.tick({ t: "nope", running: true, coolant: 12 }).action, cs.ACTIONS.none);
  assert.equal(m.tick(null).action, cs.ACTIONS.none);
});

test("reset clears state and capture count is not reset by it", () => {
  // Reset is for aborting a capture; the lifetime count is a session
  // statistic and should survive, so a panel can show "2 captures today"
  // across a manual abort.
  const m = cs.createMonitor();
  run(m, [[0, false, 12], [90, false, 12], [100, true, 12]]);
  assert.equal(m.isLogging(), true);
  m.reset();
  assert.equal(m.isLogging(), false);
  assert.equal(m.isArmed(), false);
  assert.equal(m.captureCount(), 1);
});

test("state and options are exposed for a panel", () => {
  const m = cs.createMonitor({ cold_temp: 30 });
  assert.equal(m.options.cold_temp, 30);
  assert.deepEqual(m.state(), {
    armed: false, logging: false, captures: 0, last_start_temp: null,
  });
});
