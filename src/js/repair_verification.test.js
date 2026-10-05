"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const repair = require("./repair_verification.js");

test("repair comparison groups DTCs by ECU address and code", () => {
  const before = [
    { name: "DME", address: 1, dtcs: [{ code: "2A82", text: "VANOS" }, { code: "29E0" }] },
    { name: "EGS", address: 2, dtcs: [{ code: "2A82" }] },
  ];
  const after = [
    { name: "DME", address: 1, dtcs: [{ code: "29E0" }, { code: "2A82" }] },
    { name: "EGS", address: 2, dtcs: [] },
    { name: "DSC", address: 3, dtcs: [{ code: "5E20" }] },
  ];
  const result = repair.compareFaults(before, after);
  assert.deepEqual(result.cleared, [{ code: "2A82", address: 2, module: "EGS" }]);
  assert.equal(result.remaining.length, 2);
  assert.deepEqual(result.newFaults, [{ code: "5E20", address: 3, module: "DSC" }]);
});

test("repair value comparisons require matching identifiers and units", () => {
  const result = repair.compareValues(
    [{ id: "rpm", label: "RPM", value: 800, unit: "rpm" }, { id: "temp", value: 90, unit: "C" }],
    [{ id: "rpm", label: "RPM", value: 900, unit: "rpm" }, { id: "temp", value: 95, unit: "F" }, { id: "new", value: 1, unit: "" }],
  );
  assert.deepEqual(result[0], { id: "new", label: "new", unit: "", before: undefined, after: 1, comparable: false, delta: null });
  assert.equal(result.find(x => x.id === "rpm").delta, 100);
  assert.equal(result.find(x => x.id === "temp").comparable, false);
});

test("repair checks require both scans and never claim a repair verdict", () => {
  assert.throws(() => repair.buildRepairCheck({ before: {} }), /baseline and a follow-up/);
  const item = repair.buildRepairCheck({ vehicleId: "car-1", before: { dtcs: [] }, after: { dtcs: [] } });
  assert.equal(item.vehicleId, "car-1");
  assert.equal(item.assessment, "evidence-comparison-only");
});
