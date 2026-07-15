/* Tests for `src/js/live_format.js` — pure helpers used by the gauge
 * canvas and the CSV exporter. Run with `npm run test:js` (which calls
 * `node --test src/js/test/*.test.cjs`). The tests run under the Node
 * test runner; the helpers themselves load via CommonJS so we avoid
 * touching `package.json`'s "type" field (which would break the
 * browser's <script> tag loading).
 *
 * Adding a new rule: write a failing test here first, then make it pass
 * in live_format.js, then update the production call sites in main.js
 * and gauges.js. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { csvCell, clampGaugeValue, severityClass } = require("../live_format.js");

test("csvCell — numeric point emits two-decimal string", () => {
  assert.equal(csvCell({ x: 0, y: 3.14159 }), "3.14");
  assert.equal(csvCell({ x: 0, y: -0.005 }), "-0.01");
  assert.equal(csvCell({ x: 0, y: 0 }), "0.00");
  assert.equal(csvCell({ x: 0, y: 1e6 }), "1000000.00");
});

test("csvCell — enum text is JSON-quoted", () => {
  assert.equal(csvCell({ x: 0, y: 0, text: "3" }), '"3"');
  assert.equal(csvCell({ x: 0, y: 0, text: "P/N" }), '"P/N"');
  // The label "Crank, Slosh" has a comma — JSON.stringify round-trips
  // it through CSV without splitting the cell.
  assert.equal(csvCell({ x: 0, y: 0, text: "Crank, Slosh" }), '"Crank, Slosh"');
});

test("csvCell — enum text takes precedence over y", () => {
  // Even when y has a numeric value, an enum param should be exported
  // as its label so the CSV is human-readable rather than a column of
  // 0.00s. This was the bug fixed by PR #64.
  assert.equal(csvCell({ x: 0, y: 0, text: "Running" }), '"Running"');
});

test("csvCell — missing point is empty cell, not NaN", () => {
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell({}), "");
  // {x, y} with no text and y=null should also be empty (distinct from y=0)
  assert.equal(csvCell({ x: 0, y: null }), "");
});

test("csvCell — text: '' (empty string) still emits quoted empty CSV cell", () => {
  // An enum param that resolves to "" is distinct from missing. We
  // string-coerce so the row stays aligned with the others.
  assert.equal(csvCell({ x: 0, y: 0, text: "" }), '""');
});

test("clampGaugeValue — clamps to [min, max]", () => {
  assert.equal(clampGaugeValue(5, 0, 10), 5);
  assert.equal(clampGaugeValue(-1, 0, 10), 0);
  assert.equal(clampGaugeValue(11, 0, 10), 10);
});

test("clampGaugeValue — equal bounds collapse the range", () => {
  assert.equal(clampGaugeValue(5, 3, 3), 3);
});

test("clampGaugeValue — NaN propagates", () => {
  // NaN behavior is a property of Math.min/max on NaN inputs, not our
  // helper. Documenting it so a future change doesn't silently flip it.
  assert.ok(Number.isNaN(clampGaugeValue(NaN, 0, 10)));
});

// ---- severityClass (v0.5.0 PR #3) -----------------------------------
//
// Maps an enum-style label to a CSS class for severity styling. Used
// by the gauge canvas (different fillStyle) and the Logging-tab
// channel display (class on the label span) when a LiveValue.text is
// severity-bearing.

test("severityClass — null / undefined / empty returns empty class", () => {
  assert.equal(severityClass(null), "");
  assert.equal(severityClass(undefined), "");
  assert.equal(severityClass(""), "");
  // Non-string input should also be safe (defensive: caller may pass
  // a number or object by mistake).
  assert.equal(severityClass(0), "");
  assert.equal(severityClass({}), "");
});

test("severityClass — informational labels return empty class", () => {
  // The "None" state from knock_detect (DID 401F) must NOT trigger
  // severity styling. Same for the gear-position labels, the engine-
  // state labels, and any other non-severity enum.
  assert.equal(severityClass("None"), "");
  assert.equal(severityClass("P/N"), "");
  assert.equal(severityClass("Off"), "");
  assert.equal(severityClass("Cranking"), "");
  assert.equal(severityClass("Running"), "");
  assert.equal(severityClass("Idle"), "");
  assert.equal(severityClass("Overrun"), "");
  assert.equal(severityClass("Shutdown"), "");
  assert.equal(severityClass("Error"), ""); // EGS sentinel — not severity
});

test("severityClass — critical keywords return severity-critical", () => {
  assert.equal(severityClass("Severe"), "severity-critical");
  assert.equal(severityClass("severe"), "severity-critical");
  assert.equal(severityClass("SEVERE"), "severity-critical");
  assert.equal(severityClass("Critical"), "severity-critical");
  assert.equal(severityClass("Fault"), "severity-critical");
});

test("severityClass — warning keywords return severity-warning", () => {
  assert.equal(severityClass("Light"), "severity-warning");
  assert.equal(severityClass("Moderate"), "severity-warning");
  assert.equal(severityClass("Warning"), "severity-warning");
  assert.equal(severityClass("light"), "severity-warning");
  assert.equal(severityClass("MODERATE"), "severity-warning");
});

test("severityClass — exact match only, not substring", () => {
  // Deliberate behaviour: "none of the above" must NOT count as
  // "None". Future severity-bearing enums must be added to the
  // keyword lists explicitly.
  assert.equal(severityClass("none of the above"), "");
  assert.equal(severityClass("Lightly loaded"), "");
  assert.equal(severityClass("Warning: low oil"), ""); // substring, not exact
  assert.equal(severityClass("Critical fault code"), "");
});

test("severityClass — unknown enum label returns empty class", () => {
  // A future contributor adds a new enum (say, "TBD" or "Reserved")
  // and doesn't update the keyword lists. The class falls back to
  // empty — no severity styling, but no crash either.
  assert.equal(severityClass("TBD"), "");
  assert.equal(severityClass("Reserved"), "");
  assert.equal(severityClass("0xFF"), "");
});
