"use strict";

// Static HTML walkthrough bundle (v0.11.0).
//
// Takes a snapshot of the current walkthrough session — test plan, answer
// history, a pre-rendered SVG chart of the log data, freeze-frame context,
// verification badge — and emits a single self-contained `.html` file
// that displays the walkthrough in any browser without Tauri, without
// `invoke()`, and without any external script tags. The intended drop
// target is a forum post, an email, a USB stick on a phone.
//
// Design notes:
//
//   - The output is **stateless** — it shows the snapshot as it was at
//     export time. There are no Pass/Fail buttons to advance the walk;
//     the breadcrumb captures the user's path so a reader can follow
//     the reasoning without driving the plan themselves. This keeps
//     the file small (~5 KB for a typical walkthrough) and removes the
//     need to inline the testplan_walk reducer source at export time.
//
//   - The chart is **pre-rendered at export time** by the caller (main.js,
//     which has access to `window.beeemuuSvg.chartToSvg`). The bundle
//     accepts the resulting SVG string and embeds it verbatim. No
//     `svg_export.js` runtime dependency in the bundle.
//
//   - The bundle is pure data → string. No DOM, no globals. Tests run
//     under `node --test` without any browser shim.
//
// Dual export — CommonJS for `node --test`, browser via
// `window.beeemuuWalkthroughBundle` for the Save button in `main.js`.

/**
 * Build a self-contained HTML string that displays a walkthrough.
 *
 * @param {{
 *   plan: object,                         // test plan (steps, dtc, meta)
 *   walkAnswers: string[],                // answer history (e.g. ["pass", "fail"])
 *   logChartSvg?: string,                 // pre-rendered SVG of the log chart (optional)
 *   freezeFrame?: Array<{label: string, value: string}>,
 *   meta?: {vehicleLabel?: string, profileName?: string, appVersion?: string, exportedAtIso?: string},
 * }} input
 * @returns {string} Self-contained HTML document.
 */
function buildBundleHtml(input) {
  if (!input || !input.plan) return "";
  const plan = input.plan;
  const answers = Array.isArray(input.walkAnswers) ? input.walkAnswers : [];
  const logChartSvg = String(input.logChartSvg || "");
  const freezeFrame = Array.isArray(input.freezeFrame) ? input.freezeFrame : [];
  const meta = input.meta || {};

  // Compute the walkthrough state using the same reducer semantics as
  // the in-app walkthrough — duplicated here so the bundle is self-
  // contained (no inlined reducer needed). Pure function over a small
  // plan graph; O(steps) walk with cycle guard.
  const state = computeWalkState(plan, answers);

  const title = plan.dtc || "?";
  const planTitle = (plan.meta && plan.meta.title) || "";
  const verified = plan.meta && plan.meta.verified === "verified";

  // Compose the body HTML.
  const body = [];
  body.push(`<h1>${esc(title)} — ${esc(planTitle)}`);
  body.push(verified
    ? `<span class="badge badge-verified">✓ Verified</span>`
    : `<span class="badge badge-needs">NEEDS VERIFICATION</span>`);
  body.push(`</h1>`);

  body.push(`<div class="meta">`);
  body.push(esc(meta.vehicleLabel || ""));
  body.push(meta.profileName ? ` · ${esc(meta.profileName)}` : "");
  body.push(meta.exportedAtIso ? ` · exported ${esc(meta.exportedAtIso)}` : "");
  body.push(meta.appVersion ? ` · BeeEmUu ${esc(meta.appVersion)}` : "");
  body.push(`</div>`);

  // Current step card.
  if (state.current) {
    const cls = state.done ? "step-card step-conclusion" : (state.invalid ? "step-card" : "step-card step-current");
    body.push(`<div class="${cls}">`);
    body.push(`<div class="step-id">step ${esc(state.current.id)}${state.done ? " (conclusion)" : ""}</div>`);
    if (state.done) {
      body.push(`<div class="step-instr"><b>Conclusion:</b> ${esc(state.current.conclusion || "")}</div>`);
    } else {
      if (state.current.instruction) {
        body.push(`<div class="step-instr">${esc(state.current.instruction)}</div>`);
      }
      if (state.current.measurement) {
        const m = state.current.measurement;
        if (m.kind === "did") {
          const range = (m.expected_min != null && m.expected_max != null)
            ? ` (expect ${m.expected_min}–${m.expected_max})`
            : "";
          body.push(`<div class="step-measure">📟 Measure <code>${esc(m.did || "")}</code>${esc(range)}</div>`);
        } else {
          body.push(`<div class="step-measure">👀 ${esc(m.question || "Observe")}</div>`);
        }
      }
    }
    if (state.current.source) {
      body.push(`<div class="muted">source: ${esc(state.current.source)}</div>`);
    }
    body.push(`</div>`);
  }
  if (state.invalid) {
    body.push(`<div class="muted">⚠ Walk is invalid — the last answer pointed at a missing branch.</div>`);
  }

  // Breadcrumb.
  const crumbs = state.path.filter((p) => p.answer);
  if (crumbs.length) {
    body.push(`<div class="breadcrumb">Path: `);
    crumbs.forEach((c, i) => {
      const label = c.answer === "pass" ? "Pass" : (c.answer === "fail" ? "Fail" : "→");
      const cls = (i === crumbs.length - 1) ? `crumb crumb-current` : `crumb`;
      body.push(`<span class="${cls}">${esc(label)}</span>`);
    });
    body.push(`</div>`);
  }

  // Freeze frame.
  if (freezeFrame.length) {
    body.push(`<div class="ff"><b>At fault time:</b> `);
    body.push(freezeFrame.map((f) => `${esc(f.label)} ${esc(f.value)}`).join(" · "));
    body.push(`</div>`);
  }

  // Pre-rendered log chart (embedded verbatim). The SVG comes from the
  // caller's `svg_export.chartToSvg(...)` call at export time.
  if (logChartSvg) {
    body.push(`<div class="chart-wrap">${logChartSvg}</div>`);
  }

  // Full plan tree (collapsible).
  const stepCount = (plan.steps || []).length;
  body.push(`<details><summary>Full plan tree (${stepCount} step${stepCount === 1 ? "" : "s"})</summary>`);
  body.push(renderPlanTree(plan));
  body.push(`</details>`);

  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>BeeEmUu walkthrough — ${esc(title)}</title>`,
    inlineCss(),
    `</head>`,
    `<body>`,
    `<div id="root">${body.join("\n")}</div>`,
    // Tiny trailing script: nothing to do at view time — the body is
    // already rendered server-side. But we emit an empty IIFE so the
    // page is future-proofed for interactive enhancements without
    // needing a structural change to the bundle.
    `<script>(function(){})();</script>`,
    `</body>`,
    `</html>`,
  ].join("\n");
}

/**
 * Walk a plan from the entry step, applying an ordered list of answers.
 * Mirrors `TestPlanWalk.walk` semantics so the bundle's breadcrumb and
 * current-step match the in-app display.
 *
 * @param {object} plan - {steps: [{id, on_pass?, on_fail?, next?, conclusion?}]}
 * @param {string[]} answers - ["pass", "fail", "next", ...]
 * @returns {{current: object|null, path: Array, done: boolean, invalid: boolean}}
 */
function computeWalkState(plan, answers) {
  const byId = {};
  for (const s of (plan && plan.steps) || []) byId[s.id] = s;
  const startId = byId["s1"] ? "s1" : (plan && plan.steps && plan.steps[0] ? plan.steps[0].id : null);
  const path = [];
  let currentId = startId;
  let invalid = false;
  const seq = Array.isArray(answers) ? answers : [];
  const visited = new Set();
  for (const answer of seq) {
    const step = byId[currentId];
    if (!step || isConclusion(step)) break;
    let target = null;
    if (answer === "pass") target = step.on_pass || null;
    else if (answer === "fail") target = step.on_fail || null;
    else if (answer === "next") target = step.next || null;
    if (!target || !byId[target]) {
      invalid = true;
      break;
    }
    path.push({ id: currentId, answer });
    currentId = target;
    if (visited.has(currentId)) { invalid = true; break; }
    visited.add(currentId);
  }
  const current = byId[currentId] || null;
  path.push({ id: currentId, answer: null });
  return { current, path, done: isConclusion(current), invalid };
}

function isConclusion(step) {
  return !!(step && typeof step.conclusion === "string" && step.conclusion.trim() !== "");
}

/**
 * Render the full plan graph as a collapsible list. Each step is a
 * bullet with its instruction / conclusion + outgoing edges.
 */
function renderPlanTree(plan) {
  const steps = plan.steps || [];
  const parts = [];
  parts.push(`<div style="margin-top:8px">`);
  for (const s of steps) {
    const conc = isConclusion(s);
    parts.push(`<div style="border-left: 2px solid #ddd; padding: 4px 0 4px 12px; margin: 6px 0;">`);
    parts.push(`<div class="step-id">${esc(s.id)}${conc ? " (conclusion)" : ""}</div>`);
    if (s.instruction) parts.push(`<div>${esc(s.instruction)}</div>`);
    if (s.conclusion) parts.push(`<div><i>${esc(s.conclusion)}</i></div>`);
    const edges = [];
    if (s.on_pass) edges.push(`pass → ${s.on_pass}`);
    if (s.on_fail) edges.push(`fail → ${s.on_fail}`);
    if (s.next) edges.push(`next → ${s.next}`);
    if (edges.length) parts.push(`<div class="muted">${edges.map(esc).join(" · ")}</div>`);
    parts.push(`</div>`);
  }
  parts.push(`</div>`);
  return parts.join("");
}

function inlineCss() {
  return [
    `<style>`,
    `  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;`,
    `         margin: 0 auto; padding: 24px; max-width: 880px;`,
    `         color: #1a1a1a; background: #fff; line-height: 1.5; }`,
    `  h1 { font-size: 22px; margin: 0 0 4px 0; }`,
    `  .meta { color: #666; font-size: 13px; margin-bottom: 24px; }`,
    `  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px;`,
    `           font-size: 11px; font-weight: 600; margin-left: 8px; }`,
    `  .badge-needs { background: #fff4e0; color: #8a5a00; border: 1px solid #f0c060; }`,
    `  .badge-verified { background: #e0f5e0; color: #1a6a1a; border: 1px solid #80c080; }`,
    `  .step-card { border: 1px solid #ddd; border-radius: 6px; padding: 16px;`,
    `               margin: 12px 0; background: #fafafa; }`,
    `  .step-current { border-color: #4da3ff; background: #f0f7ff; }`,
    `  .step-conclusion { border-color: #80c080; background: #f0fff0; }`,
    `  .step-id { font-family: ui-monospace, Menlo, monospace; font-size: 12px;`,
    `             color: #888; margin-bottom: 4px; }`,
    `  .step-instr { font-size: 15px; margin: 8px 0; }`,
    `  .step-measure { background: #f0f4f8; padding: 8px 12px; border-radius: 4px;`,
    `                  margin: 8px 0; font-size: 14px; }`,
    `  .breadcrumb { font-size: 12px; color: #888; margin: 16px 0 8px 0; }`,
    `  .crumb { display: inline-block; padding: 2px 6px; margin-right: 4px;`,
    `           background: #e0e0e0; border-radius: 3px; }`,
    `  .crumb-current { background: #4da3ff; color: #fff; }`,
    `  .chart-wrap { margin: 16px 0; }`,
    `  .chart-wrap svg { max-width: 100%; height: auto; border: 1px solid #eee; }`,
    `  .ff { font-size: 12px; color: #555; background: #f8f8f0; padding: 8px 12px;`,
    `        border-radius: 4px; margin: 8px 0; }`,
    `  details { margin: 8px 0; }`,
    `  summary { cursor: pointer; font-size: 14px; color: #555; }`,
    `  .muted { color: #888; font-style: italic; }`,
    `  @media print {`,
    `    .step-card { break-inside: avoid; }`,
    `    .chart-wrap { break-inside: avoid; }`,
    `  }`,
    `</style>`,
  ].join("\n");
}

/**
 * Minimal HTML-escape for in-DOM strings.
 */
function esc(s) {
  s = s == null ? "" : String(s);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildBundleHtml, computeWalkState };
}
if (typeof window !== "undefined") {
  window.beeemuuWalkthroughBundle = { buildBundleHtml, computeWalkState };
}
