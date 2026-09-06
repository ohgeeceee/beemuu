"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildBeginnerFaultSummary } = require("./beginner_fault_summary.js");

test("beginner fault summary: stays hidden before a fault read", () => {
  assert.equal(buildBeginnerFaultSummary({ faultMemoryRead: false }), null);
});

test("beginner fault summary: explains an empty fault memory", () => {
  const summary = buildBeginnerFaultSummary({ faultMemoryRead: true, faultCount: 0, moduleName: "DME" });
  assert.equal(summary.tone, "ok");
  assert.match(summary.detail, /intermittent problem/i);
});

test("beginner fault summary: frames codes as clues, not repairs", () => {
  const summary = buildBeginnerFaultSummary({ faultMemoryRead: true, faultCount: 2, moduleName: "DME" });
  assert.equal(summary.tone, "attention");
  assert.match(summary.detail, /not a parts-replacement instruction/i);
  assert.match(summary.detail, /freeze frame/i);
});
