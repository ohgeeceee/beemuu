"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildBundleHtml, computeWalkState } = require("../../src/js/walkthrough_bundle.js");

// Minimal 2A82-style test plan fixture.
const plan2A82 = {
  dtc: "2A82",
  meta: { verified: "needs verification", title: "VANOS intake solenoid fault", engine_family: "n55" },
  steps: [
    {
      id: "s1",
      instruction: "Remove the intake VANOS solenoid and inspect the screen.",
      measurement: { kind: "manual", question: "Is the solenoid screen clogged?" },
      on_pass: "s2",
      on_fail: "s3",
      source: "community/stories/n55.toml",
    },
    {
      id: "s2",
      instruction: "Clean and reinstall.",
      measurement: { kind: "manual", question: "Does 2A82 return?" },
      on_pass: "s4",
      on_fail: "s5",
      source: "community/opinions/2A82.toml",
    },
    { id: "s3", instruction: "Screen is clean — replace solenoid.", next: "s4", source: "community/oracle/n55.json" },
    { id: "s4", conclusion: "Mechanical VANOS solenoid failure.", source: "community/opinions/2A82.toml" },
    { id: "s5", instruction: "Investigate wiring.", next: "s4", source: "community/opinions/2A82.toml" },
  ],
};

function baseInput(overrides) {
  return Object.assign(
    {
      plan: plan2A82,
      walkAnswers: [],
      freezeFrame: [],
      meta: { vehicleLabel: "F30 335i", profileName: "n55", appVersion: "0.10.0", exportedAtIso: "2026-07-21T10:00:00Z" },
    },
    overrides || {}
  );
}

test("buildBundleHtml: returns empty string for null/empty input", () => {
  assert.equal(buildBundleHtml(null), "");
  assert.equal(buildBundleHtml({}), "");
  assert.equal(buildBundleHtml({ plan: null }), "");
});

test("buildBundleHtml: produces a self-contained HTML document", () => {
  const html = buildBundleHtml(baseInput());
  assert.ok(html.startsWith("<!doctype html>"), "should start with doctype");
  assert.ok(html.includes("<html lang=\"en\">"), "should have html root");
  assert.ok(html.includes("</html>"), "should close html");
  assert.ok(html.includes("</body>"), "should close body");
  // No CDN / external script / external stylesheet — must open from a USB stick.
  assert.ok(!/src=["']https?:\/\//i.test(html), "no external script src");
  assert.ok(!/<link[^>]+href=["']https?:\/\//i.test(html), "no external stylesheet");
  assert.ok(!/cdnjs/i.test(html), "no CDN reference");
});

test("buildBundleHtml: includes the DTC, plan title, and NEEDS VERIFICATION badge by default", () => {
  const html = buildBundleHtml(baseInput());
  assert.ok(html.includes("2A82"), "DTC code present");
  assert.ok(html.includes("VANOS intake solenoid fault"), "plan title present");
  assert.ok(html.includes("NEEDS VERIFICATION"), "default needs-verification badge present");
  assert.ok(html.includes("badge-needs"), "needs-verification CSS class present");
});

test("buildBundleHtml: shows ✓ Verified badge when meta.verified === 'verified'", () => {
  const planVerified = JSON.parse(JSON.stringify(plan2A82));
  planVerified.meta.verified = "verified";
  const html = buildBundleHtml(baseInput({ plan: planVerified }));
  assert.ok(html.includes("✓ Verified"), "verified badge present");
  assert.ok(html.includes("badge-verified"), "verified CSS class present");
  // The inline CSS still defines `.badge-needs` (it's harmless to
  // ship a rule we don't use). The badge `<span>` itself is what
  // changes; assert against the rendered badge content.
  assert.ok(!html.includes('class="badge badge-needs"'), "needs-verification badge span absent");
});

test("buildBundleHtml: shows the entry step when no answers are given", () => {
  const html = buildBundleHtml(baseInput());
  assert.ok(html.includes("step s1"), "entry step id rendered");
  assert.ok(html.includes("Remove the intake VANOS solenoid"), "entry instruction rendered");
});

test("buildBundleHtml: shows the breadcrumb when answers are given", () => {
  const html = buildBundleHtml(baseInput({ walkAnswers: ["pass", "fail"] }));
  assert.ok(html.includes("Path:"));
  assert.ok(html.includes(">Pass<"), "first crumb label rendered");
  assert.ok(html.includes(">Fail<"), "second crumb label rendered");
});

test("buildBundleHtml: marks the final crumb as current", () => {
  const html = buildBundleHtml(baseInput({ walkAnswers: ["pass"] }));
  assert.ok(html.includes("crumb crumb-current"), "current crumb marked");
});

test("buildBundleHtml: renders 'next' arrow for linear steps", () => {
  const html = buildBundleHtml(baseInput({ walkAnswers: ["next", "pass"] }));
  assert.ok(html.includes("→"), "arrow for 'next' answers");
});

test("buildBundleHtml: renders the freeze-frame context when provided", () => {
  const html = buildBundleHtml(baseInput({
    freezeFrame: [
      { label: "Coolant temp", value: "92 °C" },
      { label: "Engine speed", value: "0 rpm" },
    ],
  }));
  assert.ok(html.includes("At fault time:"), "ff heading present");
  assert.ok(html.includes("Coolant temp"), "ff label present");
  assert.ok(html.includes("92 °C"), "ff value present");
});

test("buildBundleHtml: embeds a pre-rendered log chart SVG when provided", () => {
  const fakeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200"><polyline points="0,100 100,80"/></svg>`;
  const html = buildBundleHtml(baseInput({ logChartSvg: fakeSvg }));
  assert.ok(html.includes("chart-wrap"), "chart wrapper present");
  assert.ok(html.includes(fakeSvg), "pre-rendered SVG embedded verbatim");
});

test("buildBundleHtml: omits the chart-wrap DIV when no logChartSvg is provided", () => {
  const html = buildBundleHtml(baseInput());
  // The CSS rule `.chart-wrap { ... }` is always in the bundle. We
  // assert against the wrapper DIV (rendered by the bundle when a
  // chart is provided), not the class.
  assert.ok(!html.includes('<div class="chart-wrap">'), "chart wrapper div absent");
});

test("buildBundleHtml: includes the full plan tree in a <details> block", () => {
  const html = buildBundleHtml(baseInput());
  assert.ok(html.includes("<details>"), "details element present");
  assert.ok(html.includes("Full plan tree (5 steps)"), "step count rendered");
  assert.ok(html.includes(">s1<"), "step s1 rendered in tree");
  assert.ok(html.includes(">s5<"), "step s5 rendered in tree");
  assert.ok(html.includes("Mechanical VANOS solenoid failure"), "conclusion rendered");
});

test("buildBundleHtml: meta block includes vehicle, profile, app version, export timestamp", () => {
  const html = buildBundleHtml(baseInput());
  assert.ok(html.includes("F30 335i"), "vehicle label rendered");
  assert.ok(html.includes("n55"), "profile name rendered");
  assert.ok(html.includes("0.10.0"), "app version rendered");
  assert.ok(html.includes("2026-07-21T10:00:00Z"), "export timestamp rendered");
});

test("buildBundleHtml: HTML-escapes DTC + title content", () => {
  const html = buildBundleHtml(baseInput({
    plan: {
      ...plan2A82,
      dtc: "<script>alert(1)</script>",
      meta: { ...plan2A82.meta, title: 'A & B "C"' },
    },
  }));
  assert.ok(!html.includes("<script>alert(1)</script>"), "raw <script> not in output");
  assert.ok(html.includes("&lt;script&gt;"), "escaped <script>");
  assert.ok(html.includes("A &amp; B"), "ampersand escaped");
});

test("buildBundleHtml: produces a balanced document with no obvious holes", () => {
  const html = buildBundleHtml(baseInput({ walkAnswers: ["pass"], freezeFrame: [{ label: "X", value: "Y" }] }));
  const openBody = (html.match(/<body[\s>]/g) || []).length;
  const closeBody = (html.match(/<\/body>/g) || []).length;
  assert.equal(openBody, 1, "one <body>");
  assert.equal(closeBody, 1, "one </body>");
  const openHtml = (html.match(/<html[\s>]/g) || []).length;
  const closeHtml = (html.match(/<\/html>/g) || []).length;
  assert.equal(openHtml, 1, "one <html>");
  assert.equal(closeHtml, 1, "one </html>");
  assert.ok(html.includes("<title>"), "title tag present");
  assert.ok(html.includes("viewport"), "viewport meta present");
  assert.ok(html.includes("<style>"), "inline style present");
});

test("buildBundleHtml: shows conclusion card when the path reaches a conclusion step", () => {
  // s1 -> pass -> s2 -> fail -> s5 -> next -> s4 (conclusion)
  const html = buildBundleHtml(baseInput({ walkAnswers: ["pass", "fail", "next"] }));
  assert.ok(html.includes("step-conclusion"), "conclusion card class present");
  assert.ok(html.includes("(conclusion)"), "conclusion label rendered");
  assert.ok(html.includes("Mechanical VANOS solenoid failure"), "conclusion text rendered");
});

test("buildBundleHtml: shows an invalid-walk note when the path points at a missing branch", () => {
  // s1 fail -> s3 (which has no on_pass edge), so a second "pass" answer
  // is invalid. This matches the in-app reducer's break-on-isConclusion
  // + missing-edge semantics.
  const html = buildBundleHtml(baseInput({ walkAnswers: ["fail", "pass"] }));
  assert.ok(html.includes("Walk is invalid"), "invalid walk message present");
});

test("computeWalkState: matches the in-app reducer semantics", () => {
  // Empty answers -> at s1, not done.
  let r = computeWalkState(plan2A82, []);
  assert.equal(r.current.id, "s1");
  assert.equal(r.done, false);

  // s1 -> pass -> s2.
  r = computeWalkState(plan2A82, ["pass"]);
  assert.equal(r.current.id, "s2");
  assert.equal(r.done, false);

  // s1 -> pass -> s2 -> fail -> s5 -> next -> s4 (conclusion).
  r = computeWalkState(plan2A82, ["pass", "fail", "next"]);
  assert.equal(r.current.id, "s4");
  assert.equal(r.done, true);

  // Bad answer -> invalid: s1 fail -> s3 (no on_pass edge), so a
  // second "pass" answer is invalid. Matches the in-app reducer.
  r = computeWalkState(plan2A82, ["fail", "pass"]);
  assert.equal(r.invalid, true);

  // Reaching a conclusion is NOT invalid even if the answer string is
  // recognised by a previous step (s2 has on_pass="s4", a conclusion).
  r = computeWalkState(plan2A82, ["pass", "pass"]);
  assert.equal(r.invalid, false);
  assert.equal(r.done, true);

  // Empty input -> null current.
  r = computeWalkState({ steps: [] }, []);
  assert.equal(r.current, null);
});
