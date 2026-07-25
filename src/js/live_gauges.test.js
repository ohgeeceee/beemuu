"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  GAUGE_DEFINITIONS,
  createLiveGaugesController,
} = require("./live_gauges.js");

class FakeGauge {
  constructor(canvas, options) {
    this.canvas = canvas;
    this.options = options;
    this.calls = [];
  }
  set(value) { this.calls.push(value); }
  tick() {}
}

function harness({ source = null } = {}) {
function harness() {
  const canvases = new Map(GAUGE_DEFINITIONS.map((definition) => [definition.key, { id: definition.key }]));
  let timerCallback = null;
  let cleared = null;
  const status = { textContent: "", classList: { toggle() {} } };
  const button = { textContent: "" };
  const onTickCalls = [];
  const controller = createLiveGaugesController({
    GaugeCtor: FakeGauge,
    canvasFor: (key) => canvases.get(key),
    status,
    button,
    source,
    onSourceTick: (latest) => onTickCalls.push(latest),
    setIntervalFn: (callback, delay) => { timerCallback = callback; return { delay }; },
    clearIntervalFn: (timer) => { cleared = timer; },
  });
  return { controller, status, button, timer: () => timerCallback, cleared: () => cleared, onTickCalls };
    setIntervalFn: (callback, delay) => { timerCallback = callback; return { delay }; },
    clearIntervalFn: (timer) => { cleared = timer; },
  });
  return { controller, status, button, timer: () => timerCallback, cleared: () => cleared };
}

test("defines the six planned Live CAN gauges", () => {
  assert.deepEqual(
    GAUGE_DEFINITIONS.map(({ key, label, unit, min, max }) => ({ key, label, unit, min, max })),
    [
      { key: "rpm", label: "RPM", unit: "rpm", min: 0, max: 8000 },
      { key: "coolant", label: "Coolant", unit: "°C", min: -10, max: 130 },
      { key: "oilTemp", label: "Oil temp", unit: "°C", min: -10, max: 150 },
      { key: "vehicleSpeed", label: "Vehicle speed", unit: "km/h", min: 0, max: 250 },
      { key: "batteryVoltage", label: "Battery voltage", unit: "V", min: 10, max: 16 },
      { key: "throttle", label: "Throttle", unit: "%", min: 0, max: 100 },
    ],
  );
});

test("starts off, caches values, and renders every 100 ms only when running", () => {
  const h = harness();
  assert.equal(h.controller.isRunning(), false);
  assert.equal(h.status.textContent, "Off");
  assert.equal(h.button.textContent, "Start CAN listener");

  // Without a source, setValues() is the only way to feed values.
  h.controller.setValues({ rpm: 1500, coolant: 42 });
  assert.deepEqual(h.controller.gauges.rpm.calls, []);
  const timer = h.controller.start();
  assert.equal(timer.delay, 100);
  assert.equal(h.status.textContent, "Listening");
  assert.equal(h.button.textContent, "Stop CAN listener");

  h.timer()();
  assert.deepEqual(h.controller.gauges.rpm.calls, [1500]);
  assert.deepEqual(h.controller.gauges.coolant.calls, [42]);
  assert.deepEqual(h.controller.gauges.oilTemp.calls, []);

  h.controller.stop();
  assert.equal(h.controller.isRunning(), false);
  assert.equal(h.status.textContent, "Off");
  assert.ok(h.cleared());
});

test("ignores unknown and non-finite cached values", () => {
  const h = harness();
  h.controller.setValues({ rpm: NaN, coolant: 91, madeUp: 123 });
  h.controller.start();
  h.timer()();
  assert.deepEqual(h.controller.gauges.rpm.calls, []);
  assert.deepEqual(h.controller.gauges.coolant.calls, [91]);
  assert.equal(h.controller.gauges.madeUp, undefined);
});

// ---------- slice 5: peak tracking ----------

test("peakFor: tracks the highest value seen per gauge since start", () => {
  const h = harness();
  h.controller.start();
  h.controller.setValues({ rpm: 1500 });
  h.timer()();
  h.controller.setValues({ rpm: 3000 });
  h.timer()();
  h.controller.setValues({ rpm: 2500 });
  h.timer()();
  assert.equal(h.controller.peakFor("rpm"), 3000);
  assert.equal(h.controller.peakFor("coolant"), undefined);
});

test("peakFor: resetPeaks clears the per-gauge peaks", () => {
  const h = harness();
  h.controller.start();
  h.controller.setValues({ rpm: 4000 });
  h.timer()();
  assert.equal(h.controller.peakFor("rpm"), 4000);
  h.controller.resetPeaks();
  assert.equal(h.controller.peakFor("rpm"), undefined);
});

// ---------- slice 7: source wiring ----------

test("slice 7: source.latestValues() feeds setValues() on each render tick", () => {
  const source = {
    startCalls: 0,
    stopCalls: 0,
    latestValues: () => ({ rpm: 2200, coolant: 88 }),
  };
  const h = harness({ source });
  source.start = () => { source.startCalls += 1; };
  source.stop = () => { source.stopCalls += 1; };
  h.controller.start();
  assert.equal(source.startCalls, 1);
  h.timer()();
  assert.deepEqual(h.controller.gauges.rpm.calls, [2200]);
  assert.deepEqual(h.controller.gauges.coolant.calls, [88]);
  h.controller.stop();
  assert.equal(source.stopCalls, 1);
});

test("slice 7: onSourceTick is called on each render tick with the latest values", () => {
  const source = { latestValues: () => ({ rpm: 900 }) };
  source.start = () => {};
  source.stop = () => {};
  const h = harness({ source });
  h.controller.start();
  h.timer()();
  h.timer()();
  assert.equal(h.onTickCalls.length, 2);
  assert.deepEqual(h.onTickCalls[0], { rpm: 900 });
});

test("slice 7: framesPerSecond reflects the source's framesPerSecond", () => {
  const source = { framesPerSecond: () => 42.5, latestValues: () => ({}) };
  source.start = () => {};
  source.stop = () => {};
  const h = harness({ source });
  assert.equal(h.controller.framesPerSecond(), 42.5);
});

test("slice 7: no source → framesPerSecond returns 0", () => {
  const h = harness();
  assert.equal(h.controller.framesPerSecond(), 0);
});

test("slice 7: source returning null/undefined doesn't crash the render", () => {
  const source = { latestValues: () => null };
  source.start = () => {};
  source.stop = () => {};
  const h = harness({ source });
  h.controller.start();
  // No throw, no gauges updated.
  h.timer()();
  assert.deepEqual(h.controller.gauges.rpm.calls, []);
});
