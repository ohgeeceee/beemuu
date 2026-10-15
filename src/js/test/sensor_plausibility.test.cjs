"use strict";

/* Cross-check engine tests — v4.2.0.
 *
 * Every pair is exercised on a happy path and a mismatch, and the two things
 * the engine exists to get right are tested hardest: a deviation blamed on
 * the correct side only when the evidence points there, and every
 * unjudgeable input coming back as `unknown` rather than a made-up score.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const S = require("../sensor_plausibility.js");

/* Small factories. */
function pts(ys, dt = 1, x0 = 0) {
  return ys.map((y, i) => ({ x: x0 + i * dt, y }));
}

function ch(ys, unit) {
  return { data: pts(ys), unit };
}

function ramp(n, start, step) {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

function entry(id) {
  return S.eachCheck[id];
}

/* A healthy 20-sample log in which every check has its window satisfied. */
function cleanSeries() {
  const n = 20;
  const coolant = [], oil = [], ambient = [], iat = [];
  const boost = [], map = [], lambda = [], trim = [];
  const rpm = [], gear = [], speed = [], battery = [];
  for (let i = 0; i < n; i++) {
    coolant.push(60 + 1.5 * i);
    oil.push(60 + 1.5 * i - 5);
    ambient.push(20 + 0.05 * i);
    iat.push(21.5 + 0.05 * i);
    boost.push(4 * i);
    map.push(101.3 + 4 * i);
    lambda.push(1.0 + 0.001 * i);
    trim.push(-2 + 0.2 * i);
    rpm.push(800 + 120 * i);
    gear.push(i < 4 ? 0 : 3);
    speed.push(i < 4 ? 0 : 20 + 2 * i);
    battery.push(13.8 + 0.01 * i);
  }
  return {
    coolant: ch(coolant),
    oil: ch(oil),
    ambient: ch(ambient),
    iat: ch(iat),
    boost: ch(boost),
    map: ch(map),
    baro: { data: pts(new Array(n).fill(101.3)) },
    lambda: ch(lambda),
    fuel_trim: ch(trim),
    rpm: ch(rpm),
    gear: ch(gear),
    speed: ch(speed),
    battery: ch(battery),
  };
}

/* ------------------------------------------------------------------ *
 * Pairing
 * ------------------------------------------------------------------ */
test("samplePairs pairs two channels on their shared x grid within the max distance", () => {
  const a = ch([1, 2, 3, 4, 5, 6]);
  const b = ch([2, 3, 4, 5, 6, 7]);
  const pairs = S.samplePairs(a, b);
  assert.equal(pairs.length, 6);
  assert.deepEqual(pairs.map((p) => p.x), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(pairs.map((p) => p.a), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(pairs.map((p) => p.b), [2, 3, 4, 5, 6, 7]);

  // A 100 s gap is not stitched at the default distance...
  const far = { data: pts([0, 0, 0], 1, 100) };
  assert.equal(S.samplePairs(a, far).length, 0);
  // ...but is when the caller widens the window.
  assert.equal(S.samplePairs(a, far, { maxDist: 200 }).length, 9);
});

test("samplePairs survives junk, unsorted x and non-finite samples", () => {
  const a = ch([1, 2, 3]);
  assert.deepEqual(S.samplePairs(null, a), []);
  assert.deepEqual(S.samplePairs({ data: [] }, a), []);
  assert.deepEqual(S.samplePairs(a, undefined), []);

  const messy = { data: [{ x: 2, y: 20 }, { x: NaN, y: 9 }, { x: 0, y: 0 }, { x: 1, y: Infinity }, { x: 1, y: 10 }] };
  const pairs = S.samplePairs(a, messy);
  assert.deepEqual(pairs.map((p) => p.x), [0, 1, 2]);
  assert.deepEqual(pairs.map((p) => p.b), [0, 10, 20]);
});

test("cleanPoints drops unrepresentable samples, sorts, and collapses duplicate x", () => {
  const c = S.cleanPoints([{ x: 2, y: 2 }, { x: 1, y: "a" }, { x: 1, y: 1 }, { x: 1, y: 9 }, { x: 3, y: NaN }]);
  assert.equal(c.dropped, 2);
  assert.equal(c.collapsed, 1);
  assert.deepEqual(c.points, [{ x: 1, y: 9 }, { x: 2, y: 2 }]);
});

/* ------------------------------------------------------------------ *
 * Channel resolution
 * ------------------------------------------------------------------ */
test("channelName uses the declared mapping and falls back to the role name", () => {
  assert.equal(S.channelName({ channels: { coolant: "Kühlmittel" } }, "coolant"), "Kühlmittel");
  assert.equal(S.channelName({}, "oil"), "oil");
  assert.equal(S.channelName(null, "rpm"), "rpm");

  const m = new Map([["rpm", ch([1, 2, 3])]]);
  assert.ok(S.getChannel(m, "rpm"));
  assert.ok(S.getChannel({ rpm: ch([1, 2, 3]) }, "rpm"));
  assert.equal(S.getChannel(m, "nope"), undefined);
  assert.equal(S.getChannel(null, "rpm"), undefined);
});

/* ------------------------------------------------------------------ *
 * Coolant vs oil temperature
 * ------------------------------------------------------------------ */
test("coolant and oil converge once the engine is warm", () => {
  const s = { coolant: ch(ramp(10, 70, 1)), oil: ch(ramp(10, 68, 1)) };
  const r = S.checkPair(entry("coolant_oil_convergence"), s);
  assert.equal(r.verdict, "ok");
  assert.equal(r.attribution, null);
  assert.equal(r.score, 100);
});

test("oil that never warms with the coolant is blamed on oil", () => {
  const s = { coolant: ch(ramp(10, 80, 1)), oil: ch(ramp(10, 40, 0.5)) };
  const r = S.checkPair(entry("coolant_oil_convergence"), s);
  assert.equal(r.verdict, "mismatch");
  assert.equal(r.attribution, "b");
  assert.match(r.evidence.join(" "), /oil/);
});

test("oil hotter than coolant cannot be attributed to either side", () => {
  const s = { coolant: ch(ramp(10, 80, 1)), oil: ch(ramp(10, 120, 0.5)) };
  const r = S.checkPair(entry("coolant_oil_convergence"), s);
  assert.equal(r.verdict, "inconclusive");
  assert.equal(r.attribution, null);
});

test("coolant and oil that never warm up cannot be judged", () => {
  const s = { coolant: ch(ramp(10, 40, 1)), oil: ch(ramp(10, 38, 1)) };
  const r = S.checkPair(entry("coolant_oil_convergence"), s);
  assert.equal(r.verdict, "unknown");
  assert.equal(r.score, null);
  assert.equal(r.confidence, 0);
  assert.match(r.evidence.join(" "), /never reached/);
});

/* ------------------------------------------------------------------ *
 * Intake air vs ambient before start
 * ------------------------------------------------------------------ */
test("intake air matches ambient before start", () => {
  const s = { ambient: ch(ramp(8, 20, 0.1)), iat: ch(ramp(8, 21, 0.1)) };
  const r = S.checkPair(entry("iat_ambient_cold_start"), s);
  assert.equal(r.verdict, "ok");
});

test("intake air far from ambient before start is blamed on IAT", () => {
  const s = { ambient: ch(ramp(8, 20, 0.1)), iat: ch(ramp(8, 35, 0.1)) };
  const r = S.checkPair(entry("iat_ambient_cold_start"), s);
  assert.equal(r.verdict, "mismatch");
  assert.equal(r.attribution, "b");
});

test("a heat-soaked intake with no before-start samples cannot be judged", () => {
  const s = { ambient: ch(ramp(8, 20, 0.1)), iat: ch(ramp(8, 60, 0.5)) };
  const r = S.checkPair(entry("iat_ambient_cold_start"), s);
  assert.equal(r.verdict, "unknown");
  assert.match(r.evidence.join(" "), /before-start/);
});

/* ------------------------------------------------------------------ *
 * Boost vs manifold absolute pressure
 * ------------------------------------------------------------------ */
test("MAP equals baro plus boost", () => {
  const boost = ramp(8, 0, 5);
  const s = { boost: ch(boost), map: ch(boost.map((v) => 101.3 + v)) };
  const r = S.checkPair(entry("boost_map_consistency"), s);
  assert.equal(r.verdict, "ok");
});

test("MAP below barometric pressure is physically impossible and blamed on MAP", () => {
  const s = { boost: ch(ramp(8, 10, 1)), map: ch(ramp(8, 80, 1)) };
  const r = S.checkPair(entry("boost_map_consistency"), s);
  assert.equal(r.verdict, "mismatch");
  assert.equal(r.attribution, "b");
});

test("MAP high but still plausible cannot be attributed to either side", () => {
  const s = { boost: ch(ramp(8, 10, 1)), map: ch(ramp(8, 150, 1)) };
  const r = S.checkPair(entry("boost_map_consistency"), s);
  assert.equal(r.verdict, "inconclusive");
  assert.equal(r.attribution, null);
});

test("the MAP check uses the caller's mapped baro channel", () => {
  const s = {
    boost: ch(ramp(8, 20, 1)),
    map: ch(ramp(8, 150, 1)),
    baro: { data: pts([130]) },
  };
  const mapped = S.checkPair(entry("boost_map_consistency"), s, { channels: { baro: "baro" } });
  assert.equal(mapped.verdict, "ok");
  // Without the baro channel the 101.3 kPa default makes the same log disagree.
  const fallback = S.checkPair(entry("boost_map_consistency"), { boost: s.boost, map: s.map });
  assert.equal(fallback.verdict, "inconclusive");
});

/* ------------------------------------------------------------------ *
 * Lambda vs fuel trim
 * ------------------------------------------------------------------ */
test("a sane lambda beside a matching fuel trim passes", () => {
  const s = { lambda: ch(ramp(8, 0.99, 0.001)), fuel_trim: ch(ramp(8, -2, 0.2)) };
  const r = S.checkPair(entry("lambda_fuel_trim_contradiction"), s);
  assert.equal(r.verdict, "ok");
});

test("a lean lambda with fuel pulled out cannot be attributed to either side", () => {
  const s = { lambda: ch(ramp(8, 1.08, 0.005)), fuel_trim: ch(ramp(8, -8, 0.2)) };
  const r = S.checkPair(entry("lambda_fuel_trim_contradiction"), s);
  assert.equal(r.verdict, "inconclusive");
  assert.equal(r.attribution, null);
});

test("a lambda outside its physical band is blamed on lambda", () => {
  const s = { lambda: ch(ramp(8, 1.4, 0.01)), fuel_trim: ch(ramp(8, -8, 0.2)) };
  const r = S.checkPair(entry("lambda_fuel_trim_contradiction"), s);
  assert.equal(r.verdict, "mismatch");
  assert.equal(r.attribution, "a");
});

/* ------------------------------------------------------------------ *
 * RPM vs vehicle speed
 * ------------------------------------------------------------------ */
test("a car in gear above idle is moving", () => {
  const s = { rpm: ch(ramp(8, 1500, 200)), speed: ch(ramp(8, 30, 5)), gear: { data: pts(new Array(8).fill(3)) } };
  const r = S.checkPair(entry("rpm_speed_movement"), s);
  assert.equal(r.verdict, "ok");
});

test("a stationary speed readout above idle in gear is blamed on speed", () => {
  const s = { rpm: ch(ramp(8, 1500, 200)), speed: ch(ramp(8, 0, 0.1)), gear: { data: pts(new Array(8).fill(3)) } };
  const r = S.checkPair(entry("rpm_speed_movement"), s);
  assert.equal(r.verdict, "mismatch");
  assert.equal(r.attribution, "b");
});

test("without a gear channel the rpm/speed check refuses", () => {
  const s = { rpm: ch(ramp(8, 1500, 200)), speed: ch(ramp(8, 30, 5)) };
  const r = S.checkPair(entry("rpm_speed_movement"), s);
  assert.equal(r.verdict, "unknown");
  assert.match(r.evidence.join(" "), /gear/);
});

test("checks with no in-window samples refuse instead of guessing", () => {
  const idle = S.checkPair(entry("rpm_speed_movement"), {
    rpm: ch(ramp(8, 800, 50)),
    speed: ch(ramp(8, 0, 1)),
    gear: ch(ramp(8, 0, 0.5)),
  });
  assert.equal(idle.verdict, "unknown");
  assert.match(idle.evidence.join(" "), /no moving samples/);

  const slow = S.checkPair(entry("charging_voltage"), {
    rpm: ch(ramp(8, 600, 50)),
    battery: ch(ramp(8, 13, 0.1)),
  });
  assert.equal(slow.verdict, "unknown");
  assert.match(slow.evidence.join(" "), /no samples above/);
});

/* ------------------------------------------------------------------ *
 * Battery voltage vs rpm
 * ------------------------------------------------------------------ */
test("a running alternator holds voltage up", () => {
  const s = { rpm: ch(ramp(8, 1500, 300)), battery: ch(ramp(8, 13.8, 0.05)) };
  const r = S.checkPair(entry("charging_voltage"), s);
  assert.equal(r.verdict, "ok");
});

test("voltage sagging at speed is blamed on the battery channel", () => {
  const s = { rpm: ch(ramp(8, 1500, 300)), battery: ch(ramp(8, 12.0, 0.05)) };
  const r = S.checkPair(entry("charging_voltage"), s);
  assert.equal(r.verdict, "mismatch");
  assert.equal(r.attribution, "b");
});

/* ------------------------------------------------------------------ *
 * Refusal discipline
 * ------------------------------------------------------------------ */
test("a missing side returns unknown with a named evidence line", () => {
  const r = S.checkPair(entry("coolant_oil_convergence"), { coolant: ch(ramp(10, 80, 1)) });
  assert.equal(r.verdict, "unknown");
  assert.equal(r.attribution, null);
  assert.equal(r.score, null);
  assert.equal(r.confidence, 0);
  assert.match(r.evidence[0], /oil/);
});

test("too few overlapping samples returns unknown", () => {
  const s = { coolant: ch([80, 81, 82]), oil: ch([78, 79, 80]) };
  const r = S.checkPair(entry("coolant_oil_convergence"), s);
  assert.equal(r.verdict, "unknown");
  assert.match(r.evidence.join(" "), /overlapping/);
});

test("a flat channel carries no relationship and returns unknown", () => {
  const s = { coolant: ch(ramp(10, 80, 0)), oil: ch(ramp(10, 70, 1)) };
  const r = S.checkPair(entry("coolant_oil_convergence"), s);
  assert.equal(r.verdict, "unknown");
  assert.match(r.evidence.join(" "), /constant/);
});

test("a declared window with no expected range returns unknown", () => {
  const broken = Object.assign({}, entry("coolant_oil_convergence"), { window: {} });
  const s = { coolant: ch(ramp(10, 80, 1)), oil: ch(ramp(10, 70, 1)) };
  const r = S.checkPair(broken, s);
  assert.equal(r.verdict, "unknown");
  assert.equal(r.score, null);
  assert.match(r.evidence.join(" "), /no expected range/);
});

/* ------------------------------------------------------------------ *
 * Junk input
 * ------------------------------------------------------------------ */
test("a junk session makes every check unknown rather than throwing", () => {
  const all = S.analyze(null);
  assert.equal(all.summary.n_checks, Object.keys(S.eachCheck).length);
  assert.equal(all.summary.unknown, all.summary.n_checks);
  assert.ok(all.checks.every((c) => c.verdict === "unknown" && c.score === null && c.confidence === 0));

  const nan = S.analyze({
    coolant: { data: [{ x: 0, y: NaN }, { x: 1, y: Infinity }] },
    oil: { data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] },
  });
  assert.ok(nan.checks.every((c) => c.verdict === "unknown"));

  assert.doesNotThrow(() => S.checkPair(entry("coolant_oil_convergence"), undefined));
});

test("a null channel mapping falls back to the role names", () => {
  const s = { coolant: ch(ramp(10, 80, 1)), oil: ch(ramp(10, 78, 1)) };
  const r = S.checkPair(entry("coolant_oil_convergence"), s, { channels: null });
  assert.equal(r.verdict, "ok");
});

/* ------------------------------------------------------------------ *
 * Session analysis
 * ------------------------------------------------------------------ */
test("a clean log yields zero mismatches and a passing headline", () => {
  const out = S.analyze(cleanSeries());
  assert.equal(out.mismatches.length, 0);
  assert.equal(out.summary.mismatched, 0);
  assert.equal(out.summary.ok, out.summary.n_checks);
  assert.equal(out.summary.headline, "all cross-checks passed");
});

test("analyze counts verdicts and lists the worst checks first", () => {
  const s = cleanSeries();
  s.battery = ch(ramp(20, 12.0, 0.01));
  const out = S.analyze(s);
  assert.equal(out.summary.mismatched, 1);
  assert.equal(out.checks[0].verdict, "mismatch");
  assert.equal(out.checks[0].id, "charging_voltage");
  assert.ok(out.mismatches.some((c) => c.id === "charging_voltage"));
});

/* ------------------------------------------------------------------ *
 * Exports
 * ------------------------------------------------------------------ */
test("the exported thresholds pin the documented windows", () => {
  assert.equal(S.MIN_PAIRED_SAMPLES, 5);
  assert.equal(S.OIL_CONVERGE_C, 15);
  assert.equal(S.COOLANT_WARM_C, 70);
  assert.equal(S.IAT_AMBIENT_TOL_C, 8);
  assert.equal(S.BOOST_CONSISTENCY_KPA, 15);
  assert.equal(S.MOVING_RPM, 1200);
  assert.equal(S.CHARGING_RPM, 1200);
  assert.equal(S.CHARGING_MIN_V, 13.0);
});

test("checkPair returns the documented shape", () => {
  const s = { rpm: ch(ramp(8, 1500, 300)), battery: ch(ramp(8, 13.8, 0.05)) };
  const r = S.checkPair(entry("charging_voltage"), s);
  for (const key of ["id", "verdict", "attribution", "score", "confidence", "deviation", "evidence"]) {
    assert.ok(key in r, `missing ${key}`);
  }
  assert.ok(Array.isArray(r.evidence));
  assert.equal(r.id, "charging_voltage");
});
