"use strict";

/* Signal Library index loader — v3.0.0 feature 8.
 *
 * `src/js/signal_index.json` is generated from `community/profiles/*.toml` by
 * `scripts/gen_signal_index.py`. It exists because `list_profiles()` returns
 * only id/label/theme, so the webview cannot reach the params without a change
 * to `commands.rs` — and that file is Tier B, one human merge, for data that is
 * static at build time. Generating beats widening the command surface.
 *
 * `index.html` defines `window.beeemuuSignalIndexData` from the generated JSON
 * (as a plain script assignment, since the Tauri webview cannot `fetch` a
 * relative asset path). This module turns that into the index and publishes it
 * as `window.beeemuuSignalLibraryIndex`, which both the Signal Library panel
 * and the Tuning Fingerprint panel read.
 *
 * `baselines` is deliberately empty. Stock (rpm x load) baselines are
 * community-contributed per engine and none ship today; the fingerprint panel
 * checks this and refuses to run rather than comparing against a guess.
 */

(function (root) {
  "use strict";

  /**
   * Build the published index object from a generated payload.
   * Returns null when the payload or the signal_library engine is unavailable,
   * so the panel mounts to "absent" rather than to a crash.
   */
  function buildIndexFrom(payload) {
    const api = root.beeemuuSignalLibrary;
    if (!api || !payload || !Array.isArray(payload.profiles)) return null;
    return {
      index: api.build(payload.profiles),
      /* Deliberately empty until a community baseline exists. The fingerprint
       * panel reads this and refuses rather than inventing a comparison. */
      baselines: (root.beeemuuStockBaselines && root.beeemuuStockBaselines.default) || {},
      generated_from: payload.source || null,
      generated_note: payload.note || null,
    };
  }

  /** Build from whatever is already on `window`, publishing the result. */
  function publish() {
    const built = buildIndexFrom(root.beeemuuSignalIndexData);
    if (built) root.beeemuuSignalLibraryIndex = built;
    return built;
  }

  const api = { buildIndexFrom, publish };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.beeemuuSignalIndex = api;
    // The engines load before this file in index.html, so publishing at parse
    // time works; publish() is also exposed for a late-arriving payload.
    if (root.beeemuuSignalLibrary && root.beeemuuSignalIndexData) publish();
  }
})(typeof window !== "undefined" ? window : globalThis);