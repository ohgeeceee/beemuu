"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const d = require("../adaptation_drift.js");

const DAY = 86400000;
const day = n => new Date(Date.UTC(2026, 0, 1) + n * DAY).toISOString();

/* A perfectly linear ramp: value = start + perDay * days. */
function ramp(perDay, count, start) {
  const s = start == null ? 0 : start;
  return Array.from({ length: count }, (_, i) => ({ t: day(i), value: s + perDay * i }));
}

test("linearFit recovers the slope of a clean ramp", () => {
  const fit = d.linearFit(ramp(2, 10));
  assert.ok(Math.abs(fit.slope * DAY - 2) < 1e-9, `slope was ${fit.slope}`);
  assert.ok(Math.abs(fit.r - 1) < 1e-9);
  assert.equal(fit.n, 10);
});

test("linearFit stays precise on epoch-millisecond timestamps", () => {
  // Uncentered least squares on raw epochs squares to ~1e24; if the fit is
  // computed that way the slope comes back as noise.
  const pts = Array.from({ length: 8 }, (_, i) => ({ t: 1.7e12 + i * DAY, value: i * 3 }));
  const fit = d.linearFit(pts);
  assert.ok(Math.abs(fit.slope * DAY - 3) < 1e-6, `slope was ${fit.slope}`);
});

test("linearFit returns null when there is nothing to fit", () => {
  assert.equal(d.linearFit([]), null);
  assert.equal(d.linearFit([{ t: 1, value: 1 }]), null);
  assert.equal(d.linearFit([{ t: 5, value: 1 }, { t: 5, value: 2 }]), null);
  assert.equal(d.linearFit(null), null);
});

test("predictAt evaluates the fitted line at an absolute time", () => {
  const fit = d.linearFit(ramp(1, 5));
  const at = Date.parse(day(9));
  assert.ok(Math.abs(d.predictAt(fit, at) - 9) < 1e-6);
});

test("a flat series is steady, not a trend", () => {
  const flat = Array.from({ length: 6 }, (_, i) => ({ t: day(i), value: 42 }));
  const r = d.analyzeSeries(flat, { id: "idle", unit: "rpm" });
  assert.equal(r.status, "ok");
  assert.equal(r.severity, d.SEVERITIES.ok);
  assert.ok(Math.abs(r.slope_per_day) < 1e-9);
  assert.match(r.message, /steady/);
});

test("two readings are reported as insufficient, not as stable", () => {
  // The critical honesty case: flat because you measured twice is not the same
  // claim as flat because it is flat.
  const r = d.analyzeSeries(ramp(1, 2), { id: "ltft" });
  assert.equal(r.status, "insufficient_data");
  assert.equal(r.severity, d.SEVERITIES.ok);
  assert.equal(r.slope_per_day, null);
  assert.match(r.message, /need 3/);
});

test("a zero-reading history says so instead of claiming a current value", () => {
  const r = d.analyzeSeries([], { id: "ltft" });
  assert.equal(r.status, "insufficient_data");
  assert.equal(r.current, null);
});

test("a trim already past its limit escalates to act with no future date", () => {
  const r = d.analyzeSeries(ramp(5, 10, 0), {
    id: "ltft", label: "Long-term fuel trim", unit: "%", threshold: 40,
  });
  assert.equal(r.status, "ok");
  assert.equal(r.severity, d.SEVERITIES.act);   // current is 45, past the 40 limit
  assert.match(r.message, /past its limit/);
  // `act` means the limit is already behind us, so there is no crossing left to
  // predict. Printing a date here would point at a moment that has passed.
  assert.equal(r.predict_crossing, null);
});

test("a trim that will cross the limit in the future gets a date", () => {
  const { reports } = d.analyzeAll(
    { ltft: ramp(1, 10, 0) },
    { ltft: { label: "Long-term fuel trim", unit: "%", threshold: 20 } }
  );
  const r = reports[0];
  // 9 of 20 is comfortably inside the limit, so this is `ok` — but a clean
  // trend with real history still earns a projected date, because that is
  // exactly the case the module exists for: a value walking steadily toward a
  // limit while nothing is wrong yet.
  assert.equal(r.severity, d.SEVERITIES.ok);
  assert.ok(r.predict_crossing, "expected a projected crossing date");
  assert.ok(r.predict_crossing.at.endsWith("Z"));
  assert.equal(r.predict_crossing.days_from_now, 11);
});

test("a trim approaching but not past its limit is watch, with a date", () => {
  // 0..36 in steps of 4, limit 40 -> ratio 0.9, rising.
  const r = d.analyzeSeries(ramp(4, 10, 0), {
    id: "ltft", label: "Long-term fuel trim", unit: "%", threshold: 40,
  });
  assert.equal(r.severity, d.SEVERITIES.watch);
  assert.ok(r.predict_crossing);
  assert.match(r.message, /within 10%/);
});

test("no crossing is projected when the correlation is too weak to mean anything", () => {
  // Same net movement as a clean ramp, but scattered: the line explains little,
  // so any date would be fiction.
  const noisy = [
    { t: day(0), value: 0 }, { t: day(1), value: 9 }, { t: day(2), value: 1 },
    { t: day(3), value: 11 }, { t: day(4), value: 2 }, { t: day(5), value: 10 },
  ];
  const r = d.analyzeSeries(noisy, { id: "ltft", threshold: 12 });
  assert.ok(Math.abs(r.correlation) < d.MIN_CORRELATION,
    `expected weak correlation, got ${r.correlation}`);
  assert.equal(r.predict_crossing, null);
  assert.equal(r.severity, d.SEVERITIES.ok);
});

test("no crossing is projected for a trend moving away from the limit", () => {
  const r = d.analyzeSeries(ramp(-3, 10, 30), {
    id: "ltft", threshold: 40,
  });
  assert.equal(r.predict_crossing, null);
  // Settling back down toward normal is the ECU recovering. With a known
  // threshold and a comfortable value, that is `ok` — not a watch item.
  assert.equal(r.severity, d.SEVERITIES.ok);
  assert.match(r.message, /steady/);
});

test("a crossing that already happened is not reported as a future date", () => {
  // The series crossed the limit on day 3; `now` is day 9. Publishing that as
  // "reaches the limit in -6 days" would be nonsense, and the `now` parameter
  // exists precisely so a panel reading a real history gets this right.
  const r = d.analyzeSeries(ramp(1, 10, 0), {
    id: "ltft", threshold: 3, now: Date.parse(day(9)),
  });
  assert.equal(r.predict_crossing, null);
  // Without `now`, the last reading is the reference point, which is also in
  // the past relative to the crossing — same answer.
  assert.equal(d.analyzeSeries(ramp(1, 10, 0), { id: "ltft", threshold: 3 }).predict_crossing, null);
});

test("a centuries-out projection is withheld rather than printed as a date", () => {
  const r = d.analyzeSeries(ramp(0.0001, 6, 0), { id: "ltft", threshold: 40 });
  assert.equal(r.predict_crossing, null);
  // ...but the trend is still reported.
  assert.notEqual(r.slope_per_day, null);
});

test("a parameter with no community threshold can never escalate past watch", () => {
  // We do not know what "bad" means for a parameter nobody has published a
  // limit for, so a real trend must not be allowed to claim `act`.
  const r = d.analyzeSeries(ramp(1, 10, 0), { id: "unknown_param" });
  assert.equal(r.threshold, null);
  assert.equal(r.severity, d.SEVERITIES.watch);
  assert.match(r.message, /no community threshold/);
});

test("normalizePoint accepts Date, ISO string and epoch millis alike", () => {
  const ms = Date.parse(day(3));
  assert.deepEqual(d.normalizePoint({ t: day(3), value: 1 }), { t: ms, value: 1 });
  assert.deepEqual(d.normalizePoint({ date: new Date(ms), y: 1 }), { t: ms, value: 1 });
  assert.deepEqual(d.normalizePoint({ t: ms, value: 1 }), { t: ms, value: 1 });
  assert.equal(d.normalizePoint({ t: "not a date", value: 1 }), null);
  assert.equal(d.normalizePoint({ t: day(1), value: "x" }), null);
  assert.equal(d.normalizePoint(null), null);
});

test("limitRatio is null when there is no limit to compare against", () => {
  assert.equal(d.limitRatio(5, null), null);
  assert.equal(d.limitRatio(5, 0), null);
  assert.equal(d.limitRatio(5, 4), 1.25);
  assert.equal(d.limitRatio(-5, 4), 1.25);  // magnitude, direction preserved separately
});

test("recordObservation replaces a same-timestamp reading instead of duplicating it", () => {
  let h = [];
  h = d.recordObservation(h, { t: day(0), value: 1 });
  h = d.recordObservation(h, { t: day(1), value: 2 });
  assert.equal(h.length, 2);
  h = d.recordObservation(h, { t: day(1), value: 99 });
  assert.equal(h.length, 2);
  assert.equal(h[1].value, 99);
});

test("recordObservation ignores junk and keeps history sorted", () => {
  const h = d.recordObservation([{ t: day(5), value: 1 }], { t: "nope", value: 2 });
  assert.equal(h.length, 1);
  const h2 = d.recordObservation([{ t: day(5), value: 1 }], { t: day(1), value: 2 });
  assert.deepEqual(h2.map(p => p.value), [2, 1]);
});

test("analyzeAll orders worst-first and summarizes the counts", () => {
  const histories = {
    steady: ramp(0, 6, 5),
    rising: ramp(5, 6, 0),
    sparse: ramp(1, 2, 0),
  };
  const { reports, summary } = d.analyzeAll(histories, {
    steady: { threshold: 10 },
    rising: { label: "LTFT", unit: "%", threshold: 20 },
    sparse: { threshold: 5 },
  });
  assert.deepEqual(reports.map(r => r.id), ["rising", "steady", "sparse"]);
  assert.equal(summary.total, 3);
  assert.equal(summary.act, 1);
  assert.equal(summary.insufficient, 1);
  // The unmeasured parameter sorts last, so it can never be read as a healthy
  // one at a glance.
  assert.equal(reports[2].status, "insufficient_data");
});

test("analyzeAll accepts a Map and tolerates no metadata at all", () => {
  const histories = new Map([["x", ramp(1, 5, 0)]]);
  const { reports, summary } = d.analyzeAll(histories);
  assert.equal(reports[0].id, "x");
  assert.equal(summary.total, 1);
  assert.deepEqual(d.analyzeAll(null).reports, []);
  assert.deepEqual(d.analyzeAll(undefined).summary.total, 0);
});

test("a non-array series degrades to insufficient data rather than throwing", () => {
  // Found by the panel layer: a caller passing its whole history object handed
  // the engine a map where a list was expected, and `.map` blew up — blanking
  // the panel instead of degrading it.
  for (const junk of [{ a: 1 }, "nope", 42, true]) {
    const r = d.analyzeSeries(junk, { id: "x" });
    assert.equal(r.status, "insufficient_data", JSON.stringify(junk));
    assert.equal(r.current, null);
    assert.equal(r.slope_per_day, null);
  }
  // ...and through analyzeAll, which is the public entry point.
  const { reports, summary } = d.analyzeAll({ x: { a: 1 }, y: ramp(1, 5) }, {});
  assert.equal(summary.total, 2);
  assert.equal(reports.find(r => r.id === "x").status, "insufficient_data");
  assert.equal(reports.find(r => r.id === "y").status, "ok");
});

test("labels fall back to the id so a report is never blank", () => {
  const r = d.analyzeSeries(ramp(0, 5, 3), { id: "idle_target" });
  assert.equal(r.label, "idle_target");
  assert.match(r.message, /idle_target/);
});
