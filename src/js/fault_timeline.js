/* Cross-session fault timeline. This summarizes recorded DTC reads; it does
 * not imply that a fault is currently present or diagnose its cause. */
(function (root) {
  "use strict";

  function timestamp(value) {
    if (typeof value !== "string") return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  function buildTimeline(entries, options = {}) {
    if (!Array.isArray(entries)) return [];
    const limit = Number.isInteger(options.limit) && options.limit > 0 ? Math.min(options.limit, 500) : 100;
    return entries.filter(entry => entry && typeof entry === "object").map(entry => {
      const first = timestamp(entry.first_seen_iso);
      const last = timestamp(entry.last_seen_iso);
      const code = typeof entry.code === "string" ? entry.code.trim().toUpperCase() : "";
      const address = Number(entry.address);
      const occurrences = Number(entry.occurrences);
      if (!code || first === null || last === null || !Number.isFinite(address)) return null;
      return {
        code,
        address,
        text: typeof entry.text === "string" ? entry.text : "",
        statusText: typeof entry.status_text === "string" ? entry.status_text : "",
        firstSeen: first,
        lastSeen: last,
        occurrences: Number.isInteger(occurrences) && occurrences > 0 ? occurrences : 1,
        kind: "recorded-dtc",
      };
    }).filter(Boolean).sort((a, b) => b.lastSeen - a.lastSeen || a.address - b.address || a.code.localeCompare(b.code)).slice(0, limit);
  }

  const api = { buildTimeline };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BeemuuFaultTimeline = api;
})(typeof window !== "undefined" ? window : null);
