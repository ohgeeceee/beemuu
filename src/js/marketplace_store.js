/* Installed marketplace plugins: localStorage persistence.
 *
 * Separate from the v1/v2 package store (`plugins.js`) on purpose — the two
 * formats have different trust and capability models, and neither loader
 * should ever trip over the other's data. Mirrors its conventions: bounded
 * counts and sizes, full re-validation on load, corruption surfaces as a
 * thrown error for the UI to explain rather than silent data loss. */
(function (root) {
  "use strict";

  const STORAGE_KEY = "beeemuu.plugins.marketplace.v1";
  const MAX_INSTALLED = 20;
  const MAX_STORAGE_BYTES = 2 * 1024 * 1024;
  const MAX_MAIN_SOURCE = 120000;

  function fail(message) { throw new Error(message); }
  const size = text => new TextEncoder().encode(text).length;

  function validateEntry(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Invalid installed marketplace entry.");
    const m = raw.manifest;
    if (!m || typeof m !== "object") fail("Installed marketplace entry is missing its manifest.");
    if (typeof m.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(m.id)) fail("Invalid installed plugin id.");
    if (typeof m.version !== "string" || !/^\d+\.\d+\.\d+$/.test(m.version)) fail(`Installed plugin "${m.id}": invalid version.`);
    if (typeof m.name !== "string" || !m.name.trim()) fail(`Installed plugin "${m.id}": invalid name.`);
    if (!Array.isArray(m.capabilities)) fail(`Installed plugin "${m.id}": capabilities must be an array.`);
    if (typeof raw.source !== "string" || !raw.source.trim()) fail(`Installed plugin "${m.id}": missing source.`);
    if (size(raw.source) > MAX_MAIN_SOURCE) fail(`Installed plugin "${m.id}": source exceeds the cap.`);
    if (typeof raw.enabled !== "boolean") fail(`Installed plugin "${m.id}": invalid enabled flag.`);
    if (typeof raw.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(raw.sha256)) fail(`Installed plugin "${m.id}": invalid archive digest.`);
    return {
      manifest: {
        id: m.id,
        name: m.name,
        version: m.version,
        capabilities: m.capabilities.slice(),
        author: typeof m.author === "string" ? m.author : null,
        description: typeof m.description === "string" ? m.description : null,
        category: typeof m.category === "string" ? m.category : null,
        official: m.official === true,
        homepage: typeof m.homepage === "string" ? m.homepage : null,
        license: typeof m.license === "string" ? m.license : null,
      },
      source: raw.source,
      readme: typeof raw.readme === "string" ? raw.readme : null,
      enabled: raw.enabled,
      sha256: raw.sha256,
      installedAt: typeof raw.installedAt === "string" ? raw.installedAt : null,
    };
  }

  function load(storage) {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    if (size(raw) > MAX_STORAGE_BYTES) fail("Marketplace plugin storage exceeds 2 MiB.");
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries) || entries.length > MAX_INSTALLED) fail("Invalid marketplace plugin storage.");
    const ids = new Set();
    return entries.map(entry => {
      const clean = validateEntry(entry);
      if (ids.has(clean.manifest.id)) fail(`Duplicate installed marketplace plugin "${clean.manifest.id}".`);
      ids.add(clean.manifest.id);
      return clean;
    });
  }

  function save(storage, entries) {
    if (entries.length > MAX_INSTALLED) fail("Marketplace plugin storage is full. Remove a plugin first.");
    const raw = JSON.stringify(entries);
    if (size(raw) > MAX_STORAGE_BYTES) fail("Marketplace plugin storage is full. Remove a plugin first.");
    storage.setItem(STORAGE_KEY, raw); // Quota errors must reach the UI.
  }

  /* Last-good registry cache. Unlike the installed store, this is advisory
   * state: a corrupt or oversized cache is DISCARDED (load returns null),
   * never thrown, because the network can always rebuild it. The UI still
   * re-validates the entries through the registry client before listing
   * them — this module only guarantees JSON shape, not trust. */
  const REGISTRY_CACHE_KEY = "beeemuu.plugins.marketplace.registry-cache.v1";
  const MAX_REGISTRY_CACHE_BYTES = 256 * 1024;

  function saveRegistryCache(storage, entries, fetchedAt) {
    if (!Array.isArray(entries)) fail("Registry cache entries must be an array.");
    if (typeof fetchedAt !== "string" || !fetchedAt) fail("Registry cache needs a fetch timestamp.");
    const raw = JSON.stringify({ fetchedAt, entries });
    if (size(raw) > MAX_REGISTRY_CACHE_BYTES) fail("Registry is too large to cache.");
    storage.setItem(REGISTRY_CACHE_KEY, raw); // Quota errors must reach the UI.
  }

  function loadRegistryCache(storage) {
    try {
      const raw = storage.getItem(REGISTRY_CACHE_KEY);
      if (!raw) return null;
      if (size(raw) > MAX_REGISTRY_CACHE_BYTES) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      if (typeof parsed.fetchedAt !== "string" || !parsed.fetchedAt) return null;
      if (!Array.isArray(parsed.entries)) return null;
      return { fetchedAt: parsed.fetchedAt, entries: parsed.entries };
    } catch (_) {
      return null; // Corrupt cache: ignore it, the next refresh rewrites it.
    }
  }

  const api = { STORAGE_KEY, MAX_INSTALLED, load, save, REGISTRY_CACHE_KEY, saveRegistryCache, loadRegistryCache };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BeemuuMarketplaceStore = api;
})(typeof window !== "undefined" ? window : null);
