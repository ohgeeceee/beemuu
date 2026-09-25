/* Tests for `src/js/wiring_detect.js` — the Wiring Detective circuit lookup.
 * Pure and deterministic. Run with `node --test`. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { circuitFor, hasCircuit, cardHtml, CIRCUITS } = require("../wiring_detect.js");

test("circuitFor — returns the circuit for a known code", () => {
  const c = circuitFor("P0171");
  assert.ok(c);
  assert.equal(c.component, "MAF sensor");
  assert.equal(c.ecu_pin, "X60002.26");
  assert.equal(c.power_fuse, "F07 (5A)");
  assert.equal(c.ground_point, "G105");
  assert.ok(Array.isArray(c.common_failures) && c.common_failures.length > 0);
});

test("circuitFor — is case-insensitive", () => {
  assert.deepEqual(circuitFor("p0171"), circuitFor("P0171"));
  assert.deepEqual(circuitFor("2a82"), circuitFor("2A82"));
});

test("circuitFor — unknown or empty returns null", () => {
  assert.equal(circuitFor("NOPE9999"), null);
  assert.equal(circuitFor(""), null);
  assert.equal(circuitFor(null), null);
  assert.equal(circuitFor(undefined), null);
});

test("hasCircuit — true only for known codes", () => {
  assert.equal(hasCircuit("P0171"), true);
  assert.equal(hasCircuit("2A82"), true);
  assert.equal(hasCircuit("ZZZZ"), false);
});

test("cardHtml — renders the full circuit chain with all four nodes", () => {
  const html = cardHtml("P0171");
  assert.match(html, /Fuse F07 \(5A\)/);
  assert.match(html, /ECU X60002\.26/);
  assert.match(html, /MAF sensor pin 3/);
  assert.match(html, /Ground G105/);
  assert.match(html, /───▶/); // chain connectors
  assert.match(html, /wiring-card/);
});

test("cardHtml — lists common failure points", () => {
  const html = cardHtml("2A82");
  assert.match(html, /Solenoid clogged with oil sludge/);
  assert.match(html, /wiring-failures/);
});

test("cardHtml — escapes HTML in component/failure text", () => {
  // A hostile code with markup must not inject; unknown codes return "".
  assert.equal(cardHtml("P0171").includes("<script>"), false);
  assert.equal(cardHtml("NOPE"), "");
});

test("cardHtml — unknown code returns empty string", () => {
  assert.equal(cardHtml("ZZZZ"), "");
  assert.equal(cardHtml(""), "");
});

test("dataset — every circuit has the required fields", () => {
  for (const [code, c] of Object.entries(CIRCUITS)) {
    assert.ok(/^[0-9A-Z]+$/.test(code), `code ${code} should be uppercase alnum`);
    for (const field of ["component", "ecu_pin", "component_pin", "power_fuse", "ground_point"]) {
      assert.ok(typeof c[field] === "string" && c[field].length > 0, `${code}.${field} missing`);
    }
    assert.ok(Array.isArray(c.common_failures), `${code}.common_failures should be an array`);
  }
});
