"use strict";

/* Static wiring tests for the v4 panels (v3.8.0 – v5.0.0 UI layer).
 *
 * The engine tests prove the analysis is right. These prove the analysis is
 * *reachable*: a panel bound to an id that the markup does not have, or to a
 * global no engine publishes, renders an empty box that looks like "no faults
 * found". That failure mode is invisible to every engine test and to a manual
 * click-through on the happy path, so it gets pinned here instead — every id,
 * every global and every class the panel file names must exist somewhere real.
 *
 * No jsdom here on purpose: these read the files as text, so they run in any
 * checkout.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const HTML = read("src/index.html");
const CSS = read("src/css/app.css");
const MAIN = read("src/js/main.js");
const UI = read("src/js/v4_ui.js");

/* The v3.8–v5.0 engines, each with the global it publishes and the panel that
 * depends on it. Keep in step with the <script> block in index.html. */
const ENGINES = [
  { file: "signal_quality.js", global: "beeemuuSignalQuality", panel: "v4-signal" },
  { file: "drive_cycle.js", global: "beeemuuDriveCycle", panel: "v4-cycle" },
  { file: "fleet_dashboard.js", global: "beeemuuFleetDashboard", panel: "v4-fleet" },
  { file: "service_provenance.js", global: "beeemuuServiceProvenance", panel: "v4-prov" },
  { file: "sensor_plausibility.js", global: "beeemuuSensorPlausibility", panel: "v4-sensor" },
  { file: "opinion_consensus.js", global: "beeemuuOpinionConsensus", panel: "v4-opinion" },
  { file: "plugin_capability_bridge.js", global: "beeemuuPluginCapabilityBridge", panel: "v4-plugin" },
];

/* plugin_capabilities.js is deliberately absent from ENGINES: it is the
 * pre-existing v3 enforcement core, it publishes no global (node-only,
 * `module.exports`), and plugin_bridge.js / plugin_host.js reach it through
 * require(). It is still loaded in the webview, so the ordering test below
 * only insists on what the panels actually read. */


const scriptIndex = (file) => HTML.indexOf(`js/${file}`);

test("every v4 engine is loaded by the app", () => {
  const missing = ENGINES.filter((e) => scriptIndex(e.file) === -1).map((e) => e.file);
  assert.deepEqual(missing, [], "index.html does not load: " + missing.join(", "));
});

test("every v4 engine is loaded before the panel file that uses it", () => {
  const ui = scriptIndex("v4_ui.js");
  assert.ok(ui > 0, "index.html does not load v4_ui.js");
  const late = ENGINES.filter((e) => scriptIndex(e.file) > ui).map((e) => e.file);
  assert.deepEqual(late, [], "loaded after v4_ui.js: " + late.join(", "));
});

test("every v4 engine is loaded before main.js publishes the bridge", () => {
  // The bridge's data getters are cheap, but main.js's boot path calls into the
  // engines that are already defined; an engine declared after it would be
  // missing for the first paint and the panel would show "unavailable".
  const main = scriptIndex("main.js");
  assert.ok(main > 0, "index.html does not load main.js");
  const late = ENGINES.filter((e) => scriptIndex(e.file) > main).map((e) => e.file);
  assert.deepEqual(late, [], "loaded after main.js: " + late.join(", "));
});

test("every v4 engine publishes the global the panel file reads", () => {
  for (const e of ENGINES) {
    const src = read("src/js/" + e.file);
    assert.match(
      src,
      new RegExp(`window\\.${e.global}\\s*=`),
      `${e.file} never assigns window.${e.global}`
    );
    assert.ok(
      UI.includes("window." + e.global),
      `v4_ui.js never reads window.${e.global}, so ${e.file} is dead weight`
    );
  }
});

test("the panel file reads no engine global that is never loaded", () => {
  const read_globals = new Set();
  const re = /window\.(beeemuu[A-Za-z0-9]+)/g;
  let m;
  while ((m = re.exec(UI)) !== null) read_globals.add(m[1]);
  // beeemuuV4/V3 are the data bridge (tested separately below) and beeemuuV4UI
  // is this file's own export, so none of them is an engine global.
  const bridgeNames = new Set(["beeemuuV4", "beeemuuV3", "beeemuuV4UI"]);
  const unexplained = [...read_globals].filter(
    (g) => !bridgeNames.has(g) && !ENGINES.some((e) => e.global === g)
  );
  assert.deepEqual(unexplained, [], "v4_ui.js reads undeclared globals: " + unexplained.join(", "));
});

test("every element id the panel file binds to exists in the markup", () => {
  const ids = new Set();
  const re = /\$\("([a-z0-9-]+)"\)/g;
  let m;
  while ((m = re.exec(UI)) !== null) ids.add(m[1]);
  assert.ok(ids.size >= 12, "expected the panel file to bind a good number of ids, found " + ids.size);
  const missing = [...ids].filter((id) => !HTML.includes(`id="${id}"`));
  assert.deepEqual(missing, [], "markup is missing: " + missing.join(", "));
});

test("each panel has a run control and a body to render into", () => {
  for (const e of ENGINES) {
    if (!e.panel) continue;
    assert.ok(HTML.includes(`id="${e.panel}-run"`), `no run button for ${e.panel}`);
    assert.ok(HTML.includes(`id="${e.panel}-body"`), `no render target for ${e.panel}`);
  }
});

test("the v4 panels live inside the diagnostics view", () => {
  const start = HTML.indexOf('id="view-diagnostics"');
  assert.ok(start > 0, "no diagnostics view in the markup");
  const end = HTML.indexOf("</section>", start);
  const view = HTML.slice(start, end);
  const missing = ENGINES.filter((e) => e.panel && !view.includes(`id="${e.panel}-run"`)).map(
    (e) => e.panel
  );
  assert.deepEqual(missing, [], "outside the diagnostics view: " + missing.join(", "));
});

test("every CSS class the panel file uses is defined", () => {
  // Classes are built two ways: as literals ("v3-note muted"), and by appending
  // a verdict to a prefix ("v3-pill-" + kind). Both have to land on a real rule,
  // or a panel renders unstyled text that reads as a plain paragraph instead of
  // a warning. Element ids are quoted strings too, so they are collected first
  // and excluded — an id is not a class.
  const ids = new Set();
  const idRe = /\$\("([a-z0-9-]+)"\)/g;
  let m;
  while ((m = idRe.exec(UI)) !== null) ids.add(m[1]);

  const literal = new Set();
  const re = /"([a-z0-9 -]*v[34]-[a-z0-9 -]+)"/g;
  while ((m = re.exec(UI)) !== null) {
    for (const c of m[1].split(/\s+/)) {
      // Skip ids, and skip a prefix mid-concatenation such as "v3-pill-".
      if (c && !ids.has(c) && !c.endsWith("-")) literal.add(c);
    }
  }

  const { VERDICT_CLASS, PILL_KIND } = require("../v4_ui.js");
  for (const v of Object.keys(VERDICT_CLASS)) literal.add(VERDICT_CLASS[v]);
  for (const k of Object.values(PILL_KIND)) literal.add("v3-pill-" + k);

  assert.ok(literal.size >= 6, "found suspiciously few classes: " + [...literal].join(", "));
  const missing = [...literal].filter((c) => !new RegExp(`\\.${c}[\\s,{:.]`).test(CSS));
  assert.deepEqual(missing, [], "app.css has no rule for: " + missing.join(", "));
});

test("the bridge is published under both names from one object", () => {
  assert.match(MAIN, /window\.beeemuuV3\s*=/, "main.js no longer publishes window.beeemuuV3");
  assert.match(
    MAIN,
    /window\.beeemuuV4\s*=\s*window\.beeemuuV3\s*;/,
    "the v4 panels must read the same bridge object, not a second copy"
  );
  assert.match(UI, /window\.beeemuuV4\s*\|\|\s*window\.beeemuuV3/, "v4_ui.js must fall back to the v3 name");
});

test("the panel file renders text, never markup", () => {
  for (const bad of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval("]) {
    assert.ok(!UI.includes(bad), `v4_ui.js uses ${bad}; untrusted text must go through textContent`);
  }
});

test("the panel file is inert when no window exists", () => {
  // Requiring it in node must not throw and must not mount anything: this is
  // what stops a syntax error or a top-level DOM call from blanking the app.
  const api = require("../v4_ui.js");
  assert.equal(typeof api.mountAll, "function");
  assert.equal(typeof api.refreshAll, "function");
  assert.equal(typeof api.parseFleet, "function");
  assert.equal(api.mountAll(), 0, "mountAll found panels with no document present");
});

test("every engine in the arc is a real module, not a stub", () => {
  for (const e of ENGINES) {
    const src = read("src/js/" + e.file);
    assert.ok(src.length > 2000, `${e.file} is too small to be a real engine`);
    assert.ok(
      /module\.exports/.test(src),
      `${e.file} cannot be tested in node: no module.exports`
    );
    assert.ok(
      /typeof window !== "undefined"/.test(src),
      `${e.file} assigns a global without guarding for node`
    );
  }
});

test("the v4 panel file is loaded after the panel markup it binds", () => {
  // A script in <head> pointing at ids that do not exist yet would mount
  // nothing. The include block is at the end of <body>, so the markup must
  // appear before it in document order.
  const ui = scriptIndex("v4_ui.js");
  for (const e of ENGINES) {
    if (!e.panel) continue;
    assert.ok(
      HTML.indexOf(`id="${e.panel}-run"`) < ui,
      `${e.panel} markup appears after the v4_ui.js include`
    );
  }
});
