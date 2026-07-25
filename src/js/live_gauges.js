"use strict";

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
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = options;
  const gauges = {};
  const values = {};
  let timer = null;

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
    for (const definition of GAUGE_DEFINITIONS) {
      const value = values[definition.key];
      if (Number.isFinite(value)) gauges[definition.key].set(value);
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
    timer = setIntervalFn(render, 100);
    updateStatus(true);
    return timer;
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
    updateStatus(false);
  }

  updateStatus(false);
  return { gauges, setValues, render, start, stop, isRunning: () => timer !== null };
}

function mountLiveGauges(documentRef = document) {
  const button = documentRef.getElementById("btn-live-can-toggle");
  const status = documentRef.getElementById("live-can-status");
  if (!button || !status || typeof Gauge === "undefined") return null;
  const controller = createLiveGaugesController({
    GaugeCtor: Gauge,
    canvasFor: (key) => documentRef.querySelector(`[data-live-can-gauge="${key}"]`),
    status,
    button,
  });
  button.addEventListener("click", () => {
    if (controller.isRunning()) controller.stop(); else controller.start();
  });
  return controller;
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
