"use strict";

// CAN data-surface consistency guard.
//
// Why this file exists: three separate cycles have landed a CAN-decoder
// slice in pieces and left the pieces disagreeing —
//
//   * v0.17.0 shipped simulator frames + gauge keys with no DECODERS entries
//     (decodeFor() returned null for every new ID),
//   * v0.19.0 shipped 15 frames to the desktop simulator and forgot the
//     public-site mirror (three parity tests red),
//   * KNOWN_GAUGE_KEYS declared 29 keys while the panel rendered 8 and no
//     decoder produced fan / blower / amb.
//
// Every one of those was invisible until a human ran the suite and read the
// diff. This test asserts the four surfaces agree, so the next half-landed
// slice fails here, by name, instead of shipping.
//
// The three "pending" lists below are deliberate: they are the places where
// the app is knowingly incomplete, and adding to them should require a
// reason in the PR. They are assertions about intent, not a dumping ground.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = require("../live_can_source.js");
const dec = require("../can_decoders.js");
const gauges = require("../live_gauges.js");

/** An 8-byte frame that is valid for every decoder (no zero-length traps). */
const SAMPLE_FRAME = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];

/** Simulated frame IDs with no decoder yet — see `docs/validation/can-broadcast.md`. */
const FRAME_IDS_PENDING_DECODER = [
  0x1D2, // placeholder emitted for frame-completeness; layout unverified
];

/** KNOWN_GAUGE_KEYS with no producing decoder yet. */
const KEYS_PENDING_DECODER = [
  "blower", // IHKA; no verified byte layout
  "fan", // IHKA; no verified byte layout
];

/** Every key any registered decoder can emit. */
function decoderKeys() {
  const keys = new Set();
  for (const entry of Object.values(dec.DECODERS)) {
    const out = entry.decode(SAMPLE_FRAME);
    if (out == null || typeof out !== "object" || Array.isArray(out)) continue;
    for (const key of Object.keys(out)) keys.add(key);
  }
  return keys;
}

/**
 * Frame IDs whose decoder deliberately does not return a key/value map.
 * `0x0CE` returns the four wheel speeds as an array, and KNOWN_GAUGE_KEYS
 * declares no wheel keys, so there is nothing for the cache to merge. It
 * stays decoded-and-dropped until the panel has somewhere to put it.
 */
const FRAME_IDS_NON_MAP_RESULT = [0x0CE];

/** Keys reachable from the simulator's own frames. */
function simulatedKeys() {
  const keys = new Set();
  for (const frame of src.framesAt(0, 50)) {
    const out = dec.decodeFor(frame.id, frame.data);
    if (out == null || typeof out !== "object" || Array.isArray(out)) continue;
    for (const key of Object.keys(out)) keys.add(key);
  }
  return keys;
}

test("every simulated frame ID has a decoder", () => {
  const frames = src.framesAt(0, 50);
  const orphans = frames
    .map((f) => f.id)
    .filter((id) => id !== 0x0AA && dec.decodeFor(id, frames.find((f) => f.id === id).data) === null)
    .filter((id) => !FRAME_IDS_PENDING_DECODER.includes(id));
  assert.deepEqual(
    orphans.map((id) => `0x${id.toString(16)}`),
    [],
    "simulator emits frames nothing decodes",
  );
});

test("every decoder registered for a simulated frame is reachable", () => {
  // The reverse direction: a DECODERS entry whose ID is never simulated and
  // never documented as external is dead code.
  const simulated = new Set(src.framesAt(0, 50).map((f) => f.id));
  const externallyFed = [0x2A0, 0x3C0]; // fuel level / lambda, live-CAN only
  const dead = Object.keys(dec.DECODERS)
    .map(Number)
    .filter((id) => !simulated.has(id) && !externallyFed.includes(id));
  assert.deepEqual(dead.map((id) => `0x${id.toString(16)}`), []);
});

test("every KNOWN_GAUGE_KEY is produced by some decoder", () => {
  const produced = new Set([...decoderKeys(), ...simulatedKeys()]);
  const unproduced = src.KNOWN_GAUGE_KEYS.filter(
    (k) => !produced.has(k) && !KEYS_PENDING_DECODER.includes(k),
  );
  assert.deepEqual(unproduced, [], "declared gauge keys no decoder can ever fill");
});

test("every gauge the panel renders has a producing decoder", () => {
  const produced = new Set([...decoderKeys(), ...simulatedKeys()]);
  const orphans = gauges.GAUGE_DEFINITIONS.map((g) => g.key).filter((k) => !produced.has(k));
  assert.deepEqual(orphans, [], "panel gauge has no decoder behind it (dial would never move)");
});

test("every decoder returns a gauge-key map over declared keys", () => {
  // The bug this pins: three decoders returned a bare number and one an
  // array, so `mergeDecoded` (which reads `decoded[key]`) dropped them and
  // the dials never moved. A decoder result must be either null or an object
  // keyed by declared gauge keys — nothing else can reach the cache.
  const bad = [];
  for (const frame of src.framesAt(0, 50)) {
    if (FRAME_IDS_NON_MAP_RESULT.includes(frame.id)) continue;
    const out = dec.decodeFor(frame.id, frame.data);
    if (out == null) continue;
    if (typeof out !== "object" || Array.isArray(out)) {
      bad.push(`0x${frame.id.toString(16)} returned ${Array.isArray(out) ? "an array" : typeof out}`);
      continue;
    }
    const unknown = Object.keys(out).filter((k) => !src.KNOWN_GAUGE_KEYS.includes(k));
    if (unknown.length) bad.push(`0x${frame.id.toString(16)} emits unmergeable key(s) ${unknown.join(", ")}`);
  }
  assert.deepEqual(bad, []);
});

test("a simulated tick fills the gauge keys the panel actually renders", () => {
  // The user-visible contract: every dial on the Live Gauges panel gets a
  // value from the simulator. oilTemp / vehicleSpeed / batteryVoltage were
  // silently dropped and three of eight dials sat at their minimum forever.
  const timers = {
    cb: null,
    setIntervalFn: (fn) => { timers.cb = fn; return 1; },
    clearIntervalFn: () => {},
  };
  const source = src.createSimulatorSource({
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    tickIntervalMs: 100,
  });
  source.start();
  timers.cb();
  const values = source.latestValues();
  source.stop();
  const silent = gauges.GAUGE_DEFINITIONS
    .map((g) => g.key)
    // fuelLevel / lambda ride on live-CAN-only IDs the simulator does not emit
    .filter((k) => k !== "fuelLevel" && k !== "lambda")
    .filter((k) => !(k in values));
  assert.deepEqual(silent, [], "panel dials with no value from a simulator tick");
});

test("every key a simulated tick decodes reaches the cache", () => {
  // Closes the general case: whatever a frame decodes to must survive the
  // merge. Booleans count — the flag keys are declared gauge keys.
  const timers = {
    cb: null,
    setIntervalFn: (fn) => { timers.cb = fn; return 1; },
    clearIntervalFn: () => {},
  };
  const source = src.createSimulatorSource({ setIntervalFn: timers.setIntervalFn, clearIntervalFn: timers.clearIntervalFn });
  source.start();
  timers.cb();
  const values = source.latestValues();
  source.stop();
  const dropped = [...simulatedKeys()].filter((k) => !(k in values));
  assert.deepEqual(dropped, [], "decoded keys never reach latestValues()");
});

test("panel markup, panel definitions and decoder keys agree", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  const markup = [...html.matchAll(/data-live-can-gauge="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    markup,
    gauges.GAUGE_DEFINITIONS.map((g) => g.key),
    "a gauge added in JS without markup (or vice versa) can never render",
  );
  // Peaks are read per key too, so the same drift applies there.
  const peaks = [...html.matchAll(/data-live-can-peak="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(peaks, markup, "every gauge cell needs a matching peak readout");
});
