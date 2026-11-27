"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_STALE_MS,
  STATUS,
  createTracker,
} = require("./live_freshness.js");

// Deterministic clock: tests advance it by assigning t.ms.
function clock(start) {
  const t = { ms: start };
  return { t, now: () => t.ms };
}

test("a fresh value reports live and renders no label text", () => {
  const { t, now } = clock(1000);
  const tr = createTracker({ now, staleMs: 5000 });
  tr.noteValue("rpm");
  assert.equal(tr.status("rpm"), STATUS.LIVE);
  assert.deepEqual(tr.label("rpm"), { status: STATUS.LIVE, text: "" });
  t.ms += 5000;
  assert.equal(tr.status("rpm"), STATUS.LIVE, "exactly at the threshold is still live");
});

test("a channel goes stale once its age passes the threshold", () => {
  const { t, now } = clock(0);
  const tr = createTracker({ now, staleMs: 5000 });
  tr.noteValue("coolant");
  t.ms += 5001;
  assert.equal(tr.status("coolant"), STATUS.STALE);
  assert.equal(tr.label("coolant").text, "stale — last read 5 s ago");
});

test("an explicit parameter error marks the channel stale immediately", () => {
  const { t, now } = clock(0);
  const tr = createTracker({ now, staleMs: 5000 });
  tr.noteValue("oil");
  t.ms += 100;
  tr.noteError("oil");
  assert.equal(tr.status("oil"), STATUS.STALE, "error newer than the value wins");
});

test("an error on a never-read channel reports stale, not waiting", () => {
  const tr = createTracker({ now: () => 0, staleMs: 5000 });
  tr.noteError("boost");
  assert.equal(tr.status("boost"), STATUS.STALE);
  assert.equal(tr.label("boost").text, "stale — read rejected");
});

test("a value newer than the error clears the stale state", () => {
  const { t, now } = clock(0);
  const tr = createTracker({ now, staleMs: 5000 });
  tr.noteValue("lambda");
  t.ms += 100;
  tr.noteError("lambda");
  assert.equal(tr.status("lambda"), STATUS.STALE);
  t.ms += 100;
  tr.noteValue("lambda");
  assert.equal(tr.status("lambda"), STATUS.LIVE);
});

test("a channel that never answered reports waiting", () => {
  const tr = createTracker({ now: () => 0, staleMs: 5000 });
  assert.equal(tr.status("spark"), STATUS.WAITING);
  assert.equal(tr.label("spark").text, "waiting for first read");
});

test("stop() reports stopped for every channel until a value arrives", () => {
  const { t, now } = clock(0);
  const tr = createTracker({ now, staleMs: 5000 });
  tr.noteValue("rpm");
  tr.stop();
  assert.equal(tr.status("rpm"), STATUS.STOPPED);
  assert.equal(tr.status("never-seen"), STATUS.STOPPED);
  assert.equal(tr.label("rpm").text, "polling stopped");
  t.ms += 100;
  tr.noteValue("rpm");
  assert.equal(tr.status("rpm"), STATUS.LIVE, "a fresh value means the loop is alive again");
});

test("reset() forgets all channels and clears the stopped flag", () => {
  const tr = createTracker({ now: () => 0, staleMs: 5000 });
  tr.noteValue("rpm");
  tr.stop();
  tr.reset();
  assert.equal(tr.status("rpm"), STATUS.WAITING);
});

test("staleMs defaults to the 5 s Live Gauges threshold", () => {
  assert.equal(DEFAULT_STALE_MS, 5000);
  const { t, now } = clock(0);
  const tr = createTracker({ now });
  tr.noteValue("rpm");
  t.ms += DEFAULT_STALE_MS + 1;
  assert.equal(tr.status("rpm"), STATUS.STALE);
});

test("staleMs of zero disables age-based staleness but not error staleness", () => {
  const { t, now } = clock(0);
  const tr = createTracker({ now, staleMs: 0 });
  tr.noteValue("rpm");
  t.ms += 60 * 60 * 1000;
  assert.equal(tr.status("rpm"), STATUS.LIVE, "no age threshold configured");
  tr.noteError("rpm");
  assert.equal(tr.status("rpm"), STATUS.STALE, "explicit errors still mark stale");
});

test("channels track independently", () => {
  const { t, now } = clock(0);
  const tr = createTracker({ now, staleMs: 5000 });
  tr.noteValue("rpm");
  t.ms += 4000;
  tr.noteValue("coolant");
  t.ms += 2000;
  assert.equal(tr.status("rpm"), STATUS.STALE);
  assert.equal(tr.status("coolant"), STATUS.LIVE);
});
