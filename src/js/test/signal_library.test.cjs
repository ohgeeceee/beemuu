"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const s = require("../signal_library.js");

/* Fixtures shaped exactly like the parsed community TOML. */
const profiles = [
  {
    id: "n55",
    label: "N55",
    param: [
      { id: "rpm", label: "Engine speed", unit: "rpm", query: "obd:0C", target: 0x12, decode: "u16_quarter", min: 0, max: 7000 },
      { id: "coolant", label: "Coolant temp", unit: "°C", query: "obd:05", target: 0x12, decode: "temp_u8" },
      { id: "oil", label: "Oil temp [UNVERIFIED placeholder]", unit: "°C", query: "local:10", target: 0x12, decode: "temp_u8" },
      { id: "timing", label: "Ignition timing [needs verification]", unit: "°", query: "uds:F186", target: 0x12, decode: "s16_div4" },
      { id: "rail", label: "Rail pressure", unit: "kPa", query: "uds:40B3", target: 0x12, decode: "u16" },
    ],
  },
  {
    id: "n54",
    label: "N54",
    param: [
      // Same signals, second engine: must merge, not duplicate.
      { id: "rpm", label: "Engine speed", unit: "rpm", query: "obd:0C", target: 0x12, decode: "u16_quarter" },
      { id: "coolant", label: "Coolant temp", unit: "°C", query: "obd:05", target: 0x12, decode: "temp_u8" },
      { id: "lambda", label: "Lambda [needs verification]", unit: "", query: "local:31", target: 0x12, decode: "u8_div100" },
    ],
  },
];

const index = s.build(profiles);

test("build indexes every distinct signal and counts confidence", () => {
  // 8 param entries across two engines, 6 distinct signal ids (rpm and
  // coolant appear on both).
  assert.equal(index.signals.length, 6);
  assert.equal(index.summary.total, 6);
  assert.equal(index.summary.verified, 2);   // rpm, coolant — OBD-II standard
  assert.equal(index.summary.unverified, 3); // oil (local:10), timing (flagged), lambda (local:31)
  assert.equal(index.summary.community, 1);  // rail (uds:40B3)
  assert.deepEqual(index.engines, ["n54", "n55"]);
});

test("the same signal on two engines is one row carrying both", () => {
  const rpm = index.signals.find(x => x.id === "rpm");
  assert.deepEqual(rpm.engines, ["n55", "n54"]);
  assert.equal(rpm.confidence, s.CONFIDENCE.verified);
});

test("OBD-II standard PIDs are verified by design", () => {
  assert.equal(s.classify("obd:0C", "Engine speed"), s.CONFIDENCE.verified);
  assert.equal(s.classify("obd:05", "Coolant temp"), s.CONFIDENCE.verified);
  assert.equal(s.classify("obd:0C", "Engine speed"), s.CONFIDENCE.verified);
  // Leading zeros must not change the verdict.
  assert.equal(s.classify("obd:0c", "x"), s.CONFIDENCE.verified);
});

test("a local identifier is unverified unless the label says otherwise", () => {
  // The n55 profile's own words: "The `local:10` placeholder is unverified
  // for E-series and has no open-source evidence."
  assert.equal(s.classify("local:10", "Oil temp"), s.CONFIDENCE.unverified);
  assert.equal(s.classify("uds:F186", "Ignition timing"), s.CONFIDENCE.community);
  assert.equal(s.classify("mystery:99", "Unknown"), s.CONFIDENCE.unverified);
  assert.equal(s.classify("", "Unknown"), s.CONFIDENCE.unverified);
  assert.equal(s.classify(null, null), s.CONFIDENCE.unverified);
});

test("an explicit needs-verification note outranks the query form", () => {
  // Even an OBD PID, if the author flagged it, must not be shown as verified.
  assert.equal(s.classify("obd:0C", "Engine speed [needs verification]"), s.CONFIDENCE.unverified);
  assert.equal(s.classify("uds:F186", "Timing [UNVERIFIED placeholder]"), s.CONFIDENCE.unverified);
  assert.equal(s.classify("local:1", "Thing [no open-source evidence]"), s.CONFIDENCE.unverified);
});

test("cleanLabel strips bracketed caveats so search hits the signal name", () => {
  assert.equal(s.cleanLabel("Oil temp [UNVERIFIED placeholder]"), "Oil temp");
  assert.equal(s.cleanLabel("Ignition timing [needs verification]"), "Ignition timing");
  assert.equal(s.cleanLabel("  Engine   speed  "), "Engine speed");
  // A label that is nothing but a caveat must not become empty.
  assert.equal(s.cleanLabel("[unverified]"), "");
  assert.equal(s.cleanLabel(null), "");
});

test("a label that is only a caveat still indexes under its id", () => {
  const idx = s.build([{ id: "x", param: [{ id: "weird", label: "[unverified]", query: "obd:0C" }] }]);
  assert.equal(idx.signals[0].label, "weird");
});

test("signals sort best-confidence first", () => {
  const order = index.signals.map(x => x.confidence);
  const ranks = order.map(c => s.RANK[c]);
  for (let i = 1; i < ranks.length; i++) assert.ok(ranks[i - 1] <= ranks[i]);
});

test("search requires every term to match", () => {
  assert.deepEqual(s.search(index, "engine speed").map(x => x.id), ["rpm"]);
  assert.deepEqual(s.search(index, "coolant").map(x => x.id), ["coolant"]);
  // An OR search on a short query would return the whole catalog.
  assert.equal(s.search(index, "coolant oil").length, 0);
  assert.equal(s.search(index, "rail pressure").length, 1);
});

test("search matches ids, units, queries and engine names", () => {
  assert.ok(s.search(index, "kPa").some(x => x.id === "rail"));
  assert.ok(s.search(index, "local:10").some(x => x.id === "oil"));
  assert.ok(s.search(index, "n54").length >= 1);
});

test("search can be restricted to an engine", () => {
  const onN55 = s.search(index, "", { engine: "n55" });
  const onN54 = s.search(index, "", { engine: "n54" });
  assert.ok(onN55.some(x => x.id === "rail"));   // N55 only
  assert.ok(!onN54.some(x => x.id === "rail"));
  assert.ok(onN54.every(x => x.engines.includes("n54")));
});

test("verifiedOnly hides community and unverified signals", () => {
  const out = s.search(index, "", { verifiedOnly: true });
  assert.deepEqual(out.map(x => x.id).sort(), ["coolant", "rpm"]);
});

test("an engine filter for a signal nobody supports returns nothing", () => {
  assert.deepEqual(s.search(index, "", { engine: "m47" }), []);
});

test("the summary states the caveat rather than burying it", () => {
  assert.match(index.summary.note, /unverified/);
  assert.match(index.summary.note, /confirm it on your own car/);
});

test("the index carries the caveat count a panel needs to show", () => {
  // A panel that lists 218 signals without saying how many are guesses is the
  // failure mode this whole feature exists to prevent.
  assert.ok(index.summary.unverified > 0);
  assert.equal(
    index.summary.verified + index.summary.community + index.summary.unverified,
    index.summary.total
  );
});

test("enginesFor lists the engines supporting a signal", () => {
  assert.deepEqual(s.enginesFor(index, "rpm").sort(), ["n54", "n55"]);
  assert.deepEqual(s.enginesFor(index, "rail"), ["n55"]);
  assert.deepEqual(s.enginesFor(index, "nope"), []);
  assert.deepEqual(s.enginesFor(null, "rpm"), []);
});

test("targetLabel names the DME and renders other addresses", () => {
  assert.equal(s.targetLabel({ target: 0x12 }), "DME");
  assert.equal(s.targetLabel({ target: 0x18 }), "0x18");
  assert.equal(s.targetLabel({ target: null }), "");
  assert.equal(s.targetLabel({}), "");
});

test("build tolerates junk profiles and parameters", () => {
  for (const input of [null, undefined, [], [null], [{}], [{ id: "" }]]) {
    const idx = s.build(input);
    assert.equal(idx.signals.length, 0, JSON.stringify(input));
  }
  const idx = s.build([
    { id: "x", param: [null, {}, { label: "no id" }, { id: "ok", query: "obd:0C" }] },
  ]);
  assert.equal(idx.signals.length, 1);
  assert.equal(idx.signals[0].id, "ok");
});

test("search tolerates a missing or empty index", () => {
  assert.deepEqual(s.search(null, "rpm"), []);
  assert.deepEqual(s.search({}, "rpm"), []);
  // An empty query is "show me everything", which is the correct behaviour for
  // a library panel opening cold — not an error.
  assert.equal(s.search(index, "").length, index.signals.length);
  assert.equal(s.search(index, null).length, index.signals.length);
  assert.equal(s.search(index, "   ").length, index.signals.length);
});

test("a param with no engine id is skipped rather than indexed under a blank", () => {
  const idx = s.build([{ id: "", param: [{ id: "orphan", query: "obd:0C" }] }]);
  assert.equal(idx.signals.length, 0);
});
