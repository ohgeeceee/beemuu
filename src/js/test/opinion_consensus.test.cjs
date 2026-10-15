"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const c = require("../opinion_consensus.js");

/* A fixed clock so every recency assertion is deterministic. */
const NOW = 1800000000;

/* Build an opinion in the normalised shape the loader produces. */
function opinion(repair_id, source, extra = {}) {
  return Object.assign({ repair_id, source, updated_at: NOW - 86400 }, extra);
}

/* Build a stored community row (the TOML shape) instead. */
function communityRow(action, perspective, extra = {}) {
  return Object.assign({ action, perspective, created_at: NOW - 86400 }, extra);
}

/* Collect every string anywhere in a result, for the no-probability sweep. */
function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}

/* ------------------------------------------------------------------ *
 * source tiers and thresholds
 * ------------------------------------------------------------------ */

test("sourceWeight returns the exported tier weight for each named tier", () => {
  assert.equal(c.sourceWeight("workshop"), c.SOURCE_TIERS.workshop);
  assert.equal(c.sourceWeight("verified_owner"), c.SOURCE_TIERS.verified_owner);
  assert.equal(c.sourceWeight("owner"), c.SOURCE_TIERS.owner);
  assert.equal(c.sourceWeight("anonymous"), c.SOURCE_TIERS.anonymous);
});

test("sourceWeight ranks workshop above verified_owner above owner above anonymous", () => {
  assert.ok(c.sourceWeight("workshop") > c.sourceWeight("verified_owner"));
  assert.ok(c.sourceWeight("verified_owner") > c.sourceWeight("owner"));
  assert.ok(c.sourceWeight("owner") > c.sourceWeight("anonymous"));
});

test("sourceWeight gives an unknown tier the lowest weight, never a default of 1", () => {
  const w = c.sourceWeight("someone-on-a-parking-lot-forum");
  assert.equal(w, c.LOWEST_WEIGHT);
  assert.notEqual(w, 1);
  assert.equal(c.sourceWeight(""), c.LOWEST_WEIGHT);
  assert.equal(c.sourceWeight(42), c.LOWEST_WEIGHT);
});

test("sourceWeight is case- and whitespace-tolerant and reads a qualified origin", () => {
  assert.equal(c.sourceWeight("  Workshop "), c.SOURCE_TIERS.workshop);
  assert.equal(c.sourceWeight("workshop:autohaus-berlin"), c.SOURCE_TIERS.workshop);
});

test("SOURCE_TIERS pins the canonical tiers and the community perspective aliases", () => {
  assert.equal(c.SOURCE_TIERS.workshop, 1);
  assert.equal(c.SOURCE_TIERS.verified_owner, 0.75);
  assert.equal(c.SOURCE_TIERS.owner, 0.5);
  assert.equal(c.SOURCE_TIERS.anonymous, 0.25);
  assert.equal(c.SOURCE_TIERS.dealer, c.SOURCE_TIERS.workshop);
  assert.equal(c.SOURCE_TIERS.indie, c.SOURCE_TIERS.owner);
  assert.equal(c.SOURCE_TIERS.diy, c.SOURCE_TIERS.anonymous);
});

test("the quorum, contention, mileage and staleness thresholds are pinned", () => {
  assert.equal(c.MIN_OPINIONS, 4);
  assert.equal(c.MIN_DISTINCT_SOURCES, 2);
  assert.equal(c.CONTENTION_MARGIN, 0.25);
  assert.equal(c.MILEAGE_BAND_TOLERANCE, 30000);
  assert.equal(c.MILEAGE_FAR_FACTOR, 0.5);
  assert.equal(c.STALE_AFTER_SECONDS, 63072000);
  assert.equal(c.STALE_FACTOR, 0.5);
});

/* ------------------------------------------------------------------ *
 * weighting
 * ------------------------------------------------------------------ */

test("weightOpinion returns the documented fields", () => {
  const w = c.weightOpinion(opinion("R1", "workshop"), { now: NOW });
  assert.equal(w.repair_id, "R1");
  assert.equal(w.source, "workshop");
  assert.equal(w.recency_factor, 1);
  assert.equal(w.weight, c.SOURCE_TIERS.workshop);
});

test("weightOpinion down-weights an opinion whose mileage band is far from the vehicle", () => {
  const near = c.weightOpinion(opinion("R1", "owner", { mileage_band: 100000 }), { vehicle_mileage: 100000 });
  const far = c.weightOpinion(opinion("R1", "owner", { mileage_band: 200000 }), { vehicle_mileage: 100000 });
  assert.equal(near.mileage_factor, 1);
  assert.equal(far.mileage_factor, c.MILEAGE_FAR_FACTOR);
  assert.equal(far.weight, c.SOURCE_TIERS.owner * c.MILEAGE_FAR_FACTOR);
});

test("mileage down-weighting holds at its exact boundary", () => {
  const atEdge = c.weightOpinion(opinion("R1", "owner", { mileage_band: 100000 + c.MILEAGE_BAND_TOLERANCE }), { vehicle_mileage: 100000 });
  const onePast = c.weightOpinion(opinion("R1", "owner", { mileage_band: 100001 + c.MILEAGE_BAND_TOLERANCE }), { vehicle_mileage: 100000 });
  assert.equal(atEdge.mileage_factor, 1);                      // exactly tolerance is on-band
  assert.equal(onePast.mileage_factor, c.MILEAGE_FAR_FACTOR);  // one mile past is off-band
});

test("weightOpinion down-weights a stale opinion and keeps a fresh one whole", () => {
  const fresh = c.weightOpinion(opinion("R1", "owner", { updated_at: NOW - 86400 }), { now: NOW });
  const stale = c.weightOpinion(opinion("R1", "owner", { updated_at: NOW - c.STALE_AFTER_SECONDS - 1 }), { now: NOW });
  assert.equal(fresh.recency_factor, 1);
  assert.equal(stale.recency_factor, c.STALE_FACTOR);
  assert.equal(stale.weight, c.SOURCE_TIERS.owner * c.STALE_FACTOR);
});

test("staleness holds at its exact boundary", () => {
  const edge = c.weightOpinion(opinion("R1", "owner", { updated_at: NOW - c.STALE_AFTER_SECONDS }), { now: NOW });
  const past = c.weightOpinion(opinion("R1", "owner", { updated_at: NOW - c.STALE_AFTER_SECONDS - 1 }), { now: NOW });
  assert.equal(edge.recency_factor, 1);                     // exactly the age limit is still fresh
  assert.equal(past.recency_factor, c.STALE_FACTOR);
});

test("weightOpinion uses the injected now and no wall clock", () => {
  const o = opinion("R1", "owner", { updated_at: NOW - 1000 });
  const seenEarly = c.weightOpinion(o, { now: NOW });
  const seenLate = c.weightOpinion(o, { now: NOW + c.STALE_AFTER_SECONDS });
  assert.equal(seenEarly.recency_factor, 1);
  assert.equal(seenLate.recency_factor, c.STALE_FACTOR);
});

test("weightOpinion returns null for anything that cannot name a repair", () => {
  assert.equal(c.weightOpinion(null), null);
  assert.equal(c.weightOpinion({}), null);
  assert.equal(c.weightOpinion({ repair_id: null, source: "owner" }), null);
  assert.equal(c.weightOpinion({ repair_id: "  ", source: "owner" }), null);
});

test("normalizeOpinion reads the stored community row aliases", () => {
  const n = c.normalizeOpinion(communityRow("Clean the VANOS solenoid", "indie", { source: "E90Post DIY threads" }));
  assert.equal(n.repair_id, "Clean the VANOS solenoid");
  assert.equal(n.source, "e90post diy threads");
  assert.equal(n.tier, "indie");
  assert.equal(n.updated_at, NOW - 86400);
});

/* ------------------------------------------------------------------ *
 * tally
 * ------------------------------------------------------------------ */

test("tally groups opinions by repair and sums their earned weight", () => {
  const t = c.tally([
    opinion("R1", "workshop"),
    opinion("R1", "owner"),
    opinion("R2", "anonymous"),
  ]);
  assert.equal(t.n_repairs, 2);
  const r1 = t.repairs.find(r => r.repair_id === "R1");
  assert.equal(r1.raw_count, 2);
  assert.equal(r1.weighted, c.SOURCE_TIERS.workshop + c.SOURCE_TIERS.owner);
});

test("tally counts distinct sources, so repeated rows from one source count once", () => {
  const t = c.tally([opinion("R1", "owner"), opinion("R1", "owner"), opinion("R1", "owner")]);
  assert.equal(t.repairs[0].raw_count, 3);
  assert.equal(t.repairs[0].distinct_sources, 1);
  assert.equal(t.n_sources, 1);
});

test("tally reports supporters and dissenters per repair", () => {
  const t = c.tally([opinion("R1", "workshop"), opinion("R1", "owner"), opinion("R2", "anonymous")]);
  const r1 = t.repairs.find(r => r.repair_id === "R1");
  assert.equal(r1.supporters, 2);
  assert.equal(r1.dissenters, 1);
});

test("tally orders repairs by earned weight, heaviest first", () => {
  const t = c.tally([opinion("R1", "anonymous"), opinion("R2", "workshop")]);
  assert.equal(t.repairs[0].repair_id, "R2");
});

test("tally tolerates junk input and drops opinions with no repair_id", () => {
  assert.deepEqual(c.tally(null).repairs, []);
  assert.equal(c.tally({}).n_opinions, 0);
  const t = c.tally([null, {}, { repair_id: null, source: "owner" }, opinion("R1", "owner")]);
  assert.equal(t.n_opinions, 1);
  assert.equal(t.repairs[0].repair_id, "R1");
});

test("tally does not crash on NaN mileage or a missing timestamp", () => {
  const t = c.tally([opinion("R1", "owner", { mileage_band: NaN, updated_at: NaN })], { vehicle_mileage: 100000 });
  assert.equal(t.n_opinions, 1);
  assert.equal(t.repairs[0].weighted, c.SOURCE_TIERS.owner);
});

/* ------------------------------------------------------------------ *
 * consensus — refusals
 * ------------------------------------------------------------------ */

test("fewer than the minimum opinions is insufficient, not a weak verdict", () => {
  const r = c.analyze([
    opinion("R1", "workshop"), opinion("R2", "owner"), opinion("R3", "anonymous"),
  ]);
  assert.equal(r.consensus.verdict, "insufficient");
  assert.equal(r.consensus.winner, null);
  assert.equal(r.consensus.score, null);
  assert.equal(r.consensus.confidence, 0);
  assert.equal(r.consensus.margin, null);
});

test("consensus evidence names the opinion shortfall in plain language", () => {
  const r = c.analyze([opinion("R1", "workshop"), opinion("R1", "owner")]);
  assert.match(r.consensus.evidence.join(" | "), /quorum needs 4/);
});

test("a single source is refused even with many opinions", () => {
  const r = c.analyze([
    opinion("R1", "owner"), opinion("R1", "owner"), opinion("R1", "owner"),
    opinion("R1", "owner"), opinion("R1", "owner"), opinion("R1", "owner"),
  ]);
  assert.equal(r.summary.n_opinions, 6);
  assert.equal(r.summary.n_sources, 1);
  assert.equal(r.consensus.verdict, "insufficient");
  assert.match(r.consensus.evidence.join(" | "), /quorum needs 2/);
});

test("a single very confident opinion is never a consensus", () => {
  const r = c.analyze([opinion("R1", "workshop")]);
  assert.equal(r.consensus.verdict, "insufficient");
  assert.equal(r.consensus.winner, null);
  assert.notEqual(r.consensus.verdict, "agreed");
  assert.equal(r.consensus.confidence, 0);
});

/* ------------------------------------------------------------------ *
 * consensus — agreement and contention
 * ------------------------------------------------------------------ */

test("a clear weighted majority is agreed", () => {
  const r = c.analyze([
    opinion("R1", "workshop"), opinion("R1", "verified_owner"), opinion("R1", "owner"),
    opinion("R2", "anonymous"),
  ]);
  assert.equal(r.consensus.verdict, "agreed");
  assert.equal(r.consensus.winner, "R1");
  assert.equal(r.consensus.contested, false);
  assert.ok(r.consensus.score > 0 && r.consensus.score <= 1);
  assert.ok(r.consensus.confidence > 0);
});

test("a two-way contest inside the margin returns contested true and picks no winner", () => {
  const r = c.analyze([
    opinion("R1", "workshop"), opinion("R1", "owner"),
    opinion("R2", "workshop"), opinion("R2", "owner"),
  ]);
  assert.equal(r.consensus.contested, true);
  assert.equal(r.consensus.verdict, "contested");
  assert.equal(r.consensus.winner, null);
  assert.equal(r.consensus.score, null);
  assert.ok(r.consensus.margin <= c.CONTENTION_MARGIN);
});

test("a contested result carries an explicit contention block", () => {
  const r = c.analyze([
    opinion("R1", "workshop"), opinion("R1", "owner"),
    opinion("R2", "workshop"), opinion("R2", "owner"),
  ]);
  assert.ok(r.consensus.contention);
  assert.equal(r.consensus.contention.threshold, c.CONTENTION_MARGIN);
  assert.ok([r.consensus.contention.leader, r.consensus.contention.challenger].includes("R1"));
  assert.ok([r.consensus.contention.leader, r.consensus.contention.challenger].includes("R2"));
});

test("the contention decision holds at its exact margin boundary", () => {
  const mk = (secondWeight) => ({
    repairs: [
      { repair_id: "R1", raw_count: 2, weighted: 1, distinct_sources: 2, supporters: 2, dissenters: 2 },
      { repair_id: "R2", raw_count: 2, weighted: secondWeight, distinct_sources: 2, supporters: 2, dissenters: 2 },
    ],
    n_opinions: 4, n_sources: 2, n_repairs: 2, total_weight: 1 + secondWeight,
  });
  // (1 - 0.75) / 1 = 0.25 exactly → still contested (inclusive).
  assert.equal(c.consensus(mk(0.75)).contested, true);
  // (1 - 0.74) / 1 = 0.26 → past the margin, agreement stands.
  assert.equal(c.consensus(mk(0.74)).contested, false);
  assert.equal(c.consensus(mk(0.74)).verdict, "agreed");
});

test("a unanimous field is agreement, not contention", () => {
  const r = c.analyze([
    opinion("R1", "workshop"), opinion("R1", "verified_owner"),
    opinion("R1", "owner"), opinion("R1", "anonymous"),
  ]);
  assert.equal(r.consensus.verdict, "agreed");
  assert.equal(r.consensus.winner, "R1");
  assert.equal(r.consensus.score, 1);
});

/* ------------------------------------------------------------------ *
 * analyze
 * ------------------------------------------------------------------ */

test("analyze returns a ranking, a consensus, a dissent list and a summary", () => {
  const r = c.analyze([
    opinion("R1", "workshop"), opinion("R1", "verified_owner"), opinion("R1", "owner"),
    opinion("R2", "anonymous"),
  ]);
  assert.equal(r.ranking.length, 2);
  assert.ok(r.consensus && typeof r.consensus === "object");
  assert.ok(Array.isArray(r.dissent));
  assert.equal(r.summary.n_opinions, 4);
  assert.equal(r.summary.n_sources, 4);
  assert.equal(r.summary.n_repairs, 2);
});

test("analyze reports dissent instead of discarding it", () => {
  const r = c.analyze([
    opinion("R1", "workshop"), opinion("R1", "verified_owner"), opinion("R1", "owner"),
    opinion("R2", "anonymous"),
  ]);
  assert.equal(r.dissent.length, 1);
  assert.equal(r.dissent[0].repair_id, "R2");
  assert.equal(r.dissent[0].supporters, 1);
});

test("analyze summarises agreement, contention and refusal in its headline", () => {
  const agreed = c.analyze([
    opinion("R1", "workshop"), opinion("R1", "verified_owner"), opinion("R1", "owner"),
    opinion("R2", "anonymous"),
  ]);
  assert.match(agreed.summary.headline, /community agreement/);
  const contested = c.analyze([
    opinion("R1", "workshop"), opinion("R1", "owner"),
    opinion("R2", "workshop"), opinion("R2", "owner"),
  ]);
  assert.match(contested.summary.headline, /contested/);
  const refused = c.analyze([opinion("R1", "workshop")]);
  assert.match(refused.summary.headline, /no second opinion/);
});

test("analyze tolerates junk input without throwing", () => {
  assert.deepEqual(c.analyze(null).ranking, []);
  assert.equal(c.analyze({}).summary.n_opinions, 0);
  assert.equal(c.analyze([]).consensus.verdict, "insufficient");
  assert.equal(c.analyze([null, {}]).summary.n_opinions, 0);
});

test("analyze is deterministic under an injected now", () => {
  const input = () => [
    opinion("R1", "workshop"), opinion("R1", "owner", { updated_at: NOW - c.STALE_AFTER_SECONDS - 1 }),
    opinion("R2", "verified_owner"), opinion("R2", "anonymous"),
  ];
  const a = c.analyze(input(), { now: NOW });
  const b = c.analyze(input(), { now: NOW });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("no produced string is ever rendered as a probability or likelihood", () => {
  const r = c.analyze([
    opinion("R1", "workshop"), opinion("R1", "verified_owner"), opinion("R1", "owner"),
    opinion("R2", "anonymous"), opinion("R2", "anonymous"),
    opinion("R3", "owner"), opinion("R3", "diy"),
  ]);
  const strings = collectStrings(r);
  assert.ok(strings.length > 0);
  for (const s of strings) {
    assert.doesNotMatch(s, /probability|likelihood|% chance/i);
  }
});
