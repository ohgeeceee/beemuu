"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseBootmod3Csv, mapHeaderToId } = require("../log_import_bootmod3.js");

test("mapHeaderToId known", ()=>{
  assert.equal(mapHeaderToId("RPM"), "rpm");
  assert.equal(mapHeaderToId("Boost (psi)"), "boost_cmd");
  assert.equal(mapHeaderToId("Unknown Col"), "unknown_col");
});
test("parse bootmod3 csv", ()=>{
  const csv = "RPM,Boost (psi),Lambda\n3000,12.5,0.98\n3100,13.0,1.00";
  const { ids, rows, series } = parseBootmod3Csv(csv);
  assert.deepEqual(ids, ["rpm","boost_cmd","lambda_1"]);
  assert.equal(rows.length, 2);
  assert.equal(series.get("rpm").length, 2);
  assert.equal(series.get("rpm")[0].y, 3000);
});
test("parse mhd csv", ()=>{
  const csv = "RPM,IAT,Coolant\n2500,30,85\n2600,31,86";
  const { series } = parseBootmod3Csv(csv);
  assert.equal(series.get("iat")[0].y, 30);
});
