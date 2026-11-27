/* UI-level tests for the v5.2.0 offline marketplace behaviour.
 *
 * The marketplace must never make installed plugins unmanageable just
 * because plugins.beemuu.com is unreachable: the last-good registry cache is
 * used when possible, and installed-only cards render even with no cache.
 * Runs the real UI module inside jsdom with the network stubbed out. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const uiSource = fs.readFileSync(path.join(__dirname, "marketplace_ui.js"), "utf8");
const registryApi = require("./marketplace_registry.js");
const storeApi = require("./marketplace_store.js");

const registryEntry = (patch = {}) => ({
  id: "dtc-explainer",
  name: "DTC Explainer",
  version: "1.0.0",
  author: "ohgeeceee",
  official: true,
  description: "Plain-English explanations of BMW fault codes.",
  category: "diagnostics",
  tags: ["dtc", "help"],
  homepage: "https://example.com/plugin",
  download: { url: "https://example.com/dtc-explainer-1.0.0.zip", sha256: "a".repeat(64), sizeBytes: 6191 },
  minAppVersion: "2.2.0",
  license: "GPL-3.0-only",
  capabilities: ["read-dtc"],
  ...patch,
});

const installedEntry = (patch = {}) => ({
  manifest: {
    id: "dtc-explainer", name: "DTC Explainer", version: "1.0.0",
    capabilities: ["read-dtc"], author: "ohgeeceee", description: "Plain-English explanations of BMW fault codes.",
    category: "diagnostics", official: true, homepage: "https://example.com/plugin", license: "GPL-3.0-only",
  },
  source: "export function activate() {}",
  readme: "# hi",
  enabled: true,
  sha256: "b".repeat(64),
  installedAt: "2026-11-26T00:00:00.000Z",
  ...patch,
});

const offline = async () => { throw new Error("network down"); };
const tick = () => new Promise(resolve => setImmediate(resolve));

function makeDom({ installed = [], cache = null, fetchImpl = offline } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <div id="plugins-status"></div>
    <div id="plugins-marketplace"></div>
    <div id="plugins-marketplace-detail"></div>
    <button id="plugins-marketplace-refresh" type="button"></button>
    <input id="plugins-marketplace-filter" type="search">
  </body>`, { url: "http://localhost/", runScripts: "dangerously" });
  const w = dom.window;
  w.BeemuuMarketplaceRegistry = registryApi;
  w.BeemuuMarketplaceStore = storeApi;
  w.BeemuuMarketplaceZip = require("./marketplace_zip.js");
  w.BeemuuMarketplaceRunner = require("./marketplace_runner.js");
  if (installed.length) storeApi.save(w.localStorage, installed);
  if (cache) storeApi.saveRegistryCache(w.localStorage, cache.entries, cache.fetchedAt);
  w.fetch = fetchImpl;
  w.eval(uiSource);
  return dom;
}

const gridText = w => w.document.getElementById("plugins-marketplace").textContent;
const gridButton = (w, label) => [...w.document.querySelectorAll("#plugins-marketplace button")].find(b => b.textContent === label);

test("offline with no cache still renders installed plugins with full management", async () => {
  const dom = makeDom({ installed: [installedEntry()] });
  const w = dom.window;
  await w.mountBeemuuMarketplace({ host: {}, appVersion: "5.2.0" });

  assert.match(gridText(w), /Marketplace unavailable: network down/);
  assert.match(gridText(w), /DTC Explainer/);
  assert.ok(gridButton(w, "Disable"), "enabled plugin keeps its Disable button offline");
  assert.ok(gridButton(w, "Open"), "enabled plugin can still be opened offline");
  assert.ok(gridButton(w, "Remove"), "plugin can still be removed offline");

  gridButton(w, "Disable").dispatchEvent(new w.Event("click"));
  await tick(); await tick();
  assert.equal(storeApi.load(w.localStorage)[0].enabled, false, "disable works against local storage offline");
  assert.match(gridText(w), /Not in the current registry listing/);
});

test("offline with a cache restores the listing, update badges and update-all", async () => {
  const cached = {
    fetchedAt: "2026-11-26T09:00:00.000Z",
    entries: [
      registryEntry({ version: "2.0.0" }),
      registryEntry({ id: "fuel-trim-health", name: "Fuel Trim Health", version: "1.1.0", description: "Long-term fuel trim trends." }),
    ],
  };
  const installed = [
    installedEntry(), // 1.0.0 installed, 2.0.0 cached -> update
    installedEntry({ manifest: { ...installedEntry().manifest, id: "fuel-trim-health", name: "Fuel Trim Health", version: "1.0.0" } }), // -> update too
  ];
  const dom = makeDom({ installed, cache: cached });
  const w = dom.window;
  await w.mountBeemuuMarketplace({ host: {}, appVersion: "5.2.0" });

  assert.match(gridText(w), /cached 2026-11-26/);
  assert.match(gridText(w), /Update available: 1\.0\.0 → 2\.0\.0/);
  assert.ok(gridButton(w, "Update all (2)"), "two cached updates offer Update all");
  assert.ok(!gridButton(w, "Install"), "both cached entries are installed already");
});

test("a corrupt cache is ignored rather than breaking the offline view", async () => {
  const dom = makeDom({ installed: [installedEntry()] });
  const w = dom.window;
  w.localStorage.setItem(storeApi.REGISTRY_CACHE_KEY, "{broken json");
  await w.mountBeemuuMarketplace({ host: {}, appVersion: "5.2.0" });
  assert.match(gridText(w), /Showing installed plugins only/);
  assert.match(gridText(w), /DTC Explainer/);
});

test("filter narrows cards and reports an empty result", async () => {
  const cached = {
    fetchedAt: "2026-11-26T09:00:00.000Z",
    entries: [
      registryEntry(),
      registryEntry({ id: "fuel-trim-health", name: "Fuel Trim Health", description: "Long-term fuel trim trends." }),
    ],
  };
  const dom = makeDom({ cache: cached });
  const w = dom.window;
  await w.mountBeemuuMarketplace({ host: {}, appVersion: "5.2.0" });
  assert.match(gridText(w), /DTC Explainer/);
  assert.match(gridText(w), /Fuel Trim Health/);

  const input = w.document.getElementById("plugins-marketplace-filter");
  input.value = "fuel";
  input.dispatchEvent(new w.Event("input"));
  await tick();
  assert.doesNotMatch(gridText(w), /DTC Explainer/);
  assert.match(gridText(w), /Fuel Trim Health/);

  input.value = "no-such-plugin";
  input.dispatchEvent(new w.Event("input"));
  await tick();
  assert.match(gridText(w), /No plugins match your search/);
});

test("a successful refresh clears the offline notice and writes the cache", async () => {
  const good = async () => ({ ok: true, json: async () => ({ plugins: [registryEntry()] }) });
  const dom = makeDom({ fetchImpl: good });
  const w = dom.window;
  await w.mountBeemuuMarketplace({ host: {}, appVersion: "5.2.0" });
  assert.doesNotMatch(gridText(w), /Marketplace unavailable|unreachable/);
  assert.match(gridText(w), /DTC Explainer/);
  const cache = storeApi.loadRegistryCache(w.localStorage);
  assert.ok(cache, "refresh persisted the registry cache");
  assert.equal(cache.entries[0].id, "dtc-explainer");
});
