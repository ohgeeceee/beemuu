"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { createDIDBridge } = require("./live_data_bridge.js");
const { createKdcanSource } = require("./live_kdcan_source.js");

describe("createKdcanSource", () => {
  it("exports createKdcanSource function", () => {
    assert.strictEqual(typeof createKdcanSource, "function");
  });

  it("has start, stop, latestValues, framesPerSecond methods", () => {
    const bridge = createDIDBridge();
    const source = createKdcanSource(bridge);
    assert.strictEqual(typeof source.start, "function");
    assert.strictEqual(typeof source.stop, "function");
    assert.strictEqual(typeof source.latestValues, "function");
    assert.strictEqual(typeof source.framesPerSecond, "function");
    assert.strictEqual(typeof source.applySweepFromTauri, "function");
    assert.strictEqual(typeof source.resetPeaks, "function");
  });

  it("starts stopped", () => {
    const bridge = createDIDBridge();
    const source = createKdcanSource(bridge);
    // Not running yet.
    const values = source.latestValues();
    assert.deepStrictEqual(values, {});
  });

  it("applies sweeps only when running", () => {
    const bridge = createDIDBridge();
    const source = createKdcanSource(bridge);
    const values = [
      { id: "rpm", label: "RPM", unit: "rpm", value: 750, min: 0, max: 8000 },
    ];
    // Apply while stopped — should be ignored.
    source.applySweepFromTauri(values, []);
    assert.deepStrictEqual(source.latestValues(), {});

    // Start and apply — should cache.
    source.start();
    source.applySweepFromTauri(values, []);
    const cached = source.latestValues();
    assert.strictEqual(cached.rpm, 750);
  });

  it.skip("tracks framesPerSecond over 1-second window", async () => {
    const bridge = createDIDBridge();
    const source = createKdcanSource(bridge, { targetFps: 10 });
    source.start();

    // Apply 5 sweeps rapidly.
    for (let i = 0; i < 5; i++) {
      source.applySweepFromTauri([
        { id: "rpm", label: "RPM", unit: "rpm", value: 750 + i * 100, min: 0, max: 8000 },
      ], []);
    }

    // Wait for the 1-second FPS window to roll.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const fps = source.framesPerSecond();
    // FPS should be ~5 (the 5 sweeps in the last second).
    // Allow for timing jitter.
    assert.ok(fps >= 3 && fps <= 10, `Expected FPS ~5, got ${fps}`);
    source.stop();
  });

  it("stops and resets FPS", () => {
    const bridge = createDIDBridge();
    const source = createKdcanSource(bridge);
    source.start();
    source.applySweepFromTauri([
      { id: "rpm", label: "RPM", unit: "rpm", value: 750, min: 0, max: 8000 },
    ], []);
    assert.strictEqual(source.framesPerSecond() >= 0, true);
    source.stop();
    assert.strictEqual(source.framesPerSecond(), 0);
  });

  it("resets bridge peaks on resetPeaks()", () => {
    const bridge = createDIDBridge();
    const source = createKdcanSource(bridge);
    source.start();
    source.applySweepFromTauri([
      { id: "rpm", label: "RPM", unit: "rpm", value: 3200, min: 0, max: 8000 },
    ], []);
    assert.strictEqual(bridge.peakFor("rpm"), 3200);
    source.resetPeaks();
    assert.strictEqual(bridge.peakFor("rpm"), undefined);
  });
});
