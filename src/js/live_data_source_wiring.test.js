"use strict";

const { describe, it, after } = require("node:test");
const assert = require("node:assert");

// v0.15.0 slice 2c — tests for the K+DCAN data source wiring module.
//
// The wiring module is a passive consumer: it transforms
// LiveSweepResult arrays into bridge cache updates. main.js owns the
// timer (via read_live_data polling) and feeds each sweep to
// applySweep(). The module does not spawn its own setInterval.
//
// The factory reads from window.beeemuuDIDBridge /
// window.beeemuuKdcanSource. For tests we stage those globals so the
// factory's `const { createDIDBridge } = window.beeemuuDIDBridge || {}`
// resolves to real factories. The factory closes over `window` at call
// time, so we re-stage globals before each init.

const bridgeModule = require("./live_data_bridge.js");
const kdcanModule = require("./live_kdcan_source.js");

function stageGlobals() {
  global.window = {
    beeemuuDIDBridge: bridgeModule,
    beeemuuKdcanSource: kdcanModule,
  };
}

function stageEmptyWindow() {
  global.window = {};
}

function clearGlobals() {
  delete global.window;
}

function loadWiringFresh() {
  delete require.cache[require.resolve("./live_data_source_wiring.js")];
  return require("./live_data_source_wiring.js");
}

// Tests that call ctrl.start() create a 1-second FPS-tracking
// setInterval via the kdcan source. node --test keeps the event loop
// alive while any setInterval is pending (Windows teardown hang;
// matches the v0.14.0 / v0.14.2 / v0.14.5 live_can_source test
// pattern). Track every started controller and stop them after each
// suite so the runner exits cleanly.
const liveControllers = [];
function track(ctrl) {
  liveControllers.push(ctrl);
  return ctrl;
}
function stopAll() {
  for (const c of liveControllers) {
    try { c.stop(); } catch (_) { /* ignore */ }
  }
  liveControllers.length = 0;
}
after(stopAll);

describe("live_data_source_wiring module surface", () => {
  it("exports initKdcanDataSource, getKdcanSource, getBridge", () => {
    const wiring = require("./live_data_source_wiring.js");
    assert.strictEqual(typeof wiring.initKdcanDataSource, "function");
    assert.strictEqual(typeof wiring.getKdcanSource, "function");
    assert.strictEqual(typeof wiring.getBridge, "function");
  });
});

describe("initKdcanDataSource", () => {
  it("returns a passive controller when bridge modules are not loaded", () => {
    stageEmptyWindow();
    const wiring = loadWiringFresh();
    const ctrl = wiring.initKdcanDataSource({
      invoke: () => Promise.reject(new Error("should not be called")),
      log: () => {},
    });
    assert.strictEqual(typeof ctrl.applySweep, "function");
    assert.strictEqual(typeof ctrl.start, "function");
    assert.strictEqual(typeof ctrl.stop, "function");
    assert.strictEqual(typeof ctrl.reset, "function");
    assert.strictEqual(typeof ctrl.getKdcanSource, "function");
    assert.strictEqual(typeof ctrl.getBridge, "function");
    assert.strictEqual(ctrl.getKdcanSource(), null);
    assert.strictEqual(ctrl.getBridge(), null);
    assert.doesNotThrow(() => ctrl.applySweep([], []));
    assert.doesNotThrow(() => ctrl.start());
    assert.doesNotThrow(() => ctrl.stop());
    assert.doesNotThrow(() => ctrl.reset());
  });

  it("returns a wired controller when bridge modules are loaded", () => {
    stageGlobals();
    const wiring = loadWiringFresh();
    const ctrl = wiring.initKdcanDataSource({
      invoke: () => Promise.resolve({ values: [], errors: [] }),
      log: () => {},
    });
    const kdcanSrc = ctrl.getKdcanSource();
    const bridge = ctrl.getBridge();
    assert.notStrictEqual(kdcanSrc, null);
    assert.notStrictEqual(bridge, null);
    assert.strictEqual(typeof kdcanSrc.start, "function");
    assert.strictEqual(typeof kdcanSrc.stop, "function");
    assert.strictEqual(typeof kdcanSrc.applySweepFromTauri, "function");
    assert.strictEqual(typeof bridge.resetPeaks, "function");
    ctrl.stop();
  });

  it("module-level getKdcanSource / getBridge return the live instances", () => {
    stageGlobals();
    const wiring = loadWiringFresh();
    assert.strictEqual(wiring.getKdcanSource(), null);
    assert.strictEqual(wiring.getBridge(), null);
    const ctrl = wiring.initKdcanDataSource({ invoke: () => {}, log: () => {} });
    assert.strictEqual(wiring.getKdcanSource(), ctrl.getKdcanSource());
    assert.strictEqual(wiring.getBridge(), ctrl.getBridge());
  });
});

describe("applySweep (passive transform)", () => {
  it("feeds the kdcan source's applySweepFromTauri when source is running", () => {
    stageGlobals();
    const wiring = loadWiringFresh();
    const ctrl = track(wiring.initKdcanDataSource({
      invoke: () => {},
      log: () => {},
    }));
    ctrl.start();
    const kdcanSrc = ctrl.getKdcanSource();
    const values = [
      { id: "rpm", label: "RPM", unit: "rpm", value: 1500, min: 0, max: 8000 },
    ];
    const errors = [];
    ctrl.applySweep(values, errors);
    const fresh = kdcanSrc.latestValues();
    assert.strictEqual(fresh.rpm, 1500);
  });

  it("does nothing when source is not running (no error)", () => {
    stageGlobals();
    const wiring = loadWiringFresh();
    const ctrl = wiring.initKdcanDataSource({ invoke: () => {}, log: () => {} });
    assert.doesNotThrow(() =>
      ctrl.applySweep(
        [{ id: "rpm", label: "RPM", unit: "rpm", value: 9999 }],
        []
      )
    );
    const kdcanSrc = ctrl.getKdcanSource();
    assert.deepStrictEqual(kdcanSrc.latestValues(), {});
  });

  it("handles null / undefined values + errors gracefully", () => {
    stageGlobals();
    const wiring = loadWiringFresh();
    const ctrl = track(wiring.initKdcanDataSource({ invoke: () => {}, log: () => {} }));
    ctrl.start();
    assert.doesNotThrow(() => ctrl.applySweep(null, null));
    assert.doesNotThrow(() => ctrl.applySweep(undefined, undefined));
    assert.doesNotThrow(() => ctrl.applySweep([], []));
  });
});

describe("start / stop / reset lifecycle", () => {
  it("start() is idempotent — calls don't stack", () => {
    stageGlobals();
    const wiring = loadWiringFresh();
    const ctrl = track(wiring.initKdcanDataSource({ invoke: () => {}, log: () => {} }));
    ctrl.start();
    ctrl.start();
    ctrl.start();
    // No internal state to assert; the contract is "must not throw".
    ctrl.stop();
  });

  it("stop() is idempotent", () => {
    stageGlobals();
    const wiring = loadWiringFresh();
    const ctrl = wiring.initKdcanDataSource({ invoke: () => {}, log: () => {} });
    assert.doesNotThrow(() => {
      ctrl.stop();
      ctrl.stop();
      ctrl.stop();
    });
  });

  it("reset() stops the source and clears bridge peaks", () => {
    stageGlobals();
    const wiring = loadWiringFresh();
    const ctrl = track(wiring.initKdcanDataSource({ invoke: () => {}, log: () => {} }));
    ctrl.start();
    ctrl.applySweep(
      [{ id: "rpm", label: "RPM", unit: "rpm", value: 5000 }],
      []
    );
    const bridge = ctrl.getBridge();
    assert.strictEqual(bridge.peakFor("rpm"), 5000);
    ctrl.reset();
    assert.strictEqual(bridge.peakFor("rpm"), undefined);
  });
});