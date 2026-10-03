"use strict";

/* Wiring guards for the v3 UI slice.
 *
 * These check the seams that a jsdom panel test cannot reach: the bridge in
 * main.js, the cold-start feed, and the generated-artifact pipeline. A panel can
 * be perfect in isolation and still never be fed anything.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const MAIN = fs.readFileSync(path.join(ROOT, "src/js/main.js"), "utf8");
const HTML = fs.readFileSync(path.join(ROOT, "src/index.html"), "utf8");

test("main.js publishes the v3 bridge before anything can read it", () => {
  assert.match(MAIN, /window\.beeemuuV3\s*=/);
  // The bridge is defined near the top, before main() runs, so a panel that
  // registers at parse time finds it.
  const bridgeAt = MAIN.indexOf("window.beeemuuV3 = {");
  const firstUse = MAIN.indexOf("window.beeemuuV3._notify()");
  assert.ok(bridgeAt > -1 && firstUse > bridgeAt,
    "the bridge must be defined before the first _notify call");
});

test("the bridge is read-only — no settable field for app state", () => {
  // A panel must not be able to mutate a live diagnostic session through the
  // bridge. Every data field is an arrow-function getter, so assigning to it
  // would shadow the getter rather than change the app's state — but a bare
  // value would be a real, writable door. Check the shape, not just the name.
  const block = MAIN.slice(MAIN.indexOf("window.beeemuuV3 = {"));
  const body = block.slice(0, block.indexOf("\n};"));
  for (const field of ["logSeries", "dtcs", "vehicleModules", "vehicleAddress",
    "isConnected", "isReplay"]) {
    const line = new RegExp(`^\\s*${field}:`, "m").test(body);
    assert.ok(line, `bridge is missing ${field}`);
    // The value must be a function, not a captured variable.
    assert.match(body, new RegExp(`^\\s*${field}:\\s*\\(\\)\\s*=>`, "m"),
      `${field} must be an arrow-function getter, not a settable value`);
  }
  // And the bridge object itself is frozen against accidental extension.
  assert.doesNotMatch(body, /connected:\s*[^=]/,
    "the bridge must not expose the mutable `connected` flag");
  assert.doesNotMatch(body, /sessionReplay:\s*[^=]/,
    "the bridge must not expose the mutable `sessionReplay` flag");
});

test("the bridge exposes what the panels actually need", () => {
  const ui = fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8");
  const block = MAIN.slice(MAIN.indexOf("window.beeemuuV3 = {"));
  const body = block.slice(0, block.indexOf("\n};"));
  for (const method of ["logSeries", "dtcs", "vehicleModules", "isReplay"]) {
    assert.ok(body.includes(`${method}:`), `bridge is missing ${method}`);
    if (ui.includes(`b.${method}()`) || ui.includes(`${method}()`)) {
      assert.ok(body.includes(`${method}:`), `panel uses ${method} but the bridge lacks it`);
    }
  }
});

test("a throwing panel listener cannot break a diagnostic session", () => {
  // The isolation guarantee, read from main.js because it is main.js's job.
  const block = MAIN.slice(MAIN.indexOf("_notify() {"));
  assert.match(block, /try\s*\{/);
  assert.match(block, /catch/);
});

test("main.js notifies at every point the bridge's data changes", () => {
  // The panel contract. Missing one of these leaves a panel showing stale data
  // with no error anywhere.
  for (const marker of [
    "modules = [];",              // disconnect / leaving replay
    "selectedAddress = address;", // module selection
    "lastDtcs = dtcs;",           // a fault read
    'invoke("scan_modules")',     // vehicle test
    "Loaded session snapshot.",   // snapshot load
  ]) {
    assert.ok(MAIN.includes(marker), `marker missing: ${marker}`);
  }
  const notifies = (MAIN.match(/window\.beeemuuV3\._notify\(\)/g) || []).length;
  assert.ok(notifies >= 6, `only ${notifies} _notify() call sites`);
});

test("the cold-start monitor is fed from the existing poll loop", () => {
  // Not from its own timer: a second sampling loop is a second thing that can
  // disagree with the first.
  assert.match(MAIN, /function feedColdStartMonitor\(values\)/);
  const callSites = (MAIN.match(/feedColdStartMonitor\(/g) || []).length;
  assert.ok(callSites >= 2, "the helper is defined but never called from pollOnce");
  const poll = MAIN.slice(MAIN.indexOf("async function pollOnce()"));
  assert.match(poll.slice(0, 3000), /feedColdStartMonitor\(result\.values/);
});

test("the cold-start feed derives engine state from rpm and never invents it", () => {
  const block = MAIN.slice(MAIN.indexOf("function feedColdStartMonitor"));
  const body = block.slice(0, block.indexOf("\n}\n"));
  assert.match(body, /rpm != null && rpm > 0/,
    "running must be inferred from a measured rpm, not assumed true");
  assert.match(body, /coolant = null/,
    "a missing coolant read must stay null so the monitor declines to arm");
});

test("the cold-start feed is a no-op when nothing is armed", () => {
  // The overwhelmingly common case: every sweep, forever, with no monitor.
  // Two guards, because the panel may be unmounted entirely or mounted but
  // not armed.
  const block = MAIN.slice(MAIN.indexOf("function feedColdStartMonitor"));
  const body = block.slice(0, block.indexOf("\n}\n"));
  assert.match(body, /if \(!panel \|\| typeof panel\.observe !== "function"\) return;/,
    "an unmounted panel must short-circuit");
  assert.match(body, /!panel\.monitor\(\)\) return;/,
    "an unarmed panel must short-circuit before touching the values");
});

test("v3 engines load before v3_ui.js and before main.js uses the bridge", () => {
  const order = [...HTML.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1]);
  const at = name => {
    const i = order.indexOf(name);
    assert.ok(i > -1, `${name} is not loaded by index.html`);
    return i;
  };
  const uiAt = at("v3_ui.js");
  for (const engine of ["misfire_patterns.js", "adaptation_drift.js",
    "tuning_fingerprint.js", "flash_audit.js", "cold_start.js",
    "parameter_hunt.js", "symptom_index.js", "signal_library.js",
    "vehicle_passport.js"]) {
    assert.ok(at(engine) < uiAt, `${engine} must load before v3_ui.js`);
  }
  // The signal index loader needs both the engine and the generated data.
  const loaderAt = at("v3_signal_index.js");
  assert.ok(at("signal_library.js") < loaderAt);
  assert.ok(at("signal_index_data.js") < loaderAt);
});

test("every script index.html loads exists on disk", () => {
  const srcs = [...HTML.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m => m[1]);
  for (const src of srcs) {
    assert.ok(fs.existsSync(path.join(ROOT, "src", src)), `index.html loads a missing file: ${src}`);
  }
});

test("the v3 panels are inside the diagnostics view and are reachable", () => {
  // A panel rendered into a hidden section is a panel nobody sees.
  const section = HTML.slice(HTML.indexOf('<section id="view-diagnostics"'));
  const end = section.indexOf("</section>");
  const body = section.slice(0, end);
  for (const id of ["v3-symptom-body", "v3-misfire-body", "v3-drift-body",
    "v3-fingerprint-body", "v3-flash-body", "v3-cold-status",
    "v3-signal-body", "v3-passport-body", "v3-hunt-body"]) {
    assert.ok(body.includes(`id="${id}"`), `#${id} is not in the diagnostics view`);
  }
});

test("the v3 CSS ships the classes the panels use", () => {
  const css = fs.readFileSync(path.join(ROOT, "src/css/app.css"), "utf8");
  for (const cls of [".v3-panels", ".v3-card", ".v3-pill", ".v3-pill-ok",
    ".v3-pill-warn", ".v3-pill-danger", ".v3-signal-row", ".v3-board-row",
    ".v3-code", ".v3-input-row", ".v3-cold-line", ".v3-note"]) {
    assert.ok(css.includes(cls), `app.css is missing ${cls}`);
  }
  // Severity must not be carried by colour alone.
  assert.match(css, /v3-ok\b/);
  assert.match(css, /v3-warn\b/);
  assert.match(css, /v3-danger\b/);
});

test("main.js still parses after the bridge and feed additions", () => {
  // `node --check` on the real file: a syntax error here is a blank window.
  assert.doesNotThrow(() => {
    // eslint-disable-next-line no-new-func
    new Function(MAIN.replace(/^\s*const invoke = .*$/m, ""));
  });
});
