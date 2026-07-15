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

/* Map an enum-style label to a CSS class name for severity styling.
 * Used by the gauge canvas (different `fillStyle`) and the
 * Logging-tab channel display (class on the label span) when a
 * LiveValue.text is severity-bearing.
 *
 * Returns:
 *   "severity-critical" — text matches a critical keyword
 *   "severity-warning"  — text matches a warning keyword
 *   ""                  — text is informational / "None" / unknown
 *
 * Matching is case-insensitive and exact — partial matches like
 * "none of the above" do not count as the "None" state. This is
 * deliberate: it prevents accidental severity bumps from labels
 * that happen to contain a keyword.
 *
 * Keyword lists are derived from the v0.4.0 example DIDs
 * (community/profiles/{b58,n55}.toml). New severity-bearing
 * enums added in the future should extend one of these lists
 * (or add a new severity tier) — there is no per-DID
 * configuration because that would push responsibility onto
 * community-profile contributors, who shouldn't have to think
 * about UI severity classes. */
function severityClass(text) {
  if (typeof text !== "string" || text.length === 0) return "";
  const lower = text.toLowerCase();
  // Critical keywords — pre-existing examples: "Severe".
  // Add new critical-tier enum labels here as the community
  // adds them.
  if (
    lower === "severe" ||
    lower === "critical" ||
    lower === "fault"
  ) {
    return "severity-critical";
  }
  // Warning keywords — pre-existing examples: "Light", "Moderate",
  // "Warning".
  if (
    lower === "light" ||
    lower === "moderate" ||
    lower === "warning"
  ) {
    return "severity-warning";
  }
  // Informational / "None" / unknown. Empty string is the
  // CSS-class equivalent of "no special styling".
  return "";
}

/* Standardised export pattern for both Node (CommonJS test runner) and
 * the browser (window global). The check is defensive: browser context
 * has no `module`. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { csvCell, clampGaugeValue, severityClass };
}
if (typeof window !== "undefined") {
  window.LiveFormat = { csvCell, clampGaugeValue, severityClass };
}
