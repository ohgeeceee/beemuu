// v0.15.0 slice 2b — Live Gauges data source flip.
//
// Wires the DID-projection bridge + K+DCAN source into the main.js
// polling loop. When `connected && profile selected`, the Live
// Gauges panel reads from the K+DCAN cable via `read_live_data`.
// Otherwise, it falls back to the simulator.

let kdcanSource = null;
let bridge = null;

/**
 * Initialize the K+DCAN data source for the Live Gauges panel.
 * Call this once at app startup (after live_gauges.js mounts).
 *
 * @param {Object} options
 * @param {Function} options.invoke — The Tauri `invoke` function.
 * @param {Function} options.log — The app's log function.
 * @returns {Object} — `{ startPolling, stopPolling, reset }`
 */
function initKdcanDataSource({ invoke, log }) {
  const { createDIDBridge } = window.beeemuuDIDBridge || {};
  const { createKdcanSource } = window.beeemuuKdcanSource || {};

  if (!createDIDBridge || !createKdcanSource) {
    log("K+DCAN data source: bridge modules not loaded, falling back to sim-only");
    return { startPolling: () => {}, stopPolling: () => {}, reset: () => {} };
  }

  bridge = createDIDBridge();
  kdcanSource = createKdcanSource(bridge, { targetFps: 10 });

  let pollingTimer = null;
  let lastProfile = null;

  async function pollOnce() {
    if (!kdcanSource) return;
    try {
      const profile = document.getElementById("live-profile")?.value;
      if (!profile) return;

      const result = await invoke("read_live_data", { profile });
      kdcanSource.applySweepFromTauri(result.values || [], result.errors || []);
    } catch (e) {
      log("K+DCAN poll failed: " + e);
    }
  }

  function startPolling(intervalMs = 250) {
    if (pollingTimer) return;
    kdcanSource?.start();
    pollingTimer = setInterval(pollOnce, intervalMs);
    log("K+DCAN data source started (polling every " + intervalMs + "ms)");
  }

  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
    kdcanSource?.stop();
    log("K+DCAN data source stopped");
  }

  function reset() {
    stopPolling();
    bridge?.resetPeaks();
    lastProfile = null;
  }

  return { startPolling, stopPolling, reset };
}

/**
 * Get the current K+DCAN source instance (for wiring into live_gauges.js).
 * @returns {Object|null}
 */
function getKdcanSource() {
  return kdcanSource;
}

/**
 * Get the current bridge instance (for peak queries, etc.).
 * @returns {Object|null}
 */
function getBridge() {
  return bridge;
}

// Export for main.js caller
if (typeof module !== "undefined" && module.exports) {
  module.exports = { initKdcanDataSource, getKdcanSource, getBridge };
} else if (typeof window !== "undefined") {
  window.beeemuuKdcanDataSource = { initKdcanDataSource, getKdcanSource, getBridge };
}