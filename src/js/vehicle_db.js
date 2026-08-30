"use strict";

// Vehicle database — VIN prefix -> build sheet options
// Pure helper, reads community/vehicle_db.toml via Tauri command or local JSON fallback.

function lookupVin(vin, db) {
  if (!vin || !db) return [];
  const upper = String(vin).toUpperCase();
  // longest prefix wins
  let best = [];
  let bestLen = -1;
  for (const [prefix, entry] of Object.entries(db)) {
    if (upper.startsWith(prefix.toUpperCase()) && prefix.length > bestLen) {
      best = Array.isArray(entry.options) ? entry.options : [];
      bestLen = prefix.length;
    }
  }
  return best;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { lookupVin };
}
if (typeof window !== "undefined") {
  window.beeemuuVehicleDb = { lookupVin };
}
