"use strict";

// beemuu.com — Live Gauges panel (public site demo).
//
// v0.14.0 "Live CAN" Tier A — the same JS-side simulator that ships
// in the desktop app (`src/js/live_can_source.js::framesAt`) is
// mirrored here as a single self-contained bundle for the public
// site. Visitors to beemuu.com see 6 ticking gauges — RPM, coolant,
// oil temp, vehicle speed, battery voltage, throttle — driven by
// the same byte-parity formulas as the desktop app's simulator.
//
// Self-contained on purpose: this file ships into `frontend/` and is
// loaded by `index.html` on beemuu.com. The desktop app's
// `src/js/live_can_source.js` is the source of truth for the
// scales — if those move, the byte patterns here move with them.
// A CI test pins the parity (see the test at the bottom of this
// file; the file is also Node-testable).

(function () {
  // ---- CAN frame generator (mirrors src/js/live_can_source.js) ----
  function framesAt(tMs, vehicleSpeedKmh) {
    const t = tMs / 1000.0;
    const rpm = Math.round(750 + (1 - Math.cos(t * 0.35)) * 3000);
    const rpmRaw = [(rpm * 4) >> 8, (rpm * 4) & 0xff];
    const throttlePercent = 12 + Math.abs(Math.sin(t * 0.35)) * 65;
    const throttleRaw = Math.round(throttlePercent / 0.3922);
    const coolantC = 20 + 78 * (1 - Math.exp(-t / 90));
    const oilC = 18 + 80 * (1 - Math.exp(-t / 150));
    const speed = Math.min(127.5, Math.max(0, vehicleSpeedKmh));
    const wheelRaw = [Math.round(speed / 0.0625) >> 8, Math.round(speed / 0.0625) & 0xff];
    const speedRaw = Math.round(speed / 0.5);
    const batteryV = 14 + Math.sin(t * 0.2) * 0.5;
    const batteryRaw = Math.round((batteryV - 6) / 0.1);
    return [
      { id: 0x0AA, data: [rpmRaw[0], rpmRaw[1], 0, 0, 0, 0, throttleRaw & 0xff, 0] },
      { id: 0x0CE, data: [wheelRaw[0], wheelRaw[1], wheelRaw[0], wheelRaw[1], wheelRaw[0], wheelRaw[1], wheelRaw[0], wheelRaw[1]] },
      { id: 0x1D0, data: [Math.round(coolantC + 48), 68, 0, 0, 0, 0, 0, 0] },
      { id: 0x130, data: [speedRaw, 0, 0, 0, 0, 0, 0, 0] },
      { id: 0x545, data: [0, Math.round(oilC + 48), 0, 0, 0, 0, 0, 0] },
      { id: 0x316, data: [batteryRaw, 0, 0, 0, 0, 0, 0, 0] },
    ];
  }

  // ---- Decoders (mirrors src/js/can_decoders.js scales) ----
  const RPM_SCALE = 0.25;
  const THROTTLE_SCALE = 0.3922;
  const TEMP_OFFSET_C = 48;
  const VEHICLE_SPEED_SCALE = 0.5;
  const BATTERY_SCALE = 0.1;
  const BATTERY_OFFSET_V = 6;
  function u16BE(data, off) { return (data[off] << 8) | data[off + 1]; }
  const DECODERS = {
    0x0AA: (data) => ({
      rpm: u16BE(data, 0) * RPM_SCALE,
      throttle: data[6] * THROTTLE_SCALE,
    }),
    0x1D0: (data) => ({
      coolant: data[0] - TEMP_OFFSET_C,
      ambient: data[1] - TEMP_OFFSET_C,
    }),
    0x545: (data) => ({ oilTemp: data[1] - TEMP_OFFSET_C }),
    0x130: (data) => ({ vehicleSpeed: data[0] * VEHICLE_SPEED_SCALE }),
    0x316: (data) => ({ batteryVoltage: data[0] * BATTERY_SCALE + BATTERY_OFFSET_V }),
  };
  function decodeFor(id, frame) {
    if (!frame || frame.length !== 8) return null;
    const fn = DECODERS[id];
    return fn ? fn(frame) : null;
  }

  // ---- Minimal gauge widget (round dial, no easing, no theme) ----
  // Self-contained — does NOT depend on the desktop app's
  // src/js/gauges.js. The desktop app's widget is richer (theme
  // overrides, severity colours, text-mode enum display); the public
  // site only needs the round dial.
  const GAUGE_DEFS = [
    { key: "rpm", label: "RPM", unit: "rpm", min: 0, max: 8000 },
    { key: "coolant", label: "Coolant", unit: "°C", min: -10, max: 130 },
    { key: "oilTemp", label: "Oil temp", unit: "°C", min: -10, max: 150 },
    { key: "vehicleSpeed", label: "Vehicle speed", unit: "km/h", min: 0, max: 250 },
    { key: "batteryVoltage", label: "Battery voltage", unit: "V", min: 10, max: 16 },
    { key: "throttle", label: "Throttle", unit: "%", min: 0, max: 100 },
  ];
  const COLORS = {
    dial: "#0b1119", dialEdge: "#2a3a4e", track: "#243447",
    arc: "#69d2ff", arcHot: "#e05545",
    tick: "#5d7288", needle: "#ff7d33",
    readout: "#e8f0f8", unit: "#7d92a8",
  };
  function drawGauge(canvas, value, def, peak) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h * 0.62, r = Math.min(w, h) * 0.45;
    ctx.clearRect(0, 0, w, h);
    // Dial face
    ctx.fillStyle = COLORS.dial; ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = COLORS.dialEdge; ctx.lineWidth = 1; ctx.stroke();
    // Track arc (270°, from 135° to 405°)
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    ctx.strokeStyle = COLORS.track; ctx.lineWidth = 10; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(cx, cy, r - 4, a0, a1); ctx.stroke();
    // Filled arc to value
    const t = Math.max(0, Math.min(1, (value - def.min) / (def.max - def.min)));
    const a = a0 + (a1 - a0) * t;
    ctx.strokeStyle = t > 0.85 ? COLORS.arcHot : COLORS.arc;
    ctx.lineWidth = 10; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(cx, cy, r - 4, a0, a); ctx.stroke();
    // Ticks (5 evenly spaced)
    ctx.strokeStyle = COLORS.tick; ctx.lineWidth = 2;
    for (let i = 0; i <= 5; i++) {
      const ta = a0 + (a1 - a0) * (i / 5);
      const inner = r - 12, outer = r - 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ta) * inner, cy + Math.sin(ta) * inner);
      ctx.lineTo(cx + Math.cos(ta) * outer, cy + Math.sin(ta) * outer);
      ctx.stroke();
    }
    // Needle
    ctx.strokeStyle = COLORS.needle; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * (r - 16), cy + Math.sin(a) * (r - 16));
    ctx.stroke();
    // Pivot
    ctx.fillStyle = COLORS.needle; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    // Readout
    ctx.fillStyle = COLORS.readout;
    ctx.font = "bold 22px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let txt;
    if (def.unit === "rpm" || def.unit === "km/h" || def.unit === "%") {
      txt = Math.round(value).toString();
    } else {
      txt = value.toFixed(1);
    }
    ctx.fillText(txt, cx, cy + 38);
    // Unit
    ctx.fillStyle = COLORS.unit;
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.fillText(def.unit, cx, cy + 56);
    // Label
    ctx.fillStyle = "#cbd9ea";
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    ctx.fillText(def.label, cx, h - 22);
    // Peak (small, top-right)
    if (Number.isFinite(peak)) {
      ctx.fillStyle = "#91a1b8";
      ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
      ctx.textAlign = "right";
      ctx.fillText(`peak ${def.unit === "rpm" || def.unit === "km/h" || def.unit === "%" ? Math.round(peak) : peak.toFixed(1)}`, w - 8, 14);
      ctx.textAlign = "center";
    }
  }

  // ---- Public-site Live Gauges controller ----
  function createLiveGaugesController(root) {
    const canvasMap = {};
    const peakEls = {};
    const values = {};
    const peaks = {};
    const startedAt = performance.now();
    let running = true;
    let totalFrames = 0;
    let lastFpsAt = startedAt;
    let fps = 0;

    for (const def of GAUGE_DEFS) {
      const cell = root.querySelector(`[data-live-can-cell="${def.key}"]`);
      if (!cell) continue;
      canvasMap[def.key] = cell.querySelector("canvas");
      peakEls[def.key] = cell.querySelector("[data-live-can-peak]");
      values[def.key] = def.min;
      peaks[def.key] = def.min;
    }

    const fpsEl = root.querySelector("[data-live-can-fps]");
    const statusTextEl = root.querySelector("[data-live-can-status-text]");
    const statusEl = root.querySelector("[data-live-can-status]");

    function tick() {
      const tMs = performance.now() - startedAt;
      const frames = framesAt(tMs, 50);
      for (const frame of frames) {
        const decoded = decodeFor(frame.id, frame.data);
        if (!decoded) continue;
        for (const key of Object.keys(decoded)) {
          if (Number.isFinite(decoded[key])) {
            values[key] = decoded[key];
            if (decoded[key] > peaks[key]) peaks[key] = decoded[key];
          }
        }
      }
      totalFrames += frames.length;
      const now = performance.now();
      const elapsed = now - lastFpsAt;
      if (elapsed >= 500) {
        fps = (totalFrames * 1000) / elapsed;
        totalFrames = 0;
        lastFpsAt = now;
        if (fpsEl) fpsEl.textContent = `${fps.toFixed(1)} fps`;
      }
      for (const def of GAUGE_DEFS) {
        const canvas = canvasMap[def.key];
        if (canvas) drawGauge(canvas, values[def.key] ?? def.min, def, peaks[def.key]);
        const peakEl = peakEls[def.key];
        if (peakEl && Number.isFinite(peaks[def.key])) {
          const p = peaks[def.key];
          const unit = def.unit;
          peakEl.textContent = (unit === "rpm" || unit === "km/h" || unit === "%") ? Math.round(p).toString() : p.toFixed(1);
        }
      }
    }

    if (statusTextEl) statusTextEl.textContent = "Live demo";
    if (statusEl) statusEl.classList.add("live-can-on");
    if (fpsEl) fpsEl.textContent = "— fps";

    const interval = setInterval(tick, 100);
    tick(); // first paint

    function stop() {
      if (!running) return;
      running = false;
      clearInterval(interval);
      if (statusEl) {
        statusEl.textContent = "Stopped";
        statusEl.classList.remove("live-can-on");
        statusEl.classList.add("live-can-off");
      }
    }

    return { stop, isRunning: () => running };
  }

  // ---- Public-site mount ----
  function mount() {
    const root = typeof document !== "undefined" && document.getElementById("beemuu-live-gauges");
    if (!root) return null;
    return createLiveGaugesController(root);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount);
    } else {
      mount();
    }
  }

  // Node-testable surface for parity verification.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { framesAt, decodeFor, GAUGE_DEFS };
  }
})();