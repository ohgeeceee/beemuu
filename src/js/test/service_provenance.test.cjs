"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const p = require("../service_provenance.js");

/* One history entry, the shape a garage already holds. */
function entry(date, odometer_km, extra = {}) {
  return Object.assign({ date, odometer_km }, extra);
}

/* A clean five-entry history: rising odometers, rising dates, distinct items,
 * tight costs. run with now = 2026-06-01 it has nothing to flag. */
function clean() {
  return [
    { date: "2026-01-05", odometer_km: 40000, invoice_no: "A1", items: ["oil"], cost: 210 },
    { date: "2026-02-09", odometer_km: 48000, invoice_no: "A2", items: ["brake fluid"], cost: 230 },
    { date: "2026-03-15", odometer_km: 56000, invoice_no: "A3", items: ["inspection"], cost: 220 },
    { date: "2026-04-20", odometer_km: 64000, invoice_no: "A4", items: ["oil", "filter"], cost: 240 },
    { date: "2026-05-25", odometer_km: 72000, invoice_no: "A5", items: ["tyres"], cost: 215 },
  ];
}

/* ------------------------------------------------------------------ *
 * thresholds
 * ------------------------------------------------------------------ */

test("the judgeable, gap and future thresholds are exported and pinned", () => {
  assert.equal(p.MIN_ENTRIES, 3);
  assert.equal(p.MAX_GAP_KM, 40000);
  assert.equal(p.MIN_COST_ENTRIES, 5);
  assert.equal(p.MAX_FUTURE_DAYS, 1);
});

test("the robust cost rule's modified z-score cutoff is pinned", () => {
  assert.equal(p.MAD_K, 3.5);
});

/* ------------------------------------------------------------------ *
 * field plumbing
 * ------------------------------------------------------------------ */

test("parseDate reads an ISO day as UTC midnight and rejects junk", () => {
  assert.equal(p.parseDate("1970-01-02"), 86400000);
  assert.equal(p.parseDate("2026-06-01T09:00:00Z"), p.parseDate("2026-06-01"));
  assert.equal(p.parseDate("2026-02-30"), null); // rolls over, so rejected
  assert.equal(p.parseDate("not-a-date"), null);
  assert.equal(p.parseDate(""), null);
  assert.equal(p.parseDate(null), null);
  assert.equal(p.parseDate(20260601), null);
});

test("parseOdometer accepts finite numbers and treats everything else as missing", () => {
  assert.equal(p.parseOdometer(72000), 72000);
  assert.equal(p.parseOdometer(0), 0);
  assert.equal(p.parseOdometer(NaN), null);
  assert.equal(p.parseOdometer(Infinity), null);
  assert.equal(p.parseOdometer("72000"), null);
  assert.equal(p.parseOdometer(null), null);
  assert.equal(p.parseOdometer(undefined), null);
});

test("parseRows tolerates non-object entries instead of throwing", () => {
  const rows = p.parseRows([null, 42, "x", { date: "2026-01-01", odometer_km: 5 }]);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].dateMs, null);
  assert.equal(rows[0].odometer, null);
  assert.equal(rows[3].odometer, 5);
});

/* ------------------------------------------------------------------ *
 * monotonicOdometer
 * ------------------------------------------------------------------ */

test("monotonicOdometer flags a single decrease and names both entries", () => {
  const f = p.monotonicOdometer([
    entry("2026-01-01", 10000),
    entry("2026-02-01", 20000),
    entry("2026-03-01", 15000),
    entry("2026-04-01", 30000),
  ]);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "odometer_reversal");
  assert.equal(f[0].severity, "high");
  assert.deepEqual(f[0].indices, [1, 2]);
});

test("monotonicOdometer finds nothing in a rising or steady history", () => {
  assert.deepEqual(p.monotonicOdometer([
    entry("2026-01-01", 10000),
    entry("2026-02-01", 10000), // equal is not a decrease
    entry("2026-03-01", 25000),
  ]), []);
});

test("monotonicOdometer skips a missing odometer rather than inventing a reversal", () => {
  const f = p.monotonicOdometer([
    entry("2026-01-01", 10000),
    entry("2026-02-01", null),
    entry("2026-03-01", 20000),
  ]);
  assert.deepEqual(f, []);
});

/* ------------------------------------------------------------------ *
 * chronological
 * ------------------------------------------------------------------ */

test("chronological flags an entry dated before a preceding one", () => {
  const f = p.chronological([
    entry("2026-01-01", 10000),
    entry("2026-02-01", 20000),
    entry("2026-01-15", 25000), // back-dated
    entry("2026-03-01", 30000),
  ]);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "back_dated");
  assert.deepEqual(f[0].indices, [1, 2]);
});

test("chronological ignores equal dates and a rising order", () => {
  assert.deepEqual(p.chronological([
    entry("2026-01-01", 10000),
    entry("2026-01-01", 10500), // same day, two lines
    entry("2026-02-01", 20000),
  ]), []);
});

/* ------------------------------------------------------------------ *
 * duplicateEntries
 * ------------------------------------------------------------------ */

test("duplicateEntries flags the same date, odometer and items twice", () => {
  const f = p.duplicateEntries([
    entry("2026-02-01", 50000, { items: ["oil"] }),
    entry("2026-03-01", 58000, { items: ["inspection"] }),
    entry("2026-02-01", 50000, { items: ["oil"] }),
  ]);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "duplicate");
  assert.deepEqual(f[0].indices, [0, 2]);
});

test("duplicateEntries groups three identical entries into one finding", () => {
  const f = p.duplicateEntries([
    entry("2026-02-01", 50000, { items: ["oil"] }),
    entry("2026-02-01", 50000, { items: ["oil"] }),
    entry("2026-02-01", 50000, { items: ["oil"] }),
  ]);
  assert.equal(f.length, 1);
  assert.deepEqual(f[0].indices, [0, 1, 2]);
});

test("duplicateEntries does not flag differing items or odometers", () => {
  assert.deepEqual(p.duplicateEntries([
    entry("2026-02-01", 50000, { items: ["oil"] }),
    entry("2026-02-01", 50000, { items: ["brakes"] }),
    entry("2026-02-01", 51000, { items: ["oil"] }),
  ]), []);
});

/* ------------------------------------------------------------------ *
 * costOutliers
 * ------------------------------------------------------------------ */

test("costOutliers flags a single wild cost once there are enough entries", () => {
  const f = p.costOutliers([
    entry("2026-01-01", 1, { cost: 200 }),
    entry("2026-02-01", 2, { cost: 220 }),
    entry("2026-03-01", 3, { cost: 210 }),
    entry("2026-04-01", 4, { cost: 230 }),
    entry("2026-05-01", 5, { cost: 2000 }),
  ]);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "cost_outlier");
  assert.deepEqual(f[0].indices, [4]);
});

test("costOutliers finds nothing in a tight set or in a zero-spread set", () => {
  assert.deepEqual(p.costOutliers([
    entry("2026-01-01", 1, { cost: 200 }),
    entry("2026-02-01", 2, { cost: 205 }),
    entry("2026-03-01", 3, { cost: 210 }),
    entry("2026-04-01", 4, { cost: 215 }),
    entry("2026-05-01", 5, { cost: 220 }),
  ]), []);
  // Four identical costs make the MAD zero: the modified z-score is undefined,
  // so the rule declines to invent an outlier rather than fabricate one.
  assert.deepEqual(p.costOutliers([
    entry("2026-01-01", 1, { cost: 200 }),
    entry("2026-02-01", 2, { cost: 200 }),
    entry("2026-03-01", 3, { cost: 200 }),
    entry("2026-04-01", 4, { cost: 200 }),
    entry("2026-05-01", 5, { cost: 500 }),
  ]), []);
});

test("costOutliers refuses to judge below the priced-entry floor", () => {
  const f = p.costOutliers([
    entry("2026-01-01", 1, { cost: 200 }),
    entry("2026-02-01", 2, { cost: 210 }),
    entry("2026-03-01", 3, { cost: 220 }),
  ]);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "cost_unjudged");
  assert.equal(f[0].severity, "medium");
  assert.match(f[0].detail, /at least 5/);
});

/* ------------------------------------------------------------------ *
 * mileageGaps
 * ------------------------------------------------------------------ */

test("mileageGaps flags a jump beyond the plausibility limit", () => {
  const f = p.mileageGaps([
    entry("2026-01-01", 10000),
    entry("2026-02-01", 20000),
    entry("2026-03-01", 80000),
  ]);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "gap");
  assert.deepEqual(f[0].indices, [1, 2]);
});

test("mileageGaps ignores an ordinary interval", () => {
  assert.deepEqual(p.mileageGaps([
    entry("2026-01-01", 10000),
    entry("2026-02-01", 20000),
    entry("2026-03-01", 30000),
  ]), []);
});

/* ------------------------------------------------------------------ *
 * implausibleIntervals
 * ------------------------------------------------------------------ */

test("implausibleIntervals flags an entry dated past the reference date", () => {
  const f = p.implausibleIntervals([
    entry("2026-05-01", 10000),
    entry("2026-07-15", 20000),
  ], "2026-06-01");
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "implausible_interval");
  assert.deepEqual(f[0].indices, [1]);
});

test("implausibleIntervals tolerates dates at the limit and a missing now", () => {
  assert.deepEqual(p.implausibleIntervals([
    entry("2026-05-31", 10000),
    entry("2026-06-01", 20000),
    entry("2026-06-02", 30000), // exactly one day ahead is allowed
  ], "2026-06-01"), []);
  assert.deepEqual(p.implausibleIntervals([entry("2030-01-01", 1)], null), []);
});

/* ------------------------------------------------------------------ *
 * analyze
 * ------------------------------------------------------------------ */

test("a clean five-entry history is consistent with no findings", () => {
  const r = p.analyze(clean(), { now: "2026-06-01" });
  assert.equal(r.verdict, "consistent");
  assert.equal(r.score, 100);
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary.headline, "no inconsistency detected in the service history");
});

test("analyze summarises entry count, date span and mileage span", () => {
  const r = p.analyze(clean(), { now: "2026-06-01" });
  assert.equal(r.summary.n_entries, 5);
  assert.equal(r.summary.span_days, 140);
  assert.equal(r.summary.span_km, 32000);
  assert.equal(r.confidence, 0.625);
});

test("a single odometer reversal makes the history suspect", () => {
  const h = clean();
  h[2].odometer_km = 46000; // below the 48000 that precedes it
  const r = p.analyze(h, { now: "2026-06-01" });
  assert.equal(r.verdict, "suspect");
  assert.ok(r.score < 100);
  assert.ok(r.findings.some((f) => f.kind === "odometer_reversal" && f.severity === "high"));
});

test("an equal-odometer duplicated visit is suspect", () => {
  const h = clean();
  h[3] = Object.assign({}, h[2]); // same date, odometer, items
  const r = p.analyze(h, { now: "2026-06-01" });
  assert.equal(r.verdict, "suspect");
  const dup = r.findings.find((f) => f.kind === "duplicate");
  assert.ok(dup);
  assert.deepEqual(dup.indices, [2, 3]);
});

test("a back-dated entry is suspect", () => {
  const h = clean();
  h[2].date = "2026-01-20"; // earlier than h[1] dated 2026-02-09
  const r = p.analyze(h, { now: "2026-06-01" });
  assert.equal(r.verdict, "suspect");
  assert.ok(r.findings.some((f) => f.kind === "back_dated"));
});

test("a cost outlier among enough priced entries is suspect", () => {
  const h = clean();
  h[4].cost = 5000;
  const r = p.analyze(h, { now: "2026-06-01" });
  assert.equal(r.verdict, "suspect");
  assert.ok(r.findings.some((f) => f.kind === "cost_outlier"));
});

test("analyze refuses to judge costs when there are too few priced entries", () => {
  const h = [
    { date: "2026-01-05", odometer_km: 40000, items: ["oil"], cost: 200 },
    { date: "2026-02-09", odometer_km: 48000, items: ["brake fluid"], cost: 210 },
    { date: "2026-03-15", odometer_km: 56000, items: ["inspection"], cost: 220 },
  ];
  const r = p.analyze(h, { now: "2026-06-01" });
  const cu = r.findings.find((f) => f.kind === "cost_unjudged");
  assert.ok(cu);
  assert.equal(cu.severity, "medium");
  assert.equal(r.verdict, "consistent"); // no inconsistency, but not a clean bill either
  assert.ok(r.score < 100);
  assert.match(r.summary.headline, /costs could not be assessed/);
});

test("a big mileage gap makes the history suspect", () => {
  const h = [
    { date: "2026-01-05", odometer_km: 10000, items: ["oil"], cost: 210 },
    { date: "2026-02-09", odometer_km: 20000, items: ["brake fluid"], cost: 230 },
    { date: "2026-03-15", odometer_km: 80000, items: ["inspection"], cost: 220 },
    { date: "2026-04-20", odometer_km: 88000, items: ["filter"], cost: 240 },
    { date: "2026-05-25", odometer_km: 96000, items: ["tyres"], cost: 215 },
  ];
  const r = p.analyze(h, { now: "2026-06-01" });
  assert.equal(r.verdict, "suspect");
  assert.ok(r.findings.some((f) => f.kind === "gap"));
});

test("a future-dated entry makes the history suspect", () => {
  const h = clean();
  h[4].date = "2026-07-01";
  const r = p.analyze(h, { now: "2026-06-01" });
  assert.equal(r.verdict, "suspect");
  assert.ok(r.findings.some((f) => f.kind === "implausible_interval"));
});

test("a two-entry history is refused as insufficient, not called clean", () => {
  const r = p.analyze([
    entry("2026-01-01", 40000),
    entry("2026-02-01", 48000),
  ], { now: "2026-06-01" });
  assert.equal(r.verdict, "insufficient");
  assert.equal(r.score, null);
  assert.equal(r.confidence, 0);
  assert.match(r.findings[0].detail, /at least 3/);
});

test("an unparseable date is reported rather than skipped or ignored", () => {
  const h = clean();
  h[1].date = "February the ninth";
  const r = p.analyze(h, { now: "2026-06-01" });
  assert.equal(r.verdict, "suspect");
  const f = r.findings.find((x) => x.kind === "unparseable");
  assert.ok(f);
  assert.deepEqual(f.indices, [1]);
  assert.match(f.detail, /date/);
});

test("a missing or NaN odometer is reported as unparseable", () => {
  const h = clean();
  h[2].odometer_km = NaN;
  const r = p.analyze(h, { now: "2026-06-01" });
  assert.equal(r.verdict, "suspect");
  const f = r.findings.find((x) => x.kind === "unparseable");
  assert.ok(f);
  assert.deepEqual(f.indices, [2]);
  assert.match(f.detail, /odometer/);
});

test("analyze tolerates junk input without throwing", () => {
  assert.equal(p.analyze(null).verdict, "insufficient");
  assert.equal(p.analyze({}).verdict, "insufficient");
  assert.equal(p.analyze([]).verdict, "insufficient");
  const r = p.analyze([null, {}, "x"], { now: "2026-06-01" });
  assert.equal(r.verdict, "suspect");
  assert.ok(r.findings.some((f) => f.kind === "unparseable"));
});

test("analyze is deterministic under an injected now", () => {
  const h = clean();
  h[4].date = "2026-07-01";
  const a = p.analyze(h, { now: "2026-06-01" });
  const b = p.analyze(h, { now: "2026-06-01" });
  assert.deepEqual(a, b);
  const later = p.analyze(h, { now: "2026-08-01" });
  assert.equal(later.verdict, "consistent");
});

/* ------------------------------------------------------------------ *
 * wording
 * ------------------------------------------------------------------ */

test("no produced summary or detail ever calls a history genuine or verified", () => {
  const cases = [
    p.analyze(clean(), { now: "2026-06-01" }),
    p.analyze([entry("2026-01-01", 40000)], { now: "2026-06-01" }),
    p.analyze(clean().map((e) => Object.assign({}, e, { odometer_km: null })), { now: "2026-06-01" }),
  ];
  const text = cases
    .map((r) => [r.summary.headline, ...r.findings.map((f) => f.detail)].join(" "))
    .join(" ");
  assert.doesNotMatch(text, /genuine|authentic|verified/i);
});
