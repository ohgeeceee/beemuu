"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("lookup returns null on unsupported runtime", async () => {
  const lookup = require("./dtc_source_lookup.js");
  // The module exports a factory result; fetch is unavailable in
  // Node by default, so the call should resolve to null gracefully.
  const url = await lookup.lookup("2A98");
  assert.equal(url, null);
});

test("lookup caches successful fetches across calls", async () => {
  const lookup = require("./dtc_source_lookup.js");
  lookup.clearCache();
  // Stub global fetch to verify cache + dedup behavior.
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ source_url: "https://example.com/2A98" }) };
  };
  try {
    const a = await lookup.lookup("2A98", { baseUrl: "https://api.example.com" });
    const b = await lookup.lookup("2A98");
    assert.equal(a, "https://example.com/2A98");
    assert.equal(b, "https://example.com/2A98");
    assert.equal(calls, 1, "second lookup should hit cache");
  } finally {
    globalThis.fetch = originalFetch;
    lookup.clearCache();
  }
});

test("lookup returns null when fetch throws and does not cache", async () => {
  const lookup = require("./dtc_source_lookup.js");
  lookup.clearCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network down"); };
  try {
    const url = await lookup.lookup("29CD", { baseUrl: "https://api.example.com" });
    assert.equal(url, null);
    // Cache should not retain a failed lookup.
    globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
    const url2 = await lookup.lookup("29CD", { baseUrl: "https://api.example.com" });
    assert.equal(url2, null);
  } finally {
    globalThis.fetch = originalFetch;
    lookup.clearCache();
  }
});

test("lookup respects custom baseUrl and falls back to FALLBACK_BASE", async () => {
  const lookup = require("./dtc_source_lookup.js");
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return { ok: false, json: async () => ({}) }; };
  try {
    await lookup.lookup("29CD", { baseUrl: "https://staging.example.com" });
    await lookup.lookup("29CD");
    assert.equal(seen[0], "https://staging.example.com/api/dtc/29CD");
    assert.equal(seen[1], "https://api.beemuu.com/api/dtc/29CD");
  } finally {
    globalThis.fetch = originalFetch;
    lookup.clearCache();
  }
});
