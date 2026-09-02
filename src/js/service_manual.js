"use strict";

// Service manual lookup — DTC code -> newtis.info URL
// Pure helper, no fetch, just URL builder. No corpus hosted.

const BASE = "https://www.newtis.info/tisv2/a/en";

const PREFIX_MAP = {
  "2A82": "e90-n52-engine/vanos-inlet",
  "2A87": "e90-n52-engine/vanos-exhaust",
  "2A99": "e90-n52-engine/vanos-inlet",
  "29CD": "e90-n52-engine/misfire",
  "29CC": "e90-n52-engine/misfire",
  "29E0": "e90-n54-engine/fuel-rail",
  "29E1": "e90-n54-engine/fuel-rail",
  "29E2": "e90-n54-engine/fuel-rail",
  "30FF": "e90-n54-engine/turbo-boost",
  "2E81": "e90-cooling/coolant-pump",
  "2E82": "e90-cooling/coolant-pump",
  "2E83": "e90-cooling/coolant-pump",
  "P0171": "engine/fuel-trim-lean",
  "P0300": "engine/misfire",
  "P0420": "engine/catalyst",
  "P0011": "engine/vanos-timing",
  "P0014": "engine/vanos-timing",
  "P0087": "engine/fuel-rail",
  "P0128": "engine/coolant-thermostat",
  "2E84": "e90-cooling/thermostat",
  "2F01": "e90-n54-engine/wastegate",
  "9CC1": "e90-frm/lighting",
  "9CCD": "e90-frm/lighting",
};

function manualUrl(dtcCode) {
  if (!dtcCode) return null;
  const code = String(dtcCode).trim().toUpperCase();
  const hex = /^[0-9A-F]{4,6}$/.test(code);
  const sae = /^[PUBC][0-9A-F]{4}$/.test(code);
  if (!hex && !sae) return null;
  const prefix = hex ? code.slice(0, 4) : code;
  const path = PREFIX_MAP[prefix] || PREFIX_MAP[code];
  if (path) return `${BASE}/${path}#${code}`;
  return `${BASE}/search?q=${encodeURIComponent(code)}`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { manualUrl };
}
if (typeof window !== "undefined") {
  window.beeemuuServiceManual = { manualUrl };
}
