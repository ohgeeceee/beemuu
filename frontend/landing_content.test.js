"use strict";

/* Landing-page content guards.
 *
 * The differentiators section makes factual claims about what the app does.
 * Every one of those claims is checkable against the repo, so they are checked
 * here: a marketing page that drifts from the software is worse than no
 * marketing page, because a buyer who finds out has stopped trusting the rest.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// This file lives in frontend/, so the repo root is one level up.
const ROOT = path.resolve(__dirname, "..");
const INDEX = fs.readFileSync(path.join(ROOT, "frontend/index.html"), "utf8");

/* The section, isolated so a test cannot pass on text from another section. */
function section(id) {
  const start = INDEX.indexOf(`<section id="${id}"`);
  assert.ok(start > -1, `frontend/index.html has no #${id} section`);
  const end = INDEX.indexOf("\n</section>", start);
  assert.ok(end > start, `#${id} section is not closed`);
  return INDEX.slice(start, end);
}

const DIFFER = section("different");

test("the differentiators section exists exactly once", () => {
  assert.equal((INDEX.match(/<section id="different"/g) || []).length, 1);
});

test("it is reachable from the header nav and the footer", () => {
  assert.match(INDEX, /href="#different"[^>]*>Why BeeEmUu<\/a>/);
  // Twice: header and footer. A section nobody can navigate to does not exist.
  const links = (INDEX.match(/href="#different"/g) || []).length;
  assert.ok(links >= 2, `only ${links} links to #different`);
});

test("every v3 feature that shipped is represented", () => {
  // The ten engines from docs/v3_plan.md. If one of these features is renamed
  // or dropped, this fails and the page gets corrected rather than going stale.
  for (const feature of [
    "Misfire Pattern Recognition",
    "Adaptation Drift Tracker",
    "Tuning Fingerprint Detector",
    "Flash History Auditor",
    "Symptom Index",
    "Cold Start Auto-Logger",
    "Signal Library",
    "Vehicle Passport",
    "Parameter Hunt",
  ]) {
    assert.ok(DIFFER.includes(feature), `#different does not mention ${feature}`);
  }
});

test("the safety position is stated, not implied", () => {
  // A tool that talks about writing to ECUs has to be unambiguous. This is the
  // single most load-bearing claim on the page.
  assert.match(DIFFER, /Nothing here writes to your ECU/);
  assert.match(DIFFER, /not built and are not planned/);
});

test("the page does not promise a diagnosis", () => {
  // The engines are explicit about this: `is_diagnosis: false`. A landing page
  // that says "diagnoses" contradicts the software and invites a purchase the
  // tool cannot honour.
  const claims = DIFFER.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ");
  assert.doesNotMatch(claims, /\bdiagnoses\b(?!\s+when)/i,
    "the page claims the tool diagnoses");
  assert.match(claims, /shortlists; it does not diagnose/i);
});

test("no card claims to name a tuning platform", () => {
  // tuning_fingerprint.js always returns suspected_platform: null and refuses to
  // guess. A page implying provenance detection would be a false claim.
  assert.doesNotMatch(DIFFER, /bootmod3|\bmhd\b|xentry/i);
  assert.match(DIFFER, /never names a tuning platform/);
});

test("the privacy claim matches vehicle_passport.js exactly", () => {
  // The module has no include_vin option at all; the page must not imply one.
  // Checked against the source text so the two cannot drift apart silently.
  const src = fs.readFileSync(path.join(ROOT, "src/js/vehicle_passport.js"), "utf8");
  assert.match(src, /include_vin/,
    "vehicle_passport.js should document the absence of an include_vin option");
  assert.doesNotMatch(src, /include_vin\s*:/,
    "vehicle_passport.js must not accept an include_vin option");
  assert.match(DIFFER, /there is no option to include it/i);
  assert.match(DIFFER, /VIN is <em[^>]*>never<\/em>/);
});

test("the signal-count claim is at least true", () => {
  // "40+ signals" is a checkable number. Measure it rather than trust it.
  const data = fs.readFileSync(path.join(ROOT, "src/js/signal_index_data.js"), "utf8");
  const payload = JSON.parse(
    data.slice(data.indexOf("=") + 1).trim().replace(/;\s*$/, ""));
  const distinct = new Set();
  for (const p of payload.profiles) {
    for (const q of p.param) distinct.add(q.id);
  }
  assert.ok(distinct.size >= 40, `the page claims 40+ but there are ${distinct.size}`);
  assert.match(DIFFER, /40\+ signals/);
});

test("every lucide icon named in the section is a real icon name", () => {
  // A typo in a data-lucide name renders an empty box. The page already loads
  // lucide from a CDN; this catches the name before it ships.
  const KNOWN = new Set([
    "flame", "git-compare-arrows", "fingerprint", "history", "search",
    "snowflake", "book-open", "id-card", "trophy", "shield-check",
  ]);
  const used = [...DIFFER.matchAll(/data-lucide="([^"]+)"/g)].map(m => m[1]);
  assert.ok(used.length >= 10, `only ${used.length} icons in the section`);
  for (const name of used) {
    assert.ok(KNOWN.has(name), `unknown or typo'd lucide icon: ${name}`);
  }
});

test("the section uses the site's existing card and layout classes", () => {
  // Per the site convention: no bespoke CSS, reuse glow-card / max-w-7xl. A new
  // section that needs its own stylesheet is a section nobody will maintain.
  assert.match(DIFFER, /max-w-7xl mx-auto/);
  const cards = (DIFFER.match(/glow-card/g) || []).length;
  assert.ok(cards >= 9, `only ${cards} glow-cards`);
  assert.match(DIFFER, /sm:grid-cols-2 lg:grid-cols-3/);
});

test("no inline styles in the new section", () => {
  // The site convention, same reason as the panels: inline styles do not
  // respond to the theme.
  const inline = DIFFER.match(/style="[^"]*"/g) || [];
  assert.equal(inline.length, 0, `inline styles found: ${inline.slice(0, 2).join(" ")}`);
});

test("every anchor in the section resolves to a real id or asset", () => {
  // The defect class the site already has a history of: a page linking to
  // something that does not exist.
  const anchors = [...DIFFER.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  for (const href of anchors) {
    if (href.startsWith("#")) {
      const id = href.slice(1);
      assert.ok(INDEX.includes(`id="${id}"`), `dangling anchor ${href}`);
    } else if (href.startsWith("/") && !href.startsWith("//")) {
      const file = path.join(ROOT, "frontend", href.replace(/^\//, ""));
      assert.ok(fs.existsSync(file) || fs.existsSync(file + ".html") ||
        fs.existsSync(path.join(file, "index.html")),
        `dangling link ${href}`);
    }
  }
});
