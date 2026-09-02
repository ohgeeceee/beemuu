"use strict";

// v0.14.0 slice 7 — live CAN source.
//
// The Live Gauges panel (live_gauges.js) needs fresh decoded values
// pulled from somewhere. The "somewhere" is transport-dependent:
//
//   - "sim"   → the simulator produces raw CAN frames at 10–1000 ms
//                periods (see src-tauri/src/transport/sim.rs). On the
//                webview side, we mirror the same generator so the
//                demo works without any Rust IPC today. The Tauri
//                bridge path (get_latest_can_frames →
//                SimTransport::start_can_broadcaster) is the slice-5/6
//                Tier B surface; this module is what it will feed.
//
//   - "kdcan" / "enet" → slice 5/6 will plumb a real OBDLink SX (or
//                eventually a PEAK PCAN-USB) feed through the same
//                get_latest_can_frames command. Today the hardware
//                source returns an empty frame stream so the UI shows
//                "no frames yet" rather than fake data.
//
//   - "none" / unknown → the source is idle. The panel stays unlit
//                until the user connects to a transport.
//
// The broadcast IDs (original 6 + v0.17.0 expansions) and their decoders live in can_decoders.js —
// this module is the *source* (frame producer), not the *decoder*.
// Each ticker emits frames through can_decoders.decodeFor() and
// caches the freshest value per gauge key.
//
// Architectural note: this module is a factory. Unit tests pass in
// virtual timers + a fake `decodeFor` so the timing math is
// testable in `node --test` without the webview or a real bus.

const decoders = (typeof require !== "undefined" && typeof module !== "undefined")
  ? require("./can_decoders.js")
  : (typeof window !== "undefined" ? window.beeemuuCanDecoders : null);

const KNOWN_GAUGE_KEYS = Object.freeze([
  "rpm",
  "coolant",
  "oilTemp",
  "vehicleSpeed",
  "batteryVoltage",
  "throttle",
]);

// -----------------------------------------------------------------------
// Frame generator — mirrors the Rust broadcast_frames_at() in
// src-tauri/src/transport/sim.rs (core 6 + v0.17.0 extra IDs).
// Same scales, same IDs, same formulas. The point of mirroring is to
// keep the JS-side demo and the Rust-side hardware path producing the
// SAME byte patterns so the decoder output is verifiable without a real car.
//
// If the Rust formula moves, this function moves with it. The test
// `js/live_can_source.test.js` pins the byte-for-byte output at
// t=0, t=1000, t=10000 so the parity check is caught by CI.
// -----------------------------------------------------------------------
function framesAt(t_ms, vehicle_speed_kmh) {
  const t = t_ms / 1000.0;
  const rpm = Math.round(750 + (1 - Math.cos(t * 0.35)) * 3000);
  const rpmRaw = [(rpm * 4) >> 8, (rpm * 4) & 0xff];
  const throttlePercent = 12 + Math.abs(Math.sin(t * 0.35)) * 65;
  const throttleRaw = Math.round(throttlePercent / 0.3922);
  const coolantC = 20 + 78 * (1 - Math.exp(-t / 90));
  const oilC = 18 + 80 * (1 - Math.exp(-t / 150));
  const speed = Math.min(127.5, Math.max(0, vehicle_speed_kmh));
  const wheelRaw = [Math.round(speed / 0.0625) >> 8, Math.round(speed / 0.0625) & 0xff];
  const speedRaw = Math.round(speed / 0.5);
  const batteryV = 14 + Math.sin(t * 0.2) * 0.5;
  const batteryRaw = Math.round((batteryV - 6) / 0.1);

  return [
    { id: 0x0AA, data: [rpmRaw[0], rpmRaw[1], 0, 0, 0, 0, throttleRaw & 0xff, 0] },
    { id: 0x0CE, data: [wheelRaw[0], wheelRaw[1], wheelRaw[0], wheelRaw[1], wheelRaw[0], wheelRaw[1], wheelRaw[0], wheelRaw[1]] },
    { id: 0x1D0, data: [Math.round(coolantC + 48), 68, 0, 0, 0, 0, 0, 0] },
    { id: 0x130, data: [speedRaw, 0, 0, 0, 0, 0, 0, 0] },
    { id: 0x545, data: [0, Math.round(oilC + 48), 0, 0, 0, 0, 0, 0] },
    { id: 0x316, data: [batteryRaw, 0, 0, 0, 0, 0, 0, 0] },
    // v0.17.0 additional decoders (best-effort; not core gauges)
    { id: 0x3B4, data: [0, 3, 0, 0, 0, 0, 0, 0] }, // gear ~ D3
    { id: 0x0D0, data: [0, 100, 0, 0, 0, 0, 0, 0] }, // torque ~50 Nm
    { id: 0x1B4, data: [0, 0, 0, 0, 0, 0, 0, 0] }, // steering 0
    { id: 0x0C0, data: [0, 0, 0, 0, 0, 0, 0, 0] }, // brake 0
  ];
}

// Decode a single frame and merge its decoded values into the cache.
// Only known gauge keys are kept, so a decoder that emits `{ rpm, foo }`
// doesn't pollute the cache with `foo` keys.
function mergeDecoded(cache, decoded) {
  if (decoded == null || typeof decoded !== "object") return;
  for (const key of KNOWN_GAUGE_KEYS) {
    if (Number.isFinite(decoded[key])) cache[key] = decoded[key];
  }
}

// -----------------------------------------------------------------------
// Simulator source — JS-side mirror of the Rust broadcast worker.
// Suitable for the demo path AND for slice-8 harness-doc tests.
// The hardware source (below) is the slice-5/6 Tier B wiring.
// -----------------------------------------------------------------------
function createSimulatorSource(options = {}) {
  const {
    decodeFor = (decoders ? decoders.decodeFor : null),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    now = () => Date.now(),
    tickIntervalMs = 100, // 10 Hz — gives the panel a perceptible refresh
    vehicleSpeedKmh = 50,
    // setInterval returns a non-numeric handle in the browser; tests pass
    // a number. The factory treats both as opaque tokens.
  } = options;
  if (typeof decodeFor !== "function") {
    throw new Error("createSimulatorSource requires a decodeFor(id, frame) function (pass can_decoders.decodeFor explicitly when testing).");
  }
  const startedAt = now();
  let timer = null;
  let frameCount = 0;
  let values = {};
  let lastFrameAt = null;

  function tick() {
    const tMs = now() - startedAt;
    for (const frame of framesAt(tMs, vehicleSpeedKmh)) {
      mergeDecoded(values, decodeFor(frame.id, frame.data));
    }
    frameCount += 6;
    lastFrameAt = now();
  }

  function start() {
    if (timer) return timer;
    timer = setIntervalFn(tick, tickIntervalMs);
    return timer;
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
  }

  function framesPerSecond() {
    if (lastFrameAt == null) return 0;
    // 6 frames per simulated tick; divide by elapsed-seconds-since-start.
    const elapsedSec = Math.max(0.001, (now() - startedAt) / 1000);
    return Math.round((frameCount / elapsedSec) * 10) / 10;
  }

  return {
    kind: "sim",
    start,
    stop,
    isRunning: () => timer !== null,
    latestValues: () => ({ ...values }),
    framesPerSecond,
    // Diagnostic — tests + harness doc use this to confirm the generator
    // is wired to the right scales.
    framesAt,
  };
}

// -----------------------------------------------------------------------
// Hardware source — slice 5/6 Tier B wiring. Today the
// get_latest_can_frames Tauri command isn't implemented yet; calling
// the source returns an empty stream. The shape is identical to the
// simulator source so the live_gauges controller doesn't care which
// one is plugged in.
// -----------------------------------------------------------------------
function createHardwareSource(options = {}) {
  const {
    invokeFn = (typeof window !== "undefined" && window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke)
      ? window.__TAURI__.core.invoke
      : null,
    decodeFor = (decoders ? decoders.decodeFor : null),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    pollIntervalMs = 100,
    fallbackToEmpty = true,
  } = options;
  if (typeof decodeFor !== "function") {
    throw new Error("createHardwareSource requires a decodeFor(id, frame) function (pass can_decoders.decodeFor explicitly when testing).");
  }
  let timer = null;
  let values = {};
  let frameCount = 0;
  let lastError = null;
  let firstFrameAt = null;

  async function poll() {
    if (typeof invokeFn !== "function") {
      // No Tauri bridge — stand-in mode. If the caller explicitly opted
      // in to fallbackToEmpty, we keep the source silent (no fake data).
      return;
    }
    try {
      const frames = await invokeFn("get_latest_can_frames");
      if (!Array.isArray(frames)) return;
      for (const frame of frames) {
        if (!frame || typeof frame.id !== "number" || !frame.data) continue;
        const decoded = decodeFor(frame.id, frame.data);
        mergeDecoded(values, decoded);
        frameCount += 1;
      }
      if (frames.length > 0 && firstFrameAt == null) firstFrameAt = Date.now();
      lastError = null;
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
    }
  }

  function start() {
    if (timer) return timer;
    timer = setIntervalFn(poll, pollIntervalMs);
    return timer;
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
  }

  return {
    kind: "hardware",
    start,
    stop,
    isRunning: () => timer !== null,
    latestValues: () => ({ ...values }),
    framesPerSecond: () => (firstFrameAt == null ? 0 : Math.round((frameCount / Math.max(0.001, (Date.now() - firstFrameAt) / 1000)) * 10) / 10),
    lastError: () => lastError,
  };
}

// -----------------------------------------------------------------------
// Top-level factory — picks the right source for the active transport.
// Called by main.js once the connection kind is known.
// -----------------------------------------------------------------------
function createLiveCanSource(options = {}) {
  const { transportKind } = options;
  if (transportKind === "sim") return createSimulatorSource(options);
  if (transportKind === "kdcan" || transportKind === "enet") return createHardwareSource(options);
  // Unknown / not connected — return a no-op source so the panel boots
  // cleanly. The user will see "no transport" until they connect.
  return {
    kind: "none",
    start: () => null,
    stop: () => {},
    isRunning: () => false,
    latestValues: () => ({}),
    framesPerSecond: () => 0,
  };
}

const api = {
  KNOWN_GAUGE_KEYS,
  framesAt,
  mergeDecoded,
  createLiveCanSource,
  createSimulatorSource,
  createHardwareSource,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof window !== "undefined") {
  window.beeemuuLiveCanSource = api;
}
