"use strict";

// CSV log exporter for the Logging tab.
//
// Extracted from `src/js/main.js` in v0.11.0 so the units-row option
// (`withUnits`) is independently testable. Pure data -> string: the
// caller hands in the enabled series (each with `label`, `unit`, and
// `getAllData()` returning `[{x, y, text?}, ...]`) and gets back a CSV
// text. No DOM, no Chart.js, no globals — so `src/js/csv_log_export.test.js`
// can run under `node --test` without any browser shim.
//
// Why two cells per series: the on-disk shape (see
// `beeemuu-log-2026-07-06T20-37-19.csv`) pairs each series's `y` value
// with a `LiveFormat.csvCell(point)` form so enums ("ON"/"OFF") survive
// a round-trip. The units row mirrors that two-cell pair so any loader
// that understands the schema can recover both the unit and the human
// label without a second pass.
//
// Dual export: works under `node --test` (CommonJS) and as a plain
// `<script>` in the Tauri webview (where `module` is undefined).
// Mirrors the dual-export pattern in `src/js/histogram.js` and
// `src/js/svg_export.js`.

/**
 * Build a CSV string for the current logging session.
 *
 * @param {Array<[string, {label: string, unit: string, getAllData(): Array<{x: number, y: number, text?: string}>}]>} entries
 *   The enabled series, in iteration order. Each entry must have a
 *   `getAllData()` method returning the same `{x, y, text?}` shape
 *   `main.js` writes to the chart. Output rows are aligned across all
 *   series by index, assuming (as `main.js` does) that every enabled
 *   series has the same number of points.
 * @param {{withUnits?: boolean, liveFormat?: {csvCell?: (point: any) => string}}} [opts]
 *   - `withUnits` (default false): when true, emit a second header
 *     line whose cells are the per-series unit, repeated twice per
 *     series to mirror the two-cell emission pattern below. The
 *     first row of that line under the `time_s` column is empty.
 *   - `liveFormat.csvCell`: the formatting helper for the second
 *     cell of each pair (the "human label" / enum-string cell).
 *     Defaults to a thin inline formatter that matches the existing
 *     behaviour when no helper is passed — callers that have the
 *     shared `window.LiveFormat` available should pass it.
 * @returns {string|null} CSV text, or null if no enabled series had data.
 */
function buildLogCsv(entries, opts) {
  const enabled = (entries || []).filter(([, s]) => s && typeof s.getAllData === "function" && s.getAllData().length > 0);
  if (!enabled.length) return null;

  const liveFormat = (opts && opts.liveFormat) || {};
  const csvCell = (typeof liveFormat.csvCell === "function")
    ? liveFormat.csvCell
    : defaultCsvCell;

  const allData = enabled[0][1].getAllData();
  const rows = allData.length;

  // Header: "time_s" + 1 cell per series (label/unit). Note this is
  // narrower than the data row below — the data row emits TWO cells
  // per series (numeric `y` and `LiveFormat.csvCell(point)`), which
  // matches the on-disk format in `beeemuu-log-2026-07-06T20-37-19.csv`.
  // The pre-extraction code in `main.js` did the same.
  let csv = "time_s," + enabled.map(([, s]) => `${s.label} (${s.unit})`).join(",") + "\n";
  // Optional units row: "units" + 1 cell per series (unit). Two-cell
  // pairing with the data row is preserved by aligning the data row's
  // second cell with the same series's unit.
  if (opts && opts.withUnits) {
    csv += "units," + enabled.map(([, s]) => s.unit).join(",") + "\n";
  }
  for (let i = 0; i < rows; i++) {
    const t = allData[i] && allData[i].x;
    // Pre-extraction behaviour: `t.toFixed ? t.toFixed(2) : t`. For
    // non-numeric `t` (rare in practice), we fall back to the raw value
    // to match the existing CSV exactly.
    let row = (typeof t === "number" && t.toFixed) ? t.toFixed(2) : (t ?? "");
    for (const [, s] of enabled) {
      const p = s.getAllData()[i];
      // First cell: numeric `y` (or JSON-quoted enum text).
      // `(p.y ?? "").toFixed(2)` matches the pre-extraction behaviour,
      // including its `"NaN"` emission for non-finite `y` — preserved
      // here on purpose so the wire format is byte-identical to what
      // `main.js` ships today.
      row += "," + (p
        ? (p.text !== undefined && p.text !== null
            ? JSON.stringify(p.text)
            : (p.y ?? "").toFixed(2))
        : "");
      // Second cell: the LiveFormat-shaped cell (the human label /
      // enum-string cell). Kept identical to the pre-extraction
      // behaviour via the helper.
      row += "," + csvCell(p);
    }
    csv += row + "\n";
  }
  return csv;
}

/**
 * Inline fallback for `LiveFormat.csvCell(point)`. Mirrors the rule in
 * `src/js/live_format.js` so the module is testable in isolation; the
 * real call site in `main.js` passes `window.LiveFormat.csvCell` for
 * single-source-of-truth parity with the gauge canvas.
 */
function defaultCsvCell(point) {
  if (point === undefined || point === null) return "";
  if (point.text !== undefined && point.text !== null) {
    return JSON.stringify(String(point.text));
  }
  const y = point.y;
  return (typeof y === "number" && Number.isFinite(y)) ? Number(y).toFixed(2) : "";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildLogCsv };
}
if (typeof window !== "undefined") {
  window.beeemuuCsvLog = { buildLogCsv };
}
