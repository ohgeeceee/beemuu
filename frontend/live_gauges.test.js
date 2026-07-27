"use strict";

// v0.14.0 — parity test: the public-site live_gauges.js simulator
// (frontend/live_gauges.js) MUST produce the same byte patterns
// as the desktop app's simulator (src/js/live_can_source.js). Both
// are JS-side mirrors of the Rust broadcast_frames_at() in
// src-tauri/src/transport/sim.rs. If the Rust scales move, the JS
// mirrors move with it; this test catches drift.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const publicSite = require("./live_gauges.js");
const desktop = require("../src/js/live_can_source.js");

const VEHICLE_SPEED = 50;

test("public-site simulator matches desktop app simulator at t=0", () => {
  const a = publicSite.framesAt(0, VEHICLE_SPEED);
  const b = desktop.framesAt(0, VEHICLE_SPEED);
  assert.equal(a.length, b.length, "frame count mismatch");
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].id, b[i].id, `frame ${i} id mismatch`);
    assert.deepEqual(a[i].data, b[i].data, `frame ${i} (0x${a[i].id.toString(16)}) data mismatch`);
  }
});

test("public-site simulator matches desktop app simulator at t=10000", () => {
  const a = publicSite.framesAt(10_000, VEHICLE_SPEED);
  const b = desktop.framesAt(10_000, VEHICLE_SPEED);
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(a[i].data, b[i].data, `frame ${i} (0x${a[i].id.toString(16)}) data mismatch at t=10000`);
  }
});

test("public-site simulator matches desktop app simulator at t=30000 (steady-state)", () => {
  const a = publicSite.framesAt(30_000, VEHICLE_SPEED);
  const b = desktop.framesAt(30_000, VEHICLE_SPEED);
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(a[i].data, b[i].data, `frame ${i} (0x${a[i].id.toString(16)}) data mismatch at t=30000`);
  }
});

test("public-site decoder mirrors desktop app decoder via shared scale constants", () => {
  // Both decoders are exported under different names; the public-site
  // module exposes only the byte-level functions and the scale
  // constants are inlined in DECODERS. Pin the visible outputs
  // against the Rust simulator's byte layout so the public site
  // can't drift silently.
  const frames = publicSite.framesAt(0, VEHICLE_SPEED);
  const rpmFrame = frames.find((f) => f.id === 0x0AA);
  // bytes 0-1 = (750 * 4) = 3000 = 0x0BB8
  assert.equal(rpmFrame.data[0], 0x0B);
  assert.equal(rpmFrame.data[1], 0xB8);
  // bytes 6 = throttle ~ 12/0.3922 ≈ 30
  assert.ok(rpmFrame.data[6] >= 28 && rpmFrame.data[6] <= 34, `expected throttle byte ~30, got ${rpmFrame.data[6]}`);
  // Decode round-trip — RPM 750 → 750 = 3000 * 0.25
  assert.equal(publicSite.decodeFor(0x0AA, rpmFrame.data).rpm, 750);
});

test("public-site gauge definition list matches the desktop app's six gauges", () => {
  assert.deepEqual(
    publicSite.GAUGE_DEFS.map(({ key, label, unit }) => ({ key, label, unit })),
    [
      { key: "rpm", label: "RPM", unit: "rpm" },
      { key: "coolant", label: "Coolant", unit: "°C" },
      { key: "oilTemp", label: "Oil temp", unit: "°C" },
      { key: "vehicleSpeed", label: "Vehicle speed", unit: "km/h" },
      { key: "batteryVoltage", label: "Battery voltage", unit: "V" },
      { key: "throttle", label: "Throttle", unit: "%" },
    ],
  );
});