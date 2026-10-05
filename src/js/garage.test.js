"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const garage = require("./garage.js");

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("garage upserts a VIN match and selects the existing local vehicle", () => {
  const store = storage();
  const first = garage.upsert(store, { vin: "wbaxxx", label: "Daily" });
  const id = first.activeId;
  const updated = garage.upsert(store, { vin: "WBAXXX", label: "Updated" });
  assert.equal(updated.vehicles.length, 1);
  assert.equal(updated.activeId, id);
  assert.equal(updated.vehicles[0].label, "Updated");
});

test("garage supports manual records, selection, and removal", () => {
  const store = storage();
  const state = garage.addManual(store, "Track car");
  assert.equal(state.vehicles[0].vin, null);
  const second = garage.upsert(store, { vin: "WBA2", label: "Daily" });
  const dailyId = second.vehicles.find(v => v.label === "Daily").id;
  const selected = garage.select(store, state.vehicles[0].id);
  assert.equal(selected.activeId, state.vehicles[0].id);
  const removed = garage.remove(store, state.vehicles[0].id);
  assert.equal(removed.activeId, null);
  assert.equal(removed.vehicles.length, 1);
  assert.equal(removed.vehicles[0].id, dailyId);
});

test("garage rejects selecting an unknown local id", () => {
  assert.throws(() => garage.select(storage(), "missing"), /Choose a vehicle/);
});
