"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseBeemuuCsv } = require("../log_import_beemuu.js");

test("parseBeemuuCsv: parses basic native log with metadata", () => {
  const csv = [
    '# beemuu log v1 session_tag="Road test" vin="WBAXXXX"',
    "time_s,Engine speed (rpm),Coolant (C)",
    "0.00,800.00,27.00",
    "0.25,810.00,27.50",
  ].join("\n");
  const p = parseBeemuuCsv(csv);
  assert.equal(p.sessionTag, "Road test");
  assert.equal(p.metadata.vin, "WBAXXXX");
  assert.equal(p.bookmarks.length, 0);
  assert.ok(p.series.has("engine_speed"));
  assert.equal(p.series.get("engine_speed").label, "Engine speed");
  assert.equal(p.series.get("engine_speed").unit, "rpm");
  assert.equal(p.series.get("engine_speed").data.length, 2);
});

test("parseBeemuuCsv: parses bookmarks", () => {
  const csv = [
    "# beemuu log v1",
    '# bookmark time_s=3.00 label="Cold start"',
    '# bookmark time_s=12.50 label="Throttle open"',
    "time_s,RPM (rpm)",
    "0.00,800",
    "3.00,1200",
    "12.50,1500",
  ].join("\n");
  const p = parseBeemuuCsv(csv);
  assert.equal(p.bookmarks.length, 2);
  assert.deepEqual(p.bookmarks[0], { time: 3, label: "Cold start" });
  assert.deepEqual(p.bookmarks[1], { time: 12.5, label: "Throttle open" });
});

test("parseBeemuuCsv: handles units row and restores numeric data", () => {
  const csv = [
    "# beemuu log v1",
    "time_s,Speed (km/h),Temp (C)",
    "units,,",
    "0.00,0.00,20.00",
    "1.00,45.00,21.00",
  ].join("\n");
  const p = parseBeemuuCsv(csv);
  assert.ok(p.series.has("speed"));
  assert.equal(p.series.get("speed").unit, "km/h");
  assert.equal(p.series.get("temp").data.length, 2);
});
