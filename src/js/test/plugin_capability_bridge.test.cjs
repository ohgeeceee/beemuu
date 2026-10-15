"use strict";

/*
 * plugin_bridge.test.cjs — the v5.0.0 capability bridge.
 *
 * The bridge is a security boundary, so these tests are written the way the
 * boundary is built: a well-formed request is granted, and everything else —
 * an unknown name, a write, a forged evaluation, a missing host function, a
 * junk manifest — comes back refused. The factories below keep each case to
 * the one thing it is pinning.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const bridge = require("../plugin_capability_bridge.js");

/* A minimal well-formed manifest, with overrides for the case under test. */
function manifest(overrides) {
  return Object.assign(
    { id: "com.example.dash", version: "1.0.0", capabilities: ["read-vin"] },
    overrides,
  );
}

/* A fake host: only the functions a case injects exist, everything else is
 * undefined so the runner has to fail closed. */
function host(overrides) {
  return Object.assign({}, overrides);
}

/* ------------------------------------------------------------------ *
 * validateManifest
 * ------------------------------------------------------------------ */

test("validateManifest accepts a well-formed manifest and returns a copy", () => {
  const input = manifest();
  const result = bridge.validateManifest(input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.manifest, {
    id: "com.example.dash",
    version: "1.0.0",
    capabilities: ["read-vin"],
  });
  assert.notEqual(result.manifest, input);
  assert.notEqual(result.manifest.capabilities, input.capabilities);
});

test("validateManifest never returns a partially-filled manifest on failure", () => {
  const result = bridge.validateManifest({ capabilities: ["read-vin"] });
  assert.equal(result.ok, false);
  assert.equal(result.manifest, null);
  assert.ok(result.errors.length >= 1);
});

test("validateManifest rejects anything that is not a plain object", () => {
  for (const junk of [null, undefined, 42, "manifest", true, [], () => {}, new Date()]) {
    const result = bridge.validateManifest(junk);
    assert.equal(result.ok, false, `expected ${String(junk)} to be rejected`);
    assert.equal(result.manifest, null);
  }
});

test("validateManifest rejects a missing or blank id and version", () => {
  const noId = bridge.validateManifest({ version: "1.0.0", capabilities: [] });
  assert.equal(noId.ok, false);
  assert.ok(noId.errors.join(" ").includes("id"));
  const noVersion = bridge.validateManifest({ id: "com.example.dash", capabilities: [] });
  assert.equal(noVersion.ok, false);
  assert.ok(noVersion.errors.join(" ").includes("version"));
  assert.equal(bridge.validateManifest({ id: "  ", version: "1.0.0", capabilities: [] }).ok, false);
  assert.equal(bridge.validateManifest({ id: "com.example.dash", version: "", capabilities: [] }).ok, false);
});

test("validateManifest rejects a capability list that is not an array", () => {
  const result = bridge.validateManifest(manifest({ capabilities: "read-vin" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.join(" ").includes("array"));
});

test("validateManifest rejects a non-string capability", () => {
  for (const bad of [[123], [null], ["read-vin", {}], ["read-vin", ""]]) {
    assert.equal(bridge.validateManifest(manifest({ capabilities: bad })).ok, false);
  }
});

test("validateManifest rejects a __proto__ key without polluting Object.prototype", () => {
  const evil = JSON.parse(
    '{"id":"com.example.dash","version":"1.0.0","capabilities":["read-vin"],"__proto__":{"polluted":true}}',
  );
  const result = bridge.validateManifest(evil);
  assert.equal(result.ok, false);
  assert.ok(result.errors.join(" ").includes("__proto__"));
  assert.equal({}.polluted, undefined);

  const viaConstructor = bridge.validateManifest(
    Object.assign(manifest(), { constructor: { polluted: true } }),
  );
  assert.equal(viaConstructor.ok, false);
  assert.ok(viaConstructor.errors.join(" ").includes("constructor"));
  const viaPrototype = bridge.validateManifest(Object.assign(manifest(), { prototype: {} }));
  assert.equal(viaPrototype.ok, false);
  assert.ok(viaPrototype.errors.join(" ").includes("prototype"));
});

/* ------------------------------------------------------------------ *
 * classifyCapability
 * ------------------------------------------------------------------ */

test("classifyCapability classifies the read set", () => {
  assert.equal(bridge.classifyCapability("read-vin"), "read");
  assert.equal(bridge.classifyCapability("read-dtc"), "read");
  assert.equal(bridge.classifyCapability("subscribe-live"), "read");
});

test("classifyCapability classifies the write set", () => {
  for (const name of bridge.WRITE_CAPABILITIES) {
    assert.equal(bridge.classifyCapability(name), "write");
  }
});

test("classifyCapability returns unknown for unrecognised names", () => {
  assert.equal(bridge.classifyCapability("read-everything"), "unknown");
  assert.equal(bridge.classifyCapability(""), "unknown");
});

test("classifyCapability returns unknown for non-strings and inherited names", () => {
  assert.equal(bridge.classifyCapability(42), "unknown");
  assert.equal(bridge.classifyCapability(null), "unknown");
  assert.equal(bridge.classifyCapability(undefined), "unknown");
  assert.equal(bridge.classifyCapability("constructor"), "unknown");
  assert.equal(bridge.classifyCapability("toString"), "unknown");
  assert.equal(bridge.classifyCapability("__proto__"), "unknown");
});

/* ------------------------------------------------------------------ *
 * evaluateGrants
 * ------------------------------------------------------------------ */

test("evaluateGrants grants every declared read capability and echoes the request", () => {
  const result = bridge.evaluateGrants(manifest({ capabilities: ["read-vin", "read-dtc"] }));
  assert.deepEqual(result.granted, ["read-vin", "read-dtc"]);
  assert.deepEqual(result.refused, []);
  assert.deepEqual(result.requested, ["read-vin", "read-dtc"]);
});

test("evaluateGrants refuses an unknown declared capability", () => {
  const result = bridge.evaluateGrants(manifest({ capabilities: ["read-everything"] }));
  assert.deepEqual(result.granted, []);
  assert.deepEqual(result.refused, [{ capability: "read-everything", reason: "unknown_capability" }]);
});

test("evaluateGrants refuses a declared write capability as not_permitted", () => {
  for (const name of bridge.WRITE_CAPABILITIES) {
    const result = bridge.evaluateGrants(manifest({ capabilities: [name] }));
    assert.deepEqual(result.granted, []);
    assert.deepEqual(result.refused, [{ capability: name, reason: "not_permitted" }]);
  }
});

test("evaluateGrants never grants a write, whatever the options", () => {
  const options = { denied: [], policy: { allow: ["ecu-write", "read-vin"] } };
  const result = bridge.evaluateGrants(manifest({ capabilities: ["ecu-write", "read-vin"] }), options);
  assert.deepEqual(result.granted, ["read-vin"]);
  assert.deepEqual(result.refused, [{ capability: "ecu-write", reason: "not_permitted" }]);
});

test("evaluateGrants refuses a capability the manifest never declared", () => {
  const result = bridge.evaluateGrants(manifest({ capabilities: ["read-vin"] }), {
    requested: ["read-vin", "read-dtc"],
  });
  assert.deepEqual(result.granted, ["read-vin"]);
  assert.deepEqual(result.refused, [{ capability: "read-dtc", reason: "not_declared" }]);
});

test("evaluateGrants honours the user's consent refusal", () => {
  const result = bridge.evaluateGrants(manifest({ capabilities: ["read-vin", "read-dtc"] }), {
    denied: ["read-dtc"],
  });
  assert.deepEqual(result.granted, ["read-vin"]);
  assert.deepEqual(result.refused, [{ capability: "read-dtc", reason: "denied_by_user" }]);
});

test("evaluateGrants honours an explicit policy", () => {
  const deny = bridge.evaluateGrants(manifest({ capabilities: ["read-vin", "read-dtc"] }), {
    policy: { deny: ["read-dtc"] },
  });
  assert.deepEqual(deny.refused, [{ capability: "read-dtc", reason: "denied_by_policy" }]);
  const allow = bridge.evaluateGrants(manifest({ capabilities: ["read-vin", "read-dtc"] }), {
    policy: { allow: ["read-vin"] },
  });
  assert.deepEqual(allow.granted, ["read-vin"]);
  assert.deepEqual(allow.refused, [{ capability: "read-dtc", reason: "denied_by_policy" }]);
});

test("evaluateGrants reports an invalid manifest with nothing granted", () => {
  const result = bridge.evaluateGrants(null);
  assert.deepEqual(result.granted, []);
  assert.deepEqual(result.refused, []);
  assert.equal(result.valid, false);
});

/* ------------------------------------------------------------------ *
 * consentPrompt
 * ------------------------------------------------------------------ */

test("consentPrompt emits one line per capability", () => {
  const request = manifest({ capabilities: ["read-vin", "read-dtc", "subscribe-live"] });
  const prompt = bridge.consentPrompt(request, bridge.evaluateGrants(request));
  assert.equal(prompt.lines.length, prompt.capabilities.length);
  assert.equal(prompt.lines.length, 3);
  assert.deepEqual(prompt.capabilities, ["read-vin", "read-dtc", "subscribe-live"]);
  assert.equal(prompt.plugin_id, "com.example.dash");
});

test("consentPrompt text carries no HTML tags", () => {
  const request = manifest({ capabilities: ["read-vin", "ecu-write", "read-everything"] });
  const prompt = bridge.consentPrompt(request, bridge.evaluateGrants(request));
  for (const line of prompt.lines) {
    assert.equal(/<\s*[a-z!/]/i.test(line), false, `line looks like markup: ${line}`);
    assert.equal(line.includes("<"), false);
  }
  assert.equal(JSON.stringify(prompt).includes("<"), false);
});

test("consentPrompt marks an all-read request read-only", () => {
  const request = manifest({ capabilities: ["read-vin", "subscribe-live"] });
  const prompt = bridge.consentPrompt(request, bridge.evaluateGrants(request));
  assert.equal(prompt.risk, "read-only");
  assert.ok(prompt.lines.every((line) => line.includes("allowed")));
});

test("consentPrompt marks a write request refused", () => {
  const request = manifest({ capabilities: ["read-vin", "flash-ecu"] });
  const prompt = bridge.consentPrompt(request, bridge.evaluateGrants(request));
  assert.equal(prompt.risk, "refused");
  const line = prompt.lines.find((l) => l.includes("flash an ECU"));
  assert.ok(line && line.includes("refused"));
});

test("consentPrompt marks a non-write refusal elevated", () => {
  const request = manifest({ capabilities: ["read-vin", "read-everything"] });
  const prompt = bridge.consentPrompt(request, bridge.evaluateGrants(request));
  assert.equal(prompt.risk, "elevated");
});

test("consentPrompt is pure data that survives a JSON round-trip", () => {
  const request = manifest({ capabilities: ["read-vin", "ecu-write"] });
  const prompt = bridge.consentPrompt(request, bridge.evaluateGrants(request));
  assert.deepEqual(JSON.parse(JSON.stringify(prompt)), prompt);
  assert.deepEqual(Object.keys(prompt).sort(), ["capabilities", "lines", "plugin_id", "risk", "title"]);
});

/* ------------------------------------------------------------------ *
 * createRunner
 * ------------------------------------------------------------------ */

test("createRunner runs a granted read-vin and returns the host result", () => {
  const request = manifest({ capabilities: ["read-vin"] });
  const runner = bridge.createRunner(request, bridge.evaluateGrants(request), host({
    "read-vin": () => ({ vin: "WBA5A5C50ED512345" }),
  }));
  assert.deepEqual(runner.run("read-vin"), {
    ok: true,
    capability: "read-vin",
    result: { vin: "WBA5A5C50ED512345" },
  });
});

test("createRunner runs a granted read-dtc and returns the host result", () => {
  const request = manifest({ capabilities: ["read-dtc"] });
  const runner = bridge.createRunner(request, bridge.evaluateGrants(request), host({
    "read-dtc": () => [{ code: "P0300", status: "stored" }],
  }));
  assert.deepEqual(runner.run({ capability: "read-dtc" }), {
    ok: true,
    capability: "read-dtc",
    result: [{ code: "P0300", status: "stored" }],
  });
});

test("createRunner runs subscribe-live with the args it was handed", () => {
  const request = manifest({ capabilities: ["subscribe-live"] });
  const seen = [];
  const runner = bridge.createRunner(request, bridge.evaluateGrants(request), host({
    "subscribe-live": (args) => {
      seen.push(args);
      return { token: "sub-1" };
    },
  }));
  assert.deepEqual(runner.run({ capability: "subscribe-live", args: ["rpm", "coolant"] }), {
    ok: true,
    capability: "subscribe-live",
    result: { token: "sub-1" },
  });
  assert.deepEqual(seen, [["rpm", "coolant"]]);
});

test("createRunner fails closed when the host function was not injected", () => {
  const request = manifest({ capabilities: ["read-vin"] });
  const runner = bridge.createRunner(request, bridge.evaluateGrants(request), host());
  assert.deepEqual(runner.run("read-vin"), { ok: false, reason: "host_unavailable" });
  const noHost = bridge.createRunner(request, bridge.evaluateGrants(request), null);
  assert.deepEqual(noHost.run("read-vin"), { ok: false, reason: "host_unavailable" });
});

test("createRunner refuses a capability the manifest never declared", () => {
  const request = manifest({ capabilities: ["read-vin"] });
  const runner = bridge.createRunner(request, bridge.evaluateGrants(request), host({
    "read-dtc": () => "should never run",
  }));
  assert.deepEqual(runner.run("read-dtc"), { ok: false, reason: "not_granted" });
});

test("createRunner cannot be forged into a write path", () => {
  const request = manifest({ capabilities: ["read-vin"] });
  const forged = {
    granted: ["ecu-write", "read-vin"],
    refused: [],
    requested: ["ecu-write", "read-vin"],
  };
  const runner = bridge.createRunner(request, forged, host({
    "ecu-write": () => "flashed",
    "read-vin": () => ({ vin: "WBA5A5C50ED512345" }),
  }));
  assert.deepEqual(runner.run("ecu-write"), { ok: false, reason: "not_granted" });
  assert.deepEqual(runner.granted, ["read-vin"]);
});

test("createRunner re-checks the grant instead of trusting the evaluation", () => {
  const request = manifest({ capabilities: ["read-vin"] });
  const forged = { granted: ["read-dtc"], refused: [] };
  const runner = bridge.createRunner(request, forged, host({ "read-dtc": () => "leaked" }));
  assert.deepEqual(runner.run("read-dtc"), { ok: false, reason: "not_granted" });
});

test("createRunner refuses a capability the consent declined at run time", () => {
  const request = manifest({ capabilities: ["read-vin", "read-dtc"] });
  const evaluation = bridge.evaluateGrants(request, { denied: ["read-dtc"] });
  const runner = bridge.createRunner(request, evaluation, host({
    "read-vin": () => ({ vin: "WBA5A5C50ED512345" }),
    "read-dtc": () => [{ code: "P0300" }],
  }));
  assert.deepEqual(runner.run("read-dtc"), { ok: false, reason: "not_granted" });
  assert.equal(runner.run("read-vin").ok, true);
});

test("createRunner refuses a malformed intent", () => {
  const request = manifest({ capabilities: ["read-vin"] });
  const runner = bridge.createRunner(request, bridge.evaluateGrants(request), host({
    "read-vin": () => ({ vin: "WBA5A5C50ED512345" }),
  }));
  for (const bad of [null, undefined, 42, true, [], {}]) {
    assert.deepEqual(runner.run(bad), { ok: false, reason: "not_granted" });
  }
});

/* ------------------------------------------------------------------ *
 * auditLines
 * ------------------------------------------------------------------ */

test("auditLines emits exactly one line per grant, refusal or run attempt", () => {
  const events = [
    { type: "grant", capability: "read-vin" },
    { type: "refuse", capability: "ecu-write", reason: "not_permitted" },
    { type: "refuse", capability: "read-everything", reason: "unknown_capability" },
    { type: "run", capability: "read-dtc", ok: true },
    { type: "run", capability: "read-dtc", ok: false, reason: "host_unavailable" },
  ];
  const lines = bridge.auditLines(events);
  assert.equal(lines.length, events.length);
});

test("auditLines is deterministic whatever the input order", () => {
  const events = [
    { type: "grant", capability: "read-vin" },
    { type: "refuse", capability: "ecu-write", reason: "not_permitted" },
    { type: "run", capability: "read-dtc", ok: true },
  ];
  const forward = bridge.auditLines(events);
  assert.deepEqual(bridge.auditLines(events), forward);
  assert.deepEqual(bridge.auditLines(events.slice().reverse()), forward);
  assert.deepEqual(forward.slice().sort(), forward);
});

test("auditLines qualifies the capability class and the outcome", () => {
  const lines = bridge.auditLines([
    { type: "refuse", capability: "flash-ecu", reason: "not_permitted" },
    { type: "grant", capability: "read-vin" },
    { type: "run", capability: "read-dtc", ok: false, reason: "host_unavailable" },
  ]);
  const refusal = lines.find((l) => l.startsWith("refuse flash-ecu"));
  assert.ok(refusal.includes("vehicle write"));
  assert.ok(refusal.includes("never grants vehicle writes"));
  const grant = lines.find((l) => l.startsWith("grant read-vin"));
  assert.ok(grant.includes("read-only"));
  const run = lines.find((l) => l.startsWith("run read-dtc"));
  assert.ok(run.includes("host function unavailable"));
});

test("auditLines tolerates junk", () => {
  assert.deepEqual(bridge.auditLines(null), []);
  assert.deepEqual(bridge.auditLines({}), []);
  assert.deepEqual(bridge.auditLines([null, 5, "grant", {}]), []);
});

/* ------------------------------------------------------------------ *
 * the exported tables
 * ------------------------------------------------------------------ */

test("READ_CAPABILITIES is exactly the three wired read capabilities", () => {
  assert.deepEqual(bridge.READ_CAPABILITIES.slice().sort(), ["read-dtc", "read-vin", "subscribe-live"]);
});

test("KNOWN_CAPABILITIES includes the read set and the write set", () => {
  assert.ok(bridge.WRITE_CAPABILITIES.length > 0);
  for (const name of bridge.WRITE_CAPABILITIES) {
    assert.equal(bridge.READ_CAPABILITIES.includes(name), false);
    assert.equal(bridge.has(bridge.KNOWN_CAPABILITIES, name), true);
    assert.equal(bridge.KNOWN_CAPABILITIES[name].kind, "write");
  }
  for (const name of bridge.READ_CAPABILITIES) {
    assert.equal(bridge.has(bridge.KNOWN_CAPABILITIES, name), true);
    assert.equal(bridge.KNOWN_CAPABILITIES[name].kind, "read");
  }
  for (const name of bridge.WRITE_CAPABILITIES) {
    assert.equal(bridge.has(bridge.KNOWN_CAPABILITIES, name), true);
    assert.equal(bridge.KNOWN_CAPABILITIES[name].kind, "write");
  }
});
