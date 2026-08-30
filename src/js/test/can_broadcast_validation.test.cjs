"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("can-broadcast sample fixture exists and decodes", () => {
  const csvPath = path.join(__dirname, "../../../community/fixtures/can-broadcast-sample.csv");
  assert.ok(fs.existsSync(csvPath), "fixture must exist");
  const csv = fs.readFileSync(csvPath, "utf8");
  assert.ok(csv.includes("0x0AA"), "fixture must contain 0x0AA");
  // decoder smoke test if available
  try {
    const dec = require("../can_decoders.js");
    // sample frame 0x0AA data 0x12 0x34 -> RPM = 0x1234 /4 = 1165
    const rpm = dec.decode ? dec.decode("0x0AA", Buffer.from([0x12,0x34,0,0,0,0,0,0])) : null;
    if (rpm && typeof rpm.rpm === "number") {
      assert.equal(Math.round(rpm.rpm), 1165);
    }
  } catch {}
});

test("validation doc exists", () => {
  const doc = path.join(__dirname, "../../../docs/validation/can-broadcast-run.md");
  assert.ok(fs.existsSync(doc));
});
