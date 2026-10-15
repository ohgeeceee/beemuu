"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fd = require("../fleet_dashboard.js");

/* A deterministic "now" so a bucket never depends on the wall clock. */
const NOW = "2024-06-01";

/* A service item. Intervals are omitted unless the caller supplies them, so
 * the engine is never handed an interval it did not ask for. */
function item(id, interval_km = null, interval_days = null) {
  const it = { id, label: id + " service" };
  if (interval_km != null) it.interval_km = interval_km;
  if (interval_days != null) it.interval_days = interval_days;
  return it;
}

/* A service-history entry. */
function entry(date, odometer_km, items, cost = null) {
  const e = { date, odometer_km, items: items || [] };
  if (cost != null) e.cost = cost;
  return e;
}

/* A whole vehicle record with room for overrides. */
function vehicle(overrides = {}) {
  return Object.assign({
    id: "V1",
    label: "Test Car",
    odometer_km: 100000,
    service_history: [],
    dtcs: [],
    cycles: [],
  }, overrides);
}

/* A clean car: serviced twice, on schedule, nothing owed. */
function cleanVehicle() {
  return vehicle({
    id: "clean",
    label: "Clean",
    odometer_km: 58000,
    service_history: [
      entry("2024-01-01", 50000, [item("oil", 10000)]),
      entry("2024-06-01", 58000, [item("oil", 10000)]),
    ],
  });
}

/* ------------------------------------------------------------------ *
 * dates
 * ------------------------------------------------------------------ */

test("parseDate reads a strict ISO date to epoch days and rejects loose input", () => {
  assert.equal(fd.parseDate("1970-01-01"), 0);
  assert.equal(fd.parseDate("2024-01-02") - fd.parseDate("2024-01-01"), 1);
  assert.equal(fd.parseDate("01/02/2024"), null);
  assert.equal(fd.parseDate("2024-1-2"), null);
  assert.equal(fd.parseDate(""), null);
  assert.equal(fd.parseDate(null), null);
  assert.equal(fd.parseDate(20240101), null);
});

test("parseDate rejects a roll-over date instead of normalising it", () => {
  assert.equal(fd.parseDate("2024-02-31"), null);
  assert.equal(fd.parseDate("2024-13-01"), null);
});

test("daysBetween and kmBetween measure a difference and null out on junk", () => {
  assert.equal(fd.daysBetween("2024-01-01", "2024-01-11"), 10);
  assert.equal(fd.daysBetween("2024-01-11", "2024-01-01"), -10);
  assert.equal(fd.daysBetween("nope", "2024-01-01"), null);
  assert.equal(fd.kmBetween(50000, 62000), 12000);
  assert.equal(fd.kmBetween(NaN, 100), null);
  assert.equal(fd.kmBetween(100, null), null);
});

/* ------------------------------------------------------------------ *
 * serviceItems
 * ------------------------------------------------------------------ */

test("serviceItems computes the next due point from a distance interval", () => {
  const v = vehicle({ odometer_km: 55000, service_history: [entry("2024-01-01", 50000, [item("oil", 10000)])] });
  const it = fd.serviceItems(v, NOW)[0];
  assert.equal(it.id, "oil");
  assert.equal(it.last_done_km, 50000);
  assert.equal(it.last_done_date, "2024-01-01");
  assert.equal(it.due_at_km, 60000);
  assert.equal(it.km_remaining, 5000);
  assert.equal(it.status, "ok");
});

test("serviceItems calls an item exactly at its due distance overdue", () => {
  const v = vehicle({ odometer_km: 60000, service_history: [entry("2024-01-01", 50000, [item("oil", 10000)])] });
  const it = fd.serviceItems(v, NOW)[0];
  assert.equal(it.km_remaining, 0);
  assert.equal(it.status, "overdue");
});

test("serviceItems splits due_soon from ok at exactly DUE_SOON_KM", () => {
  const hist = [entry("2024-01-01", 50000, [item("oil", 10000)])];
  const soon = fd.serviceItems(vehicle({ odometer_km: 59000, service_history: hist }), NOW)[0];
  const ok = fd.serviceItems(vehicle({ odometer_km: 58999, service_history: hist }), NOW)[0];
  assert.equal(soon.km_remaining, fd.DUE_SOON_KM);
  assert.equal(soon.status, "due_soon");
  assert.equal(ok.km_remaining, fd.DUE_SOON_KM + 1);
  assert.equal(ok.status, "ok");
});

test("serviceItems drives status from the calendar interval alone", () => {
  const v = vehicle({ odometer_km: 50000, service_history: [entry("2024-01-01", 50000, [item("oil", null, 365)])] });
  const it = fd.serviceItems(v, NOW)[0];
  assert.equal(it.due_at_km, null);
  assert.equal(it.km_remaining, null);
  assert.equal(it.due_at_date, "2024-12-31");
  assert.equal(it.days_remaining, fd.daysBetween(NOW, "2024-12-31"));
  assert.equal(it.status, "ok");
});

test("serviceItems calls an item exactly at its due date overdue", () => {
  const v = vehicle({ odometer_km: 50000, service_history: [entry("2024-01-01", 50000, [item("oil", null, 365)])] });
  const it = fd.serviceItems(v, "2024-12-31")[0];
  assert.equal(it.days_remaining, 0);
  assert.equal(it.status, "overdue");
});

test("serviceItems reports an item with no interval as unknown, never ok", () => {
  const v = vehicle({ odometer_km: 50000, service_history: [entry("2024-01-01", 50000, [item("oil")])] });
  const it = fd.serviceItems(v, NOW)[0];
  assert.equal(it.interval_km, null);
  assert.equal(it.interval_days, null);
  assert.equal(it.km_remaining, null);
  assert.equal(it.days_remaining, null);
  assert.equal(it.status, "unknown");
});

test("serviceItems reports unknown when a distance interval has no odometer to measure against", () => {
  const v = vehicle({ odometer_km: null, service_history: [entry("2024-01-01", 50000, [item("oil", 10000)])] });
  const it = fd.serviceItems(v, NOW)[0];
  assert.equal(it.interval_km, 10000);
  assert.equal(it.due_at_km, 60000);
  assert.equal(it.km_remaining, null);
  assert.equal(it.status, "unknown");
});

test("serviceItems keeps only the most recent service of an item", () => {
  const v = vehicle({ odometer_km: 60000, service_history: [
    entry("2024-01-01", 40000, [item("oil", 10000)]),
    entry("2024-06-01", 55000, [item("oil", 10000)]),
  ] });
  const it = fd.serviceItems(v, NOW)[0];
  assert.equal(it.last_done_km, 55000);
  assert.equal(it.last_done_date, "2024-06-01");
  assert.equal(it.due_at_km, 65000);
});

test("serviceItems takes the worst of the distance and calendar signals", () => {
  const v = vehicle({ odometer_km: 58000, service_history: [entry("2024-01-01", 50000, [item("oil", 10000, 365)])] });
  const it = fd.serviceItems(v, "2024-12-31")[0];
  assert.equal(it.km_remaining, 2000);          // comfortably ok by distance
  assert.equal(it.days_remaining, 0);           // but exactly due by calendar
  assert.equal(it.status, "overdue");
});

test("serviceItems tolerates junk vehicles and empty histories", () => {
  assert.deepEqual(fd.serviceItems(null, NOW), []);
  assert.deepEqual(fd.serviceItems(vehicle({ service_history: null }), NOW), []);
  assert.deepEqual(fd.serviceItems({ odometer_km: 100 }, NOW), []);
  assert.deepEqual(fd.serviceItems(vehicle({ service_history: [null, 7, "x"] }), NOW), []);
});

/* ------------------------------------------------------------------ *
 * odometerHealth
 * ------------------------------------------------------------------ */

test("odometerHealth accepts a clean, increasing odometer sequence", () => {
  const v = vehicle({ service_history: [
    entry("2024-01-01", 40000, []), entry("2024-03-01", 50000, []), entry("2024-06-01", 60000, []),
  ] });
  const h = fd.odometerHealth(v);
  assert.equal(h.entries, 3);
  assert.equal(h.monotonic, true);
  assert.equal(h.duplicates, false);
  assert.equal(h.out_of_order, false);
  assert.deepEqual(h.problems, []);
});

test("odometerHealth surfaces a non-monotonic odometer without sorting it", () => {
  const v = vehicle({ service_history: [
    entry("2024-01-01", 60000, []), entry("2024-03-01", 40000, []),
  ] });
  const h = fd.odometerHealth(v);
  assert.equal(h.monotonic, false);
  assert.equal(h.out_of_order, true);
  assert.equal(h.problems[0].kind, "out_of_order");
  assert.equal(h.problems[0].previous, 60000); // the recorded order is intact
});

test("odometerHealth flags a duplicated odometer reading", () => {
  const v = vehicle({ service_history: [
    entry("2024-01-01", 50000, []), entry("2024-03-01", 50000, []),
  ] });
  const h = fd.odometerHealth(v);
  assert.equal(h.duplicates, true);
  assert.equal(h.monotonic, false);
  assert.equal(h.problems[0].kind, "duplicate_odometer");
});

test("odometerHealth flags an unreadable odometer value", () => {
  const v = vehicle({ service_history: [
    entry("2024-01-01", 50000, []), entry("2024-03-01", NaN, []),
  ] });
  const h = fd.odometerHealth(v);
  assert.equal(h.monotonic, false);
  assert.ok(h.problems.some(p => p.kind === "unparseable_odometer"));
});

test("odometerHealth tolerates a vehicle with no history", () => {
  assert.equal(fd.odometerHealth(null).entries, 0);
  assert.equal(fd.odometerHealth(null).monotonic, null);
  assert.equal(fd.odometerHealth(vehicle({ service_history: [] })).entries, 0);
});

/* ------------------------------------------------------------------ *
 * costProfile
 * ------------------------------------------------------------------ */

test("costProfile totals, averages and medians the service costs", () => {
  const v = vehicle({ service_history: [
    entry("2024-01-01", 40000, [], 100),
    entry("2024-03-01", 45000, [], 200),
    entry("2024-06-01", 50000, [], 300),
  ] });
  const c = fd.costProfile(v);
  assert.equal(c.entries, 3);
  assert.equal(c.total, 600);
  assert.equal(c.mean, 200);
  assert.equal(c.median, 200);
  assert.equal(c.outlier_entries, 0);
});

test("costProfile flags a cost outlier only once there are enough entries", () => {
  const few = fd.costProfile(vehicle({ service_history: [
    entry("2024-01-01", 40000, [], 100), entry("2024-03-01", 45000, [], 100), entry("2024-06-01", 50000, [], 900),
  ] }));
  assert.equal(few.entries, 3);
  assert.equal(few.outlier_entries, 0); // below MIN_COST_ENTRIES — no rule runs

  const many = fd.costProfile(vehicle({ service_history: [
    entry("2024-01-01", 40000, [], 100), entry("2024-02-01", 42000, [], 100),
    entry("2024-03-01", 45000, [], 100), entry("2024-06-01", 50000, [], 900),
  ] }));
  assert.equal(many.entries, 4);
  assert.equal(many.median, 100);
  assert.equal(many.outlier_entries, 1);
  assert.equal(many.outliers[0].cost, 900);
});

test("costProfile tolerates a vehicle with no costs", () => {
  const c = fd.costProfile(vehicle({ service_history: [entry("2024-01-01", 40000, [])] }));
  assert.equal(c.entries, 0);
  assert.equal(c.total, 0);
  assert.equal(c.mean, null);
  assert.equal(c.median, null);
  assert.deepEqual(fd.costProfile(null).outliers, []);
});

/* ------------------------------------------------------------------ *
 * gradeVehicle
 * ------------------------------------------------------------------ */

test("gradeVehicle gives a clean, serviced vehicle an A", () => {
  const g = fd.gradeVehicle(cleanVehicle(), NOW);
  assert.equal(g.score, 100);
  assert.equal(g.grade, "A");
  assert.equal(g.confidence, 1);
  assert.equal(g.overdue_count, 0);
  assert.deepEqual(g.reasons, []);
});

test("gradeVehicle penalises an overdue item and counts it", () => {
  const v = vehicle({ odometer_km: 62000, service_history: [entry("2024-01-01", 50000, [item("oil", 10000)])] });
  const g = fd.gradeVehicle(v, NOW);
  assert.equal(g.overdue_count, 1);
  assert.equal(g.due_soon_count, 0);
  assert.equal(g.score, 85);
  assert.equal(g.grade, "B");
  assert.match(g.reasons.join(" "), /overdue/);
});

test("gradeVehicle counts an item that is only due soon", () => {
  const v = vehicle({ odometer_km: 59500, service_history: [entry("2024-01-01", 50000, [item("oil", 10000)])] });
  const g = fd.gradeVehicle(v, NOW);
  assert.equal(g.overdue_count, 0);
  assert.equal(g.due_soon_count, 1);
  assert.equal(g.score, 95);
  assert.match(g.reasons.join(" "), /due within/);
});

test("gradeVehicle names the open DTCs and charges for them", () => {
  const v = cleanVehicle();
  v.dtcs = [{ code: "2DED" }, { code: "2E77" }];
  const g = fd.gradeVehicle(v, NOW);
  assert.equal(g.open_dtcs, 2);
  assert.deepEqual(g.open_dtc_codes, ["2DED", "2E77"]);
  assert.equal(g.score, 84);
  assert.equal(g.grade, "B");
  assert.match(g.reasons.join(" "), /2DED/);
});

test("gradeVehicle refuses a vehicle with no service history", () => {
  const g = fd.gradeVehicle(vehicle({ service_history: [] }), NOW);
  assert.equal(g.grade, null);
  assert.equal(g.score, null);
  assert.equal(g.confidence, 0);
  assert.equal(g.overdue_count, null);
  assert.match(g.reasons.join(" "), /no service history/);
});

test("gradeVehicle refuses a vehicle with no odometer", () => {
  const v = vehicle({ odometer_km: null, service_history: [entry("2024-01-01", 50000, [item("oil", 10000)])] });
  const g = fd.gradeVehicle(v, NOW);
  assert.equal(g.grade, null);
  assert.equal(g.score, null);
  assert.match(g.reasons.join(" "), /no odometer/);
});

test("gradeVehicle refuses a vehicle whose date cannot be parsed", () => {
  const bad = fd.gradeVehicle(vehicle({
    odometer_km: 58000,
    service_history: [entry("2024-13-01", 50000, [item("oil", 10000)])],
  }), NOW);
  assert.equal(bad.grade, null);
  assert.equal(bad.score, null);
  assert.match(bad.reasons.join(" "), /unparseable date/);

  const missing = fd.gradeVehicle(vehicle({
    odometer_km: 58000,
    service_history: [entry(null, 50000, [item("oil", 10000)])],
  }), NOW);
  assert.equal(missing.grade, null);
  assert.match(missing.reasons.join(" "), /unparseable date/);
});

test("gradeVehicle is deterministic under an injected now", () => {
  const v = cleanVehicle();
  assert.deepEqual(fd.gradeVehicle(v, NOW), fd.gradeVehicle(v, NOW));
  assert.deepEqual(fd.serviceItems(v, NOW), fd.serviceItems(v, fd.parseDate(NOW)));
});

test("gradeFor maps the letter-grade bands", () => {
  assert.equal(fd.gradeFor(90), "A");
  assert.equal(fd.gradeFor(89), "B");
  assert.equal(fd.gradeFor(80), "B");
  assert.equal(fd.gradeFor(79), "C");
  assert.equal(fd.gradeFor(69), "D");
  assert.equal(fd.gradeFor(59), "F");
  assert.equal(fd.gradeFor(null), null);
});

/* ------------------------------------------------------------------ *
 * fleet
 * ------------------------------------------------------------------ */

test("fleet ranks vehicles best-first with the ungraded last", () => {
  const overdue = vehicle({ id: "overdue", label: "Overdue", odometer_km: 62000,
    service_history: [entry("2024-01-01", 50000, [item("oil", 10000)])] });
  const mystery = vehicle({ id: "mystery", label: "Mystery", service_history: [] });
  const r = fd.fleet([overdue, cleanVehicle(), mystery], NOW);
  assert.deepEqual(r.vehicles.map(v => v.id), ["clean", "overdue", "mystery"]);
  assert.equal(r.summary.n_vehicles, 3);
  assert.equal(r.summary.n_graded, 2);
  assert.equal(r.summary.n_ungraded, 1);
  assert.equal(r.summary.urgent, 1);
  assert.match(r.summary.headline, /1 vehicle overdue/);
});

test("fleet totals the service spend and tolerates junk input", () => {
  const v = vehicle({ id: "a", odometer_km: 58000, service_history: [
    entry("2024-01-01", 50000, [item("oil", 10000)], 200),
    entry("2024-06-01", 58000, [item("oil", 10000)], 300),
  ] });
  assert.equal(fd.fleet([v], NOW).summary.total_cost, 500);

  assert.deepEqual(fd.fleet(null).vehicles, []);
  assert.equal(fd.fleet(null).summary.n_vehicles, 0);
  assert.equal(fd.fleet([]).summary.headline, "no vehicles to grade");
  assert.match(fd.fleet([vehicle({ service_history: [] })], NOW).summary.headline, /no vehicle could be graded/);
});

/* ------------------------------------------------------------------ *
 * thresholds
 * ------------------------------------------------------------------ */

test("the exported thresholds are pinned", () => {
  assert.equal(fd.MIN_COST_ENTRIES, 4);
  assert.equal(fd.OUTLIER_MAD_Z, 3.5);
  assert.equal(fd.DUE_SOON_KM, 1000);
  assert.equal(fd.DUE_SOON_DAYS, 30);
  assert.equal(fd.OVERDUE_PENALTY, 15);
  assert.equal(fd.DUE_SOON_PENALTY, 5);
  assert.equal(fd.DTC_PENALTY, 8);
  assert.equal(fd.GRADE_A, 90);
});
