"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const { createDIDBridge, GAUGE_KEYS, PARAM_TO_GAUGE } = require("./live_data_bridge.js");

describe("createDIDBridge", () => {
  describe("module exports", () => {
    it("exports createDIDBridge function", () => {
      assert.strictEqual(typeof createDIDBridge, "function");
    });

    it("exports GAUGE_KEYS constant", () => {
      assert.ok(Array.isArray(GAUGE_KEYS));
      assert.strictEqual(GAUGE_KEYS.length, 6);
      assert.ok(GAUGE_KEYS.includes("rpm"));
      assert.ok(GAUGE_KEYS.includes("coolant"));
      assert.ok(GAUGE_KEYS.includes("oilTemp"));
      assert.ok(GAUGE_KEYS.includes("vehicleSpeed"));
      assert.ok(GAUGE_KEYS.includes("batteryVoltage"));
      assert.ok(GAUGE_KEYS.includes("throttle"));
    });

    it("exports PARAM_TO_GAUGE mapping", () => {
      assert.ok(typeof PARAM_TO_GAUGE === "object" && PARAM_TO_GAUGE !== null);
      assert.strictEqual(PARAM_TO_GAUGE.rpm, "rpm");
      assert.strictEqual(PARAM_TO_GAUGE.coolant, "coolant");
      assert.strictEqual(PARAM_TO_GAUGE.oil, "oilTemp");
      assert.strictEqual(PARAM_TO_GAUGE.vehicleSpeed, "vehicleSpeed");
      assert.strictEqual(PARAM_TO_GAUGE.volt, "batteryVoltage");
      assert.strictEqual(PARAM_TO_GAUGE.throttle, "throttle");
    });
  });

  describe("bridge instance", () => {
    let bridge;
    before(() => {
      bridge = createDIDBridge();
    });

    it("has applySweep method", () => {
      assert.strictEqual(typeof bridge.applySweep, "function");
    });

    it("has latestValues method", () => {
      assert.strictEqual(typeof bridge.latestValues, "function");
    });

    it("has peakFor method", () => {
      assert.strictEqual(typeof bridge.peakFor, "function");
    });

    it("has resetPeaks method", () => {
      assert.strictEqual(typeof bridge.resetPeaks, "function");
    });

    it("has lastSweep method", () => {
      assert.strictEqual(typeof bridge.lastSweep, "function");
    });

    it("starts with empty cache", () => {
      const values = bridge.latestValues();
      assert.deepStrictEqual(values, {});
    });

    it("starts with null lastSweep", () => {
      assert.strictEqual(bridge.lastSweep(), null);
    });
  });

  describe("applySweep", () => {
    it("caches numeric values from LiveValue array", () => {
      const bridge = createDIDBridge();
      const values = [
        { id: "rpm", label: "Engine speed", unit: "rpm", value: 750, min: 0, max: 8000 },
        { id: "coolant", label: "Coolant temp", unit: "°C", value: 92, min: -40, max: 150 },
        { id: "oil", label: "Oil temp", unit: "°C", value: 98, min: -40, max: 160 },
      ];
      bridge.applySweep(values, []);
      const cached = bridge.latestValues();
      assert.strictEqual(cached.rpm, 750);
      assert.strictEqual(cached.coolant, 92);
      assert.strictEqual(cached.oilTemp, 98);
    });

    it("ignores non-gauge params (e.g. iat, load)", () => {
      const bridge = createDIDBridge();
      const values = [
        { id: "iat", label: "Intake air temp", unit: "°C", value: 25, min: -40, max: 80 },
        { id: "load", label: "Engine load", unit: "%", value: 45, min: 0, max: 100 },
      ];
      bridge.applySweep(values, []);
      const cached = bridge.latestValues();
      // iat and load are not in PARAM_TO_GAUGE, so they're ignored.
      assert.strictEqual(cached.rpm, undefined);
      assert.strictEqual(Object.keys(cached).length, 0);
    });

    it("ignores enum params (those with text field)", () => {
      const bridge = createDIDBridge();
      const values = [
        { id: "gear", label: "Gear", unit: "", value: 3, min: 0, max: 6, text: "D" },
      ];
      bridge.applySweep(values, []);
      const cached = bridge.latestValues();
      // gear is not a numeric gauge, skipped.
      assert.strictEqual(Object.keys(cached).length, 0);
    });

    it("tracks peaks across sweeps", () => {
      const bridge = createDIDBridge();
      bridge.applySweep([{ id: "rpm", label: "RPM", unit: "rpm", value: 750, min: 0, max: 8000 }], []);
      assert.strictEqual(bridge.peakFor("rpm"), 750);
      bridge.applySweep([{ id: "rpm", label: "RPM", unit: "rpm", value: 3200, min: 0, max: 8000 }], []);
      assert.strictEqual(bridge.peakFor("rpm"), 3200);
      bridge.applySweep([{ id: "rpm", label: "RPM", unit: "rpm", value: 2800, min: 0, max: 8000 }], []);
      assert.strictEqual(bridge.peakFor("rpm"), 3200); // Peak stays at max.
    });

    it("resets peaks on resetPeaks()", () => {
      const bridge = createDIDBridge();
      bridge.applySweep([{ id: "rpm", label: "RPM", unit: "rpm", value: 3200, min: 0, max: 8000 }], []);
      assert.strictEqual(bridge.peakFor("rpm"), 3200);
      bridge.resetPeaks();
      assert.strictEqual(bridge.peakFor("rpm"), undefined);
    });

    it("logs errors but doesn't poison cache", () => {
      const bridge = createDIDBridge();
      const values = [{ id: "rpm", label: "RPM", unit: "rpm", value: 750, min: 0, max: 8000 }];
      const errors = [{ id: "coolant", label: "Coolant", sid: 0x10, nrc: 0x12, error: "NRC 0x12" }];
      bridge.applySweep(values, errors);
      const cached = bridge.latestValues();
      // rpm is cached, coolant error is logged but doesn't affect cache.
      assert.strictEqual(cached.rpm, 750);
      assert.strictEqual(cached.coolant, undefined); // No prior value.
    });

    it("keeps last-known value on error", () => {
      const bridge = createDIDBridge();
      // First sweep: good coolant value.
      bridge.applySweep([{ id: "coolant", label: "Coolant", unit: "°C", value: 92, min: -40, max: 150 }], []);
      assert.strictEqual(bridge.latestValues().coolant, 92);
      // Second sweep: error on coolant.
      bridge.applySweep([], [{ id: "coolant", label: "Coolant", sid: 0x10, nrc: 0x12, error: "NRC 0x12" }]);
      // Coolant keeps its last value.
      assert.strictEqual(bridge.latestValues().coolant, 92);
    });

    it("sets lastSweep timestamp", () => {
      const bridge = createDIDBridge();
      const before = Date.now();
      bridge.applySweep([], []);
      const after = Date.now();
      const ts = bridge.lastSweep();
      assert.ok(ts !== null);
      assert.ok(ts >= before && ts <= after);
    });
  });

  describe("latestValues", () => {
    it("returns only cached gauge keys", () => {
      const bridge = createDIDBridge();
      bridge.applySweep([
        { id: "rpm", label: "RPM", unit: "rpm", value: 750, min: 0, max: 8000 },
        { id: "iat", label: "Intake air temp", unit: "°C", value: 25, min: -40, max: 80 }, // Ignored.
      ], []);
      const cached = bridge.latestValues();
      assert.ok("rpm" in cached);
      assert.ok(!("iat" in cached));
      assert.strictEqual(Object.keys(cached).length, 1);
    });

    it("omits keys without values", () => {
      const bridge = createDIDBridge();
      bridge.applySweep([{ id: "rpm", label: "RPM", unit: "rpm", value: 750, min: 0, max: 8000 }], []);
      const cached = bridge.latestValues();
      assert.ok("rpm" in cached);
      assert.ok(!("coolant" in cached));
      assert.ok(!("oilTemp" in cached));
    });
  });
});
