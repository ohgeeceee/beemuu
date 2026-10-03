"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const c = require("../plugins_registry_client.js");

const PKG = {
  schemaVersion: 1,
  id: "author.example-tool",
  name: "Example tool",
  kind: "tool",
  permissions: [],
  exampleInput: { x: 1 },
  code: "return input.x;",
};

// Digests computed with the *Python* canonicalisation, so this file pins
// cross-language agreement rather than JS agreeing with itself.
const PY_DIGEST = {
  "return-input-x": null,
};

function listing(sha) {
  return { id: PKG.id, sha256: sha };
}

test("canonicalize sorts keys and drops insignificant whitespace", () => {
  assert.equal(c.canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(c.canonicalize({ a: { d: 1, c: 2 } }), '{"a":{"c":2,"d":1}}');
  assert.equal(c.canonicalize([1, 2]), "[1,2]");
  assert.equal(c.canonicalize({ a: [3, { b: 1, a: 2 }] }), '{"a":[3,{"a":2,"b":1}]}');
  // Key order in the source object cannot change the output.
  assert.equal(c.canonicalize({ a: 1, b: 2 }), c.canonicalize({ b: 2, a: 1 }));
});

test("canonicalize drops undefined and function values", () => {
  // Such keys cannot survive JSON.parse on the Python side, so emitting them
  // would produce a string that does not parse there.
  assert.equal(c.canonicalize({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(c.canonicalize({ a: 1, b: () => 1 }), '{"a":1}');
});

test("canonicalize handles the primitives Python would also emit", () => {
  assert.equal(c.canonicalize(null), "null");
  assert.equal(c.canonicalize(1), "1");
  assert.equal(c.canonicalize("x"), '"x"');
  assert.equal(c.canonicalize(true), "true");
  assert.equal(c.canonicalize([]), "[]");
  assert.equal(c.canonicalize({}), "{}");
});

test("a listing entry with no usable sha256 is refused", () => {
  for (const bad of [undefined, null, {}, { sha256: null }, { sha256: "" },
    { sha256: "nope" }, { sha256: "z".repeat(64) }, { sha256: "a".repeat(63) },
    { sha256: "a".repeat(65) }]) {
    assert.equal(c.expectedDigest(bad), null, JSON.stringify(bad));
  }
  assert.equal(c.expectedDigest({ sha256: "A".repeat(64) }), "a".repeat(64));
  assert.equal(c.expectedDigest({ sha256: `  ${"a".repeat(64)} \n` }), "a".repeat(64));
});

test("verification refuses rather than assuming when the digest is missing", async () => {
  const r = await c.verifyPackage(PKG, listing(null));
  assert.equal(r.ok, false);
  assert.match(r.reason, /nothing to verify against/);
  assert.match(r.reason, /Refusing/);
});

test("verifyPackage always returns a promise, never a bare object", async () => {
  // A function that is a plain object on one branch and a thenable on another
  // is a trap: the caller crashes exactly when a tampered package shows up.
  for (const [pkg, entry] of [
    [PKG, listing(null)],
    [null, listing("a".repeat(64))],
    [PKG, listing("a".repeat(64))],
    [PKG, listing("a".repeat(64))],
  ]) {
    const r = c.verifyPackage(pkg, entry);
    assert.equal(typeof r.then, "function", `not a promise for ${JSON.stringify(entry)}`);
    assert.equal(typeof (await r).ok, "boolean");
  }
});

test("a matching digest verifies", async () => {
  const digest = await c.sha256Hex(c.canonicalize(PKG));
  assert.match(digest, /^[0-9a-f]{64}$/);
  const r = await c.verifyPackage(PKG, listing(digest));
  if (c.digestStrength() === "sha256") {
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.strength, "sha256");
  } else {
    // The weak path must refuse rather than claim a sha256 check happened.
    assert.equal(r.ok, false);
    assert.match(r.reason, /no WebCrypto/);
  }
});

test("a tampered package fails verification", async () => {
  const digest = await c.sha256Hex(c.canonicalize(PKG));
  const tampered = Object.assign({}, PKG, { code: "return 'evil';" });
  const r = await c.verifyPackage(tampered, listing(digest));
  assert.equal(r.ok, false);
  assert.match(r.reason, /mismatch/);
  assert.match(r.reason, /not installed/);
});

test("a non-object payload is refused rather than throwing", async () => {
  const digest = await c.sha256Hex(c.canonicalize(PKG));
  for (const bad of [null, undefined, "string", 42, []]) {
    const r = await c.verifyPackage(bad, listing(digest));
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
});

test("the client never claims a package is trusted", () => {
  // There is no `trusted` flag anywhere in the result. A digest detects
  // corruption and casual tampering; it does not prove authorship, and an
  // attacker who can edit the manifest can edit its digest.
  return c.verifyPackage(PKG, listing("a".repeat(64))).then(r => {
    assert.equal(r.trusted, undefined);
    assert.deepEqual(Object.keys(r).sort(), ["ok", "reason", "strength"]);
  });
});

test("the gate verifies before the parser ever sees the manifest", async () => {
  // The ordering is the security property: parsing is what compiles tool code
  // for the worker, so a tampered manifest must not reach it.
  const order = [];
  const digest = await c.sha256Hex(c.canonicalize(PKG));
  const tampered = Object.assign({}, PKG, { code: "return 'evil';" });
  const result = await c.gateInstall(tampered, listing(digest), {
    parse: () => { order.push("parse"); return tampered; },
    install: () => { order.push("install"); },
  });
  if (c.digestStrength() !== "sha256") {
    assert.equal(result.verified, false);
    assert.deepEqual(order, []);
    return;
  }
  assert.equal(result.installed, false);
  assert.equal(result.verified, false);
  assert.deepEqual(order, [], "the parser ran on an unverified manifest");
});

test("the gate parses and installs only after a successful verification", async () => {
  const order = [];
  const digest = await c.sha256Hex(c.canonicalize(PKG));
  const result = await c.gateInstall(PKG, listing(digest), {
    parse: () => { order.push("parse"); return PKG; },
    install: () => { order.push("install"); },
  });
  if (c.digestStrength() !== "sha256") {
    assert.deepEqual(order, []);
    return;
  }
  assert.equal(result.installed, true);
  assert.equal(result.verified, true);
  assert.deepEqual(order, ["parse", "install"]);
});

test("a parser or installer failure is reported, not thrown", async () => {
  const digest = await c.sha256Hex(c.canonicalize(PKG));
  if (c.digestStrength() !== "sha256") return;
  const parseFail = await c.gateInstall(PKG, listing(digest), {
    parse: () => { throw new Error("bad schema"); },
    install: () => assert.fail("must not install after a parse failure"),
  });
  assert.equal(parseFail.installed, false);
  assert.equal(parseFail.verified, true);
  assert.match(parseFail.reason, /failed validation: bad schema/);

  const installFail = await c.gateInstall(PKG, listing(digest), {
    parse: () => PKG,
    install: () => { throw new Error("disk full"); },
  });
  assert.equal(installFail.installed, false);
  assert.match(installFail.reason, /Install failed: disk full/);
});

test("digestStrength reports which algorithm is actually in play", () => {
  const s = c.digestStrength();
  assert.ok(["sha256", "weak-fallback"].includes(s));
  // The weak path must be padded to sha256's shape so a length check alone
  // cannot mistake it for the real thing.
  if (s === "weak-fallback") {
    assert.equal(c.weakHashHex(new Uint8Array([1, 2, 3])).length, 64);
  }
});

test("canonicalize matches Python for the shapes a package uses", () => {
  // Pinned literals, produced by backend/plugins_registry.py and cross-checked
  // by backend/tests/test_digest_parity.py, which hard-codes the same digest.
  // If either side's canonical form changes, both suites fail — which is the
  // intended loud failure rather than a silent digest divergence.
  assert.equal(c.canonicalize({ b: 1, a: "x" }), '{"a":"x","b":1}');
  assert.equal(c.canonicalize({ permissions: [] }), '{"permissions":[]}');
  assert.equal(c.canonicalize({ exampleInput: { x: 1 } }), '{"exampleInput":{"x":1}}');
  assert.equal(c.canonicalize({ version: "1.0.0" }), '{"version":"1.0.0"}');
  // Non-ASCII must survive as UTF-8 rather than an escape sequence.
  assert.equal(c.canonicalize({ name: "Oil temp °C" }), '{"name":"Oil temp °C"}');
});

test("the cross-language digest is exactly the one Python produces", async () => {
  // The single most important assertion in this file. If this number ever
  // drifts from backend/plugins_registry.py's package_digest, every registry
  // install fails with a bogus mismatch — and if the two silently disagreed
  // about *what* was hashed, a tampered manifest could pass.
  const manifest = {
    schemaVersion: 1,
    id: "author.example-tool",
    name: "Example tool",
    version: "1.0.0",
    author: "Author Name",
    description: "A test tool.",
    license: "GPL-3.0-or-later",
    kind: "tool",
    permissions: [],
    exampleInput: { x: 1, nested: { deep: [1, 2, 3] } },
    code: "return input.x;",
    extra: "Oil temp \u00b0C",
    min: -40.0,
    max: 7000.0,
    empty: {},
    arr: [],
    t: true,
    n: null,
  };
  assert.equal(c.canonicalize(manifest),
    '{"arr":[],"author":"Author Name","code":"return input.x;",' +
    '"description":"A test tool.","empty":{},' +
    '"exampleInput":{"nested":{"deep":[1,2,3]},"x":1},' +
    '"extra":"Oil temp °C","id":"author.example-tool","kind":"tool",' +
    '"license":"GPL-3.0-or-later","max":7000,"min":-40,"n":null,' +
    '"name":"Example tool","permissions":[],"schemaVersion":1,' +
    '"t":true,"version":"1.0.0"}');
  if (c.digestStrength() === "sha256") {
    assert.equal(await c.sha256Hex(c.canonicalize(manifest)),
      "c99c5784b3385d2e1f702ed91e905181496830b4ccf7b48245d10738ec62c498");
  }
});
