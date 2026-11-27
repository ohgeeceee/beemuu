/* Marketplace registry client — validates entries from
 * https://plugins.beemuu.com/registry.json before the UI lists them.
 *
 * The marketplace manifest schema lives in the beemuu-plugins repository
 * (manifest.schema.json); this module is the app-side mirror. Every field is
 * checked here so the UI never renders — and the installer never fetches —
 * a malformed entry. Pure: no DOM, no fetch, no timers. The caller injects
 * the network. */
(function (root) {
  "use strict";

  const MAX_ENTRIES = 200;
  const MAX_TAGS = 8;
  const CATEGORIES = Object.freeze(["diagnostics", "coding", "reporting", "data", "ui", "tools"]);
  /* The full marketplace capability vocabulary, including the reserved names.
   * Which ones a plugin may actually exercise is the runner's decision — this
   * module only decides whether a manifest is well-formed. */
  const CAPABILITIES = Object.freeze([
    "read-vin", "read-dtc", "clear-dtc", "live-data",
    "coding-write", "ecu-flash", "network", "filesystem", "ui",
  ]);

  const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;
  const SEMVER = /^\d+\.\d+\.\d+$/;
  const SHA256 = /^[0-9a-f]{64}$/;

  function fail(message) { throw new Error(message); }
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  /* Compare two semver strings. Returns -1, 0 or 1. Throws on non-semver,
   * because a silent wrong answer would hide or invent updates. */
  function compareSemver(a, b) {
    if (!SEMVER.test(a) || !SEMVER.test(b)) fail(`Not semver: "${a}" vs "${b}".`);
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
    }
    return 0;
  }

  /* Validate one registry entry. Returns a fresh object holding only the
   * fields the app acts on — unknown fields are dropped, not carried. */
  function validateEntry(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Registry entry must be an object.");
    for (const key of ["__proto__", "constructor", "prototype"]) {
      if (has(raw, key)) fail(`Registry entry must not define ${key}.`);
    }
    const m = raw;
    if (!SLUG.test(String(m.id || ""))) fail(`Invalid plugin id: "${m.id}".`);
    if (!SEMVER.test(String(m.version || ""))) fail(`Plugin "${m.id}": version must be semver.`);
    if (!SEMVER.test(String(m.minAppVersion || ""))) fail(`Plugin "${m.id}": minAppVersion must be semver.`);
    const name = String(m.name || "");
    if (!name.trim() || name.length > 80) fail(`Plugin "${m.id}": invalid name.`);
    const description = String(m.description || "");
    if (description.length < 10 || description.length > 300) fail(`Plugin "${m.id}": description must be 10–300 characters.`);
    const author = String(m.author || "");
    if (!author.trim() || author.length > 100) fail(`Plugin "${m.id}": invalid author.`);
    if (!CATEGORIES.includes(m.category)) fail(`Plugin "${m.id}": unknown category "${m.category}".`);
    if (!Array.isArray(m.capabilities)) fail(`Plugin "${m.id}": capabilities must be an array.`);
    for (const capability of m.capabilities) {
      if (!CAPABILITIES.includes(capability)) fail(`Plugin "${m.id}": unknown capability "${capability}".`);
    }
    const tags = Array.isArray(m.tags) ? m.tags : [];
    if (tags.length > MAX_TAGS) fail(`Plugin "${m.id}": at most ${MAX_TAGS} tags.`);
    for (const tag of tags) {
      if (typeof tag !== "string" || tag.length > 40) fail(`Plugin "${m.id}": invalid tag.`);
    }
    const download = m.download;
    if (!download || typeof download !== "object") fail(`Plugin "${m.id}": missing download.`);
    if (!String(download.url || "").startsWith("https://")) fail(`Plugin "${m.id}": download URL must be https.`);
    if (!SHA256.test(String(download.sha256 || ""))) fail(`Plugin "${m.id}": download sha256 must be 64 lowercase hex characters.`);

    return {
      id: m.id,
      name,
      version: m.version,
      author,
      official: m.official === true,
      description,
      category: m.category,
      tags: tags.slice(),
      capabilities: m.capabilities.slice(),
      minAppVersion: m.minAppVersion,
      download: {
        url: String(download.url),
        sha256: String(download.sha256),
        sizeBytes: Number.isFinite(download.sizeBytes) ? download.sizeBytes : null,
      },
      homepage: typeof m.homepage === "string" && m.homepage.startsWith("https://") ? m.homepage : null,
      license: typeof m.license === "string" ? m.license : null,
    };
  }

  /* Validate a whole registry document. Rejects duplicate ids and caps the
   * listing so a hostile or broken registry cannot flood the UI. */
  function validateRegistry(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.plugins)) fail("Invalid registry document.");
    if (raw.plugins.length > MAX_ENTRIES) fail(`Registry lists more than ${MAX_ENTRIES} plugins.`);
    const seen = new Set();
    return raw.plugins.map(entry => {
      const clean = validateEntry(entry);
      if (seen.has(clean.id)) fail(`Duplicate plugin id "${clean.id}" in registry.`);
      seen.add(clean.id);
      return clean;
    });
  }

  /* Given installed entries ({id, version}) and a validated registry, return
   * the registry entries that are newer than what is installed. */
  function updatesAvailable(installed, registry) {
    const byId = new Map();
    for (const entry of installed) byId.set(entry.id, entry.version);
    return registry.filter(entry => byId.has(entry.id) && compareSemver(entry.version, byId.get(entry.id)) > 0);
  }

  const api = { CAPABILITIES, CATEGORIES, MAX_ENTRIES, compareSemver, validateEntry, validateRegistry, updatesAvailable };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BeemuuMarketplaceRegistry = api;
})(typeof window !== "undefined" ? window : null);
