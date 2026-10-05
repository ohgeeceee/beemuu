"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTimeline } = require("../fault_timeline.js");

test("fault timeline normalizes records and sorts most recent first", () => {
  const result = buildTimeline([
    { code: "p0301", address: 17, text: "Cylinder misfire", first_seen_iso: "2025-01-01T00:00:00Z", last_seen_iso: "2025-02-01T00:00:00Z", occurrences: 3 },
    { code: "P0171", address: 18, text: "Mixture", first_seen_iso: "2025-01-05T00:00:00Z", last_seen_iso: "2025-03-01T00:00:00Z", occurrences: 1 },
  ]);
  assert.deepEqual(result.map(row => row.code), ["P0171", "P0301"]);
  assert.equal(result[1].occurrences, 3);
  assert.equal(result[1].kind, "recorded-dtc");
});

test("fault timeline ignores malformed or undated entries instead of inventing dates", () => {
  assert.deepEqual(buildTimeline([
    { code: "P0301", address: 1, first_seen_iso: "unknown", last_seen_iso: "2025-01-01" },
    { code: "", address: 1, first_seen_iso: "2025-01-01", last_seen_iso: "2025-01-02" },
    null,
  ]), []);
});

test("fault timeline applies a bounded result limit", () => {
  const entries = Array.from({ length: 6 }, (_, i) => ({
    code: `P0${i}00`, address: i, first_seen_iso: "2025-01-01T00:00:00Z",
    last_seen_iso: `2025-01-0${i + 1}T00:00:00Z`, occurrences: i,
  }));
  assert.equal(buildTimeline(entries, { limit: 2 }).length, 2);
  assert.equal(buildTimeline(entries, { limit: 9999 }).length, 6);
});
