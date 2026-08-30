"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const src = require("./live_can_source.js");
const decoders = require("./can_decoders.js");

// ---------- frame generator parity with the Rust simulator ----------
// These tests pin the JS-side framesAt() to the same byte patterns
// the Rust broadcast_frames_at() produces (sin/cos here, same
// formulas as src-tauri/src/transport/sim.rs:55-126). If the Rust
// scales move, the JS-side mirror must move with it — the test
// catches drift before it reaches the decoder.

test("framesAt: t=0 produces the expected 6-frame idle pattern", () => {
  const frames = src.framesAt(0, 50);
  assert.equal(frames.length, 6);
  const ids = frames.map((f) => f.id);
  assert.deepEqual(ids, [0x0AA, 0x0CE, 0x1D0, 0x130, 0x545, 0x316]);
  // 0x0AA: rpm ≈ 750 → 750 * 4 = 3000 = 0x0BB8, throttle ~ 12 / 0.3922 ≈ 31
  assert.equal(frames[0].data[0], 0x0B);
  assert.equal(frames[0].data[1], 0xB8);
  assert.ok(frames[0].data[6] >= 28 && frames[0].data[6] <= 34);
  // 0x130: 50 km/h → 50 / 0.5 = 100
  assert.equal(frames[3].data[0], 100);
  // 0x316: battery ≈ 14 V → (14 - 6) / 0.1 = 80
  assert.equal(frames[5].data[0], 80);
});

test("framesAt: t=10000 (10s in) — engine is revving, coolant warming", () => {
  const frames = src.framesAt(10_000, 50);
  const decoded = frames.map((f) => decoders.decodeFor(f.id, f.data));
  // Frame order (mirrors Rust broadcast_frames_at): 0x0AA, 0x0CE, 0x1D0, 0x130, 0x545, 0x316.
  const rpm = decoded[0].rpm; //    0x0AA
  const coolant = decoded[2].coolant; // 0x1D0
  const speed = decoded[3]; //      0x130
  const battery = decoded[5]; //    0x316
  // RPM should be in the band (750, 6750) — the cos/sin cycling.
  assert.ok(rpm > 750 && rpm < 6750, `expected rpm in (750, 6750), got ${rpm}`);
  // Coolant should have warmed up from 20°C; at t=10s it's
  // 20 + 78*(1 - e^-10/90) ≈ 27.5 °C.
  assert.ok(coolant > 25 && coolant < 32, `expected coolant ~ 27.5°C, got ${coolant}`);
  // Vehicle speed stays at 50 km/h.
  assert.equal(speed, 50);
  // Battery oscillates around 14 V — pick a reasonable band.
  assert.ok(battery > 13 && battery < 15, `expected battery ~ 14V, got ${battery}`);
});

test("framesAt: vehicle_speed clamps at 0..127.5", () => {
  const low = src.framesAt(1000, -10);
  const high = src.framesAt(1000, 200);
  assert.equal(decoders.decodeFor(high[3].id, high[3].data), 127.5);
  // 0 km/h → speed_raw = 0
  assert.equal(low[3].data[0], 0);
});

// ---------- simulator source factory ----------

function fakeDecodeFor(id, frame) {
  // A minimal decoder — returns the first byte as `rpm`, etc. Used to
  // confirm the source wires decoded values through without depending
  // on the real decoders.
  if (id === 0x0AA) return { rpm: frame[0] * 10 };
  if (id === 0x1D0) return { coolant: frame[0] };
  return null;
}

function fakeTimers() {
  let timer = null;
  let callback = null;
  let tickMs = 0;
  let nowValue = 0;
  return {
    setIntervalFn: (cb, ms) => { callback = cb; tickMs = ms; timer = { ms }; return timer; },
    clearIntervalFn: (t) => { if (t === timer) { timer = null; callback = null; } },
    tick: () => { if (callback) callback(); nowValue += tickMs; },
    advanceTime: (ms) => { nowValue += ms; },
    isRunning: () => timer !== null,
    now: () => nowValue,
  };
}

test("simulator source: start, emit, stop", () => {
  const timers = fakeTimers();
  const source = src.createSimulatorSource({
    decodeFor: fakeDecodeFor,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    now: timers.now,
    tickIntervalMs: 100,
  });
  assert.equal(source.kind, "sim");
  assert.equal(source.isRunning(), false);
  source.start();
  assert.equal(source.isRunning(), true);
  // 1 tick → 6 frames decoded → 2 known gauge keys (rpm, coolant).
  timers.advanceTime(100);
  timers.tick();
  const values = source.latestValues();
  assert.ok(Number.isFinite(values.rpm));
  assert.ok(Number.isFinite(values.coolant));
  // Throttle / oilTemp / vehicleSpeed / batteryVoltage are not in the
  // fake decoder, so they must NOT pollute the cache.
  assert.equal("throttle" in values, false);
  assert.equal("oilTemp" in values, false);
  source.stop();
  assert.equal(source.isRunning(), false);
});

test("simulator source: ignore unknown and non-finite decoded values", () => {
  const timers = fakeTimers();
  const source = src.createSimulatorSource({
    decodeFor: (id, frame) => ({ rpm: NaN, coolant: 91, madeUp: 42 }),
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    now: timers.now,
    tickIntervalMs: 100,
  });
  source.start();
  timers.advanceTime(100);
  timers.tick();
  const values = source.latestValues();
  assert.equal("rpm" in values, false);
  assert.equal(values.coolant, 91);
  assert.equal("madeUp" in values, false);
});

test("simulator source: framesPerSecond is non-zero after a tick", () => {
  const timers = fakeTimers();
  const source = src.createSimulatorSource({
    decodeFor: fakeDecodeFor,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    now: timers.now,
    tickIntervalMs: 100,
    vehicleSpeedKmh: 50,
  });
  source.start();
  // Six ticks at 100 ms each = 0.6 s elapsed; 6 frames/tick * 6 ticks = 36 frames.
  for (let i = 0; i < 6; i++) {
    timers.advanceTime(100);
    timers.tick();
  }
  const fps = source.framesPerSecond();
  assert.ok(fps > 0, `expected fps > 0, got ${fps}`);
});

// ---------- hardware source (slice 5/6 stub) ----------

test("hardware source: works without invoke (no-op fallback)", () => {
  const timers = fakeTimers();
  const source = src.createHardwareSource({
    decodeFor: fakeDecodeFor,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    invokeFn: null,
    pollIntervalMs: 100,
  });
  assert.equal(source.kind, "hardware");
  source.start();
  timers.advanceTime(100);
  timers.tick();
  // No frames → no values, no errors.
  assert.deepEqual(source.latestValues(), {});
  assert.equal(source.framesPerSecond(), 0);
  assert.equal(source.lastError(), null);
});

test("hardware source: invokes get_latest_can_frames and decodes", async () => {
  const timers = fakeTimers();
  let invokes = 0;
  let lastResolve = null;
  const source = src.createHardwareSource({
    decodeFor: fakeDecodeFor,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    invokeFn: (cmd) => {
      invokes += 1;
      assert.equal(cmd, "get_latest_can_frames");
      return Promise.resolve([
        { id: 0x0AA, data: [0x05, 0, 0, 0, 0, 0, 0, 0] },
        { id: 0x1D0, data: [0x40, 0, 0, 0, 0, 0, 0, 0] },
      ]);
    },
    pollIntervalMs: 100,
  });
  source.start();
  timers.advanceTime(100);
  timers.tick();
  // Wait for the poll microtasks to finish.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(invokes, 1);
  const values = source.latestValues();
  assert.equal(values.rpm, 50); // 0x05 * 10
  assert.equal(values.coolant, 64); // 0x40
  await lastResolve;
});

// ---------- top-level factory ----------

test("createLiveCanSource: 'sim' → simulator source", () => {
  const source = src.createLiveCanSource({ transportKind: "sim", decodeFor: fakeDecodeFor });
  assert.equal(source.kind, "sim");
});

test("createLiveCanSource: 'kdcan' → hardware source", () => {
  const source = src.createLiveCanSource({ transportKind: "kdcan", decodeFor: fakeDecodeFor, invokeFn: null });
  assert.equal(source.kind, "hardware");
});

test("createLiveCanSource: 'enet' → hardware source", () => {
  const source = src.createLiveCanSource({ transportKind: "enet", decodeFor: fakeDecodeFor, invokeFn: null });
  assert.equal(source.kind, "hardware");
});

test("createLiveCanSource: unknown / none → no-op source", () => {
  const source = src.createLiveCanSource({ transportKind: "what" });
  assert.equal(source.kind, "none");
  assert.deepEqual(source.latestValues(), {});
  assert.equal(source.framesPerSecond(), 0);
});

// ---------- module shape ----------

test("module.exports includes the documented API surface", () => {
  const expected = [
    "KNOWN_GAUGE_KEYS",
    "framesAt",
    "mergeDecoded",
    "createLiveCanSource",
    "createSimulatorSource",
    "createHardwareSource",
  ];
  for (const key of expected) {
    const t = typeof src[key];
    assert.ok(t === "function" || t === "object", `missing or wrong-typed ${key} (got ${t})`);
  }
  assert.deepEqual(src.KNOWN_GAUGE_KEYS, ["rpm", "coolant", "oilTemp", "vehicleSpeed", "batteryVoltage", "throttle"]);
});
