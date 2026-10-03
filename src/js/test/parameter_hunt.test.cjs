"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("../parameter_hunt.js");

test("a responding identifier scores discovery points", () => {
  const s = h.scoreDiscovery({ kind: "discovery", engine: "N54", module: "DME" });
  assert.equal(s.valid, true);
  assert.equal(s.verified, false);
  assert.equal(s.points, 5);           // half of 10, unconfirmed
  assert.equal(s.engine, "n54");       // normalized
  assert.match(s.reason, /awaiting confirmation/);
});

test("an unattributed finding is recorded but never scored", () => {
  // An identifier that responds but is not tied to an engine cannot be checked
  // by anybody else, so it cannot count.
  for (const d of [
    { kind: "discovery" },
    { kind: "discovery", engine: "n54" },
    { kind: "discovery", module: "DME" },
    { kind: "discovery", engine: "  ", module: "DME" },
  ]) {
    const s = h.scoreDiscovery(d);
    assert.equal(s.valid, false, JSON.stringify(d));
    assert.equal(s.points, 0);
    assert.match(s.reason, /Missing/);
  }
});

test("verification is worth more than a self-report, for every kind", () => {
  for (const kind of h.KINDS) {
    const self = h.scoreDiscovery({ kind, engine: "n54", module: "DME" });
    const conf = h.scoreDiscovery({ kind, engine: "n54", module: "DME", verified: true });
    assert.equal(conf.verified, true);
    assert.equal(conf.points, h.SCORES[kind]);
    assert.ok(conf.points > self.points, `${kind}: ${conf.points} !> ${self.points}`);
  }
});

test("an unverified claim can never outrank a confirmed one", () => {
  // The cap that stops a leaderboard being won by volume: an unverified claim
  // is worth at most half its kind's value, and never more than 50. So no
  // unverified finding can reach a confirmed score for the same kind, let
  // alone outrank one.
  const unverifiedByteMap = h.scoreDiscovery({ kind: "byte_mapping", engine: "n54", module: "DME" });
  assert.equal(unverifiedByteMap.points, h.SCORES.byte_mapping / 2);
  assert.ok(unverifiedByteMap.points <= 50);
  for (const kind of h.KINDS) {
    const self = h.scoreDiscovery({ kind, engine: "n54", module: "DME" });
    const conf = h.scoreDiscovery({ kind, engine: "n54", module: "DME", verified: true });
    assert.ok(self.points < conf.points, `${kind}: unverified must rank below confirmed`);
  }
  // A verified freeze schema (100) comfortably beats any unverified finding.
  const verified = h.scoreDiscovery({ kind: "freeze_schema", engine: "n54", module: "DME", verified: true });
  assert.ok(verified.points > unverifiedByteMap.points);
});

test("an unknown kind is rejected with a usable message", () => {
  const s = h.scoreDiscovery({ kind: "vibes", engine: "n54", module: "DME" });
  assert.equal(s.valid, false);
  assert.match(s.reason, /Unknown discovery kind "vibes"/);
  assert.match(s.reason, /discovery/);   // lists the real kinds
  assert.equal(h.scoreDiscovery(null).valid, false);
  assert.equal(h.scoreDiscovery("nope").valid, false);
});

test("verification only ever comes from a strict boolean true", () => {
  // A UI checkbox or a form field must not be able to set it by being truthy.
  for (const v of ["true", 1, {}, [], "yes"]) {
    const s = h.scoreDiscovery({ kind: "freeze_schema", engine: "n54", module: "DME", verified: v });
    assert.equal(s.verified, false, `verified=${JSON.stringify(v)}`);
    assert.equal(s.points, h.SCORES.freeze_schema / 2);
  }
  assert.equal(
    h.scoreDiscovery({ kind: "freeze_schema", engine: "n54", module: "DME", verified: true }).verified,
    true
  );
});

test("a hunter totals only counted findings", () => {
  const hunter = h.createHunter("currie");
  hunter.add({ kind: "discovery", engine: "n54", module: "DME", ident: "0x0C" });
  hunter.add({ kind: "byte_mapping", engine: "n54", module: "DME", ident: "0x0D", verified: true });
  hunter.add({ kind: "discovery" });           // unattributed: recorded, not scored
  assert.equal(hunter.total(), h.SCORES.discovery / 2 + h.SCORES.byte_mapping);
  assert.equal(hunter.findings().length, 3);
  assert.equal(hunter.findings().filter(f => f.counted).length, 2);
});

test("re-probing the same identifier does not score again", () => {
  // The obvious way a leaderboard dies. The second probe is kept for the
  // record and says why it scored nothing.
  const hunter = h.createHunter("currie");
  const first = hunter.add({ kind: "discovery", engine: "n54", module: "DME", ident: "0x0C" });
  const second = hunter.add({ kind: "discovery", engine: "n54", module: "DME", ident: "0x0C" });
  assert.equal(first.counted, true);
  assert.equal(second.counted, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.duplicate_of, first.id);
  assert.equal(second.points, 0);
  assert.match(second.reason, /does not score again/);
  assert.equal(hunter.total(), first.points);
});

test("a confirming resubmission of a counted finding still scores nothing extra", () => {
  // Otherwise "confirm everything twice" is a scoring exploit.
  const hunter = h.createHunter("currie");
  hunter.add({ kind: "byte_mapping", engine: "n54", module: "DME", ident: "0x0D" });
  const again = hunter.add({ kind: "byte_mapping", engine: "n54", module: "DME", ident: "0x0D", verified: true });
  assert.equal(again.counted, false);
  assert.equal(hunter.total(), h.SCORES.byte_mapping / 2);
});

test("a different identifier on the same module is a different finding", () => {
  const hunter = h.createHunter("currie");
  hunter.add({ kind: "discovery", engine: "n54", module: "DME", ident: "0x0C" });
  hunter.add({ kind: "discovery", engine: "n54", module: "DME", ident: "0x0D" });
  assert.equal(hunter.findings().filter(f => f.counted).length, 2);
});

test("the same identifier on a different engine is a different finding", () => {
  const hunter = h.createHunter("currie");
  hunter.add({ kind: "discovery", engine: "n54", module: "DME", ident: "0x0C" });
  hunter.add({ kind: "discovery", engine: "n52", module: "DME", ident: "0x0C" });
  assert.equal(hunter.findings().filter(f => f.counted).length, 2);
});

test("pending shows what a confirmation would be worth", () => {
  const hunter = h.createHunter("currie");
  hunter.add({ kind: "freeze_schema", engine: "n54", module: "DME" });
  hunter.add({ kind: "discovery", engine: "n54", module: "DME", ident: "0x01" });
  const pending = hunter.pending();
  assert.deepEqual(pending.map(p => p.kind), ["freeze_schema", "discovery"]);
  assert.equal(pending[0].would_gain, h.SCORES.freeze_schema - h.SCORES.freeze_schema / 2);
  // A confirmed finding is not pending.
  hunter.add({ kind: "dtc_story", engine: "n54", module: "DME", verified: true });
  assert.equal(hunter.pending().length, 2);
});

test("the leaderboard ranks by points then by confirmed evidence", () => {
  const a = h.createHunter("alice");
  const b = h.createHunter("bob");
  const c = h.createHunter("carol");
  // Alice and Bob tie on points; Bob's are confirmed, so Bob wins the tie.
  a.add({ kind: "discovery", engine: "n54", module: "DME", ident: "0x01" });
  a.add({ kind: "discovery", engine: "n54", module: "DME", ident: "0x02" });
  b.add({ kind: "byte_mapping", engine: "n54", module: "DME", ident: "0x01" });
  b.add({ kind: "byte_mapping", engine: "n54", module: "DME", ident: "0x02" });
  c.add({ kind: "first_oil_sensor", engine: "n54", module: "DME", verified: true });

  const board = h.leaderboard([a, b, c]);
  assert.deepEqual(board.map(r => r.name), ["carol", "bob", "alice"]);
  assert.deepEqual(board.map(r => r.rank), [1, 2, 3]);
  assert.equal(board[0].points, h.SCORES.first_oil_sensor);
  assert.equal(board[1].confirmed, 0);
});

test("a hunter with only unconfirmed findings is flagged", () => {
  const a = h.createHunter("alice");
  a.add({ kind: "discovery", engine: "n54", module: "DME", ident: "0x01" });
  const b = h.createHunter("bob");
  b.add({ kind: "discovery", engine: "n54", module: "DME", ident: "0x09", verified: true });
  const board = h.leaderboard([a, b]);
  assert.equal(board.find(r => r.name === "alice").unconfirmed, true);
  assert.equal(board.find(r => r.name === "bob").unconfirmed, false);
});

test("the leaderboard tolerates no hunters at all", () => {
  assert.deepEqual(h.leaderboard([]), []);
  assert.deepEqual(h.leaderboard(null), []);
});

test("challenge progress counts unique findings, not submissions", () => {
  const hunter = h.createHunter("currie");
  // Three probes of the same identifier must not complete a "map 3" challenge.
  for (let i = 0; i < 3; i++) {
    hunter.add({ kind: "discovery", engine: "n54", module: "DME", ident: "0x0C" });
  }
  const [c] = h.evaluateChallenges(
    [{ id: "n54-3", title: "N54 Pioneer", target: 3, engine: "n54" }],
    [hunter]
  );
  assert.equal(c.progress, 1);
  assert.equal(c.complete, false);
  assert.deepEqual(c.contributors, ["currie"]);
});

test("the same finding from two hunters counts once", () => {
  // Both contributors probe 0x0C on their N54s. That is one fact about the
  // identifier, not two — the challenge is about mapping the engine, not about
  // how many people confirmed the same thing.
  const a = h.createHunter("alice");
  const b = h.createHunter("bob");
  a.add({ kind: "discovery", engine: "n54", module: "DME", ident: "0x0C" });
  b.add({ kind: "discovery", engine: "n54", module: "DME", ident: "0x0C" });
  const [c] = h.evaluateChallenges(
    [{ id: "n54-3", title: "N54 Pioneer", target: 3, engine: "n54" }],
    [a, b]
  );
  assert.equal(c.progress, 1);
  assert.equal(c.complete, false);
  // Both are still credited as contributors.
  assert.deepEqual(c.contributors.sort(), ["alice", "bob"]);
});

test("a challenge completes on genuinely distinct findings", () => {
  const hunter = h.createHunter("currie");
  for (const id of ["0x0C", "0x0D", "0x0E"]) {
    hunter.add({ kind: "discovery", engine: "n54", module: "DME", ident: id });
  }
  const [c] = h.evaluateChallenges(
    [{ id: "n54-3", title: "N54 Pioneer", target: 3, engine: "n54" }],
    [hunter]
  );
  assert.equal(c.complete, true);
  assert.equal(c.progress, 3);
});

test("a challenge does not count findings from another engine or kind", () => {
  const hunter = h.createHunter("currie");
  hunter.add({ kind: "discovery", engine: "n52", module: "DME", ident: "0x01" });
  hunter.add({ kind: "dtc_story", engine: "n54", module: "DME", ident: "0x02" });
  const [c] = h.evaluateChallenges(
    [{ id: "x", title: "N54 only", target: 2, engine: "n54", kind: "discovery" }],
    [hunter]
  );
  assert.equal(c.progress, 0);
  assert.equal(c.complete, false);
});

test("challenge evaluation tolerates junk and no challenges", () => {
  assert.deepEqual(h.evaluateChallenges(null, null), []);
  assert.deepEqual(h.evaluateChallenges([], [h.createHunter("x")]), []);
  const [c] = h.evaluateChallenges([{ id: "no-target", title: "T" }], [h.createHunter("x")]);
  assert.equal(c.complete, false);
  assert.equal(c.progress, 0);
});

test("an anonymous hunter is named rather than left blank", () => {
  assert.equal(h.createHunter("").name, "anonymous");
  assert.equal(h.createHunter("   ").name, "anonymous");
  assert.equal(h.createHunter(null).name, "anonymous");
});
