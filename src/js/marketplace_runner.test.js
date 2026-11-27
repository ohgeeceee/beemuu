"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const runner = require("./marketplace_runner.js");

test("grantsFor grants reads, iframe-local ui and download-only filesystem", () => {
  const { granted, refused } = runner.grantsFor(["read-vin", "read-dtc", "live-data", "ui", "filesystem"]);
  assert.deepEqual(granted.sort(), ["filesystem", "live-data", "read-dtc", "read-vin", "ui"]);
  assert.deepEqual(refused, []);
});

test("grantsFor refuses writes, network and unknown names, with reasons", () => {
  const { granted, refused } = runner.grantsFor(["clear-dtc", "coding-write", "ecu-flash", "network", "teleport"]);
  assert.deepEqual(granted, []);
  const byCap = new Map(refused.map(r => [r.capability, r.reason]));
  assert.equal(byCap.size, 5);
  assert.match(byCap.get("clear-dtc"), /writes to an ECU/);
  assert.match(byCap.get("coding-write"), /writes to an ECU/);
  assert.match(byCap.get("ecu-flash"), /not grantable/);
  assert.match(byCap.get("network"), /no network access/);
  assert.equal(byCap.get("teleport"), "unknown capability");
});

test("harness document is a locked-down sandbox: no network, no same-origin, downloads only", () => {
  const html = runner.harnessHtml();
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /allow-same-origin/);
  assert.doesNotMatch(html, /fetch\(/);
});

test("harness builds context only from granted capabilities", () => {
  const script = runner.harnessScript();
  for (const capability of ["read-vin", "read-dtc", "live-data", "ui", "filesystem"]) {
    assert.match(html_source_check(capability), /granted\.includes/);
  }
  // The subscribeLive shim accepts the marketplace (pids, cb) shape.
  assert.match(script, /subscribeLive = \(pids, cb\)/);
  // deactivate is called on shutdown, guarded.
  assert.match(script, /plugin\.deactivate/);
});
function html_source_check(capability) {
  const script = runner.harnessScript();
  const needle = `granted.includes("${capability}")`;
  assert.ok(script.includes(needle), `harness must gate ${capability}`);
  return needle;
}

test("startPlugin requires the capability bridge and a host; app code stays text-only", () => {
  assert.throws(() => runner.startPlugin({ container: null, entry: { manifest: { capabilities: [] } }, host: null }), /plugin_capabilities/);
  const ui = fs.readFileSync(path.join(__dirname, "marketplace_ui.js"), "utf8");
  assert.doesNotMatch(ui, /innerHTML|allow-same-origin/);
  assert.match(ui, /setAttribute\("sandbox", "allow-scripts allow-downloads"\)|startPlugin/);
});
