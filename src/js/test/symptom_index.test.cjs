"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const s = require("../symptom_index.js");

test("a described cold-start stumble ranks the cold-start entry first", () => {
  const r = s.search("it stumbles badly on a cold start in the morning");
  assert.ok(r.length);
  assert.equal(r[0].entry.id, "cold_start_stumble");
  assert.ok(r[0].hits.some(h => h.term === "cold start"));
});

test("search is case-insensitive and tolerates partial words", () => {
  const a = s.search("COLD START STUMBLE");
  const b = s.search("cold start stumble");
  assert.equal(a[0].entry.id, b[0].entry.id);
  assert.equal(a[0].score, b[0].score);
  // "hesitat" is the stem, so "hesitates" matches without an exact word.
  assert.ok(s.search("the engine hesitates at idle").length);
});

test("a weak single term does not produce a shortlist", () => {
  // "hot" alone and "rev" alone are noise. A shortlist of everything is the
  // same as no shortlist.
  assert.deepEqual(s.search("hot"), []);
  assert.deepEqual(s.search("rev"), []);
  assert.deepEqual(s.search(""), []);
  assert.deepEqual(s.search("   "), []);
  assert.deepEqual(s.search(null), []);
});

test("a specific phrase outranks a broad keyword match", () => {
  // "the temperature warning came on" is an overheating report, and must not
  // be dragged down by scoring every incidental "hot"-adjacent word equally.
  const r = s.diagnose("temperature warning light came on and it is overheating");
  assert.equal(r.matched[0].id, "overheating");
  assert.ok(r.matched[0].matched_terms.includes("overheat") ||
    r.matched[0].matched_terms.includes("temperature"));
});

test("candidates merge across entries and de-duplicate codes", () => {
  // "rough idle" matches both rough_idle and cold_start_stumble, and both
  // list 2A82. It must appear once.
  const c = s.candidates("rough hunting idle and it also stumbles cold");
  const codes = c.map(x => x.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.includes("2A82"));
  const vanos = c.find(x => x.code === "2A82");
  assert.ok(vanos.sources.length > 1, "should record both entries as sources");
});

test("a code's confidence is the strongest claim, never an average", () => {
  // 2A82 is verified in rough_idle and cold_start_stumble. If only one entry
  // mentioned it as community, the verified evidence must still stand rather
  // than being diluted to a middle value.
  const c = s.candidates("rough hunting idle stumbles cold start");
  const vanos = c.find(x => x.code === "2A82");
  assert.equal(vanos.confidence, "verified");
});

test("a code seen as community somewhere and verified elsewhere stays verified", () => {
  // Order in the dataset must not decide the evidence grade. No code in the
  // shipped index actually has a community/verified split, so the rule is
  // exercised directly on the merge rather than through the dataset.
  const weak = { code: "2A82", confidence: "community", note: "weak", source: "a" };
  const strong = { code: "2A82", confidence: "verified", note: "strong", source: "b" };
  assert.equal(s.mergeSightings([weak, strong])[0].confidence, "verified");
  // Reverse order lands the same way — no last-write-wins downgrade.
  const reversed = s.mergeSightings([strong, weak])[0];
  assert.equal(reversed.confidence, "verified");
  assert.equal(reversed.note, "strong");
  assert.deepEqual(reversed.sources, ["b", "a"]);

  // Two community claims never invent a verified one.
  const both = s.mergeSightings([weak, Object.assign({}, weak, { source: "c" })]);
  assert.equal(both[0].confidence, "community");
  assert.deepEqual(both[0].sources, ["a", "c"]);

  // Codes are upper-cased and de-duplicated case-insensitively.
  const mixed = s.mergeSightings([
    { code: "2a98", confidence: "community" },
    { code: "2A98", confidence: "verified" },
  ]);
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].code, "2A98");
  assert.equal(mixed[0].confidence, "verified");

  // Through the real path, every entry mentioning 2A82 agrees.
  const c = s.candidates("rough hunting idle stumbles cold start lacks power");
  assert.equal(c.find(x => x.code === "2A82").confidence, "verified");
});

test("mergeSightings tolerates junk", () => {
  assert.deepEqual(s.mergeSightings(null), []);
  assert.deepEqual(s.mergeSightings([]), []);
  assert.deepEqual(s.mergeSightings([null]), []);
});

test("candidates sort verified before community", () => {
  const c = s.candidates("stumbles on a cold start");
  const rank = { verified: 0, community: 1, unknown: 2 };
  for (let i = 1; i < c.length; i++) {
    assert.ok(rank[c[i - 1].confidence] <= rank[c[i].confidence]);
  }
});

test("diagnose returns candidates, checks and components together", () => {
  const r = s.diagnose("battery is flat every morning and the car is dead");
  assert.equal(r.matched[0].id, "electrical");
  assert.ok(r.components.includes("Battery"));
  assert.ok(r.checks.length);
  assert.ok(r.codes.length);
});

test("diagnose never claims to be a diagnosis", () => {
  // The load-bearing flag. A shortlist presented as a verdict costs people
  // money in parts they did not need.
  for (const q of ["cold start stumble", "overheating", "no power", "random words here"]) {
    assert.equal(s.diagnose(q).is_diagnosis, false, q);
  }
});

test("diagnose on an unmatched description says so plainly", () => {
  const r = s.diagnose("the windscreen wiper is squeaking");
  assert.deepEqual(r.matched, []);
  assert.deepEqual(r.codes, []);
  assert.match(r.note, /Nothing in the index matched/);
  assert.match(r.note, /Try naming the conditions/);
});

test("an unmatched description still refuses to diagnose", () => {
  // The "nothing matched" note is its own branch and does not repeat the
  // not-a-diagnosis wording, but the flag still holds and the note still has
  // to steer the user somewhere useful rather than dead-ending.
  const r = s.diagnose("the windscreen wiper is squeaking");
  assert.equal(r.is_diagnosis, false);
  assert.deepEqual(r.components, []);
  assert.deepEqual(r.checks, []);
  assert.match(r.note, /Try naming the conditions/);
});

test("byId finds an entry and returns null for junk", () => {
  assert.equal(s.byId("cold_start_stumble").id, "cold_start_stumble");
  assert.equal(s.byId("nope"), null);
  assert.equal(s.byId(null), null);
});

test("the long-phrase bonus does not let one phrase outrank a multi-term match", () => {
  // "rotten egg" is a 10-char phrase and earns the +3. It should not beat a
  // genuine multi-signal match like the overheating entry.
  const specific = s.diagnose("temperature warning came on, overheating, and the coolant is disappearing");
  const single = s.diagnose("there is a rotten egg smell");
  assert.ok(specific.matched[0].score > single.matched[0].score);
});

test("a code is either backed by a published circuit or explicitly says it is not", () => {
  // Cross-module consistency, and the reason it matters: a shortlist that
  // names a circuit `wiring_detect.js` cannot resolve is a dead end for the
  // panel. The only legitimate way to name an unresolvable code is to say so
  // with `circuit: false`, rather than inventing a pin number nobody verified.
  const wiring = require("../wiring_detect.js");
  for (const entry of s.SYMPTOMS) {
    for (const c of entry.codes) {
      const resolvable = wiring.hasCircuit(c.code);
      if (!resolvable) {
        assert.equal(c.circuit, false,
          `${entry.id} names ${c.code}, which wiring_detect.js cannot resolve — mark it circuit: false`);
      }
    }
  }
  // ...and the flagged code really is unresolvable, so the flag is not a
  // permanent excuse for a circuit that exists.
  const disa = s.byId("cold_start_stumble").codes.find(c => c.code === "2A98");
  assert.equal(disa.circuit, false);
  assert.equal(wiring.hasCircuit("2A98"), false);
});

test("every entry has a title, description and at least one code", () => {
  for (const e of s.SYMPTOMS) {
    assert.ok(e.id && e.title && e.description, e.id);
    assert.ok(e.codes.length, e.id);
    assert.ok(e.signals.length, e.id);
    assert.ok(e.checks.length, e.id);
    assert.ok(e.components.length, e.id);
  }
});

test("symptom ids are unique", () => {
  const ids = s.SYMPTOMS.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("an overheating shortlist carries the safety note", () => {
  // Never open a hot cooling system. This is the one instruction in the index
  // that can hurt someone, so it is pinned.
  const r = s.diagnose("it is overheating and steaming");
  assert.ok(r.checks.some(c => /never open a cooling system/i.test(c)));
});
