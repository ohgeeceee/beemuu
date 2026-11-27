"use strict";

/* Wiring guard: every window.beeemuu* global main.js dereferences must be
 * provided by a classic <script> actually loaded by index.html.
 *
 * Regression coverage for the missing live_data_panel.js script tag: the
 * module existed, its unit tests passed under require(), and main.js crashed
 * the moment startPolling() dereferenced window.beeemuuLiveDataPanel — jsdom
 * and node --test both gave the module its own scope, so only the shipping
 * shell was broken. This test reads index.html as the browser sees it and
 * fails on a reference no loaded script provides.
 *
 * Soft references through optional chaining (window.beeemuuX?.foo) are
 * exempt by construction: they degrade to undefined on purpose.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const HTML = fs.readFileSync(path.join(ROOT, "src/index.html"), "utf8");
const MAIN = fs.readFileSync(path.join(ROOT, "src/js/main.js"), "utf8");

const scriptSrcs = [...HTML.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)]
  .map((m) => m[1]);

function providedGlobals(src) {
  const names = new Set();
  // Modules publish as `window.X =`, `root.X =` (root = window when present),
  // or `globalThis.X =`.
  for (const m of src.matchAll(/(?:window|root|globalThis)\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) {
    names.add(m[1]);
  }
  return names;
}

test("index.html loads every js script main.js hard-references", () => {
  // Collect the globals each loaded script publishes, plus whatever main.js
  // publishes itself (order inside main.js is its own concern).
  const provided = providedGlobals(MAIN);
  const missingFiles = [];
  for (const src of scriptSrcs) {
    const file = path.join(ROOT, "src", src);
    if (!fs.existsSync(file)) {
      missingFiles.push(src);
      continue;
    }
    for (const name of providedGlobals(fs.readFileSync(file, "utf8"))) {
      provided.add(name);
    }
  }
  assert.deepEqual(missingFiles, [],
    "index.html references script files that do not exist");

  // Hard references: window.beeemuuX NOT followed by ?. (optional chaining
  // is a deliberate soft reference). Match the full token first, then look at
  // the characters after it — a lookahead alone would let the greedy token
  // backtrack one character to satisfy it.
  const referenced = new Set();
  for (const m of MAIN.matchAll(/window\.(beeemuu[A-Za-z0-9_$]*)/g)) {
    const tail = MAIN.slice(m.index + m[0].length, m[0].length + m.index + 2);
    if (tail.startsWith("?.")) continue; // soft reference by construction
    referenced.add(m[1]);
  }

  const unprovided = [...referenced].filter((name) => !provided.has(name)).sort();
  assert.deepEqual(unprovided, [],
    "main.js dereferences globals no loaded script provides: " + unprovided.join(", "));
});

test("live_data_panel.js is loaded before main.js", () => {
  // The specific regression: pollOnce/startPolling dereference
  // window.beeemuuLiveDataPanel unconditionally, so the tag must exist and
  // must precede main.js.
  const panelAt = HTML.indexOf('<script src="js/live_data_panel.js"></script>');
  const mainAt = HTML.indexOf('<script src="js/main.js"></script>');
  assert.ok(panelAt > -1, "live_data_panel.js is not loaded by index.html");
  assert.ok(mainAt > -1, "main.js is not loaded by index.html");
  assert.ok(panelAt < mainAt, "live_data_panel.js must load before main.js");
});
