"use strict";

// Tests for `src/js/testplan_walk.js` — the pure branch-traversal reducer
// behind the v0.9.0 guided fault-finding walkthrough (PR #4). Run with
// `npm run test:js` (`node --test src/js/test/*.test.cjs`).
//
// Conventions mirror `log_diff.test.cjs`: pure functions, Node-only here;
// the browser render path is verified manually in the simulator.

const test = require("node:test");
const assert = require("node:assert/strict");

const { walk, optionsFor, isConclusion, entryStep } = require("../testplan_walk.js");

// A small 2A82-shaped plan: manual branch → two conclusions.
const PLAN = {
  dtc: "2A82",
  title: "VANOS intake solenoid fault",
  engine_family: "n55",
  steps: [
    {
      id: "s1",
      instruction: "Inspect for sludge.",
      measurement: { kind: "manual", question: "Clogged?" },
      on_pass: "s2",
      on_fail: "s3",
      source: "community/stories/n55.toml",
    },
    { id: "s2", instruction: "Clean it.", conclusion: "Cleaned.", source: "community/opinions/2A82.toml" },
    { id: "s3", instruction: "Replace it.", conclusion: "Replaced.", source: "community/oracle/n55.json" },
  ],
};

// A plan exercising a `next` (linear) edge and a did measurement.
const LINEAR = {
  dtc: "29E0",
  title: "Rail pressure",
  steps: [
    {
      id: "s1",
      instruction: "Read rail pressure.",
      measurement: { kind: "did", did: "0x5AC3", expected_min: 40, expected_max: 200 },
      next: "s2",
      source: "research/bmw_diag_dim04_uds_dids.md",
    },
    { id: "s2", conclusion: "Done.", source: "community/opinions/29E0.toml" },
  ],
};

test("entryStep — prefers s1", () => {
  assert.equal(entryStep(PLAN), "s1");
  assert.equal(entryStep({ steps: [{ id: "sX" }] }), "sX");
  assert.equal(entryStep({ steps: [] }), null);
});

test("walk — no answers sits at the entry step, not done", () => {
  const r = walk(PLAN, []);
  assert.equal(r.currentId, "s1");
  assert.equal(r.done, false);
  assert.equal(r.invalid, false);
  assert.deepEqual(r.path, [{ id: "s1", answer: null }]);
});

test("walk — pass branch reaches the clean conclusion", () => {
  const r = walk(PLAN, ["pass"]);
  assert.equal(r.currentId, "s2");
  assert.equal(r.done, true);
  assert.equal(r.current.conclusion, "Cleaned.");
  assert.deepEqual(r.path, [
    { id: "s1", answer: "pass" },
    { id: "s2", answer: null },
  ]);
});

test("walk — fail branch reaches the replace conclusion", () => {
  const r = walk(PLAN, ["fail"]);
  assert.equal(r.currentId, "s3");
  assert.equal(r.done, true);
  assert.equal(r.current.conclusion, "Replaced.");
});

test("walk — cannot advance past a conclusion", () => {
  // Extra answers after reaching a conclusion are ignored.
  const r = walk(PLAN, ["pass", "fail", "pass"]);
  assert.equal(r.currentId, "s2");
  assert.equal(r.done, true);
});

test("walk — an answer with no matching edge is marked invalid", () => {
  // s1 has no `next` edge; answering "next" is invalid and the walk stays.
  const r = walk(PLAN, ["next"]);
  assert.equal(r.currentId, "s1");
  assert.equal(r.invalid, true);
  assert.equal(r.done, false);
});

test("walk — linear `next` edge advances to conclusion", () => {
  const r = walk(LINEAR, ["next"]);
  assert.equal(r.currentId, "s2");
  assert.equal(r.done, true);
});

test("walk — cycle guard: a self-referential plan never hangs", () => {
  const cyclic = {
    dtc: "BAD",
    steps: [
      { id: "s1", on_pass: "s2", source: "x" },
      { id: "s2", on_pass: "s1", source: "x" }, // loops back
    ],
  };
  const r = walk(cyclic, ["pass", "pass", "pass", "pass"]);
  // Terminates (invalid) rather than looping forever.
  assert.equal(r.invalid, true);
  assert.ok(r.currentId === "s1" || r.currentId === "s2");
});

test("optionsFor — manual branch labels Yes/No", () => {
  const opts = optionsFor(PLAN.steps[0]);
  assert.deepEqual(opts, [
    { answer: "pass", label: "Yes" },
    { answer: "fail", label: "No" },
  ]);
});

test("optionsFor — did branch labels In range / Out of range", () => {
  const step = {
    id: "s1",
    measurement: { kind: "did", did: "0x1" },
    on_pass: "s2",
    on_fail: "s3",
  };
  assert.deepEqual(optionsFor(step), [
    { answer: "pass", label: "In range" },
    { answer: "fail", label: "Out of range" },
  ]);
});

test("optionsFor — linear step offers Continue", () => {
  assert.deepEqual(optionsFor(LINEAR.steps[0]), [{ answer: "next", label: "Continue" }]);
});

test("optionsFor — a conclusion offers no options", () => {
  assert.deepEqual(optionsFor(PLAN.steps[1]), []);
  assert.equal(isConclusion(PLAN.steps[1]), true);
  assert.equal(isConclusion(PLAN.steps[0]), false);
});
