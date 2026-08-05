"use strict";

// v0.14.0 slices 3, 5, 7 — Live Gauges panel.
//
// slice 3 (initial): the panel + controller. The controller renders
// the 6 broadcast gauges (RPM, coolant, oil temp, vehicle speed,
// battery voltage, throttle) at 10 Hz from a `setValues()` cache.
// The controller is decoupled from the data source via dependency
// injection (GaugeCtor, canvasFor, setIntervalFn).
//
// slice 7: the controller optionally takes a `source` (a
// live_can_source.js factory output). When source is provided,
// `start()` also starts the source and pulls `latestValues()` into
// the cache on each render tick. The source is the thing that
// knows about the transport (sim vs kdcan vs enet).
//
// slice 5 (extra live features): each gauge keeps a
// `peakThisSession` value. The controller exposes a per-key
// `peakFor(key)` reader. The panel renders the peak under the
// gauge label. The controller also tracks frames per second through
// the source's `framesPerSecond` and exposes it via
// `framesPerSecond()`; the panel header shows it when a source is
// attached.

const GAUGE_DEFINITIONS = Object.freeze([
  { key: "rpm", label: "RPM", unit: "rpm", min: 0, max: 8000 },
  { key: "coolant", label: "Coolant", unit: "°C", min: -10, max: 130 },
  { key: "oilTemp", label: "Oil temp", unit: "°C", min: -10, max: 150 },
  { key: "vehicleSpeed", label: "Vehicle speed", unit: "km/h", min: 0, max: 250 },
  { key: "batteryVoltage", label: "Battery voltage", unit: "V", min: 10, max: 16 },
  { key: "throttle", label: "Throttle", unit: "%", min: 0, max: 100 },
]);

function createLiveGaugesController(options) {
  const {
    GaugeCtor,
    canvasFor,
    status,
    button,
    source: initialSource = null,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    onSourceTick = null, // (latestValues) => void — for the panel header to mirror fps
  } = options;
  // v0.15.0 slice 2c — wrap `source` in a holder so setSource() can
  // reassign it. The destructured `source` from options above is a
  // const binding; the live reference lives on `sourceHolder.source`.
  const sourceHolder = { source: initialSource };
  const gauges = {};
  const values = {};
  const peaks = {}; // slice 5: per-gauge peak across the active session
  let timer = null;
  let sourceRunning = false;

  for (const definition of GAUGE_DEFINITIONS) {
    gauges[definition.key] = new GaugeCtor(canvasFor(definition.key), definition);
  }

  function updateStatus(running) {
    status.textContent = running ? "Listening" : "Off";
    status.classList.toggle("live-can-off", !running);
    button.textContent = running ? "Stop CAN listener" : "Start CAN listener";
    button.setAttribute?.("aria-pressed", String(running));
  }

  function render() {
    if (sourceHolder.source && typeof sourceHolder.source.latestValues === "function") {
      const fresh = sourceHolder.source.latestValues();
      if (fresh && typeof fresh === "object") {
        setValues(fresh);
      }
      if (typeof onSourceTick === "function") {
        onSourceTick(fresh);
      }
    }
    for (const definition of GAUGE_DEFINITIONS) {
      const value = values[definition.key];
      if (Number.isFinite(value)) {
        gauges[definition.key].set(value);
        // Track peak across the session. Reset on `start()`.
        if (peaks[definition.key] === undefined || value > peaks[definition.key]) {
          peaks[definition.key] = value;
        }
      }
    }
  }

  function setValues(nextValues) {
    if (!nextValues || typeof nextValues !== "object") return;
    for (const definition of GAUGE_DEFINITIONS) {
      if (Number.isFinite(nextValues[definition.key])) {
        values[definition.key] = nextValues[definition.key];
      }
    }
  }

  function start() {
    if (timer) return timer;
    if (sourceHolder.source && typeof sourceHolder.source.start === "function") {
      sourceHolder.source.start();
      sourceRunning = true;
    }
    timer = setIntervalFn(render, 100);
    updateStatus(true);
    return timer;
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
    if (sourceHolder.source && sourceRunning && typeof sourceHolder.source.stop === "function") {
      sourceHolder.source.stop();
      sourceRunning = false;
    }
    updateStatus(false);
  }

  function resetPeaks() {
    for (const definition of GAUGE_DEFINITIONS) {
      peaks[definition.key] = undefined;
    }
  }

  function peakFor(key) {
    return peaks[key];
  }

  function framesPerSecond() {
    if (sourceHolder.source && typeof sourceHolder.source.framesPerSecond === "function") {
      return sourceHolder.source.framesPerSecond();
    }
    return 0;
  }

  // v0.15.0 slice 2c — swap the data source at runtime. Used by
  // main.js to flip the Live Gauges panel from the sim-only source
  // (the default in mountLiveGauges) to the K+DCAN source adapter
  // once initKdcanDataSource() has run. Stops the old source if
  // running, replaces in closure, starts the new one if the
  // controller is currently ticking.
  function setSource(newSource) {
    const wasRunning = timer !== null;
    if (sourceHolder.source && sourceRunning && typeof sourceHolder.source.stop === "function") {
      sourceHolder.source.stop();
    }
    sourceRunning = false;
    sourceHolder.source = newSource || null;
    if (wasRunning && sourceHolder.source && typeof sourceHolder.source.start === "function") {
      sourceHolder.source.start();
      sourceRunning = true;
    }
  }

  updateStatus(false);
  return {
    gauges,
    setValues,
    render,
    start,
    stop,
    setSource,
    isRunning: () => timer !== null,
    peakFor,
    resetPeaks,
    framesPerSecond,
  };
}

function mountLiveGauges(documentRef = document) {
  const button = documentRef.getElementById("btn-live-can-toggle");
  const status = documentRef.getElementById("live-can-status");
  if (!button || !status || typeof Gauge === "undefined") return null;
  // The panel's frame-rate label is a small span to the right of the
  // status badge. v0.14.0 slice 5 — populated via onSourceTick below.
  let fpsEl = documentRef.getElementById("live-can-fps");
  if (!fpsEl) {
    fpsEl = documentRef.createElement("span");
    fpsEl.id = "live-can-fps";
    fpsEl.className = "live-can-fps";
    fpsEl.textContent = "";
    status.parentElement?.appendChild(fpsEl);
  }
  const peakEls = {};
  for (const definition of GAUGE_DEFINITIONS) {
    const el = documentRef.querySelector(`[data-live-can-peak="${definition.key}"]`);
    if (el) peakEls[definition.key] = el;
  }
  const source = (typeof window !== "undefined" && window.beeemuuLiveCanSource && typeof window.beeemuuLiveCanSource.createLiveCanSource === "function")
    ? window.beeemuuLiveCanSource.createLiveCanSource({ transportKind: "sim" })
    : null;
  const controller = createLiveGaugesController({
    GaugeCtor: Gauge,
    canvasFor: (key) => documentRef.querySelector(`[data-live-can-gauge="${key}"]`),
    status,
    button,
    source,
    onSourceTick: () => {
      const fps = controller.framesPerSecond();
      fpsEl.textContent = fps > 0 ? `${fps} fps` : "";
      // Mirror the per-gauge peak into the peak label.
      for (const definition of GAUGE_DEFINITIONS) {
        const el = peakEls[definition.key];
        if (!el) continue;
        const peak = controller.peakFor(definition.key);
        el.textContent = Number.isFinite(peak) ? formatPeak(peak, definition) : "—";
      }
    },
  });
  button.addEventListener("click", () => {
    if (controller.isRunning()) controller.stop(); else controller.start();
  });
  // v0.15.0 slice 2c — stash the controller on the window surface so
  // main.js can grab it (after initKdcanDataSource runs) and call
  // setSource(kdcanSource) to flip the panel from sim to K+DCAN.
  if (typeof window !== "undefined") {
    window.beeemuuLiveGauges.controller = controller;
  }
  return controller;
}

// Format the peak value to one decimal place for floats, integer for
// integer gauges. Exported only as part of the module's window surface
// for tests; the in-renderer call uses the local helper.
function formatPeak(value, definition) {
  if (!Number.isFinite(value)) return "—";
  // Integer gauges (RPM, km/h, %) get no decimals.
  const integerUnits = new Set(["rpm", "km/h", "%"]);
  if (integerUnits.has(definition.unit)) return Math.round(value).toString();
  return value.toFixed(1);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { GAUGE_DEFINITIONS, createLiveGaugesController, mountLiveGauges };
}
if (typeof window !== "undefined") {
  window.beeemuuLiveGauges = { GAUGE_DEFINITIONS, createLiveGaugesController, mountLiveGauges };
  // The script tag is loaded after the panel DOM in src/index.html, so by
  // the time this module executes the DOM is already parsed. Mount
  // synchronously now. If a future refactor moves the script tag to
  // <head>, swap to a DOMContentLoaded listener — both branches are
  // bundled in mountLiveGauges() so the controller is idempotent only if
  // called once. (v0.14.0 slice 3 — the "panel never ticks" bug.)
  mountLiveGauges(window.document);
}
