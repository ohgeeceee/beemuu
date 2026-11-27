"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("./marketplace_registry.js");

const entry = (patch = {}) => ({
  id: "dtc-explainer",
  name: "DTC Explainer",
  version: "1.0.0",
  author: "ohgeeceee",
  official: true,
  description: "Plain-English explanations of BMW fault codes.",
  category: "diagnostics",
  tags: ["dtc", "help"],
  homepage: "https://example.com/plugin",
  download: {
    url: "https://example.com/dtc-explainer-1.0.0.zip",
    sha256: "a".repeat(64),
    sizeBytes: 6191,
  },
  minAppVersion: "2.2.0",
  license: "GPL-3.0-only",
  capabilities: ["read-dtc"],
  ...patch,
});

test("valid entries normalize, dropping unknown fields", () => {
  const clean = api.validateEntry(entry({ futureField: { x: 1 } }));
  assert.equal(clean.id, "dtc-explainer");
  assert.equal(clean.official, true);
  assert.equal("futureField" in clean, false);
  assert.deepEqual(clean.capabilities, ["read-dtc"]);
});

test("rejects malformed ids, versions, categories, capabilities and downloads", () => {
  for (const patch of [
    { id: "Bad ID" }, { id: "x" }, { version: "1.2" }, { minAppVersion: "2" },
    { description: "short" }, { category: "hacking" }, { capabilities: ["teleport"] },
    { capabilities: "read-dtc" }, { tags: Array(9).fill("x") },
    { download: { url: "http://insecure.example/x.zip", sha256: "a".repeat(64) } },
    { download: { url: "https://example.com/x.zip", sha256: "ZZ" } },
    { author: "" },
  ]) {
    assert.throws(() => api.validateEntry(entry(patch)), String(patch));
  }
});

test("rejects prototype-polluting keys", () => {
  assert.throws(() => api.validateEntry(JSON.parse('{"__proto__": {}}')));
});

test("registry validation dedupes ids and caps the listing", () => {
  assert.throws(() => api.validateRegistry({ plugins: [entry(), entry()] }), /Duplicate/);
  assert.throws(() => api.validateRegistry({ plugins: Array(201).fill(0).map((_, i) => entry({ id: `p-${i}` })) }), /200/);
  assert.equal(api.validateRegistry({ plugins: [entry()] }).length, 1);
});

test("semver compare and update detection", () => {
  assert.equal(api.compareSemver("1.0.0", "1.0.0"), 0);
  assert.equal(api.compareSemver("1.0.1", "1.0.0"), 1);
  assert.equal(api.compareSemver("1.0.0", "1.0.1"), -1);
  assert.equal(api.compareSemver("2.0.0", "10.0.0"), -1);
  assert.throws(() => api.compareSemver("1.0", "1.0.0"));
  const reg = [entry(), entry({ id: "other", version: "2.0.0" })];
  const updates = api.updatesAvailable([{ id: "dtc-explainer", version: "0.9.0" }, { id: "other", version: "2.0.0" }], reg);
  assert.deepEqual(updates.map(u => u.id), ["dtc-explainer"]);
});


test("filterEntries matches name, id, description, author and category, case-insensitively", () => {
  const reg = [entry(), entry({ id: "fuel-trim-health", name: "Fuel Trim Health", category: "data", description: "Long-term fuel trim trends.", author: "community-dev" })];
  assert.equal(api.filterEntries(reg, "").length, 2); // empty query keeps everything
  assert.equal(api.filterEntries(reg, "   ").length, 2);
  assert.equal(api.filterEntries(reg, null).length, 2);
  assert.deepEqual(api.filterEntries(reg, "DTC").map(e => e.id), ["dtc-explainer"]);
  assert.deepEqual(api.filterEntries(reg, "fuel trim").map(e => e.id), ["fuel-trim-health"]); // name, space-separated
  assert.deepEqual(api.filterEntries(reg, "trends").map(e => e.id), ["fuel-trim-health"]); // description
  assert.deepEqual(api.filterEntries(reg, "COMMUNITY-DEV").map(e => e.id), ["fuel-trim-health"]); // author, any case
  assert.deepEqual(api.filterEntries(reg, "data").map(e => e.id), ["fuel-trim-health"]); // category
  assert.deepEqual(api.filterEntries(reg, "no-such-plugin"), []);
});
