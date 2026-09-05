"use strict";

// Native Beemuu CSV importer (v0.21) — restores full log with tags, bookmarks, series for replay.
// Parses the format produced by csv_log_export.js: comment metadata + time_s header + units + data rows.
// Pure helpers, no DOM.

function parseBeemuuCsv(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim() !== "");
  if (lines.length < 2) throw new Error("CSV needs header + at least one row");

  let sessionTag = null;
  let bookmarks = [];
  let metadata = {};
  let headerIdx = 0;

  // Parse leading comments for metadata
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("# beemuu log")) {
      const metaStr = line.replace(/^# beemuu log v1\s*/, "");
      // Parse key="value with spaces" or key=value
      const re = /([a-z_]+)=("([^"]*)"|[^\s]+)/g;
      let m;
      while ((m = re.exec(metaStr)) !== null) {
        const k = m[1];
        let v = m[3] !== undefined ? m[3] : m[2];
        try { v = JSON.parse(v); } catch {}
        metadata[k] = v;
      }
      if (metadata.session_tag) sessionTag = metadata.session_tag;
      continue;
    }
    if (line.startsWith("# bookmark")) {
      const m = line.match(/time_s=([\d.]+)\s+label=(.+)/);
      if (m) {
        const label = m[2].replace(/^"|"$/g, "");
        bookmarks.push({ time: parseFloat(m[1]), label });
      }
      continue;
    }
    if (!line.startsWith("#") && line.includes("time_s")) {
      headerIdx = i;
      break;
    }
  }

  const headerLine = lines[headerIdx];
  const headers = headerLine.split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const timeIdx = headers.indexOf("time_s");
  if (timeIdx === -1) throw new Error("No time_s column");

  const chHeaders = headers.slice(timeIdx + 1);
  const ids = chHeaders.map(h => h.replace(/\s*\(.*?\)\s*$/, "").replace(/[^a-z0-9]+/gi, "_").toLowerCase());
  const labels = chHeaders.map(h => h.replace(/\s*\(.*?\)\s*$/, ""));
  const units = chHeaders.map(h => {
    const m = h.match(/\(([^)]+)\)/);
    return m ? m[1] : "";
  });

  const dataLines = lines.slice(headerIdx + 1).filter(l => !l.startsWith("units") && !l.startsWith("#"));
  const rows = dataLines.map(line => {
    const cells = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const t = parseFloat(cells[timeIdx]);
    const obj = { time: t };
    for (let i = 0; i < ids.length; i++) {
      const v = parseFloat(cells[timeIdx + 1 + i]);
      obj[ids[i]] = Number.isNaN(v) ? null : v;
    }
    return obj;
  }).filter(r => r.time != null && isFinite(r.time));

  // Build series map like LogSession expects
  const series = new Map();
  ids.forEach((id, i) => {
    const data = rows.map(r => ({ x: r.time, y: r[id] })).filter(p => p.y != null && isFinite(p.y));
    if (data.length) {
      series.set(id, { label: labels[i], unit: units[i], data });
    }
  });

  return {
    headers,
    ids,
    rows,
    series,
    sessionTag: sessionTag || metadata.session_tag || null,
    bookmarks,
    metadata,
    source: "beemuu"
  };
}

function parseBeemuuLogCsv(text) {
  return parseBeemuuCsv(text);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseBeemuuCsv, parseBeemuuLogCsv };
}
if (typeof window !== "undefined") {
  window.beeemuuLogImport = window.beeemuuLogImport || {};
  window.beeemuuLogImport.parseBeemuuCsv = parseBeemuuCsv;
  window.beeemuuLogImport.parseBeemuuLogCsv = parseBeemuuLogCsv;
}
