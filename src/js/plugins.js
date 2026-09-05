/* Version 1 community packages. Pure validation and persistence helpers. */
(function (root) {
  "use strict";
  const MAX_PACKAGE = 256 * 1024;
  const STORAGE_KEY = "beeemuu.plugins.v1";
  const size = text => new TextEncoder().encode(text).length;
  function fail(message) { throw new Error(message); }
  function string(value, name, max) {
    if (typeof value !== "string" || !value.trim() || value.length > max) fail(`Invalid ${name}.`);
    return value;
  }
  function fields(value, allowed, name) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`Invalid ${name}.`);
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`Unsupported ${name} field: ${key}`);
  }
  function validate(p) {
    fields(p, ["schemaVersion", "id", "name", "version", "author", "description", "license", "kind", "permissions", "content", "code", "exampleInput"], "package");
    if (size(JSON.stringify(p)) > MAX_PACKAGE) fail("Package exceeds 256 KiB.");
    if (p.schemaVersion !== 1) fail("Unsupported package schema. Expected version 1.");
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(string(p.id, "id", 100))) fail("Use a namespaced id, such as author.tool-name.");
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(string(p.version, "version", 30))) fail("Version must be major.minor.patch.");
    for (const [key, max] of [["name", 80], ["author", 100], ["description", 600], ["license", 100]]) string(p[key], key, max);
    if (!Array.isArray(p.permissions) || p.permissions.length) fail("Version 1 plugins cannot request host permissions.");
    if (p.kind === "data") {
      if (p.code !== undefined || p.exampleInput !== undefined) fail("Data packs cannot contain code or tool input.");
      fields(p.content, ["articles", "profilesToml"], "content");
      if (!Array.isArray(p.content.articles) || p.content.articles.length > 100) fail("Expected up to 100 articles.");
      for (const article of p.content.articles) {
        fields(article, ["title", "body"], "article");
        string(article.title, "article title", 120);
        string(article.body, "article body", 16000);
      }
      if (p.content.profilesToml !== undefined) string(p.content.profilesToml, "profile TOML", 120000);
      if (!p.content.articles.length && !p.content.profilesToml) fail("Data pack is empty.");
    } else if (p.kind === "tool") {
      if (p.content !== undefined) fail("Tools cannot include data-pack content.");
      string(p.code, "tool code", 120000);
      if (p.exampleInput === undefined || size(JSON.stringify(p.exampleInput)) > 32000) fail("Provide exampleInput (up to 32 KiB of JSON).");
    } else fail("Plugin kind must be data or tool.");
    return JSON.parse(JSON.stringify(p));
  }
  function parse(text) {
    if (typeof text !== "string" || size(text) > MAX_PACKAGE) fail("Package exceeds 256 KiB.");
    return validate(JSON.parse(text));
  }
  function load(storage) {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    if (size(raw) > 2 * 1024 * 1024) fail("Installed plugin storage exceeds 2 MiB.");
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries) || entries.length > 20) fail("Invalid installed plugin storage.");
    const ids = new Set();
    return entries.map(entry => {
      fields(entry, ["package", "enabled"], "installed plugin");
      const p = validate(entry.package);
      if (ids.has(p.id) || typeof entry.enabled !== "boolean") fail("Invalid installed plugin entry.");
      ids.add(p.id);
      return { package: p, enabled: entry.enabled };
    });
  }
  function save(storage, entries) {
    const raw = JSON.stringify(entries);
    if (entries.length > 20 || size(raw) > 2 * 1024 * 1024) fail("Plugin storage is full. Remove a plugin before installing another.");
    storage.setItem(STORAGE_KEY, raw); // Quota errors must reach the UI.
  }
  const api = { MAX_PACKAGE, STORAGE_KEY, validate, parse, load, save };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BeemuuPlugins = api;
})(typeof window !== "undefined" ? window : null);
