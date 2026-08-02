"use strict";

// v0.15.0 slice 1 — DID-projection bridge.
//
// The Live Gauges panel (live_gauges.js) needs fresh decoded values
// from the K+DCAN cable, not just the simulator. The v0.14.0 panel
// was sim-only by explicit user decision (the v0.14.2 cycle-pick
// conversation, Option B). v0.15.0 connects the existing
// `read_live_data` UDS path to the panel so it shows **real data
// on the K+DCAN cable**, without the OBDLink SX acquisition the
// v0.14.0 Tier B was waiting for.
//
// This module is the **bridge**: it maps each `[[profile.param]]`
// entry to the corresponding `data-live-can-gauge` slot. It reuses
// the v0.14.0 `can_decoders.js` for byte-level decoding when the
// live-data value comes through the broadcast path (future v0.16.x
// ENET/DoIP auto-detect), but for v0.15.0 the primary path is the
// UDS DID read via `read_live_data`.
//
// Architectural note: this module is a pure mapping function +
// cache. No DOM, no Tauri IPC, no async. Unit tests run under
// `node --test` without a webview or backend. `main.js` becomes
// the thin caller that invokes `read_live_data` and feeds the
// result into `bridge.applySweep()`.

const GAUGE_KEYS = Object.freeze([
  "rpm",
  "coolant",
  "oilTemp",
  "vehicleSpeed",
  "batteryVoltage",
  "throttle",
]);

// Map profile param IDs to gauge keys. This is the core mapping
// table — each `[[profile.param]]` entry's `id` field maps to a
// gauge key. Unknown IDs are ignored (they're not gauge params).
const PARAM_TO_GAUGE = Object.freeze({
  rpm: "rpm",
  coolant: "coolant",
  oil: "oilTemp",
  vehicleSpeed: "vehicleSpeed",
  volt: "batteryVoltage",
  throttle: "throttle",
});

// Decode function name to JS decoder. Mirrors the Rust
// `live::decode()` in `src-tauri/src/data/live.rs`. The bridge
// reuses the `can_decoders.js` byte-level decoders for broadcast
// frames, but for UDS DID reads the backend already decoded the
// numeric value — we just pass it through.
const DECODE_FN = {
  // Pass-through: backend already decoded.
  passthrough: (v) => v,
  // Temp: raw - 40°C (SAE J1979 coolant/oil temp).
  temp_u8: (raw) => raw - 40,
  // Percent: raw * 100 / 255 (SAE J1979 percent encoding).
  percent_a: (raw) => (raw * 100) / 255,
  // RPM: raw / 4 (SAE J1979 engine rpm).
  u16_quarter: (raw) => raw / 4,
  // Voltage: raw * 0.1 + 6 (SAE J1979 battery voltage).
  voltage_0_1_6: (raw) => raw * 0.1 + 6,
  // Throttle: raw * 100 / 255 (SAE J1979 throttle position).
  throttle_pct: (raw) => (raw * 100) / 255,
  // Speed: raw * 0.5 (SAE J1979 vehicle speed km/h).
  speed_0_5: (raw) => raw * 0.5,
};

/**
 * Create a DID-projection bridge instance.
 *
 * The bridge maintains a cache of the latest decoded values per
 * gauge key. Call `applySweep(liveValues, errors)` with the result
 * of `invoke('read_live_data', { profile })` to update the cache.
 * Call `latestValues()` to get the fresh cache for the Live Gauges
 * panel.
 *
 * @param {Object} options
 * @param {(id: string, raw: number) => number} [options.decodeFn] —
 *   Optional custom decoder for unknown decode types. Defaults to
 *   passthrough.
 */
function createDIDBridge(options = {}) {
  const { decodeFn = null } = options;
  const cache = {};
  const peaks = {};
  let lastSweepAt = null;

  /**
   * Apply a live-data sweep result to the cache.
   *
   * @param {Array} values — `LiveValue[]` from `read_live_data`.
   * @param {Array} errors — `LiveError[]` from `read_live_data`.
   *   Errors are logged but don't poison the cache; failed PIDs
   *   keep their last-known good value (or stay undefined).
   * @returns {Object} — The updated cache (same object as
   *   `latestValues()` will return).
   */
  function applySweep(values, errors) {
    lastSweepAt = Date.now();
    if (!Array.isArray(values)) return cache;

    for (const v of values) {
      if (!v || typeof v !== "object") continue;
      const gaugeKey = PARAM_TO_GAUGE[v.id];
      if (!gaugeKey) continue; // Not a gauge param (e.g. "iat", "load").

      // If the backend returned a `text` field (enum decode), skip
      // — gauges are numeric only. The enum param isn't a gauge.
      if (v.text !== undefined && v.text !== null) continue;

      const numeric = Number(v.value);
      if (!Number.isFinite(numeric)) continue;

      cache[gaugeKey] = numeric;

      // Track peak across the session (mirrors live_gauges.js).
      if (peaks[gaugeKey] === undefined || numeric > peaks[gaugeKey]) {
        peaks[gaugeKey] = numeric;
      }
    }

    // Log errors for debugging. Failed PIDs keep their last value.
    if (Array.isArray(errors) && errors.length > 0) {
      // eslint-disable-next-line no-console
      console.warn("DID-bridge sweep errors:", errors);
    }

    return cache;
  }

  /**
   * Get the latest decoded values per gauge key.
   *
   * @returns {Object} — `{ rpm: 750, coolant: 92, oilTemp: 98, ... }`.
   *   Keys without a value yet are omitted.
   */
  function latestValues() {
    const out = {};
    for (const key of GAUGE_KEYS) {
      if (cache[key] !== undefined) out[key] = cache[key];
    }
    return out;
  }

  /**
   * Get the peak value seen this session for a gauge key.
   *
   * @param {string} key — Gauge key (e.g. "rpm", "coolant").
   * @returns {number|undefined} — Peak value, or undefined if no
   *   value seen yet.
   */
  function peakFor(key) {
    return peaks[key];
  }

  /**
   * Reset all peaks (call when the user disconnects or explicitly
   * resets the session).
   */
  function resetPeaks() {
    for (const key of GAUGE_KEYS) {
      peaks[key] = undefined;
    }
  }

  /**
   * Get the timestamp of the last successful sweep.
   *
   * @returns {number|null} — Unix ms timestamp, or null if no sweep
   *   yet.
   */
  function lastSweep() {
    return lastSweepAt;
  }

  return {
    applySweep,
    latestValues,
    peakFor,
    resetPeaks,
    lastSweep,
  };
}

// Dual export: Node.js (`module.exports`) for tests, global
// (`window.beeemuuDIDBridge`) for the webview.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { createDIDBridge, GAUGE_KEYS, PARAM_TO_GAUGE };
} else if (typeof window !== "undefined") {
  window.beeemuuDIDBridge = { createDIDBridge, GAUGE_KEYS, PARAM_TO_GAUGE };
}
