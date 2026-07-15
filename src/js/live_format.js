/* Pure helpers for formatting live-data values for the UI and CSV
 * export. Kept dependency-free and dual-context: loaded as a plain
 * <script> in `index.html` (exposes `window.LiveFormat`) and `require()`d
 * by `src/js/test/live_format.test.cjs` under Node.
 *
 * Adding a new enum cell type or numeric clamp rule should live here so
 * both the gauge canvas and the CSV exporter share a single source of
 * truth. Keep the helpers small, side-effect-free, and Node-runnable. */

/* CSV cell for one logged point. Enum labels are emitted as quoted JSON
 * strings (round-trip-safe, handles commas in labels). Numeric samples
 * stay on the existing two-decimal format. Missing points become an
 * empty cell. */
function csvCell(point) {
  if (point === undefined || point === null) return "";
  if (point.text !== undefined && point.text !== null) {
    return JSON.stringify(String(point.text));
  }
  const y = point.y;
  return y === undefined || y === null ? "" : Number(y).toFixed(2);
}

/* Clamp a numeric gauge sample to the configured [min, max] range. Used
 * by `Gauge.set` in numeric mode; text mode bypasses it. */
function clampGaugeValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/* Standardised export pattern for both Node (CommonJS test runner) and
 * the browser (window global). The check is defensive: browser context
 * has no `module`. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { csvCell, clampGaugeValue };
}
if (typeof window !== "undefined") {
  window.LiveFormat = { csvCell, clampGaugeValue };
}
