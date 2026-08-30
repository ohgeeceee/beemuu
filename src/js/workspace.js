"use strict";

// Workspace save/load — v0.15.5
// Persists gauge layout across restarts via localStorage.
// Shape: { gauges: [{ profile_id, param_id, min, max }], theme }
// Pure helpers — no DOM, dual export.

function save(gauges, theme) {
  const payload = { gauges: gauges || [], theme: theme || "dark", savedAt: Date.now() };
  try { localStorage.setItem("beeemuu.workspace", JSON.stringify(payload)); } catch {}
  return payload;
}

function load() {
  try {
    const raw = localStorage.getItem("beeemuu.workspace");
    if (!raw) return { gauges: [], theme: "dark" };
    const p = JSON.parse(raw);
    return { gauges: Array.isArray(p.gauges) ? p.gauges : [], theme: p.theme || "dark" };
  } catch { return { gauges: [], theme: "dark" }; }
}

function clear() { try { localStorage.removeItem("beeemuu.workspace"); } catch {} }

if (typeof module !== "undefined" && module.exports) {
  module.exports = { save, load, clear };
}
if (typeof window !== "undefined") {
  window.beeemuuWorkspace = { save, load, clear };
}
