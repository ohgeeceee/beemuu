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
//   0x3B4 — Gear (EGS) — v0.17.0
//   0x0D0 — Engine torque (DME) — v0.17.0
//   0x1B4 — Steering angle / yaw (DSC) — v0.17.0
//   0x0C0 — Brake pressure — v0.17.0
//
// v0.17.0 expansion: additional common E9x/E6x broadcast IDs
// (best-effort layouts from community CAN logs / TECH_SPECS.md;
// need real-car verification per the harness).
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

// v0.17.0 E-series additions (best-effort)
const CAN_ID_GEAR = 0x3B4;          // EGS: current gear
const CAN_ID_ENGINE_TORQUE = 0x0D0; // DME: engine torque (Nm)
const CAN_ID_STEERING_YAW = 0x1B4;  // DSC: steering angle, yaw rate
const CAN_ID_BRAKE_PRESSURE = 0x0C0; // brake pressure

// v0.19.0 additions (best-effort; emitted by live_can_source.js)
const CAN_ID_INTAKE_TEMP = 0x2C4;   // DME: intake air temp
const CAN_ID_ENGINE_LOAD = 0x1A0;   // DME: calculated engine load
const CAN_ID_CRUISE = 0x3B8;        // DME/DSC: cruise control state
const CAN_ID_FUEL_RAIL = 0x0F4;     // DME: fuel rail pressure
const CAN_ID_MAP = 0x1D1;           // DME: manifold absolute pressure
const CAN_ID_OIL_PRESSURE = 0x2D0;  // DME: oil pressure
const CAN_ID_EXT_TEMP = 0x3E0;      // IHKA/JBE: outside temperature
const CAN_ID_IAT_MAP = 0x2C0;       // DME: intake air temp + MAP pair
const CAN_ID_TORQUE_BYTE = 0x0D1;   // DME: single-byte torque
const CAN_ID_AC_COMPRESSOR = 0x3D0; // IHKA: A/C compressor state
const CAN_ID_COOLANT_2 = 0x2C2;     // DME: second coolant sensor
const CAN_ID_ABS_STATE = 0x0B4;     // DSC: ABS active
const CAN_ID_AC_REQUEST = 0x3A0;    // IHKA: A/C request
const CAN_ID_OIL_TEMP_2 = 0x2D1;    // DME: second oil temp sensor

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

// v0.17.0 additions (best-effort; verify on real E9x/E6x)
const GEAR_BYTE = 1;                 // common location in EGS 0x3B4
const TORQUE_SCALE = 0.5;            // Nm per LSB (typical BMW)
const TORQUE_BYTE = 0;               // start of u16 for torque

// 0x1B4 (DSC) — steering angle (degrees), yaw rate (from TECH_SPECS.md)
const STEERING_SCALE = 0.1;  // deg per LSB (best-effort)
const YAW_SCALE = 0.1;       // deg/s per LSB
// 0x0C0 — brake pressure
const BRAKE_SCALE = 0.1;     // bar or MPa, best-effort
const BRAKE_BYTE = 0;

// v0.19.0 additions — additional E9x/E6x broadcast IDs. Same honesty
// caveat as the v0.17.0 block: the IDs and what they carry come from
// community logs / TECH_SPECS.md, the byte offsets and scales below
// are best-effort and need real-car verification. Changing a scale
// here is the single place to adjust it.
const INTAKE_TEMP_BYTE = 1;
const INTAKE_TEMP_OFFSET_C = -40;   // 0x2C4
const LOAD_BYTE = 2;
const LOAD_SCALE = 0.3922;          // %/LSB — same 8-bit sensor scale as throttle
const CRUISE_ACTIVE_BIT = 0x08;     // 0x3B8 byte 0
const FUEL_RAIL_SCALE = 10;         // kPa per LSB
const MAP_SCALE = 0.1;              // kPa per LSB
const EXT_TEMP_OFFSET_C = -40;      // 0x3E0
const TORQUE_NM_SCALE = 0.5;        // Nm per LSB (single-byte 0x0D1 variant)
const OIL_PRESS_SCALE = 0.05;       // bar per LSB (0x2D0)
const COOLANT2_OFFSET_C = -48;      // 0x2C2
const OIL_TEMP2_OFFSET_C = -48;     // 0x2D1
const AC_ON_BIT = 0x01;             // 0x3D0 byte 0
const AC_REQUESTED_BIT = 0x80;      // 0x3A0 byte 0
const ABS_ACTIVE_BIT = 0x04;        // 0x0B4 byte 0

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

// ---------- v0.17.0 E-series additions ----------

/**
 * Current gear from EGS 0x3B4 broadcast (E90/E60 etc).
 * Returns a small integer (0=P,1=R,2=N,3=D1...) or null.
 * Layout is best-effort; real encoding can vary by transmission.
 */
function decodeGear(frame) {
  if (!isFrame(frame)) return null;
  const raw = byteAt(frame, GEAR_BYTE);
  // Common simple mapping seen in logs; adjust per verification.
  let g;
  if (raw === 0) g = 0; // P
  else if (raw === 1) g = 1; // R
  else if (raw === 2) g = 2; // N
  else if (raw >= 3 && raw <= 8) g = raw; // D1..D6 or similar
  else g = raw;
  return g == null ? null : { gear: g };
}

/**
 * Engine torque (Nm) from 0x0D0 DME broadcast.
 * Returns number or null. Best-effort scale.
 */
function decodeEngineTorque(frame) {
  if (!isFrame(frame)) return null;
  const t = u16beAt(frame, TORQUE_BYTE) * TORQUE_SCALE;
  return { torque: t };
}

/**
 * Steering angle (deg) from 0x1B4 DSC broadcast. Best-effort per TECH_SPECS.
 */
function decodeSteeringAngle(frame) {
  if (!isFrame(frame)) return null;
  let raw = u16beAt(frame, 0);
  if (raw > 0x7FFF) raw -= 0x10000; // two's complement signed
  return { steering: raw * STEERING_SCALE };
}

/**
 * Brake pressure from 0x0C0. Best-effort.
 */
function decodeBrakePressure(frame) {
  if (!isFrame(frame)) return null;
  return { brake: u16beAt(frame, BRAKE_BYTE) * BRAKE_SCALE };
}

// ---------- v0.19.0 additions ----------
//
// Each takes a frame (1..8 bytes; missing trailing bytes read as 0,
// matching the DME's zero-padding) and returns an object keyed by the
// names in `live_can_source.js::KNOWN_GAUGE_KEYS`, or `null` when the
// input is malformed. Bit-flag decoders read byte 0.
//
// Deliberately NOT decoded here: 0x1D2 (the `amb` key) and the `fan` /
// `blower` keys have no byte layout we can defend without a real-car
// capture — the simulator emits a placeholder 0x1D2 frame, but nothing
// consumes it. Fill these in from `docs/validation/can-broadcast.md`
// evidence rather than guessing a scale.

/** Intake air temperature (°C) from DME 0x2C4. */
function decodeIntakeTemp(frame) {
  if (!isFrame(frame)) return null;
  return { intakeTemp: byteAt(frame, INTAKE_TEMP_BYTE) + INTAKE_TEMP_OFFSET_C };
}

/** Calculated engine load (%) from DME 0x1A0. */
function decodeEngineLoad(frame) {
  if (!isFrame(frame)) return null;
  return { load: byteAt(frame, LOAD_BYTE) * LOAD_SCALE };
}

/** Cruise control active flag from 0x3B8 byte 0 bit 3. */
function decodeCruise(frame) {
  if (!isFrame(frame)) return null;
  return { cruiseActive: (byteAt(frame, 0) & CRUISE_ACTIVE_BIT) !== 0 };
}

/** Fuel rail pressure (kPa) from DME 0x0F4. */
function decodeFuelRail(frame) {
  if (!isFrame(frame)) return null;
  return { fuelRail_kPa: u16beAt(frame, 0) * FUEL_RAIL_SCALE };
}

/** Manifold absolute pressure (kPa) from DME 0x1D1. */
function decodeMap(frame) {
  if (!isFrame(frame)) return null;
  return { map_kPa: u16beAt(frame, 0) * MAP_SCALE };
}

/** Oil pressure (bar) from DME 0x2D0. */
function decodeOilPressure(frame) {
  if (!isFrame(frame)) return null;
  return { oilPress_bar: byteAt(frame, 1) * OIL_PRESS_SCALE };
}

/** Outside temperature (°C) from 0x3E0. */
function decodeExtTemp(frame) {
  if (!isFrame(frame)) return null;
  return { extTemp: byteAt(frame, 0) + EXT_TEMP_OFFSET_C };
}

/** Intake air temp (°C) plus MAP (kPa) from the paired 0x2C0 frame. */
function decodeIatMap(frame) {
  if (!isFrame(frame)) return null;
  return {
    iat: byteAt(frame, 1) + INTAKE_TEMP_OFFSET_C,
    map: u16beAt(frame, 2) * MAP_SCALE,
  };
}

/** Engine torque (Nm) from the single-byte 0x0D1 frame. */
function decodeTorqueNm(frame) {
  if (!isFrame(frame)) return null;
  return { torqueNm: byteAt(frame, 0) * TORQUE_NM_SCALE };
}

/** A/C compressor engaged flag from 0x3D0 byte 0 bit 0. */
function decodeAcOn(frame) {
  if (!isFrame(frame)) return null;
  return { acOn: (byteAt(frame, 0) & AC_ON_BIT) !== 0 };
}

/** Second coolant temperature (°C) from DME 0x2C2. */
function decodeCoolant2(frame) {
  if (!isFrame(frame)) return null;
  return { coolant2: byteAt(frame, 0) + COOLANT2_OFFSET_C };
}

/** ABS active flag from DSC 0x0B4 byte 0 bit 2. */
function decodeAbsActive(frame) {
  if (!isFrame(frame)) return null;
  return { absActive: (byteAt(frame, 0) & ABS_ACTIVE_BIT) !== 0 };
}

/** A/C request flag from IHKA 0x3A0 byte 0 bit 7. */
function decodeAcRequested(frame) {
  if (!isFrame(frame)) return null;
  return { acRequested: (byteAt(frame, 0) & AC_REQUESTED_BIT) !== 0 };
}

/** Second oil temperature (°C) from DME 0x2D1. */
function decodeOilTemp2(frame) {
  if (!isFrame(frame)) return null;
  return { oilTemp2: byteAt(frame, 0) + OIL_TEMP2_OFFSET_C };
}

/**
 * Wraps a decoder that returns a bare number as `{ key: value }`.
 *
 * The dispatch table's contract is "an object of gauge key -> value" —
 * that is what the live-values cache merges (see
 * `live_can_source.js::mergeDecoded`, which iterates KNOWN_GAUGE_KEYS and
 * reads `decoded[key]`). Three of the per-ID decoders return a bare
 * number instead, so oilTemp / vehicleSpeed / batteryVoltage were silently
 * dropped from the cache and three of the eight Live Gauges dials never
 * moved — on real cars as well as the simulator, because both sources share
 * the merge. `null` passes through so malformed frames still report
 * "unusable" rather than `{ key: null }`.
 */
function keyed(key, value) {
  return value == null ? null : { [key]: value };
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
  [CAN_ID_OIL_TEMP]: { name: "oil_temp", decode: (frame) => keyed("oilTemp", decodeOilTemp(frame)) },
  [CAN_ID_WHEEL_SPEEDS]: { name: "wheel_speeds", decode: decodeWheelSpeeds },
  [CAN_ID_VEHICLE_SPEED]: { name: "vehicle_speed", decode: (frame) => keyed("vehicleSpeed", decodeVehicleSpeed(frame)) },
  [CAN_ID_BATTERY]: { name: "battery", decode: (frame) => keyed("batteryVoltage", decodeBatteryVoltage(frame)) },
  // v0.17.0
  [CAN_ID_GEAR]: { name: "gear", decode: decodeGear },
  [CAN_ID_ENGINE_TORQUE]: { name: "engine_torque", decode: decodeEngineTorque },
  [CAN_ID_STEERING_YAW]: { name: "steering_yaw", decode: decodeSteeringAngle },
  [CAN_ID_BRAKE_PRESSURE]: { name: "brake_pressure", decode: decodeBrakePressure },
  // v0.20 additional — broadcast frames generated by live_can_source.js
  0x2A0: { name: "fuel_level", decode: (f) => ({ fuelLevel: Math.round(((f[0] || 0) * 100) / 255) }) },
  0x3C0: { name: "lambda", decode: (f) => ({ lambda: 0.5 + ((f[0] || 0) * 0.004) }) },
  // v0.19 broadcast frames. The channel names are already whitelisted in
  // live_can_source.js KNOWN_GAUGE_KEYS and the desktop simulator already
  // emits every one of these IDs — but no decoder existed, so decodeFor()
  // returned null and those gauges could never populate. The scales below
  // are the contract pinned by src/js/test/can_decoders.test.cjs; like the
  // rest of this file they are best-effort community layouts and still
  // need real-car verification (see the header note).
  0x2C4: { name: "intake_temp", decode: (f) => ({ intakeTemp: u16beAt(f, 0) / 2 }) },
  0x1A0: { name: "engine_load", decode: (f) => ({ load: (f[2] || 0) * THROTTLE_SCALE }) },
  0x3B8: { name: "cruise_status", decode: (f) => ({ cruiseActive: ((f[0] || 0) & 0x08) !== 0 }) },
  0x0F4: { name: "fuel_rail", decode: (f) => ({ fuelRail_kPa: u16beAt(f, 0) * 10 }) },
  0x1D1: { name: "map_pressure", decode: (f) => ({ map_kPa: u16beAt(f, 0) / 10 }) },
  0x2D0: { name: "oil_pressure", decode: (f) => ({ oilPress_bar: (f[1] || 0) * 0.05 }) },
  0x3E0: { name: "external_temp", decode: (f) => ({ extTemp: (f[0] || 0) - 40 }) },
  0x2C0: { name: "intake_map", decode: (f) => ({ iat: (f[1] || 0) - 40, map: u16beAt(f, 2) / 10 }) },
  0x0D1: { name: "torque_2", decode: (f) => ({ torqueNm: (f[0] || 0) / 2 }) },
  0x3D0: { name: "climate_status", decode: (f) => ({ acOn: ((f[0] || 0) & 0x01) !== 0 }) },
  0x2C2: { name: "coolant_2", decode: (f) => ({ coolant2: (f[0] || 0) - 48 }) },
  0x1D2: { name: "ambient_2", decode: (f) => ({ amb: (f[0] || 0) - 40 }) },
  0x0B4: { name: "abs_status", decode: (f) => ({ absActive: ((f[0] || 0) & 0x04) !== 0 }) },
  0x3A0: { name: "ac_request", decode: (f) => ({ acRequested: ((f[0] || 0) & 0x80) !== 0 }) },
  0x2D1: { name: "oil_temp_2", decode: (f) => ({ oilTemp2: (f[0] || 0) - 48 }) },
};

/**
 * Decodes a frame by its CAN ID. Returns a map of gauge key -> value
 * (`{ oilTemp: 88 }`, `{ rpm: 800, throttle: 12 }`) or `null` if the ID is
 * unknown or the frame is malformed.
 *
 * Always a map, never a bare number: the live-values cache merges by reading
 * `decoded[key]` (`live_can_source.js::mergeDecoded`), so a primitive here is
 * dropped silently and its dial never moves. `0x0CE` (wheel speeds) is the
 * one exception — it returns an array because `KNOWN_GAUGE_KEYS` declares no
 * wheel keys, so there is nothing for the cache to merge.
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
  // v0.17.0 additions
  CAN_ID_GEAR,
  CAN_ID_ENGINE_TORQUE,
  CAN_ID_STEERING_YAW,
  CAN_ID_BRAKE_PRESSURE,
  // v0.19.0 additions
  CAN_ID_INTAKE_TEMP,
  CAN_ID_ENGINE_LOAD,
  CAN_ID_CRUISE,
  CAN_ID_FUEL_RAIL,
  CAN_ID_MAP,
  CAN_ID_OIL_PRESSURE,
  CAN_ID_EXT_TEMP,
  CAN_ID_IAT_MAP,
  CAN_ID_TORQUE_BYTE,
  CAN_ID_AC_COMPRESSOR,
  CAN_ID_COOLANT_2,
  CAN_ID_ABS_STATE,
  CAN_ID_AC_REQUEST,
  CAN_ID_OIL_TEMP_2,
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
  STEERING_SCALE,
  YAW_SCALE,
  BRAKE_SCALE,
  // v0.19.0 — same purpose as the block above.
  INTAKE_TEMP_OFFSET_C,
  LOAD_SCALE,
  CRUISE_ACTIVE_BIT,
  FUEL_RAIL_SCALE,
  MAP_SCALE,
  EXT_TEMP_OFFSET_C,
  TORQUE_NM_SCALE,
  OIL_PRESS_SCALE,
  COOLANT2_OFFSET_C,
  OIL_TEMP2_OFFSET_C,
  AC_ON_BIT,
  AC_REQUESTED_BIT,
  ABS_ACTIVE_BIT,
  // Per-ID decoders.
  decodeRpm,
  decodeThrottle,
  decodeCoolant,
  decodeAmbientTemp,
  decodeOilTemp,
  decodeWheelSpeeds,
  decodeVehicleSpeed,
  decodeBatteryVoltage,
  // v0.17.0
  decodeGear,
  decodeEngineTorque,
  decodeSteeringAngle,
  decodeBrakePressure,
  // v0.19.0
  decodeIntakeTemp,
  decodeEngineLoad,
  decodeCruise,
  decodeFuelRail,
  decodeMap,
  decodeOilPressure,
  decodeExtTemp,
  decodeIatMap,
  decodeTorqueNm,
  decodeAcOn,
  decodeCoolant2,
  decodeAbsActive,
  decodeAcRequested,
  decodeOilTemp2,
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
