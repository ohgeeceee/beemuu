"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("./plugin_capabilities.js");

/* A host that records what was called, so a test can prove an undeclared call
 * never reached vehicle/comms code rather than merely throwing somewhere. */
const host = () => {
  const calls = [];
  return {
    calls,
    readVin() { calls.push("readVin"); return "WBAXX00000TEST123"; },
    readDtc() { calls.push("readDtc"); return []; },
    subscribeLive() { calls.push("subscribeLive"); return () => {}; },
  };
};

test("grantable capabilities validate and come back sorted", () => {
  assert.deepEqual(api.validateCapabilities([]), []);
  assert.deepEqual(api.validateCapabilities(["read-vin"]), ["read-vin"]);
  assert.deepEqual(
    api.validateCapabilities(["live-data", "read-vin"]),
    ["live-data", "read-vin"],
  );
  // Every name in the grantable table must actually validate.
  for (const capability of Object.keys(api.GRANTABLE)) {
    assert.deepEqual(api.validateCapabilities([capability]), [capability]);
  }
});

test("every reserved capability is refused and names its reason", () => {
  const reserved = Object.keys(api.RESERVED);
  assert.ok(reserved.length >= 6, "the reserved table should stay populated");
  for (const capability of reserved) {
    assert.throws(
      () => api.validateCapabilities([capability]),
      error => error.message.includes(capability) && error.message.includes("not grantable"),
      `${capability} must be refused with a reason`,
    );
  }
  // The ECU-writing ones specifically must never become grantable by accident.
  for (const write of ["clear-dtc", "coding-write", "ecu-flash"]) {
    assert.throws(() => api.validateCapabilities([write]), /not grantable/);
  }
});

test("no ECU-write capability is ever grantable", () => {
  for (const capability of Object.keys(api.GRANTABLE)) {
    assert.doesNotMatch(capability, /clear|coding|flash|write/);
  }
  // And the granted surface exposes no method that could write.
  const bridge = api.createBridge(["read-vin", "read-dtc", "live-data"], host());
  for (const method of Object.keys(bridge.surface)) {
    assert.doesNotMatch(method, /clear|write|flash/i);
  }
});

test("malformed, unknown and prototype-derived capabilities are refused", () => {
  for (const bad of ["read-vin", null, undefined, 42, {}, new Set(["read-vin"])]) {
    assert.throws(() => api.validateCapabilities(bad), /must be an array/);
  }
  for (const bad of [[1], [null], [{}], ["read-vin", 2]]) {
    assert.throws(() => api.validateCapabilities(bad), /must be a string/);
  }
  assert.throws(() => api.validateCapabilities(["read-vin", "read-vin"]), /Duplicate capability/);
  assert.throws(() => api.validateCapabilities(["ecu.read"]), /Unknown capability/);
  assert.throws(() => api.validateCapabilities(["READ-VIN"]), /Unknown capability/);
  // Prototype keys must not resolve as known capabilities.
  for (const probe of ["toString", "__proto__", "constructor", "hasOwnProperty", "valueOf"]) {
    assert.throws(() => api.validateCapabilities([probe]), /Unknown capability/);
  }
  const tooMany = Array.from({ length: api.MAX_CAPABILITIES + 1 }, () => "read-vin");
  assert.throws(() => api.validateCapabilities(tooMany), /At most/);
});

test("the bridge exposes exactly the declared calls and nothing else", () => {
  const bridge = api.createBridge(["read-vin"], host());
  assert.deepEqual(bridge.capabilities, ["read-vin"]);
  assert.equal(typeof bridge.surface.readVin, "function");
  assert.equal(bridge.surface.readVin(), "WBAXX00000TEST123");
  // Declared-but-not-granted host methods are absent, and reaching for them throws.
  assert.throws(() => bridge.surface.readDtc(), /without declaring the "read-dtc" capability/);
  assert.throws(() => bridge.surface.subscribeLive(), /without declaring the "live-data" capability/);
});

test("an undeclared call throws before the host function runs", () => {
  const target = host();
  const bridge = api.createBridge(["read-vin"], target);
  assert.throws(() => bridge.surface.readDtc());
  assert.throws(() => bridge.surface.subscribeLive());
  // The whole point: nothing reached the host.
  assert.deepEqual(target.calls, []);
  // A declared call does reach it, exactly once.
  bridge.surface.readVin();
  assert.deepEqual(target.calls, ["readVin"]);
});

test("denied calls are recorded and the record cannot be mutated from outside", () => {
  const bridge = api.createBridge(["read-vin"], host());
  assert.deepEqual(bridge.denials(), []);
  assert.throws(() => bridge.surface.readDtc());
  assert.throws(() => bridge.surface.readDtc());
  assert.throws(() => bridge.surface.subscribeLive());
  const denials = bridge.denials();
  assert.deepEqual(denials, [
    { call: "readDtc", capability: "read-dtc" },
    { call: "readDtc", capability: "read-dtc" },
    { call: "subscribeLive", capability: "live-data" },
  ]);
  // Mutating the returned copy must not affect the bridge's own record.
  denials.push({ call: "forged", capability: "read-vin" });
  denials[0].call = "forged";
  assert.equal(bridge.denials().length, 3);
  assert.equal(bridge.denials()[0].call, "readDtc");
});

test("a host missing a declared method is refused rather than failing at call time", () => {
  assert.throws(() => api.createBridge(["read-dtc"], { readVin() {} }), /does not implement "readDtc"/);
  assert.throws(() => api.createBridge(["read-vin"], { readVin: "not a function" }), /does not implement "readVin"/);
  assert.throws(() => api.createBridge(["read-vin"], null), /host object is required/);
  assert.throws(() => api.createBridge(["read-vin"], "host"), /host object is required/);
  // An empty declaration still needs a host object.
  assert.deepEqual(api.createBridge([], host()).capabilities, []);
});

test("the bridge cannot be mutated by the plugin holding it", () => {
  const bridge = api.createBridge(["read-vin"], host());
  assert.throws(() => { bridge.surface.readDtc = () => "pwned"; }, /may not assign/);
  assert.throws(() => { delete bridge.surface.readVin; }, /may not delete/);
  assert.throws(() => { Object.defineProperty(bridge.surface, "readDtc", { value: () => {} }); }, /may not redefine/);
  // Ordinary object semantics still work, so the bridge does not break
  // stringification or feature detection inside plugin code.
  assert.equal(typeof bridge.surface.toString, "function");
  assert.equal(bridge.surface.then, undefined);
  assert.doesNotThrow(() => JSON.stringify({ has: typeof bridge.surface.readVin }));
});

test("summarize produces readable text for the install preview", () => {
  assert.deepEqual(api.summarize([]), []);
  assert.deepEqual(api.summarize(["read-vin"]), ["Read the vehicle identification number."]);
  assert.equal(api.summarize(["live-data", "read-vin"]).length, 2);
  assert.throws(() => api.summarize(["ecu-flash"]), /not grantable/);
});

test("a sandboxed plugin function cannot reach an undeclared capability", () => {
  /* Mirrors how the runner will hand the surface to plugin code: the plugin
   * receives the guarded object and nothing else. A plugin that tries to read
   * the VIN without declaring it fails, and the host stays untouched. */
  const target = host();
  const bridge = api.createBridge(["read-dtc"], target);
  const plugin = surface => {
    const faults = surface.readDtc();
    let stolen = null;
    try { stolen = surface.readVin(); } catch (error) { stolen = error.message; }
    return { faults, stolen };
  };
  const result = plugin(bridge.surface);
  assert.deepEqual(result.faults, []);
  assert.match(result.stolen, /without declaring the "read-vin" capability/);
  assert.deepEqual(target.calls, ["readDtc"]);
  assert.deepEqual(bridge.denials(), [{ call: "readVin", capability: "read-vin" }]);
});