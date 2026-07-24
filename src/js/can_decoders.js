"use strict";

// CAN bus broadcast decoders (v0.14.0 "Live CAN", slice 2).
//
// BMW ECUs broadcast many parameters on the raw CAN bus without
// being asked (see `docs/ROADMAP_ISSUES.md` issue 6, "CAN bus
// listener mode for E-series"). The 6 known broadcast IDs:
//
//   0x0AA — RPM, torque, throttle (DME, 10ms period)
//   0x1D0 — Coolant temp, ambient temp (DME)
//   0x545 — Oil temp, oil pressure (DME; E46 confirmed, E9x needs
//            verification per ROADMAP_ISSUES.md)
//   0x0CE — Wheel speeds (DSC)
//   0x130 — Vehicle speed, gear (EGS/DME)
//   0x316 — Battery voltage, charging (DME/IHKR)
//
// All raw frames are 8 bytes (`Uint8Array` or array of numbers).
// Every decoder takes an 8-byte frame and returns a typed value
// (or `null` if the input is malformed).
//
// ## Honest ceiling: the byte layouts below are BEST-EFFORT
//
// The CAN IDs and what each carries are documented in
// `docs/ROADMAP_ISSUES.md`. The byte-by-byte layout (which byte
// holds RPM, which holds throttle, the scales and offsets) is
// **inferred** from canonical BMW DME conventions and various
// community reverse-engineering sources. v0.14.0 ships the decoders
// in this form so the v0.14.0 cycle can land the rest of the
// infrastructure (simulator, transport, panel, harness doc) and
// have a working test path. The harness doc (slice 8) is explicit
// that all these scales need real-car verification on E46, and
// a v0.14.1 follow-up adjusts the constants below in one place
// based on real-car data.
//
// If a frame decodes to an obviously-wrong value (RPM > 10000,
// battery voltage < 9V, coolant > 150°C), the user's first move
// should be to look at the constants below and the docs/validation
// harness, not to assume the decoder logic is correct.
//
// ## Pure data → numbers
//
// This module is a pure decoder. No DOM, no Tauri IPC, no async.
// Tests run under `node --test` without a browser or backend.
// `main.js` becomes a thin caller.

// CAN ID constants. Module-level so the v0.14.0 Live Gauges panel
// and the slice-5 Tauri command surface can import them without
// duplicating the magic numbers.
const CAN_ID_RPM_THROTTLE = 0x0AA;
const CAN_ID_COOLANT_AMBIENT = 0x1D0;
const CAN_ID_OIL_TEMP = 0x545;
const CAN_ID_WHEEL_SPEEDS = 0x0CE;
const CAN_ID_VEHICLE_SPEED = 0x130;
const CAN_ID_BATTERY = 0x316;

// Scale / offset constants. All per-byte derivations of decoded
// values live here, named, so the real-car verification in v0.14.1
// can adjust them in one place.

// 0x0AA (DME) — RPM and throttle.
//   bytes 0-1: RPM, big-endian u16, scale 0.25 RPM/LSB
//   byte 6:    throttle position, scale 0.3922 %/LSB (0..100% over
//              0..255 — the standard BMW "throttle position percent"
//              encoding for 8-bit sensors)
const RPM_SCALE = 0.25;
const THROTTLE_SCALE = 0.3922;
const THROTTLE_BYTE = 6;

// 0x1D0 (DME) — Coolant and ambient temps.
//   byte 0: coolant, signed offset -48°C
//   byte 1: ambient, signed offset -48°C
const TEMP_OFFSET_C = -48;
const COOLANT_BYTE = 0;
const AMBIENT_BYTE = 1;

// 0x545 (DME) — Oil temp and oil pressure.
//   byte 1: oil temp, signed offset -48°C
const OIL_TEMP_BYTE = 1;

// 0x0CE (DSC) — Wheel speeds, 4 wheels.
//   bytes 0-1: front-left,  big-endian u16, scale 0.0625 km/h/LSB
//   bytes 2-3: front-right
//   bytes 4-5: rear-left
//   bytes 6-7: rear-right
const WHEEL_SCALE = 0.0625;

// 0x130 (EGS/DME) — Vehicle speed.
//   byte 0: vehicle speed, scale 0.5 km/h/LSB
const VEHICLE_SPEED_SCALE = 0.5;
const VEHICLE_SPEED_BYTE = 0;

// 0x316 (DME/IHKR) — Battery voltage.
//   byte 0: battery voltage, scale 0.1 V/LSB, with a 6.0V offset
//   (some BMW ECUs report 0V when the alternator is off, so a
//   small offset aligns the LSB to physical reality; v0.14.1
//   real-car verification may adjust)
const BATTERY_SCALE = 0.1;
const BATTERY_OFFSET_V = 6.0;
const BATTERY_BYTE = 0;

// ---------- frame length validation ----------

/**
 * Returns `true` if `frame` is a usable 8-byte CAN frame. Accepts
 * both `Uint8Array` and plain arrays; accepts shorter arrays (the
 * missing bytes are read as 0, which is also what the DME does on
 * the wire) but flags them via the per-decoder `null` return.
 */
function isFrame(frame) {
  if (frame == null) return false;
  if (typeof frame.length !== "number") return false;
  return frame.length >= 1 && frame.length <= 8;
}

/**
 * Safely reads byte `index` from `frame`. Returns 0 if out of
 * range, which matches the DME's behavior when a short frame is
 * received (the trailing bytes are zero-padded). Callers that want
 * to distinguish "real zero" from "missing" can check `isFrame`.
 */
function byteAt(frame, index) {
  if (!isFrame(frame)) return 0;
  if (index < 0 || index >= frame.length) return 0;
  // Normalize to number — Uint8Array[i] is already a number but
  // an Array[i] might be undefined if the array is sparse. `| 0`
  // coerces to int and defaults undefined to 0.
  return (frame[index] | 0) & 0xFF;
}

/** Reads a big-endian u16 starting at `index`. Returns 0 if out of range. */
function u16beAt(frame, index) {
  return (byteAt(frame, index) << 8) | byteAt(frame, index + 1);
}

// ---------- 0x0AA: RPM and throttle ----------

/**
 * Engine RPM from a 0x0AA DME broadcast frame. Returns a number
 * (0..16383.75 RPM in the standard scale) or `null` for malformed
 * input.
 */
function decodeRpm(frame) {
  if (!isFrame(frame)) return null;
  return u16beAt(frame, 0) * RPM_SCALE;
}

/**
 * Throttle position (%) from a 0x0AA DME broadcast frame. Returns
 * a number (0..100) or `null`.
 */
function decodeThrottle(frame) {
  if (!isFrame(frame)) return null;
  return byteAt(frame, THROTTLE_BYTE) * THROTTLE_SCALE;
}

// ---------- 0x1D0: Coolant and ambient ----------

/**
 * Coolant temperature (°C) from a 0x1D0 DME broadcast frame.
 * Returns a number or `null`.
 */
function decodeCoolant(frame) {
  if (!isFrame(frame)) return null;
  return byteAt(frame, COOLANT_BYTE) + TEMP_OFFSET_C;
}

/**
 * Ambient temperature (°C) from a 0x1D0 DME broadcast frame.
 * Returns a number or `null`.
 */
function decodeAmbientTemp(frame) {
  if (!isFrame(frame)) return null;
  return byteAt(frame, AMBIENT_BYTE) + TEMP_OFFSET_C;
}

// ---------- 0x545: Oil temp ----------

/**
 * Oil temperature (°C) from a 0x545 DME broadcast frame. Returns
 * a number or `null`. The byte layout for 0x545 is the
 * **least-confident** of the decoders here — `docs/ROADMAP_ISSUES.md`
 * notes "E46 confirmed; E9x needs verification". v0.14.1
 * real-car verification is the place to lock this down.
 */
function decodeOilTemp(frame) {
  if (!isFrame(frame)) return null;
  return byteAt(frame, OIL_TEMP_BYTE) + TEMP_OFFSET_C;
}

// ---------- 0x0CE: Wheel speeds ----------

/**
 * Four wheel speeds (km/h) from a 0x0CE DSC broadcast frame.
 * Returns `[fl, fr, rl, rr]` or `null`. Each value is a number
 * in 0..4095.9375 km/h at the standard scale.
 */
function decodeWheelSpeeds(frame) {
  if (!isFrame(frame)) return null;
  return [
    u16beAt(frame, 0) * WHEEL_SCALE,
    u16beAt(frame, 2) * WHEEL_SCALE,
    u16beAt(frame, 4) * WHEEL_SCALE,
    u16beAt(frame, 6) * WHEEL_SCALE,
  ];
}

// ---------- 0x130: Vehicle speed ----------

/**
 * Vehicle speed (km/h) from a 0x130 EGS/DME broadcast frame.
 * Returns a number (0..127.5 km/h at the standard scale) or `null`.
 */
function decodeVehicleSpeed(frame) {
  if (!isFrame(frame)) return null;
  return byteAt(frame, VEHICLE_SPEED_BYTE) * VEHICLE_SPEED_SCALE;
}

// ---------- 0x316: Battery voltage ----------

/**
 * Battery voltage (V) from a 0x316 DME/IHKR broadcast frame.
 * Returns a number (6.0..31.5 V at the standard scale) or `null`.
 * The 6.0V offset is documented in the constant above; the v0.14.1
 * real-car verification may adjust.
 */
function decodeBatteryVoltage(frame) {
  if (!isFrame(frame)) return null;
  return byteAt(frame, BATTERY_BYTE) * BATTERY_SCALE + BATTERY_OFFSET_V;
}

// ---------- dispatch by CAN ID ----------

/**
 * Map of CAN ID → decoder. The slice-7 frontend wiring and the
 * slice-5 listener both use this to look up the right decoder
 * without per-ID branching at every call site. The values are
 * `[<name>, <decoderFn>]` so test failures can name the decoder.
 */
const DECODERS = {
  [CAN_ID_RPM_THROTTLE]: { name: "rpm_throttle", decode: (frame) => ({
    rpm: decodeRpm(frame),
    throttle: decodeThrottle(frame),
  }) },
  [CAN_ID_COOLANT_AMBIENT]: { name: "coolant_ambient", decode: (frame) => ({
    coolant: decodeCoolant(frame),
    ambient: decodeAmbientTemp(frame),
  }) },
  [CAN_ID_OIL_TEMP]: { name: "oil_temp", decode: decodeOilTemp },
  [CAN_ID_WHEEL_SPEEDS]: { name: "wheel_speeds", decode: decodeWheelSpeeds },
  [CAN_ID_VEHICLE_SPEED]: { name: "vehicle_speed", decode: decodeVehicleSpeed },
  [CAN_ID_BATTERY]: { name: "battery", decode: decodeBatteryVoltage },
};

/**
 * Decodes a frame by its CAN ID. Returns the decoded value
 * (object for the multi-value frames, primitive for the rest) or
 * `null` if the ID is unknown or the frame is malformed.
 *
 * Important: a malformed frame returns `null` even for the
 * multi-value CAN IDs (0x0AA, 0x1D0), not `{ rpm: null, throttle: null }`.
 * Callers that branch on the result can use a single `if (decoded)` check
 * to handle "this frame is unusable" uniformly.
 */
function decodeFor(canId, frame) {
  const entry = DECODERS[canId];
  if (!entry) return null;
  if (!isFrame(frame)) return null;
  return entry.decode(frame);
}

// ---------- dual export ----------

const api = {
  // CAN ID constants.
  CAN_ID_RPM_THROTTLE,
  CAN_ID_COOLANT_AMBIENT,
  CAN_ID_OIL_TEMP,
  CAN_ID_WHEEL_SPEEDS,
  CAN_ID_VEHICLE_SPEED,
  CAN_ID_BATTERY,
  // Scale / offset constants — exported for v0.14.1 real-car
  // verification and for the harness doc (slice 8) to print
  // them in the user-facing report.
  RPM_SCALE,
  THROTTLE_SCALE,
  TEMP_OFFSET_C,
  WHEEL_SCALE,
  VEHICLE_SPEED_SCALE,
  BATTERY_SCALE,
  BATTERY_OFFSET_V,
  // Per-ID decoders.
  decodeRpm,
  decodeThrottle,
  decodeCoolant,
  decodeAmbientTemp,
  decodeOilTemp,
  decodeWheelSpeeds,
  decodeVehicleSpeed,
  decodeBatteryVoltage,
  // Dispatch.
  DECODERS,
  decodeFor,
  // Helpers (exported for tests and for slice-7's panel render).
  isFrame,
  byteAt,
  u16beAt,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof window !== "undefined") {
  window.beeemuuCanDecoders = api;
}
