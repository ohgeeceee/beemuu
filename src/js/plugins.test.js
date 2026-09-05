"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const api = require("./plugins.js");
const catalog = require("../plugins/catalog.json");
const tool = () => structuredClone(catalog.find(p => p.kind === "tool"));
const data = () => structuredClone(catalog.find(p => p.kind === "data"));
const storage = () => {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
};
test("catalog packages validate, have unique identities and include both kinds", () => {
  assert.equal(new Set(catalog.map(p => p.id)).size, catalog.length);
  assert.ok(catalog.some(p => p.kind === "data"));
  assert.ok(catalog.some(p => p.kind === "tool"));
  for (const p of catalog) assert.deepEqual(api.parse(JSON.stringify(p)), p);
});
test("reject permissions, unknown fields, unsupported versions and traversal IDs", () => {
  for (const patch of [{ permissions: ["ecu.write"] }, { schemaVersion: 2 }, { id: "../../x" }, { version: "1.2" }, { entrypoint: "https://evil.invalid/x.js" }, { kind: "native" }]) {
    assert.throws(() => api.validate({ ...tool(), ...patch }));
  }
  assert.throws(() => api.parse('{"__proto__": {}}'));
});
test("data rejects code and malformed or empty content", () => {
  for (const patch of [{ code: "return 1" }, { content: { articles: [] } }, { content: { articles: [{ title: "a", body: "b", html: true }] } }]) {
    assert.throws(() => api.validate({ ...data(), ...patch }));
  }
  assert.equal(api.validate({ ...data(), content: { articles: [], profilesToml: "[[profile]]" } }).kind, "data");
});
test("tool requires code and bounded example JSON; package sizes are bounded", () => {
  assert.throws(() => api.validate({ ...tool(), code: "" }));
  assert.throws(() => api.validate({ ...tool(), exampleInput: "x".repeat(32001) }));
  assert.throws(() => api.parse(" ".repeat(api.MAX_PACKAGE + 1)));
  assert.throws(() => api.parse("é".repeat(api.MAX_PACKAGE / 2 + 1)), /256 KiB/);
  assert.throws(() => api.validate({ ...tool(), content: {} }));
});
test("storage round-trips enabled state without running code", () => {
  const s = storage();
  assert.deepEqual(api.load(s), []);
  const entries = [{ package: tool(), enabled: false }, { package: data(), enabled: true }];
  api.save(s, entries);
  assert.deepEqual(api.load(s), entries);
  api.save(s, []);
  assert.deepEqual(api.load(s), []);
});
test("corruption, duplicates and quota errors are surfaced instead of erasing packages", () => {
  const s = storage();
  s.setItem(api.STORAGE_KEY, "broken");
  assert.throws(() => api.load(s));
  assert.equal(s.getItem(api.STORAGE_KEY), "broken");
  s.setItem(api.STORAGE_KEY, JSON.stringify([{ package: tool(), enabled: true }, { package: tool(), enabled: true }]));
  assert.throws(() => api.load(s));
  assert.throws(() => api.save({ setItem() { throw new Error("quota"); } }, []), /quota/);
  assert.throws(() => api.save(s, Array(21).fill({ package: tool(), enabled: false })), /full/);
});
test("runner policy denies connections and UI does not grant same-origin sandbox access", () => {
  const runner = fs.readFileSync(path.join(__dirname, "../plugin-runner.html"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "plugins_ui.js"), "utf8");
  assert.match(runner, /connect-src 'none'/);
  assert.match(runner, /frame-src 'none'/);
  assert.match(ui, /setAttribute\("sandbox", "allow-scripts"\)/);
  assert.doesNotMatch(ui, /innerHTML|allow-same-origin/);
});
