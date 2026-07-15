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

const { csvCell, clampGaugeValue } = require("../live_format.js");

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
