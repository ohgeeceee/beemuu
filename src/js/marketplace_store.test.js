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
