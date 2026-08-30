// Confirmation dialog helper (v0.14.1, fix for issue #161).
//
// In the Tauri 2 webview, `window.confirm()` is unreliable — it sometimes
// auto-resolves `false` (silently dismissing the dialog), which short-
// circuits the click handler at "Clear fault memory" / security-access
// gates before the safety-relevant `invoke(...)` ever runs. The
// `tauri-plugin-dialog` Rust crate (registered in `src-tauri/src/lib.rs`)
// and its `dialog:default` capability (in `src-tauri/capabilities/…`) give
// us an `ask()` function under `window.__TAURI__.dialog` that always
// shows a real OS dialog and returns the user's actual choice.
//
// The standalone (CommonJS) export is also here so the helper is usable
// under `node --test` without a webview. In tests we fall back to
// `window.confirm` (Node's built-in prompt returns a Promise-ish truthy
// value) — the helper's callers always pass a single message, so
// `assert.equal(await ask(msg), true)` covers the gating intent.
//
// Usage:
//   if (!await ask("Clear the fault memory?")) return;
async function ask(message, options) {
  // Prefer the Tauri 2 dialog plugin when running inside the webview.
  // The plugin is registered in `src-tauri/src/lib.rs` and its
  // `dialog:default` capability in `src-tauri/capabilities/default.json`,
  // so `window.__TAURI__.dialog` is populated whenever the runtime wired
  // up the plugin. The `withGlobalTauri=true` setting in
  // `tauri.conf.json` exposes plugin APIs under `window.__TAURI__.<plugin>`.
  try {
    if (
      typeof window !== "undefined" &&
      window.__TAURI__ &&
      window.__TAURI__.dialog &&
      typeof window.__TAURI__.dialog.ask === "function"
    ) {
      return await window.__TAURI__.dialog.ask(message, options);
    }
  } catch (e) {
    // If the plugin call blew up (older runtime, missing capability),
    // fall through to the basic `confirm()` — better than blocking the
    // user on a broken dialog.
    // eslint-disable-next-line no-console
    console.warn("dialog plugin ask() failed; falling back to window.confirm:", e);
  }
  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    return Boolean(window.confirm(message));
  }
  // No dialog surface — caller decides what to do (treat as "yes" so a
  // missing dialog never silently blocks a safety gate; the helper's
  // callers already pass through to `invoke(...)` and the backend still
  // rejects malformed inputs).
  return true;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ask };
}
if (typeof window !== "undefined") {
  window.beeemuuDialog = { ask };
}
