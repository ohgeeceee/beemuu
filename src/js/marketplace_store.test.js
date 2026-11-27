"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("./marketplace_store.js");

const storage = () => {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
};
const entry = (patch = {}) => ({
  manifest: {
    id: "dtc-explainer", name: "DTC Explainer", version: "1.0.0",
    capabilities: ["read-dtc"], author: "ohgeeceee", description: "Explain codes.",
    category: "diagnostics", official: true, homepage: null, license: "GPL-3.0-only",
  },
  source: "export function activate() {}",
  readme: "# hi",
  enabled: false,
  sha256: "b".repeat(64),
  installedAt: "2026-11-27T00:00:00.000Z",
  ...patch,
});

test("round-trips installed entries without running code", () => {
  const s = storage();
  assert.deepEqual(api.load(s), []);
  const entries = [entry(), entry({ manifest: { ...entry().manifest, id: "other-plugin" }, enabled: true })];
  api.save(s, entries);
  assert.deepEqual(api.load(s), entries);
});

test("rejects corruption, duplicates and invalid shapes on load", () => {
  const s = storage();
  s.setItem(api.STORAGE_KEY, "not json");
  assert.throws(() => api.load(s));
  s.setItem(api.STORAGE_KEY, JSON.stringify([entry(), entry()]));
  assert.throws(() => api.load(s), /Duplicate/);
  s.setItem(api.STORAGE_KEY, JSON.stringify([entry({ sha256: "zz" })]));
  assert.throws(() => api.load(s), /digest/);
  s.setItem(api.STORAGE_KEY, JSON.stringify([entry({ source: "" })]));
  assert.throws(() => api.load(s), /source/);
});

test("caps count, entry size and total size; quota errors surface", () => {
  const s = storage();
  assert.throws(() => api.save(s, Array(21).fill(0).map((_, i) => entry({ manifest: { ...entry().manifest, id: `p-${i}` } }))), /full/);
  assert.throws(() => api.load({
    getItem: () => JSON.stringify([entry({ source: "x".repeat(120001) })]),
  }), /cap/);
  assert.throws(() => api.save({ setItem() { throw new Error("quota"); } }, []), /quota/);
});


test("registry cache round-trips and stays separate from installed storage", () => {
  const s = storage();
  assert.equal(api.loadRegistryCache(s), null); // nothing cached yet
  const entries = [{ id: "dtc-explainer", version: "1.0.0" }];
  api.saveRegistryCache(s, entries, "2026-11-27T10:00:00.000Z");
  assert.deepEqual(api.loadRegistryCache(s), { fetchedAt: "2026-11-27T10:00:00.000Z", entries });
  assert.equal(s.getItem(api.STORAGE_KEY), null); // installed store untouched
  assert.deepEqual(api.load(s), []);
});

test("registry cache load discards corruption instead of throwing", () => {
  const s = storage();
  s.setItem(api.REGISTRY_CACHE_KEY, "not json");
  assert.equal(api.loadRegistryCache(s), null);
  s.setItem(api.REGISTRY_CACHE_KEY, JSON.stringify({ fetchedAt: "2026-11-27T10:00:00.000Z" })); // no entries
  assert.equal(api.loadRegistryCache(s), null);
  s.setItem(api.REGISTRY_CACHE_KEY, JSON.stringify({ entries: [] })); // no timestamp
  assert.equal(api.loadRegistryCache(s), null);
  s.setItem(api.REGISTRY_CACHE_KEY, JSON.stringify([1, 2])); // wrong top-level shape
  assert.equal(api.loadRegistryCache(s), null);
  s.setItem(api.REGISTRY_CACHE_KEY, "x".repeat(256 * 1024 + 1)); // oversized
  assert.equal(api.loadRegistryCache(s), null);
});

test("registry cache save rejects invalid input and surfaces quota errors", () => {
  const s = storage();
  assert.throws(() => api.saveRegistryCache(s, "nope", "2026-11-27T10:00:00.000Z"), /array/);
  assert.throws(() => api.saveRegistryCache(s, [], ""), /timestamp/);
  assert.throws(() => api.saveRegistryCache(s, [{ blob: "x".repeat(300 * 1024) }], "2026-11-27T10:00:00.000Z"), /too large/);
  assert.throws(() => api.saveRegistryCache({ setItem() { throw new Error("quota"); } }, [], "2026-11-27T10:00:00.000Z"), /quota/);
});
