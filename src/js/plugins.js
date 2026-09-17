/* Version 1 and 2 community packages. Pure validation and persistence helpers.
 * Version 2 adds multi-file tools: a `files` map (name -> source) plus an
 * `entry` point. Validation compiles v2 tools down to a single `code` string so
 * the existing worker runner is unchanged; v1 packages pass through as-is. */
(function (root) {
  "use strict";
  const MAX_PACKAGE = 256 * 1024;
  const MAX_FILES = 50;
  const MAX_FILE_LENGTH = 200000;
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
  /* Compile a v2 tool's `files` map into the single `code` body the worker runs.
   * Non-entry files come first (shared declarations stay in scope), the entry
   * file last (it returns the result). Rejects cyclic-looking setups. */
  function compile(files, entry) {
    const names = Object.keys(files);
    if (names.length > MAX_FILES) fail(`Tool bundles at most ${MAX_FILES} files.`);
    if (!names.includes(entry)) fail(`Entry file "${entry}" is not present in the bundle.`);
    for (const name of names) {
      if (typeof files[name] !== "string" || !files[name].trim()) fail(`Invalid bundle file: ${name}.`);
      if (files[name].length > MAX_FILE_LENGTH) fail(`Bundle file "${name}" exceeds ${MAX_FILE_LENGTH} characters.`);
    }
    const order = names.filter(n => n !== entry);
    return order.map(n => files[n]).join("\n") + "\n" + files[entry];
  }
  function validate(p) {
    fields(p, ["schemaVersion", "id", "name", "version", "author", "description", "license", "kind", "permissions", "content", "code", "exampleInput", "files", "entry"], "package");
    if (size(JSON.stringify(p)) > MAX_PACKAGE) fail("Package exceeds 256 KiB.");
    if (p.schemaVersion !== 1 && p.schemaVersion !== 2) fail("Unsupported package schema. Expected version 1 or 2.");
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(string(p.id, "id", 100))) fail("Use a namespaced id, such as author.tool-name.");
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(string(p.version, "version", 30))) fail("Version must be major.minor.patch.");
    for (const [key, max] of [["name", 80], ["author", 100], ["description", 600], ["license", 100]]) string(p[key], key, max);
    if (!Array.isArray(p.permissions) || p.permissions.length) fail("Version 1 and 2 plugins cannot request host permissions.");
    let compiled;
    if (p.kind === "data") {
      if (p.code !== undefined || p.exampleInput !== undefined || p.files !== undefined || p.entry !== undefined) fail("Data packs cannot contain code, tool input, or bundle files.");
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
      if (p.exampleInput === undefined) fail("Provide exampleInput.");
      if (size(JSON.stringify(p.exampleInput)) > 32000) fail("Provide exampleInput (up to 32 KiB of JSON).");
      if (p.files !== undefined) {
        if (p.entry === undefined || typeof p.entry !== "string") fail("A bundled tool must declare a string entry file.");
        if (!p.files || typeof p.files !== "object" || Array.isArray(p.files)) fail("Bundle `files` must be a map of filename to source.");
        compiled = compile(p.files, p.entry);
        if (p.code !== undefined && p.code !== compiled) fail("Bundle `code` does not match its `files` + `entry`.");
      } else if (p.code === undefined) {
        fail("A tool must provide `code` or a `files` bundle.");
      }
      string(compiled !== undefined ? compiled : p.code, "tool code", 120000);
    } else fail("Plugin kind must be data or tool.");
    const result = JSON.parse(JSON.stringify(p));
    if (compiled !== undefined) result.code = compiled;
    return result;
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
  const api = { MAX_PACKAGE, MAX_FILES, MAX_FILE_LENGTH, STORAGE_KEY, validate, parse, load, save };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BeemuuPlugins = api;
})(typeof window !== "undefined" ? window : null);
