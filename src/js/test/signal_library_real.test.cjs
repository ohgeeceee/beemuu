"use strict";

// Runs the signal library against the REAL community profiles, not fixtures.
// This is the test that would catch a PID added to community/profiles/ that the
// classifier grades wrongly, and it reports the actual confidence distribution
// so the number in the changelog is measured rather than estimated.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const s = require("../signal_library.js");

const ROOT = path.resolve(__dirname, "../../..");

function loadProfiles() {
  const dir = path.join(ROOT, "community/profiles");
  const out = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".toml"))) {
    const res = execFileSync("python3", ["-c", `
import json, tomllib, sys
d = tomllib.load(open(sys.argv[1], "rb"))
print(json.dumps(d.get("profile", [])))
`, path.join(dir, f)], { encoding: "utf8" });
    for (const p of JSON.parse(res)) out.push(p);
  }
  return out;
}

const profiles = loadProfiles();
const index = s.build(profiles);

test("the real community profiles index into a non-trivial catalog", () => {
  assert.ok(profiles.length >= 10, `only ${profiles.length} profiles`);
  assert.ok(index.signals.length >= 40, `only ${index.signals.length} distinct signals`);
  assert.ok(index.engines.length >= 8, `only ${index.engines.length} engines`);
});

test("the measured confidence split matches what the summary claims", () => {
  const counted = index.summary.verified + index.summary.community + index.summary.unverified;
  assert.equal(counted, index.summary.total);
  for (const sig of index.signals) {
    assert.ok(Object.values(s.CONFIDENCE).includes(sig.confidence), sig.id);
  }
});

test("a substantial verified tier exists — the PID bug emptied it", () => {
  // This is the regression test for the `obd:0C` -> `C` normalisation bug, run
  // against the real data rather than a fixture. If PID matching regresses, the
  // verified count collapses toward zero.
  assert.ok(index.summary.verified > 5,
    `only ${index.summary.verified} verified signals — PID matching has regressed`);
  assert.ok(index.summary.unverified > 0,
    "expected some unverified local: identifiers in the real profiles");
  assert.ok(index.summary.community > 0,
    "expected community-graded did:/uds: identifiers in the real profiles");
});

test("rpm and coolant are verified on every engine that lists them", () => {
  for (const id of ["rpm", "coolant"]) {
    const sig = index.signals.find(x => x.id === id);
    assert.ok(sig, `${id} missing from the index`);
    assert.equal(sig.confidence, s.CONFIDENCE.verified, id);
    assert.ok(sig.engines.length >= 5, `${id} only on ${sig.engines.length} engines`);
  }
});

test("a bare did: query is community, not unverified", () => {
  // 101 of the shipped params use `did:XXXX` rather than `uds:`. Missing that
  // prefix collapsed the whole BMW-specific tier into "unverified".
  assert.equal(s.classify("did:4003", "Ambient pressure"), s.CONFIDENCE.community);
  assert.equal(s.classify("did:4500", "Engine torque"), s.CONFIDENCE.community);
  const torque = index.signals.find(x => x.query === "did:4500");
  if (torque) assert.equal(torque.confidence, s.CONFIDENCE.community);
});

test("a signal split across engines keeps both verdicts", () => {
  // The real case, and the reason per-engine tracking exists: `oil` is
  // `obd:5C` (a standard PID, verified by design) on the diesels and
  // `local:10` — explicitly labelled an unverified placeholder — on the N55,
  // N57, S55 and S58. A flat "verified" would send an N55 owner chasing a
  // number the profile itself says not to trust.
  const oil = index.signals.find(x => x.id === "oil");
  assert.ok(oil, "expected an `oil` signal in the real profiles");
  assert.equal(oil.confidence, s.CONFIDENCE.verified);
  assert.equal(oil.partially_verified, true);
  assert.ok(oil.unverified_on.length >= 2,
    `expected several unverified engines, got ${JSON.stringify(oil.unverified_on)}`);
  for (const e of oil.unverified_on) assert.ok(oil.engines.includes(e), e);
});

test("verifiedOnly drops a signal that is unverified on the engine in view", () => {
  const oil = index.signals.find(x => x.id === "oil");
  const badEngine = oil.unverified_on[0];
  const goodEngine = oil.engines.find(e => !oil.unverified_on.includes(e));
  assert.ok(badEngine && goodEngine, "need one unverified and one verified engine");

  assert.ok(!s.search(index, "", { engine: badEngine, verifiedOnly: true })
    .some(x => x.id === "oil"), `oil should drop out on ${badEngine}`);
  assert.ok(s.search(index, "", { engine: goodEngine, verifiedOnly: true })
    .some(x => x.id === "oil"), `oil should stay on ${goodEngine}`);
});

test("no signal is indexed without a label and an id", () => {
  for (const sig of index.signals) {
    assert.ok(sig.id, "a signal with no id");
    assert.ok(sig.label, `${sig.id} has no label`);
    assert.ok(sig.engines.length, `${sig.id} has no engines`);
  }
});

test("every engine in the index corresponds to a real profile", () => {
  const known = new Set(profiles.map(p => p.id));
  for (const e of index.engines) assert.ok(known.has(e), `unknown engine ${e}`);
});

test("searching the real index finds the obvious signals", () => {
  for (const [q, expected] of [["engine speed", "rpm"], ["coolant", "coolant"]]) {
    assert.ok(s.search(index, q).some(x => x.id === expected), `${q} -> ${expected}`);
  }
});
