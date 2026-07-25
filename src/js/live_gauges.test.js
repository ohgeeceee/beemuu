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

function harness() {
  const canvases = new Map(GAUGE_DEFINITIONS.map((definition) => [definition.key, { id: definition.key }]));
  let timerCallback = null;
  let cleared = null;
  const status = { textContent: "", classList: { toggle() {} } };
  const button = { textContent: "" };
  const controller = createLiveGaugesController({
    GaugeCtor: FakeGauge,
    canvasFor: (key) => canvases.get(key),
    status,
    button,
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
