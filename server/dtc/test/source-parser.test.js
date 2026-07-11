"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { parseJsonSource, parseDelimitedText, reconcileRecords } = require("../source-parser");

test("parseJsonSource accepts JSON arrays and objects with records", () => {
  const arrayRecords = parseJsonSource('[{"code":"P0301","short_desc":"Cylinder 1"}]');
  const wrappedRecords = parseJsonSource('{"records":[{"code":"2A82","short_desc":"VANOS"}]}');

  assert.equal(arrayRecords.length, 1);
  assert.equal(wrappedRecords[0].code, "2A82");
});

test("parseDelimitedText maps simple CSV diagnostic sources to raw records", () => {
  const csv = [
    "code,type,ecu_module,short_desc,symptoms,causes,fixes,compatibility",
    "2A82,bmw_hex,DME,VANOS intake,rough idle|limp mode,dirty oil|solenoid,check oil|swap solenoids,N54|E90"
  ].join("\n");

  const rows = parseDelimitedText(csv);

  assert.deepEqual(rows[0], {
    code: "2A82",
    type: "bmw_hex",
    ecu_module: "DME",
    short_desc: "VANOS intake",
    symptoms: ["rough idle", "limp mode"],
    causes: ["dirty oil", "solenoid"],
    fixes: ["check oil", "swap solenoids"],
    compatibility: ["N54", "E90"]
  });
});

test("reconcileRecords normalizes, dedupes by code, and merges arrays", () => {
  const records = reconcileRecords([
    {
      code: "30ff",
      ecu_module: "dme",
      short_desc: "Low boost",
      symptoms: ["sluggish acceleration"],
      causes: ["boost leak"],
      fixes: ["smoke test"],
      compatibility: ["n54"]
    },
    {
      code: "30FF",
      ecu_module: "DME",
      short_desc: "Turbocharger charge-air pressure too low",
      symptoms: ["wastegate rattle"],
      causes: ["vacuum leak"],
      fixes: ["inspect vacuum lines"],
      compatibility: ["E90"]
    }
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].short_desc, "Turbocharger charge-air pressure too low");
  assert.deepEqual(records[0].symptoms, ["sluggish acceleration", "wastegate rattle"]);
  assert.deepEqual(records[0].compatibility, ["N54", "E90"]);
});
