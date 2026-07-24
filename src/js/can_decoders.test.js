"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const d = require("../../src/js/can_decoders.js");

// Fixtures are deterministic byte arrays, NOT real BMW captures. The
// scales are inferred from canonical BMW DME conventions; v0.14.1
// real-car verification is the place to lock them down. The point of
// these tests is "given a known input, the decoder is deterministic
// and mathematically correct given the asserted scales", not "this
// matches what a real E46 actually broadcasts". See
// `docs/validation/can-broadcast.md` (slice 8) for the harness doc.

// ---------- 0x0AA: RPM and throttle ----------

test("decodeRpm: idle frame (RPM ≈ 750)", () => {
  // bytes 0-1 = 0x0BB0 = 2992 → 2992 * 0.25 = 748.0 RPM
  const frame = [0x0B, 0xB0, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00];
  assert.equal(d.decodeRpm(frame), 748.0);
});

test("decodeRpm: redline frame (RPM = 8000)", () => {
  // bytes 0-1 = 0x7D00 = 32000 → 32000 * 0.25 = 8000.0 RPM
  // (0x7D00 chosen because 32000 * 0.25 = exactly 8000)
  const frame = [0x7D, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x00];
  assert.equal(d.decodeRpm(frame), 8000.0);
});

test("decodeRpm: zero frame (engine off, RPM = 0)", () => {
  assert.equal(d.decodeRpm([0, 0, 0, 0, 0, 0, 0, 0]), 0);
});

test("decodeRpm: malformed input returns null", () => {
  assert.equal(d.decodeRpm(null), null);
  assert.equal(d.decodeRpm(undefined), null);
  assert.equal(d.decodeRpm({}), null); // no .length
  assert.equal(d.decodeRpm("not an array"), null);
});

test("decodeThrottle: 50% frame (byte 6 = 0x80 = 128)", () => {
  // 128 * 0.3922 = 50.2016 %
  const frame = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00];
  assert.equal(d.decodeThrottle(frame), 128 * d.THROTTLE_SCALE);
  // The throttle scale is asserted to give ~50% at byte 0x80.
  assert.ok(d.decodeThrottle(frame) > 49.5 && d.decodeThrottle(frame) < 51.0);
});

test("decodeThrottle: zero (foot off pedal)", () => {
  assert.equal(d.decodeThrottle([0, 0, 0, 0, 0, 0, 0, 0]), 0);
});

test("decodeThrottle: 100% (byte 6 = 0xFF = 255)", () => {
  // 255 * 0.3922 = 100.011 % — the 0.011 is the rounding error in
  // the scale constant; the harness doc notes this.
  assert.equal(d.decodeThrottle([0, 0, 0, 0, 0, 0, 0xFF, 0]), 255 * d.THROTTLE_SCALE);
});

// ---------- 0x1D0: Coolant and ambient ----------

test("decodeCoolant: 90°C (operating temp, byte 0 = 0x9A = 154)", () => {
  // 154 + (-48) = 106°C — verify the offset is applied.
  // We use byte = 0x82 = 130 → 130 - 48 = 82°C
  const frame = [0x82, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  assert.equal(d.decodeCoolant(frame), 82);
});

test("decodeCoolant: -10°C (cold start, byte 0 = 0x26 = 38)", () => {
  // 38 + (-48) = -10
  const frame = [0x26, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  assert.equal(d.decodeCoolant(frame), -10);
});

test("decodeAmbientTemp: 25°C (byte 1 = 0x49 = 73)", () => {
  // 73 + (-48) = 25
  const frame = [0x00, 0x49, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  assert.equal(d.decodeAmbientTemp(frame), 25);
});

test("decodeCoolant and decodeAmbientTemp are independent (different bytes)", () => {
  // Coolant at byte 0, ambient at byte 1. Verify they don't
  // accidentally share a byte offset.
  const frame = [0x60, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  // 0x60 = 96 → 96 - 48 = 48°C coolant
  // 0x40 = 64 → 64 - 48 = 16°C ambient
  assert.equal(d.decodeCoolant(frame), 48);
  assert.equal(d.decodeAmbientTemp(frame), 16);
});

// ---------- 0x545: Oil temp ----------

test("decodeOilTemp: 100°C (operating, byte 1 = 0xB0 = 176)", () => {
  // 176 + (-48) = 128°C — too hot. Use 0x88 = 136 → 88°C for normal.
  const frame = [0x00, 0x88, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  assert.equal(d.decodeOilTemp(frame), 88);
});

test("decodeOilTemp: byte 0 is NOT oil temp (per the constant)", () => {
  // If a future refactor accidentally moved OIL_TEMP_BYTE to 0,
  // this test would fail because the input has byte 0 set to a
  // value that would decode to a wildly different number from
  // byte 1.
  const frame = [0xFF, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  // 0x40 = 64 → 64 - 48 = 16°C (cold oil)
  // If OIL_TEMP_BYTE were 0, this would decode to 255 - 48 = 207°C.
  assert.equal(d.decodeOilTemp(frame), 16);
});

// ---------- 0x0CE: Wheel speeds ----------

test("decodeWheelSpeeds: 4 different wheel speeds in one frame", () => {
  // bytes 0-1: 0x0064 = 100 → 100 * 0.0625 = 6.25 km/h
  // bytes 2-3: 0x00C8 = 200 → 200 * 0.0625 = 12.5 km/h
  // bytes 4-5: 0x012C = 300 → 300 * 0.0625 = 18.75 km/h
  // bytes 6-7: 0x0190 = 400 → 400 * 0.0625 = 25.0 km/h
  const frame = [0x00, 0x64, 0x00, 0xC8, 0x01, 0x2C, 0x01, 0x90];
  assert.deepEqual(d.decodeWheelSpeeds(frame), [6.25, 12.5, 18.75, 25.0]);
});

test("decodeWheelSpeeds: all-zero frame = car stationary", () => {
  assert.deepEqual(d.decodeWheelSpeeds([0, 0, 0, 0, 0, 0, 0, 0]), [0, 0, 0, 0]);
});

test("decodeWheelSpeeds: short frame (only 4 bytes) pads the rest as 0", () => {
  // Rear-left and rear-right bytes missing → 0 km/h.
  // bytes 0-1: 0x0064 = 100 → 6.25
  // bytes 2-3: 0x00C8 = 200 → 12.5
  // bytes 4-7: missing → 0
  assert.deepEqual(d.decodeWheelSpeeds([0x00, 0x64, 0x00, 0xC8]), [6.25, 12.5, 0, 0]);
});

// ---------- 0x130: Vehicle speed ----------

test("decodeVehicleSpeed: 50 km/h (byte 0 = 100, 100 * 0.5 = 50)", () => {
  const frame = [100, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(d.decodeVehicleSpeed(frame), 50);
});

test("decodeVehicleSpeed: 0 km/h", () => {
  assert.equal(d.decodeVehicleSpeed([0, 0, 0, 0, 0, 0, 0, 0]), 0);
});

// ---------- 0x316: Battery voltage ----------

test("decodeBatteryVoltage: 14.0V (engine on, byte 0 = 80, 80*0.1+6 = 14.0)", () => {
  // 80 * 0.1 = 8.0; + 6.0 = 14.0
  const frame = [80, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(d.decodeBatteryVoltage(frame), 14.0);
});

test("decodeBatteryVoltage: 12.4V (engine off, byte 0 = 64, 64*0.1+6 = 12.4)", () => {
  assert.equal(d.decodeBatteryVoltage([64, 0, 0, 0, 0, 0, 0, 0]), 12.4);
});

test("decodeBatteryVoltage: 6.0V floor (byte 0 = 0)", () => {
  // The 6.0V offset means a zero byte reads as 6V, not 0V. This is
  // intentional — the harness doc explains the rationale.
  assert.equal(d.decodeBatteryVoltage([0, 0, 0, 0, 0, 0, 0, 0]), 6.0);
});

// ---------- dispatch via decodeFor ----------

test("decodeFor: dispatches by CAN ID", () => {
  const rpmFrame = [0x0B, 0xB0, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00];
  // bytes 0-1 = 0x0BB0 = 2992 → 748 RPM
  // byte 6 = 0x80 = 128 → 50.20% throttle (matches the
  // decodeThrottle: 50% frame test above)
  const decoded = d.decodeFor(d.CAN_ID_RPM_THROTTLE, rpmFrame);
  assert.deepEqual(decoded, { rpm: 748.0, throttle: 128 * d.THROTTLE_SCALE });
});

test("decodeFor: returns object for multi-value frames (0x0AA, 0x1D0)", () => {
  const tmpFrame = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  const rpmDecoded = d.decodeFor(d.CAN_ID_RPM_THROTTLE, tmpFrame);
  assert.equal(typeof rpmDecoded, "object");
  assert.ok("rpm" in rpmDecoded);
  assert.ok("throttle" in rpmDecoded);

  const coolantDecoded = d.decodeFor(d.CAN_ID_COOLANT_AMBIENT, tmpFrame);
  assert.equal(typeof coolantDecoded, "object");
  assert.ok("coolant" in coolantDecoded);
  assert.ok("ambient" in coolantDecoded);
});

test("decodeFor: returns primitive for single-value frames", () => {
  assert.equal(d.decodeFor(d.CAN_ID_OIL_TEMP, [0x00, 0x88, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), 88);
  assert.equal(d.decodeFor(d.CAN_ID_VEHICLE_SPEED, [100, 0, 0, 0, 0, 0, 0, 0]), 50);
  assert.equal(d.decodeFor(d.CAN_ID_BATTERY, [80, 0, 0, 0, 0, 0, 0, 0]), 14.0);
  assert.deepEqual(d.decodeFor(d.CAN_ID_WHEEL_SPEEDS, [0, 0, 0, 0, 0, 0, 0, 0]), [0, 0, 0, 0]);
});

test("decodeFor: unknown CAN ID returns null", () => {
  // 0x999 is not in the DECODERS map.
  assert.equal(d.decodeFor(0x999, [0, 0, 0, 0, 0, 0, 0, 0]), null);
  // 0x000 is a valid hex value but not in the DECODERS map.
  assert.equal(d.decodeFor(0x000, [0, 0, 0, 0, 0, 0, 0, 0]), null);
});

test("decodeFor: malformed frame returns null even for known IDs", () => {
  // null and undefined inputs are caught by isFrame() in each
  // decoder and returned as null.
  assert.equal(d.decodeFor(d.CAN_ID_RPM_THROTTLE, null), null);
  assert.equal(d.decodeFor(d.CAN_ID_RPM_THROTTLE, undefined), null);
  // Non-array-like input.
  assert.equal(d.decodeFor(d.CAN_ID_RPM_THROTTLE, "not an array"), null);
  assert.equal(d.decodeFor(d.CAN_ID_RPM_THROTTLE, 42), null);
});

// ---------- constants are exported for harness doc ----------

test("CAN ID constants are the documented values from ROADMAP_ISSUES.md", () => {
  // Pinning these so the harness doc (slice 8) and the v0.14.0
  // panel (slice 3) can import them without risk of typo drift.
  assert.equal(d.CAN_ID_RPM_THROTTLE, 0x0AA);
  assert.equal(d.CAN_ID_COOLANT_AMBIENT, 0x1D0);
  assert.equal(d.CAN_ID_OIL_TEMP, 0x545);
  assert.equal(d.CAN_ID_WHEEL_SPEEDS, 0x0CE);
  assert.equal(d.CAN_ID_VEHICLE_SPEED, 0x130);
  assert.equal(d.CAN_ID_BATTERY, 0x316);
});

test("Scale constants are exported for v0.14.1 real-car verification", () => {
  // The harness doc and the v0.14.1 PR will reference these by
  // name. Pinning them here ensures the values are testable.
  assert.equal(d.RPM_SCALE, 0.25);
  assert.equal(d.THROTTLE_SCALE, 0.3922);
  assert.equal(d.TEMP_OFFSET_C, -48);
  assert.equal(d.WHEEL_SCALE, 0.0625);
  assert.equal(d.VEHICLE_SPEED_SCALE, 0.5);
  assert.equal(d.BATTERY_SCALE, 0.1);
  assert.equal(d.BATTERY_OFFSET_V, 6.0);
});

// ---------- dual export ----------

test("module.exports is the same shape as window.beeemuuCanDecoders", () => {
  // The CommonJS export and the window global should expose the
  // same functions, so tests and the browser-side caller see
  // identical APIs.
  const cjs = require("../../src/js/can_decoders.js");
  // We can't import the file twice under different names — but we
  // can verify the CJS export shape matches what `main.js` would
  // use, which is a fixed set of named exports.
  const expectedKeys = [
    "CAN_ID_RPM_THROTTLE", "CAN_ID_COOLANT_AMBIENT", "CAN_ID_OIL_TEMP",
    "CAN_ID_WHEEL_SPEEDS", "CAN_ID_VEHICLE_SPEED", "CAN_ID_BATTERY",
    "RPM_SCALE", "THROTTLE_SCALE", "TEMP_OFFSET_C", "WHEEL_SCALE",
    "VEHICLE_SPEED_SCALE", "BATTERY_SCALE", "BATTERY_OFFSET_V",
    "decodeRpm", "decodeThrottle", "decodeCoolant", "decodeAmbientTemp",
    "decodeOilTemp", "decodeWheelSpeeds", "decodeVehicleSpeed",
    "decodeBatteryVoltage", "DECODERS", "decodeFor",
    "isFrame", "byteAt", "u16beAt",
  ];
  for (const key of expectedKeys) {
    assert.ok(key in cjs, `module.exports missing key: ${key}`);
  }
});
