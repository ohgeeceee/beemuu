"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildFirstScanGuide } = require("./first_scan_guide.js");

test("first scan guide: simulator starts with safe learning guidance", () => {
  const guide = buildFirstScanGuide({ connectionKind: "sim" });
  assert.match(guide.intro, /does not clear faults/i);
  assert.match(guide.steps[0].detail, /safe place to learn/i);
  assert.equal(guide.steps[1].complete, false);
  assert.equal(guide.steps[2].complete, false);
});

test("first scan guide: ENET warns users to discover rather than guess", () => {
  const guide = buildFirstScanGuide({ connectionKind: "enet" });
  assert.match(guide.steps[0].detail, /Use Discover/i);
  assert.match(guide.steps[0].detail, /do not guess/i);
});

test("first scan guide: reports completed read-only scan progress", () => {
  const guide = buildFirstScanGuide({
    connectionKind: "kdcan",
    connected: true,
    moduleCount: 24,
    selectedModuleName: "DME",
    faultMemoryRead: true,
    faultCount: 2,
  });
  assert.deepEqual(guide.steps.map((step) => step.complete), [true, true, true, true]);
  assert.match(guide.steps[3].detail, /2 faults read/i);
});
