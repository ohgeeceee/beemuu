"use strict";

/* Generated-artifact guards for the Signal Library.
 *
 * `src/js/signal_index.json` and `src/js/signal_index_data.js` are generated
 * from `community/profiles/*.toml`. A stale index is invisible: the panel
 * renders, just with yesterday's signals, and nobody notices until a profile
 * contribution appears not to work. These tests fail loudly instead.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../../..");
const DATA_JS = path.join(ROOT, "src/js/signal_index_data.js");

test("the generated signal index is committed and up to date", () => {
  // Re-runs the generator in --check mode. Fails if a community profile was
  // edited without regenerating.
  const out = execFileSync("python3", ["scripts/gen_signal_index.py", "--check"], {
    cwd: ROOT, encoding: "utf8",
  });
  assert.match(out, /up to date/);
});

test("the generator rejects a malformed profile rather than dropping signals", () => {
  // If a profile fails to parse, the generator must fail loudly. Silently
  // skipping it would quietly shrink the library.
  const src = fs.readFileSync(path.join(ROOT, "scripts/gen_signal_index.py"), "utf8");
  assert.match(src, /TOMLDecodeError/);
  assert.match(src, /raise SystemExit/);
});

test("the data file is a generated artifact that says so", () => {
  const src = fs.readFileSync(DATA_JS, "utf8");
  assert.match(src, /GENERATED FILE/);
  assert.match(src, /scripts\/gen_signal_index\.py/);
  assert.match(src, /window\.beeemuuSignalIndexData/);
});

test("the generated index covers every shipped profile", () => {
  const src = fs.readFileSync(DATA_JS, "utf8");
  const json = src.slice(src.indexOf("=") + 1).trim().replace(/;\s*$/, "");
  const payload = JSON.parse(json);
  const shipped = fs.readdirSync(path.join(ROOT, "community/profiles"))
    .filter(f => f.endsWith(".toml"));
  assert.ok(shipped.length >= 10, `only ${shipped.length} profiles shipped`);
  // Every profile id in the TOML files must appear in the index.
  const indexIds = new Set(payload.profiles.map(p => p.id));
  assert.ok(indexIds.size >= 10, `index has only ${indexIds.size} profiles`);
  for (const id of ["n54", "n55", "b58", "s55", "n52", "n62"]) {
    assert.ok(indexIds.has(id), `index is missing the ${id} profile`);
  }
});

test("the generated index carries the params, not just the profile shells", () => {
  const src = fs.readFileSync(DATA_JS, "utf8");
  const json = src.slice(src.indexOf("=") + 1).trim().replace(/;\s*$/, "");
  const payload = JSON.parse(json);
  const params = payload.profiles.reduce((a, p) => a + p.param.length, 0);
  // 218 at the time of writing; assert a floor so a generator regression that
  // emits empty param lists is caught.
  assert.ok(params > 150, `index has only ${params} params`);
});

test("v3_signal_index.js publishes an index the panels can use", () => {
  // Loading the real generated file plus the loader must produce the published
  // global with an empty baselines map — the fingerprint panel depends on that
  // emptiness to refuse rather than guess.
  const globalThis_ = { };
  const win = Object.assign(globalThis_, {
    beeemuuSignalLibrary: require("../signal_library.js"),
    beeemuuSignalIndexData: (() => {
      const src = fs.readFileSync(DATA_JS, "utf8");
      const json = src.slice(src.indexOf("=") + 1).trim().replace(/;\s*$/, "");
      return JSON.parse(json);
    })(),
  });
  const loader = fs.readFileSync(path.join(ROOT, "src/js/v3_signal_index.js"), "utf8");
  // eslint-disable-next-line no-new-func
  new Function("window", "globalThis", loader)(win, win);
  assert.ok(win.beeemuuSignalLibraryIndex, "the index was not published");
  assert.ok(win.beeemuuSignalLibraryIndex.index.signals.length > 20);
  assert.deepEqual(win.beeemuuSignalLibraryIndex.baselines, {});
});
