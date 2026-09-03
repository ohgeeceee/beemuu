"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const dec = require("../can_decoders.js");

test("exports expected CAN IDs and helpers", () => {
  assert.ok(dec.CAN_ID_RPM_THROTTLE === 0x0AA);
  assert.ok(dec.CAN_ID_GEAR === 0x3B4);
  assert.ok(dec.CAN_ID_ENGINE_TORQUE === 0x0D0);
  assert.ok(typeof dec.decodeFor === "function");
  assert.ok(typeof dec.decodeGear === "function");
});

test("decodeRpm and decodeThrottle from 0x0AA", () => {
  // 0x1234 * 0.25 = 1165
  const frame = [0x12, 0x34, 0, 0, 0, 0, 0x40, 0];
  const rpm = dec.decodeRpm(frame);
  const thr = dec.decodeThrottle(frame);
  assert.equal(Math.round(rpm), 1165);
  assert.ok(thr > 24 && thr < 26); // 0x40 * 0.3922 ≈ 25.1
});

test("decodeCoolant and ambient from 0x1D0", () => {
  const frame = [0x5A, 0x60, 0,0,0,0,0,0]; // 90-48=42, 96-48=48
  assert.equal(dec.decodeCoolant(frame), 42);
  assert.equal(dec.decodeAmbientTemp(frame), 48);
});

test("decodeOilTemp from 0x545", () => {
  const frame = [0, 0x5A, 0,0,0,0,0,0];
  assert.equal(dec.decodeOilTemp(frame), 42);
});

test("decodeWheelSpeeds from 0x0CE", () => {
  // 100 km/h = 100 / 0.0625 = 1600 = 0x0640
  const frame = [0x06, 0x40, 0x06, 0x40, 0x06, 0x40, 0x06, 0x40];
  const ws = dec.decodeWheelSpeeds(frame);
  assert.deepEqual(ws, [100, 100, 100, 100]);
});

test("decodeVehicleSpeed from 0x130", () => {
  const frame = [100, 0,0,0,0,0,0,0]; // 100 * 0.5 = 50 km/h
  assert.equal(dec.decodeVehicleSpeed(frame), 50);
});

test("decodeBatteryVoltage from 0x316", () => {
  const frame = [80, 0,0,0,0,0,0,0]; // 80*0.1 + 6 = 14.0
  assert.equal(dec.decodeBatteryVoltage(frame), 14.0);
});

test("decodeGear from 0x3B4 (v0.17.0)", () => {
  assert.equal(dec.decodeGear([0, 0]).gear, 0);   // P
  assert.equal(dec.decodeGear([0, 1]).gear, 1);   // R
  assert.equal(dec.decodeGear([0, 2]).gear, 2);   // N
  assert.equal(dec.decodeGear([0, 3]).gear, 3);   // D1-ish
  assert.equal(dec.decodeGear([0, 5]).gear, 5);
});

test("decodeEngineTorque from 0x0D0 (v0.17.0)", () => {
  const frame = [0x00, 0x64, 0,0,0,0,0,0]; // 0x0064 = 100 * 0.5 = 50 Nm
  assert.equal(dec.decodeEngineTorque(frame).torque, 50);
});

test("decodeFor dispatches correctly", () => {
  const rpmFrame = [0x07, 0xD0, 0,0,0,0,0,0]; // 0x07D0 * 0.25 = 500 RPM
  const out = dec.decodeFor(0x0AA, rpmFrame);
  assert.equal(out.rpm, 500);
});

test("decodeFor unknown ID returns null", () => {
  assert.equal(dec.decodeFor(0x999, [1,2,3,4,5,6,7,8]), null);
});

test("malformed frame returns null", () => {
  assert.equal(dec.decodeRpm(null), null);
  assert.equal(dec.decodeGear([]), null);
});

test("decodeSteeringAngle from 0x1B4 (v0.17.0)", () => {
  const frame = [0x00, 0x64, 0,0,0,0,0,0]; // 100 * 0.1 = 10 deg
  assert.equal(dec.decodeSteeringAngle(frame).steering, 10);
  // negative
  const neg = [0xFF, 0x9C, 0,0,0,0,0,0]; // -100 signed *0.1 = -10
  assert.equal(dec.decodeSteeringAngle(neg).steering, -10);
});

test("decodeBrakePressure from 0x0C0 (v0.17.0)", () => {
  const frame = [0x00, 0xC8, 0,0,0,0,0,0]; // 200 * 0.1 = 20
  assert.equal(dec.decodeBrakePressure(frame).brake, 20);
});
