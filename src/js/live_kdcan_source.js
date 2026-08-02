"use strict";

// v0.15.0 slice 2 — Live Gauges data source flip.
//
// The Live Gauges panel (live_gauges.js) needs a source that
// provides fresh values from the K+DCAN cable via `read_live_data`.
// The v0.14.0 panel was sim-only; v0.15.0 flips the source to the
// DID-projection bridge when `connected && profile selected`.
//
// This module wraps the DID bridge in a source shape that
// live_gauges.js understands: `start()`, `stop()`, `latestValues()`,
// `framesPerSecond()`. The bridge's `applySweep()` is called by a
// polling timer in main.js (the caller wires the Tauri invoke).
//
// Architectural note: this module is a thin adapter. The polling
// logic stays in main.js (where the v0.14.2 live-data panel polling
// already lives). This adapter just translates between the bridge
// cache and the gauge controller's source interface.

/**
 * Create a K+DCAN data source for the Live Gauges panel.
 *
 * The source wraps a DID bridge instance and exposes the shape
 * live_gauges.js expects: start(), stop(), latestValues(),
 * framesPerSecond(). The actual polling (invoke('read_live_data'))
 * happens in main.js; the caller passes each sweep result to
 * `applySweepFromTauri(values, errors)`.
 *
 * @param {Object} bridge — A `createDIDBridge()` instance.
 * @param {Object} options
 * @param {number} [options.targetFps=10] — Target frame rate for
 *   framesPerSecond() calculation (used by the gauge header).
 */
function createKdcanSource(bridge, options = {}) {
  const { targetFps = 10 } = options;
  let running = false;
  let lastFrameAt = null;
  let frameCount = 0;
  let fpsTimer = null;
  let fps = 0;

  /**
   * Start the source. This doesn't start polling — main.js does
   * that. It just marks the source as running and resets the FPS
   * counter.
   */
  function start() {
    if (running) return;
    running = true;
    frameCount = 0;
    lastFrameAt = null;
    // FPS sampling window: 1 second.
    fpsTimer = setInterval(() => {
      fps = frameCount;
      frameCount = 0;
    }, 1000);
  }

  /**
   * Stop the source. Resets running flag and clears FPS timer.
   */
  function stop() {
    if (!running) return;
    running = false;
    if (fpsTimer) {
      clearInterval(fpsTimer);
      fpsTimer = null;
    }
    fps = 0;
    frameCount = 0;
  }

  /**
   * Apply a sweep result from Tauri (the main.js caller passes
   * the `read_live_data` result here).
   *
   * @param {Array} values — `LiveValue[]` from `read_live_data`.
   * @param {Array} errors — `LiveError[]` from `read_live_data`.
   */
  function applySweepFromTauri(values, errors) {
    if (!running) return;
    bridge.applySweep(values, errors);
    frameCount++;
    lastFrameAt = Date.now();
  }

  /**
   * Get the latest decoded values per gauge key.
   *
   * @returns {Object} — `{ rpm: 750, coolant: 92, ... }`.
   */
  function latestValues() {
    return bridge.latestValues();
  }

  /**
   * Get the current frames-per-second (for the gauge header).
   *
   * @returns {number} — FPS over the last 1-second window.
   */
  function framesPerSecond() {
    return fps;
  }

  /**
   * Reset the bridge peaks (call when the user disconnects).
   */
  function resetPeaks() {
    bridge.resetPeaks();
  }

  return {
    start,
    stop,
    latestValues,
    framesPerSecond,
    applySweepFromTauri,
    resetPeaks,
  };
}

// Dual export: Node.js (`module.exports`) for tests, global
// (`window.beeemuuKdcanSource`) for the webview.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { createKdcanSource };
} else if (typeof window !== "undefined") {
  window.beeemuuKdcanSource = { createKdcanSource };
}
