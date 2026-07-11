"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  extractDtcCodes,
  toPgVector,
  createSupermemorySearcher,
  buildSupermemoryContext,
  compatibilityStatus,
  BEEMUU_DIAGNOSTIC_AGENT_SYSTEM_PROMPT
} = require("../supermemory");
const { seedDtcCodes } = require("../seed-dtc-codes");

test("extractDtcCodes finds loose OBD-II and BMW hex codes without duplicates", () => {
  assert.deepEqual(
    extractDtcCodes("codes p0301, 2a82 and 0x30ff plus p0301 again"),
    ["P0301", "2A82", "30FF"]
  );
});

test("toPgVector serializes embedding arrays for pgvector parameters", () => {
  assert.equal(toPgVector([0.1, -0.2, 3]), "[0.1,-0.2,3]");
});

test("createSupermemorySearcher merges exact and semantic hits by code", async () => {
  const queries = [];
  const fakePool = {
    async query(text, values) {
      queries.push({ text, values });
      if (/WHERE code = ANY/.test(text)) {
        return { rows: [{ ...seedDtcCodes[1], score: 1, exact_match: true }] };
      }
      return {
        rows: [
          { ...seedDtcCodes[1], score: 0.88, exact_match: false },
          { ...seedDtcCodes[2], score: 0.81, exact_match: false }
        ]
      };
    }
  };

  const searcher = createSupermemorySearcher({
    pool: fakePool,
    embedText: async (input) => {
      assert.match(input, /sluggish acceleration/);
      return [0.1, 0.2, 0.3];
    }
  });

  const hits = await searcher.searchSupermemory("P0301 and sluggish acceleration", {
    engine: "N54",
    chassis: "E90"
  });

  assert.deepEqual(hits.map((hit) => hit.code), ["P0301", "30FF"]);
  assert.equal(hits[0].exact_match, true);
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].values[0], ["P0301"]);
});

test("buildSupermemoryContext marks compatibility and trims payload", () => {
  const context = buildSupermemoryContext({
    userMessage: "sluggish acceleration and cold-start rattle",
    vehicle: { year: 2008, make: "BMW", model: "335i", engine: "N54", chassis: "E90" },
    hits: [{ ...seedDtcCodes[2], score: 0.91 }]
  });

  assert.equal(context.source, "beemuu_supermemory");
  assert.deepEqual(context.vehicle_tags, ["N54", "E90", "335I"]);
  assert.equal(context.diagnostic_candidates[0].code, "30FF");
  assert.equal(context.diagnostic_candidates[0].compatibility_status, "match");
  assert.ok(context.rules.some((rule) => /Exact DTC/.test(rule)));
});

test("compatibilityStatus refuses to over-apply BMW proprietary codes", () => {
  assert.equal(compatibilityStatus(seedDtcCodes[2], ["B58", "G20"]), "unverified_for_vehicle");
  assert.equal(compatibilityStatus(seedDtcCodes[1], ["B58", "G20"]), "match");
  assert.equal(compatibilityStatus(seedDtcCodes[2], []), "vehicle_unknown");
});

test("agent system prompt requires Supermemory grounding and compatibility discipline", () => {
  assert.match(BEEMUU_DIAGNOSTIC_AGENT_SYSTEM_PROMPT, /Use Supermemory first/);
  assert.match(BEEMUU_DIAGNOSTIC_AGENT_SYSTEM_PROMPT, /Do not hallucinate BMW compatibility/);
  assert.match(BEEMUU_DIAGNOSTIC_AGENT_SYSTEM_PROMPT, /beemuu is diagnostic-first/);
});
