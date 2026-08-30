// Unit tests for `src/js/dialog.js` (v0.14.1 fix for issue #161).
//
// The helper has three behaviours we need to pin:
//   1. With the Tauri 2 dialog plugin wired up, `ask()` delegates to
//      `window.__TAURI__.dialog.ask`.
//   2. If the plugin isn't present (e.g. running under `node --test`
//      where no webview exists), it falls back to `window.confirm`.
//   3. If neither is present (e.g. SSR / future Node renderers), it
//      returns `true` — better to allow a safety-relevant gate to run
//      once than to silently block the user.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const dialogPath = path.join(__dirname, "dialog.js");

test("dialog module loads as CommonJS and exposes ask()", () => {
  // Clear any cached require so each test gets a fresh module.
  delete require.cache[require.resolve(dialogPath)];
  const { ask } = require(dialogPath);
  assert.equal(typeof ask, "function");
});

test("ask() delegates to window.__TAURI__.dialog.ask when the plugin is present", async () => {
  delete require.cache[require.resolve(dialogPath)];
  const { ask } = require(dialogPath);

  const calls = [];
  // Minimal global stub: what matters is that ask() reaches the plugin
  // and returns the plugin's boolean unmodified.
  global.window = {
    __TAURI__: {
      dialog: {
        async ask(message, options) {
          calls.push({ message, options });
          return true;
        },
      },
    },
    confirm: () => {
      throw new Error("confirm should NOT be called when the plugin handles it");
    },
  };

  const ok = await ask("Clear the fault memory?", { title: "Beemuu" });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message, "Clear the fault memory?");
  assert.deepEqual(calls[0].options, { title: "Beemuu" });
});

test("ask() falls back to window.confirm when the plugin is missing", async () => {
  delete require.cache[require.resolve(dialogPath)];
  const { ask } = require(dialogPath);

  let confirmCalledWith = null;
  global.window = {
    __TAURI__: {}, // no .dialog sub-namespace
    confirm: (msg) => {
      confirmCalledWith = msg;
      return true;
    },
  };

  const ok = await ask("Continue?");
  assert.equal(ok, true);
  assert.equal(confirmCalledWith, "Continue?");
});

test("ask() returns false when window.confirm returns false", async () => {
  delete require.cache[require.resolve(dialogPath)];
  const { ask } = require(dialogPath);

  global.window = {
    __TAURI__: {},
    confirm: () => false,
  };

  const ok = await ask("Continue?");
  assert.equal(ok, false);
});

test("ask() returns true when neither plugin nor confirm is available", async () => {
  delete require.cache[require.resolve(dialogPath)];
  const { ask } = require(dialogPath);

  global.window = {
    __TAURI__: {},
    // intentionally no .confirm
  };

  const ok = await ask("Continue?");
  assert.equal(ok, true, "no-dialog mode returns true to avoid silently blocking the safety gate");
});

test("plugin error is swallowed and falls back to window.confirm", async () => {
  delete require.cache[require.resolve(dialogPath)];
  const { ask } = require(dialogPath);

  global.window = {
    __TAURI__: {
      dialog: {
        async ask() {
          throw new Error("permission denied");
        },
      },
    },
    confirm: () => true,
  };

  // Suppress the warn() output the helper writes to console on fallback.
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const ok = await ask("Continue?");
    assert.equal(ok, true, "fallback confirm wins when the plugin call throws");
  } finally {
    console.warn = origWarn;
  }
});
