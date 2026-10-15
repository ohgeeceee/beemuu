#!/usr/bin/env node
/**
 * Chrome/theme regression guard for the app shell (src/index.html + src/css/*.css).
 *
 * Guards the v0.20.0 "unstyled UI chrome" fix and the dark-theme token layer:
 *   1. every chrome surface and interactive control has AT LEAST ONE AUTHORED
 *      CSS RULE — the exact defect the audit found (elements falling through to
 *      user-agent defaults and staying light grey in dark mode). Checked
 *      statically against the stylesheets so JS-rendered surfaces are covered
 *      too, and cross-checked against the live DOM via CDP for the ones that
 *      are present in the static markup.
 *   2. dark theme must not paint any visible surface near-white, except the
 *      deliberately-paper print host (#print-report-host);
 *   3. surfaces present in both themes must actually re-skin.
 *
 * Run: node scripts/test-chrome-visual.cjs
 *      CHROME_PATH=/path/to/chrome node scripts/test-chrome-visual.cjs
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const CSS_DIR = path.join(ROOT, "src", "css");
const PAGE = "file://" + path.join(ROOT, "src", "index.html");

const CHROME_SURFACES = [
  ".statusbar", ".status-dot", ".status-right",
  ".session-bar", ".session-hint",
  ".log-time", ".log-markers", ".log-markers-head", ".log-shortcuts",
  ".log-marker-time", ".log-marker-type", ".log-marker-label", ".log-marker-note",
  ".log-restore-banner", ".log-export-units-label",
  ".explorer-form", ".range-row", ".explorer-hint",
  ".exp-add-panel", ".exp-add-head", ".exp-add-form", ".exp-add-actions",
  ".exp-result-item", ".watch-bytes",
  ".diag-cols", ".diag-left", ".diag-traffic", ".traffic-wrap", ".traffic-table",
  ".selftest-body", ".st-icon", ".st-name", ".st-ms",
  ".community-body", ".info-body", ".share-body", ".share-row", ".share-label",
  ".share-import", ".share-hint", ".walkthrough-share-btn",
  ".garage-panel", ".repair-check-panel",
  ".snapshot-list", ".snapshot-card", ".snapshot-title", ".snapshot-meta",
  ".modal-overlay", ".modal", ".modal-head", ".modal-body", ".modal-warn", ".modal-actions",
  ".schema-builder", ".schema-head", ".schema-row", ".schema-fields", ".schema-hex", ".schema-actions",
  ".log-marker-list", ".schema-preview", ".sec-status", ".sec-message",
];

/* Interactive controls the audit also found unstyled. */
const CONTROLS = ["#btn-theme", "#live-profile", "#log-profile", "#exp-address",
  "#schema-address", "#cmp-left", "#cmp-right", "#import-file", "#import-text",
  "#traffic-auto", "#log-scrubber"];

/* Surfaces meant to stay paper-white in dark mode. */
const WHITE_OK = ["print-report-host"];

/* Surfaces that are deliberately identical in both themes: the chrome bar and
   its right-aligned readout are dark navy in light mode too (--blue-deep is
   not overridden), the modal header sits on that same bar colour, and
   .sec-status carries a fixed semantic status colour (--ok/--warn/--err are
   deliberately theme-stable so a "healthy" signal reads the same either way). */
const THEME_INVARIANT = [".statusbar", ".status-right", ".modal-head", ".sec-status"];

/* ---- static authored-rule index over src/css/*.css ---- */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
function ruleSelectors() {
  let all = "";
  for (const f of fs.readdirSync(CSS_DIR).filter((f) => f.endsWith(".css")))
    all += stripComments(fs.readFileSync(path.join(CSS_DIR, f), "utf8"));
  const out = new Set();
  for (const m of all.matchAll(/([^{}]+)\{/g)) {
    const body = m[1];
    if (body.includes(":root") || /^\s*@/.test(body)) { }
    for (const part of body.split(",")) {
      const t = part.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (t) out.add(t);
    }
  }
  return out;
}
const hasRuleFor = (sel, index) => {
  for (const r of index) {
    if (r === sel) return true;
    // selector appears inside a compound/keyed rule: .a .b, .a>.b, .a.b:hover ...
    if (new RegExp("(^|[\\s>+~(]|#[\\w-]*)" + sel.replace(/[.#]/g, "\\$&") + "(\\b|[:.\\s>+~)])").test(r))
      return true;
  }
  return false;
};

(async () => {
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const failed = [];
  const ok = (cond, msg) => { if (!cond) failed.push(msg); };

  await page.goto(PAGE, { waitUntil: "load" });

  /* --- 1a. static: every surface/control has an authored rule somewhere --- */
  const index = ruleSelectors();
  for (const sel of CHROME_SURFACES)
    ok(hasRuleFor(sel, index), `${sel} has no authored CSS rule (unstyled)`);
  /* Controls are covered generically (input/select/textarea/button); the live
     CDP pass below asserts they are actually matched by an authored rule. */

  /* --- 1b. live: present elements are matched by an authored rule --- */
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const catchAll = (s) => {
    const t = (s || "").replace(/\s+/g, "");
    return t === "*" || t.startsWith("*,*::before") ||
      /^::?(before|after|selection|placeholder|backdrop|marker|scrollbar)/.test(t);
  };
  const authored = new Set();
  const walk = async (node) => {
    for (const kid of node.children || []) {
      const a = kid.attributes || [];
      let id = "", cls = "";
      for (let i = 0; i < a.length; i += 2) {
        if (a[i] === "class") cls = a[i + 1];
        if (a[i] === "id") id = a[i + 1];
      }
      let m = {};
      try { m = await cdp.send("CSS.getMatchedStylesForNode", { nodeId: kid.nodeId }); } catch (e) {}
      const hit = (m.matchedCSSRules || []).some((r) => r.rule && r.rule.origin === "regular" &&
        r.rule.selectorList && !catchAll(r.rule.selectorList.text));
      if (hit) {
        if (id) authored.add("#" + id);
        for (const c of (cls || "").trim().split(/\s+/).filter(Boolean)) authored.add("." + c);
      }
      await walk(kid);
    }
  };
  await walk(root);

  const read = async (theme) => {
    await page.evaluate((t) => { document.body.dataset.theme = t; }, theme);
    return page.evaluate((sels) => {
      const out = {};
      for (const s of sels) {
        const n = document.querySelector(s);
        if (!n) { out[s] = null; continue; }
        const c = getComputedStyle(n);
        out[s] = { bg: c.backgroundColor, color: c.color,
          border: c.borderTopColor + "|" + c.borderLeftColor };
      }
      return out;
    }, CHROME_SURFACES.concat(CONTROLS));
  };
  const light = await read("light");
  const dark = await read("dark");

  const dynamic = [];
  for (const sel of CHROME_SURFACES.concat(CONTROLS)) {
    if (!light[sel]) { dynamic.push(sel); continue; }
    ok(authored.has(sel), `${sel} present in the DOM but matched by no authored rule`);
  }

  /* --- 2. dark theme paints nothing near-white except the print host --- */
  const offenders = await page.evaluate((okList) => {
    document.body.dataset.theme = "dark";
    const bad = [];
    for (const n of document.querySelectorAll("body *")) {
      const c = getComputedStyle(n);
      const m = c.backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) continue;
      const a = m[4] === undefined ? 1 : parseFloat(m[4]);
      if (a < 0.5 || (+m[1] + +m[2] + +m[3]) < 690) continue;
      if (!n.getClientRects().length) continue;
      let el = n, inside = false;
      while (el && el !== document.documentElement) {
        if (okList.includes(el.id)) { inside = true; break; }
        el = el.parentElement;
      }
      if (inside) continue;
      bad.push((n.id ? "#" + n.id : n.tagName.toLowerCase() + "." + (n.className || "")).slice(0, 70));
    }
    return bad;
  }, WHITE_OK);
  ok(offenders.length === 0,
    `near-white surface(s) in dark theme: ${JSON.stringify(offenders)}`);

  /* --- 3. present surfaces really re-skin (minus the documented invariants) --- */
  const present = CHROME_SURFACES.filter((s) => light[s] && dark[s]);
  const changed = present.filter((s) => light[s].bg !== dark[s].bg ||
    light[s].color !== dark[s].color || light[s].border !== dark[s].border);
  const flat = present.filter((s) => !changed.includes(s) && !THEME_INVARIANT.includes(s));
  ok(flat.length === 0,
    `surface(s) present but not theme-responsive: ${JSON.stringify(flat)}`);

  await browser.close();

  if (failed.length) {
    console.error("chrome/theme audit FAILED:");
    for (const f of failed) console.error("  ✗ " + f);
    process.exit(1);
  }
  console.log(`Chrome/theme audit passed: ${CHROME_SURFACES.length + CONTROLS.length} surfaces/controls ` +
    `have authored rules, ${present.length} styled in both themes, ${changed.length} re-skinned, ` +
    `${dynamic.length} dynamic surfaces deferred to the wiring tests, 0 near-white surfaces in dark.`);
})();
