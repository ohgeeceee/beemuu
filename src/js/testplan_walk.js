"use strict";

// Pure branch-traversal reducer for the guided fault-finding walkthrough
// (v0.9.0 PR #4). Given a test plan (from the `get_test_plan` command) and
// a sequence of answers, computes the current node and the breadcrumb path.
//
// This is deliberately a pure function with no DOM / Tauri dependency so it
// can be unit-tested under `node --test` (see
// `src/js/test/testplan_walk.test.cjs`). Conventions mirror `log_diff.js`:
// dual export for Node (CommonJS) and the browser (plain <script>).
//
// Plan shape (mirror of Rust `TestPlan`, docs/testplans.md):
//   { dtc, title, engine_family, steps: [ {
//       id, instruction?, measurement?, on_pass?, on_fail?, next?,
//       conclusion?, source } ] }
//
// An "answer" is one of: "pass", "fail", "next". The reducer maps it to the
// step's on_pass / on_fail / next edge respectively.

function indexSteps(plan) {
  const byId = {};
  for (const s of (plan && plan.steps) || []) byId[s.id] = s;
  return byId;
}

function entryStep(plan) {
  // Convention: the walkthrough starts at "s1" (enforced by the CI gate).
  // Fall back to the first step if a plan omits it (defensive only).
  const byId = indexSteps(plan);
  if (byId["s1"]) return "s1";
  return plan && plan.steps && plan.steps.length ? plan.steps[0].id : null;
}

function nextId(step, answer) {
  if (!step) return null;
  if (answer === "pass") return step.on_pass || null;
  if (answer === "fail") return step.on_fail || null;
  if (answer === "next") return step.next || null;
  return null;
}

function isConclusion(step) {
  return !!(step && typeof step.conclusion === "string" && step.conclusion.trim() !== "");
}

// Walk a plan from the entry step, applying an ordered list of answers.
// Returns { currentId, current, path, done, invalid }.
//   - path: array of { id, answer } breadcrumb entries taken so far
//     (answer is null for the final/current node).
//   - done: true when the current node is a conclusion.
//   - invalid: true if an answer pointed at a missing/absent edge (the
//     walk stops at the last valid node — the UI keeps the buttons live).
// A visited-set bound guards against a malformed cyclic plan hanging the UI.
function walk(plan, answers) {
  const byId = indexSteps(plan);
  const startId = entryStep(plan);
  const path = [];
  let currentId = startId;
  let invalid = false;

  const seq = Array.isArray(answers) ? answers : [];
  const visited = new Set();
  for (const answer of seq) {
    const step = byId[currentId];
    if (!step || isConclusion(step)) break; // can't advance past a conclusion
    const target = nextId(step, answer);
    if (!target || !byId[target]) {
      invalid = true;
      break;
    }
    path.push({ id: currentId, answer });
    currentId = target;
    if (visited.has(currentId)) {
      // Cycle guard: a well-formed plan is acyclic (CI-gated), but never
      // loop forever on a bad one.
      invalid = true;
      break;
    }
    visited.add(currentId);
  }

  const current = byId[currentId] || null;
  path.push({ id: currentId, answer: null });
  return {
    currentId,
    current,
    path,
    done: isConclusion(current),
    invalid,
  };
}

// The answer options a given step offers, derived from its edges + the
// measurement kind. Returns an array of { answer, label } for the UI to
// render as buttons. A conclusion node returns [].
function optionsFor(step) {
  if (!step || isConclusion(step)) return [];
  const opts = [];
  const m = step.measurement || null;
  if (step.on_pass && step.on_fail) {
    // Branching step: label pass/fail from the measurement question when present.
    if (m && m.kind === "manual") {
      opts.push({ answer: "pass", label: "Yes" });
      opts.push({ answer: "fail", label: "No" });
    } else if (m && m.kind === "did") {
      opts.push({ answer: "pass", label: "In range" });
      opts.push({ answer: "fail", label: "Out of range" });
    } else {
      opts.push({ answer: "pass", label: "Pass" });
      opts.push({ answer: "fail", label: "Fail" });
    }
  } else if (step.on_pass) {
    opts.push({ answer: "pass", label: "Pass" });
  } else if (step.on_fail) {
    opts.push({ answer: "fail", label: "Fail" });
  }
  if (step.next) opts.push({ answer: "next", label: "Continue" });
  return opts;
}

const TestPlanWalk = { walk, optionsFor, isConclusion, entryStep, nextId };

if (typeof module !== "undefined" && module.exports) {
  module.exports = TestPlanWalk;
}
if (typeof window !== "undefined") {
  window.TestPlanWalk = TestPlanWalk;
}
