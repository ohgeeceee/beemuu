"use strict";

// Read-only Bootmod3/MHD CSV -> LogSession adapter (v0.15.x proposal §3)
// Pure helpers, no DOM, reuses existing LogSession shape.
// Column map is best-effort; unknown columns kept as raw channels.

const COLUMN_MAP = {
  // Bootmod3 / MHD common headers -> BeeEmUu param ids
  "rpm": "rpm",
  "engine speed": "rpm",
  "boost (psi)": "boost_cmd",
  "boost": "boost_cmd",
  "boost (kpa)": "boost_cmd",
  "lambda": "lambda_1",
  "lambda bank 1": "lambda_1",
  "iat": "iat",
  "coolant": "coolant",
  "coolant temp": "coolant",
  "oil temp": "oil",
  "throttle": "throttle",
  "maf": "maf",
  "hpfp": "hpfp_rail",
  "rail pressure": "hpfp_rail",
  "ign timing": "inj_time",
};

function normalizeHeader(h) {
  return String(h).trim().toLowerCase().replace(/\s+/g, " ");
}

function mapHeaderToId(header) {
  const n = normalizeHeader(header);
  if (COLUMN_MAP[n]) return COLUMN_MAP[n];
  // fallback: sanitized header as id
  return n.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new Error("CSV needs header + at least one row");
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const ids = headers.map(mapHeaderToId);
  const rows = lines.slice(1).map((line) => {
    // naive split — Bootmod3/MHD do not quote commas inside fields
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const obj = {};
    for (let i = 0; i < ids.length; i++) {
      const v = parseFloat(cells[i]);
      obj[ids[i]] = Number.isNaN(v) ? cells[i] : v;
    }
    return obj;
  });
  return { headers, ids, rows };
}

/**
 * Convert parsed rows to LogSession-like series map.
 * @param {Array<Object>} rows
 * @param {Array<string>} ids
 * @returns {Map<string, Array<{x:number,y:number}>>}
 */
function toSeries(rows, ids) {
  const map = new Map();
  for (const id of ids) map.set(id, []);
  rows.forEach((row, idx) => {
    const t = idx * 0.25; // 4 Hz assumption if no time column
    for (const id of ids) {
      const v = row[id];
      if (typeof v === "number" && isFinite(v)) {
        map.get(id).push({ x: t, y: v });
      }
    }
  });
  return map;
}

function parseBootmod3Csv(text) {
  const { headers, ids, rows } = parseCsv(text);
  const series = toSeries(rows, ids);
  return { headers, ids, rows, series, source: "bootmod3/mhd" };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseCsv, parseBootmod3Csv, toSeries, mapHeaderToId, COLUMN_MAP };
}
if (typeof window !== "undefined") {
  window.beeemuuLogImport = { parseCsv, parseBootmod3Csv, toSeries, mapHeaderToId };
}
