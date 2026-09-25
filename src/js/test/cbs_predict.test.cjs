/* Tests for `src/js/cbs_predict.js` — the Predictive CBS Timeline engine.
 * Pure and deterministic (injectable nowIso). Run with `node --test`. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { CBS_ITEMS, dailyKm, measuredWearRate, predictItem, predictAll, status } = require("../cbs_predict.js");

const NOW = "2026-09-16T12:00:00Z";

test("catalog defines the standard BMW CBS items", () => {
  for (const id of ["front_brake", "rear_brake", "brake_fluid", "engine_oil", "microfilter", "spark_plugs", "coolant"]) {
    assert.ok(CBS_ITEMS[id], `missing ${id}`);
  }
});

test("dailyKm — needs at least two dated readings", () => {
  assert.equal(dailyKm([]), null);
  assert.equal(dailyKm([{ km: 1000, date: "2026-01-01" }]), null);
  assert.equal(dailyKm([{ km: 1000, date: "2026-01-01" }, { km: 1000, date: "2026-01-02" }]), 0);
  const rate = dailyKm([{ km: 5000, date: "2026-01-01" }, { km: 6200, date: "2026-01-11" }]);
  assert.equal(Math.round(rate), 120); // 1200 km over 10 days
  assert.equal(dailyKm([{ km: 5000, date: "2026-01-01" }, { km: 6200, date: "2026-01-11" }, { km: 3000, date: "bad" }]), 120);
});

test("measuredWearRate — linear wear from two points, value units per 1000km", () => {
  const hist = [
    { id: "front_brake", km: 10000, value: 8 },
    { id: "front_brake", km: 20000, value: 6 },
  ];
  assert.equal(measuredWearRate("front_brake", hist), 0.2); // 2mm per 10k km
  // filters to the item's own points and sorts by km
  assert.equal(measuredWearRate("front_brake", [...hist, { id: "rear_brake", km: 5000, value: 9 }]), 0.2);
  assert.equal(measuredWearRate("front_brake", [{ id: "front_brake", km: 20000, value: 6 }, { id: "front_brake", km: 10000, value: 8 }]), 0.2);
  assert.equal(measuredWearRate("front_brake", []), null);
  assert.equal(measuredWearRate("front_brake", null), null);
});

test("predictItem — wear-based brake pads extrapolate to threshold", () => {
  const p = predictItem(CBS_ITEMS.front_brake, 4.2, 40000, [], "mixed", 60, NOW);
  assert.equal(p.item, "front_brake");
  assert.equal(p.current_status, "OK");
  // default wear 0.14mm/1000km; gap 2.2mm => ~15714 km
  assert.equal(Math.round(p.predicted_due_km), Math.round(40000 + (4.2 - 2) / 0.14 * 1000));
  assert.ok(p.predicted_due_date, "due date computed from pace");
  assert.equal(p.driving_adjustment, "100% of mixed-driving wear");
});

test("predictItem — aggressive driving accelerates wear (later becomes sooner)", () => {
  const mixed = predictItem(CBS_ITEMS.front_brake, 4.2, 40000, [], "mixed", 60, NOW);
  const aggressive = predictItem(CBS_ITEMS.front_brake, 4.2, 40000, [], "aggressive", 60, NOW);
  assert.ok(aggressive.predicted_due_km < mixed.predicted_due_km);
  assert.match(aggressive.driving_adjustment, /135%/);
});

test("predictItem — measured wear overrides the default when history exists", () => {
  const hist = [
    { id: "front_brake", km: 10000, value: 8 },
    { id: "front_brake", km: 20000, value: 6 }, // 0.2mm/1000km (faster than default)
  ];
  const p = predictItem(CBS_ITEMS.front_brake, 6, 20000, hist, "mixed", 60, NOW);
  const expectedKm = 20000 + (6 - 2) / 0.2 * 1000; // 40000 km
  assert.equal(Math.round(p.predicted_due_km), Math.round(expectedKm));
  assert.equal(p.note, "measured wear");
  assert.equal(p.confidence, 75);
});

test("predictItem — distance-based interval items add the value to current km", () => {
  const p = predictItem(CBS_ITEMS.engine_oil, 8000, 40000, [], "mixed", 60, NOW);
  assert.equal(p.predicted_due_km, 48000); // 40000 current + 8000 remaining
  assert.equal(p.note, "distance-based interval");
  const date = predictItem(CBS_ITEMS.engine_oil, 8000, 40000, [], "mixed", 60, NOW);
  assert.ok(date.predicted_due_date); // 8000km / 60 per day ~ 133 days out
});

test("predictItem — time-based interval items (fluid) give a calendar date", () => {
  const p = predictItem(CBS_ITEMS.brake_fluid, 12, 40000, [], "mixed", 60, NOW);
  assert.equal(p.note, "time-based interval");
  assert.ok(p.predicted_due_date > NOW.slice(0, 10), "due ~12 months out");
  assert.equal(p.current_status, "OK");
});

test("status — overdue / due classification", () => {
  assert.equal(status(CBS_ITEMS.front_brake, 1.5, 40000, 42000), "OVERDUE"); // below pad threshold
  assert.equal(status(CBS_ITEMS.front_brake, 4.2, 40000, 35000), "OK"); // due in the future
  assert.equal(status(CBS_ITEMS.front_brake, 4.2, 40000, 40000), "DUE"); // due now
  assert.equal(status(CBS_ITEMS.engine_oil, 0, 40000, 42000), "OVERDUE"); // interval exhausted
  assert.equal(status(CBS_ITEMS.brake_fluid, 0, null, 40000), "OVERDUE");
});

test("predictAll — returns all provided items sorted by soonest due", () => {
  const values = { front_brake: 4.2, engine_oil: 8000, brake_fluid: 0.5 };
  const snap = [{ km: 30000, date: "2026-01-01" }, { km: 34000, date: "2026-04-16" }];
  const out = predictAll(values, 40000, [], "mixed", snap, NOW);
  // brake fluid (0.5 months, ~15 days) should be soonest; engine oil
  // (8000km at ~37.7km/day ≈ 212 days) next; front brake last.
  assert.equal(out[0].item, "brake_fluid");
  assert.equal(out.length, 3);
  for (const p of out) assert.ok(p.predicted_due_km != null || p.predicted_due_date);
});

test("predictAll — missing values are skipped", () => {
  const out = predictAll({ front_brake: 5 }, 40000, [], "mixed", [], NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].item, "front_brake");
});
