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
  const logSnippet = Array.isArray(input.logSnippet) ? input.logSnippet : [];
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

  if (logSnippet.length) {
    body.push(`<div class="log-snippet"><b>Log channels:</b> `);
    body.push(logSnippet.map((s) => `${esc(s.label)} n=${esc(s.n)} last=${esc(s.last)}`).join(" · "));
    body.push(`</div>`);
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
    `  :root { --fg:#1f2937; --muted:#6b7280; --card:#f8fafc; --border:#e5e7eb; --accent:#2563eb; }`,
    `  body { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;`,
    `         margin:0 auto; padding:24px 16px; max-width:820px; color:var(--fg); background:#fff; line-height:1.6; font-size:15px; }`,
    `  h1 { font-size:1.35rem; margin:0 0 2px; letter-spacing:-0.2px; }`,
    `  .meta { color:var(--muted); font-size:13px; margin-bottom:20px; }`,
    `  .badge { display:inline-block; padding:1px 7px; border-radius:999px; font-size:10px; font-weight:600; margin-left:6px; border:1px solid var(--border); }`,
    `  .badge-needs { background:#fef3c7; color:#92400e; border-color:#f59e0b; }`,
    `  .badge-verified { background:#ecfdf5; color:#065f46; border-color:#10b981; }`,
    `  .step-card { border:1px solid var(--border); border-radius:8px; padding:14px 16px; margin:10px 0; background:var(--card); }`,
    `  .step-current { border-color:var(--accent); background:#eff6ff; }`,
    `  .step-conclusion { border-color:#10b981; background:#ecfdf5; }`,
    `  .step-id { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px; color:var(--muted); margin-bottom:2px; }`,
    `  .step-instr { font-size:15px; margin:6px 0; }`,
    `  .step-measure { background:#f1f5f9; padding:6px 10px; border-radius:6px; margin:6px 0; font-size:13px; }`,
    `  .breadcrumb { font-size:12px; color:var(--muted); margin:14px 0 6px; display:flex; gap:4px; flex-wrap:wrap; }`,
    `  .crumb { padding:1px 5px; background:#e5e7eb; border-radius:3px; }`,
    `  .crumb-current { background:var(--accent); color:#fff; }`,
    `  .chart-wrap { margin:14px 0; }`,
    `  .chart-wrap svg { max-width:100%; height:auto; border:1px solid var(--border); border-radius:4px; }`,
    `  .ff { font-size:12px; color:#374151; background:#f8fafc; padding:6px 10px; border-radius:6px; margin:8px 0; border:1px solid var(--border); }`,
    `  details { margin:10px 0; border:1px solid var(--border); border-radius:6px; padding:4px 8px; }`,
    `  summary { cursor:pointer; font-size:13px; color:var(--muted); user-select:none; }`,
    `  .muted { color:var(--muted); font-style:italic; }`,
    `  #root > div:first-child { margin-bottom:8px; }`,
    `  @media (max-width:480px) { body { padding:16px 12px; font-size:14px; } h1 { font-size:1.15rem; } .step-card { padding:10px 12px; } }`,
    `  @media print { .step-card, .chart-wrap { break-inside:avoid; } }`,
    `</style>`,
  ].join("\n");
}

/**
 * Minimal HTML-escape for in-DOM strings.
 */
function snippetFromLogSeries(series) {
  if (!series) return [];
  const entries = typeof series.entries === "function" ? [...series.entries()] : [];
  return entries.map(([, s]) => {
    const data = typeof s.getAllData === "function" ? s.getAllData() : (Array.isArray(s.data) ? s.data : []);
    const last = data.length ? data[data.length - 1] : null;
    const lastVal = last && typeof last === "object" ? last.y : last;
    return { label: s.label || "", n: data.length, last: lastVal == null ? "" : String(lastVal) };
  }).filter((row) => row.n > 0);
}

function esc(s) {
  s = s == null ? "" : String(s);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Build a JSON snapshot of the walkthrough data (for v0.17.2 export).
 * Machine-readable, no HTML.
 */
function buildSnapshotJson(input) {
  if (!input || !input.plan) return "";
  return JSON.stringify({
    plan: input.plan,
    walkAnswers: Array.isArray(input.walkAnswers) ? input.walkAnswers : [],
    freezeFrame: Array.isArray(input.freezeFrame) ? input.freezeFrame : [],
    logSnippet: Array.isArray(input.logSnippet) ? input.logSnippet : [],
    meta: input.meta || {},
  }, null, 2);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildBundleHtml, computeWalkState, snippetFromLogSeries, buildSnapshotJson };
}
if (typeof window !== "undefined") {
  window.beeemuuWalkthroughBundle = { buildBundleHtml, computeWalkState, snippetFromLogSeries, buildSnapshotJson };
}
