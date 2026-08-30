"use strict";

// Service manual lookup — DTC code -> newtis.info URL
// Pure helper, no fetch, just URL builder. No corpus hosted.

const BASE = "https://www.newtis.info/tisv2/a/en";

const PREFIX_MAP = {
  "2A82": "e90-n52-engine/vanos-inlet",
  "2A87": "e90-n52-engine/vanos-exhaust",
  "29CD": "e90-n52-engine/misfire",
  "30FF": "e90-n54-engine/turbo-boost",
  "2E83": "e90-cooling/coolant-pump",
};

function manualUrl(dtcCode) {
  if (!dtcCode) return null;
  const code = String(dtcCode).trim().toUpperCase();
  if (!/^[0-9A-F]{4,6}$/.test(code)) return null;
  const prefix = code.slice(0,4);
  const path = PREFIX_MAP[prefix] || PREFIX_MAP[code];
  if (path) return `${BASE}/${path}#${code}`;
  // fallback: newtis search
  return `${BASE}/search?q=${encodeURIComponent(code)}`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { manualUrl };
}
if (typeof window !== "undefined") {
  window.beeemuuServiceManual = { manualUrl };
}
