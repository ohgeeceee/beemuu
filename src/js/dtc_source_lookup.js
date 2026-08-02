"use strict";

// Look up a DTC's community-source URL via the hosted /api/dtc/<code>
// endpoint. Per-process LRU-ish cache (Map; bounded at 256 entries)
// keeps repeated fault-table renders fast and degrades gracefully
// when the network is unavailable.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.beeemuuDtcSourceLookup = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const CACHE_MAX = 256;
  const cache = new Map();
  const inflight = new Map();
  const FALLBACK_BASE = "https://api.beemuu.com";

  function resolveBase(config) {
    if (config && typeof config.baseUrl === "string" && config.baseUrl) return config.baseUrl;
    if (typeof window !== "undefined" && window.__BEEEMUU_DTC_BASE__) return window.__BEEEMUU_DTC_BASE__;
    return FALLBACK_BASE;
  }

  async function rawFetch(base, code) {
    const url = base.replace(/\/$/, "") + "/api/dtc/" + encodeURIComponent(code);
    if (typeof fetch === "function") {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) return null;
      const data = await r.json();
      return data && typeof data.source_url === "string" ? data.source_url : null;
    }
    return null;
  }

  async function lookup(code, config) {
    if (!code) return null;
    const key = String(code).toUpperCase();
    if (cache.has(key)) return cache.get(key);
    if (inflight.has(key)) return inflight.get(key);

    const base = resolveBase(config);
    const promise = (async () => {
      let url = null;
      try {
        url = await rawFetch(base, key);
      } catch (_) {
        url = null;
      }
      if (url && cache.size >= CACHE_MAX) {
        // Drop the oldest entry — Map preserves insertion order.
        const first = cache.keys().next().value;
        if (first) cache.delete(first);
      }
      if (url) cache.set(key, url);
      return url;
    })();
    inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(key);
    }
  }

  function clearCache() {
    cache.clear();
    inflight.clear();
  }

  return { lookup, clearCache };
});
