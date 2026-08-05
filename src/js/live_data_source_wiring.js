// v0.15.0 slice 2c — Live Gauges data source flip (caller integration).
//
// Wires the DID-projection bridge + K+DCAN source into main.js's
// existing `read_live_data` polling loop. main.js owns the timer
// (so it doesn't double-poll); this module just transforms each
// `LiveSweepResult` into a bridge cache update and exposes the
// bridge-backed source for live_gauges.js to consume.
//
// Lifecycle:
//   - initKdcanDataSource({ invoke, log }) once at app startup
//   - applySweep(values, errors) is called from main.js's pollOnce
//     after each successful read_live_data invoke
//   - kdcanDataSource.getKdcanSource() is passed to
//     live_gauges.controller.setSource(kdcanSource) so the Live
//     Gauges panel reads from the bridge cache instead of the
//     simulator mirror.
//   - start() / stop() mark the source running (FPS tracking, etc.)
//     and are tied to the Live Gauges panel toggle button, not to
//     main.js's polling state.

let kdcanSource = null;
let bridge = null;

/**
 * Initialize the K+DCAN data source for the Live Gauges panel.
 * Call this once at app startup (after live_gauges.js mounts).
 *
 * Returns a passive controller. main.js drives the polling
 * (`read_live_data` invoke) and feeds results via `applySweep()`.
 * The kdcan source is exposed via `getKdcanSource()` for
 * `live_gauges.controller.setSource()` to swap in.
 *
 * @param {Object} options
 * @param {Function} options.invoke — The Tauri `invoke` function.
 * @param {Function} options.log — The app's log function.
 * @returns {Object} — `{ applySweep, start, stop, reset, getKdcanSource, getBridge }`
 */
function initKdcanDataSource({ invoke, log }) {
  const { createDIDBridge } = window.beeemuuDIDBridge || {};
  const { createKdcanSource } = window.beeemuuKdcanSource || {};

  if (!createDIDBridge || !createKdcanSource) {
    log("K+DCAN data source: bridge modules not loaded, falling back to sim-only");
    return {
      applySweep: () => {},
      start: () => {},
      stop: () => {},
      reset: () => {},
      getKdcanSource: () => null,
      getBridge: () => null,
    };
  }

  bridge = createDIDBridge();
  kdcanSource = createKdcanSource(bridge, { targetFps: 10 });

  /**
   * Feed one LiveSweepResult (values + errors) into the bridge cache.
   * Called from main.js's pollOnce after each successful
   * read_live_data invoke.
   *
   * No-op if the kdcan source hasn't been `start()`ed yet (the
   * kdcan source's applySweepFromTauri itself guards on
   * `running`). This lets main.js poll freely before the user
   * opens the Live Gauges panel.
   *
   * @param {Array} values — successful PIDs (LiveValue[]).
   * @param {Array} errors — per-PID failures (LiveError[]).
   */
  function applySweep(values, errors) {
    if (!kdcanSource) return;
    try {
      kdcanSource.applySweepFromTauri(values || [], errors || []);
    } catch (e) {
      log("K+DCAN applySweep failed: " + e);
    }
  }

  /**
   * Mark the kdcan source as running. Call from the Live Gauges
   * panel's start button. Idempotent.
   */
  function start() {
    kdcanSource?.start();
    log("K+DCAN data source started");
  }

  /**
   * Mark the kdcan source as stopped. Call from the Live Gauges
   * panel's stop button. Idempotent.
   */
  function stop() {
    kdcanSource?.stop();
    log("K+DCAN data source stopped");
  }

  /**
   * Reset bridge peaks. Call on profile change or session reset.
   */
  function reset() {
    stop();
    bridge?.resetPeaks();
  }

  return {
    applySweep,
    start,
    stop,
    reset,
    getKdcanSource: () => kdcanSource,
    getBridge: () => bridge,
  };
}

/**
 * Module-level accessors (for tests + main.js wiring).
 */
function getKdcanSource() {
  return kdcanSource;
}

function getBridge() {
  return bridge;
}

// Export for main.js caller
if (typeof module !== "undefined" && module.exports) {
  module.exports = { initKdcanDataSource, getKdcanSource, getBridge };
} else if (typeof window !== "undefined") {
  window.beeemuuKdcanDataSource = { initKdcanDataSource, getKdcanSource, getBridge };
}