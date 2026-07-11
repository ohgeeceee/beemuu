"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeCode,
  normalizeRecord,
  inferDtcType,
  DTC_TYPES
} = require("../normalizer");

test("normalizeCode uppercases and accepts OBD-II and BMW hex codes", () => {
  assert.equal(normalizeCode(" p0301 "), "P0301");
  assert.equal(normalizeCode("2a82"), "2A82");
  assert.equal(normalizeCode("0x30ff"), "30FF");
});

test("inferDtcType separates generic OBD-II from BMW proprietary hex", () => {
  assert.equal(inferDtcType("P0301"), DTC_TYPES.OBD2);
  assert.equal(inferDtcType("P2A00"), DTC_TYPES.OBD2);
  assert.equal(inferDtcType("2A82"), DTC_TYPES.BMW_HEX);
});

test("normalizeRecord returns the canonical lean schema", () => {
  const record = normalizeRecord({
    code: " 2a82 ",
    type: "BMW Proprietary Hex",
    ecu_module: " dme ",
    short_desc: " VANOS intake mechanism fault ",
    symptoms: ["rough idle", "rough idle", "reduced power"],
    causes: "sticking solenoid; dirty oil",
    fixes: ["1. Check oil", "2. Swap VANOS solenoids"],
    compatibility: ["n54", "E90", "n54"]
  });

  assert.deepEqual(record, {
    code: "2A82",
    type: "bmw_hex",
    ecu_module: "DME",
    short_desc: "VANOS intake mechanism fault",
    symptoms: ["rough idle", "reduced power"],
    causes: ["sticking solenoid", "dirty oil"],
    fixes: ["1. Check oil", "2. Swap VANOS solenoids"],
    compatibility: ["N54", "E90"]
  });
});

test("normalizeRecord rejects malformed or incomplete records", () => {
  assert.throws(() => normalizeCode("XYZ"), /Invalid DTC code/);
  assert.throws(
    () => normalizeRecord({ code: "P0301", ecu_module: "DME" }),
    /Missing short_desc/
  );
  assert.throws(
    () =>
      normalizeRecord({
        code: "P0301",
        type: "unknown",
        ecu_module: "DME",
        short_desc: "Cylinder 1 misfire detected"
      }),
    /Unsupported DTC type/
  );
});
