"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const m = require("../misfire_patterns.js");

/* Build n events for one cylinder with a fixed condition shape. */
function events(cylinder, n, over) {
  return Array.from({ length: n }, (_, i) => Object.assign(
    { cylinder, time_s: i, count: 1 },
    typeof over === "function" ? over(i) : over
  ));
}

test("binIndex places values in the right bucket and rejects nonsense", () => {
  assert.equal(m.binIndex(m.RPM_BINS, 0), 0);
  assert.equal(m.binIndex(m.RPM_BINS, 1500), 1);
  assert.equal(m.binIndex(m.RPM_BINS, 6000), m.RPM_BINS.length - 2);
  assert.equal(m.binIndex(m.RPM_BINS, 6001), -1);
  assert.equal(m.binIndex(m.RPM_BINS, NaN), -1);
  assert.equal(m.binIndex(m.RPM_BINS, "4000"), -1);
});

test("histogram drops unrepresentable values instead of clamping them", () => {
  const h = m.histogram([100, 4500, 9999, NaN, null], m.RPM_BINS);
  assert.equal(h.bins[0], 1);
  assert.equal(h.bins[4], 1);
  assert.equal(h.dropped, 3);
  assert.equal(h.bins.reduce((a, b) => a + b, 0), 2);
});

test("cylinderFromId normalizes the id spellings ECUs actually use", () => {
  assert.equal(m.cylinderFromId("misfireCyl3"), 3);
  assert.equal(m.cylinderFromId("misfire_cyl_3"), 3);
  assert.equal(m.cylinderFromId("misfire3"), 3);
  assert.equal(m.cylinderFromId("MisfireCylinder12"), 12);
  assert.equal(m.cylinderFromId("misfire0"), null);
  assert.equal(m.cylinderFromId("misfire99"), null);
  assert.equal(m.cylinderFromId("rpm"), null);
});

test("misfireChannels finds only misfire channels and orders by cylinder", () => {
  const series = new Map([
    ["rpm", { data: [{ x: 0, y: 800 }] }],
    ["misfireCyl4", { data: [{ x: 0, y: 0 }] }],
    ["misfireCyl1", { data: [{ x: 0, y: 0 }] }],
  ]);
  const ch = m.misfireChannels(series);
  assert.deepEqual(ch.map(c => c.cylinder), [1, 4]);
  assert.equal(m.misfireChannels(null).length, 0);
});

test("collectEvents derives one event per counter rise", () => {
  const series = new Map([
    ["misfireCyl2", { data: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 3 }, { x: 3, y: 3 }] }],
  ]);
  const ev = m.collectEvents(series);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].cylinder, 2);
  assert.equal(ev[0].count, 3);
  assert.equal(ev[0].time_s, 2);
});

test("collectEvents re-seeds on a counter reset rather than reporting a negative event", () => {
  const series = new Map([
    ["misfireCyl1", { data: [{ x: 0, y: 5 }, { x: 1, y: 0 }, { x: 2, y: 1 }] }],
  ]);
  const ev = m.collectEvents(series);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].count, 1);
  assert.equal(ev[0].time_s, 2);
});

test("collectEvents joins live values by time, tolerating unaligned samples", () => {
  const series = new Map([
    ["misfireCyl1", { data: [{ x: 0, y: 0 }, { x: 2, y: 1 }] }],
    // Sampled 0.5s before the misfire: within tolerance, so usable.
    ["rpm", { data: [{ x: 0, y: 800 }, { x: 1.5, y: 4500 }] }],
    // Sampled 2s before: past the 1.0s tolerance, so deliberately dropped
    // rather than attributed to the event as if it were current.
    ["coolant", { data: [{ x: 0, y: 20 }] }],
  ]);
  const ev = m.collectEvents(series, { tolerance: 1.0 });
  assert.equal(ev[0].rpm, 4500);
  assert.equal(ev[0].coolant, undefined);
  assert.equal(ev[0].load, undefined);
});

test("a wider tolerance accepts a more loosely sampled channel", () => {
  const series = new Map([
    ["misfireCyl1", { data: [{ x: 0, y: 0 }, { x: 2, y: 1 }] }],
    ["coolant", { data: [{ x: 0, y: 20 }] }],
  ]);
  assert.equal(m.collectEvents(series, { tolerance: 1.0 })[0].coolant, undefined);
  assert.equal(m.collectEvents(series, { tolerance: 3.0 })[0].coolant, 20);
});

test("collectEvents leaves a live value null when the nearest sample is stale", () => {
  const series = new Map([
    ["misfireCyl1", { data: [{ x: 0, y: 0 }, { x: 60, y: 1 }] }],
    ["rpm", { data: [{ x: 0, y: 800 }] }],
  ]);
  const ev = m.collectEvents(series, { tolerance: 1.0 });
  assert.equal(ev[0].rpm, undefined);
});

test("collectEvents computes time since start from a start marker's rising edge", () => {
  const series = new Map([
    ["misfireCyl1", { data: [{ x: 0, y: 0 }, { x: 30, y: 1 }] }],
    // Engine off, then starts at t=10.
    ["engineStart", { data: [{ x: 5, y: 0 }, { x: 10, y: 1 }, { x: 29, y: 1 }] }],
  ]);
  const ev = m.collectEvents(series, { startId: "engineStart" });
  assert.equal(ev[0].since_start_s, 20);
});

test("a start channel already high at the top of the log yields no start time", () => {
  // The engine was already running when recording began. Reporting t=0 as a
  // start would make the cold-start rule fire on a warm engine, so the honest
  // answer is null and the rule simply does not apply.
  const series = new Map([
    ["misfireCyl1", { data: [{ x: 0, y: 0 }, { x: 30, y: 1 }] }],
    ["engineStart", { data: [{ x: 0, y: 1 }, { x: 29, y: 1 }] }],
  ]);
  const ev = m.collectEvents(series, { startId: "engineStart" });
  assert.equal(ev[0].since_start_s, null);
  // ...and the analysis still works, minus the cold-start rule.
  const p = m.analyze(Array.from({ length: 20 }, () => ({
    cylinder: 1, time_s: 30, count: 1, rpm: 800, load: 20, coolant: 90,
  }))).patterns[0];
  assert.equal(p.pattern, "idle_vacuum");
});

test("a dominant high-load pattern names ignition, not vacuum", () => {
  const ev = events(1, 20, { rpm: 5200, load: 92, coolant: 88 });
  const p = m.analyze(ev).patterns[0];
  assert.equal(p.pattern, "high_load_ignition");
  assert.ok(p.confidence >= 80, `confidence was ${p.confidence}`);
  assert.match(p.diagnosis, /coil|plug/i);
});

test("knock retard takes priority over the generic high-load rule", () => {
  const ev = events(1, 20, { rpm: 5200, load: 92, coolant: 88, knock_retard: 6 });
  assert.equal(m.analyze(ev).patterns[0].pattern, "knock_detonation");
});

test("a cold-start cluster is distinguished from a hot one", () => {
  const cold = events(3, 20, { rpm: 900, load: 30, coolant: 25, since_start_s: 20 });
  assert.equal(m.analyze(cold).patterns[0].pattern, "cold_start_injector");
  const hot = events(3, 20, { rpm: 900, load: 30, coolant: 101, since_start_s: 900 });
  assert.equal(m.analyze(hot).patterns[0].pattern, "hot_ignition");
});

test("idle misfires across the range fall through to the vacuum rule", () => {
  const ev = events(2, 20, { rpm: 780, load: 12, coolant: 70 });
  assert.equal(m.analyze(ev).patterns[0].pattern, "idle_vacuum");
});

test("a rule must own the dominance threshold to claim the diagnosis", () => {
  // 6 of 10 high-load is not dominance — the events are spread, so the honest
  // answer is "unclear", not a confident wrong part.
  const ev = events(1, 10, (i) => (
    i < 6
      ? { rpm: 5200, load: 92, coolant: 88 }
      : { rpm: 800, load: 15, coolant: 88 }
  ));
  const p = m.analyze(ev).patterns[0];
  assert.equal(p.pattern, "unclear");
  assert.ok(p.confidence <= 25);
  // The evidence is still there for the user to see why nothing was claimed.
  const highLoad = p.evidence.find(e => e.rule === "high_load_ignition");
  assert.equal(highLoad.events, 6);
});

test("confidence rises with how lopsided the match is", () => {
  const weak = m.analyze(events(1, 20, (i) => (
    i < 15 ? { rpm: 5200, load: 92, coolant: 88 } : { rpm: 800, load: 15, coolant: 88 }
  ))).patterns[0];
  const strong = m.analyze(events(1, 20, { rpm: 5200, load: 92, coolant: 88 })).patterns[0];
  assert.ok(strong.confidence > weak.confidence,
    `expected ${strong.confidence} > ${weak.confidence}`);
});

test("too few events refuses to diagnose rather than guessing", () => {
  const p = m.analyze(events(1, 3, { rpm: 5200, load: 92, coolant: 88 })).patterns[0];
  assert.equal(p.pattern, "insufficient_data");
  assert.equal(p.confidence, 0);
  assert.match(p.diagnosis, /3 misfire events/);
});

test("a single noisy cylinder is flagged against a quiet engine", () => {
  const ev = [
    ...events(1, 30, { rpm: 5200, load: 92, coolant: 88 }),
    ...events(2, 1, { rpm: 800, load: 10, coolant: 20 }),
  ];
  const a = m.analyze(ev);
  const cyl1 = a.patterns.find(p => p.cylinder === 1);
  const cyl2 = a.patterns.find(p => p.cylinder === 2);
  assert.equal(cyl1.single_cylinder, true);
  assert.equal(cyl2.single_cylinder, false);
  assert.equal(a.total_events, 31);
});

test("rpmHeatmap rows align to RPM_BINS for every cylinder", () => {
  const ev = [
    ...events(1, 5, { rpm: 500, coolant: 20, load: 10 }),
    ...events(2, 3, { rpm: 4500, coolant: 90, load: 90 }),
  ];
  const heat = m.rpmHeatmap(m.analyze(ev));
  assert.deepEqual(heat.map(r => r.cylinder), [1, 2]);
  for (const row of heat) {
    assert.equal(row.counts.length, m.RPM_BINS.length - 1);
  }
  assert.equal(heat[0].counts[0], 5);
  assert.equal(heat[1].counts[4], 3);
});

test("analyze tolerates junk input instead of throwing", () => {
  assert.deepEqual(m.analyze(null).patterns, []);
  assert.deepEqual(m.analyze([null, {}, { cylinder: null }]).patterns, []);
  assert.deepEqual(m.analyze([]).total_events, 0);
});
