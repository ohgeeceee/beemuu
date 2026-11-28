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
    <input id="plugins-marketplace-sideload" type="file">
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


/* ---- v5.3.0 sideload flow: local .zip, unverified-source consent ---- */
const zlib = require("node:zlib");
const zipApi = require("./marketplace_zip.js");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function buildZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const stored = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, stored);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBytes]));
    offset += 30 + nameBytes.length + stored.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, cd, eocd]));
}

const SIDE_ZIP = () => buildZip({
  "plugin.json": JSON.stringify({ id: "side-demo", name: "Side Demo", version: "0.1.0", entry: "main.js", capabilities: ["ui"] }),
  "main.js": "export function activate() {}",
  "README.md": "# Side Demo",
});
const flush = () => new Promise(resolve => setTimeout(resolve, 50));

function pickFile(w, bytes, name) {
  const input = w.document.getElementById("plugins-marketplace-sideload");
  Object.defineProperty(input, "files", { value: [new w.File([bytes], name)], configurable: true });
  input.dispatchEvent(new w.Event("change"));
}
const detailText = w => w.document.getElementById("plugins-marketplace-detail").textContent;
const detailButton = (w, label) => [...w.document.querySelectorAll("#plugins-marketplace-detail button")].find(b => b.textContent === label);
const statusText = w => w.document.getElementById("plugins-status").textContent;

test("sideload consent is explicit about the unverified source; confirm installs disabled", async () => {
  const dom = makeDom();
  const w = dom.window;
  await w.mountBeemuuMarketplace({ host: {}, appVersion: "5.3.0" });

  const bytes = SIDE_ZIP();
  pickFile(w, bytes, "side-demo.zip");
  await flush();

  assert.match(detailText(w), /Unverified source/);
  const expectedSha = await zipApi.sha256Hex(bytes);
  assert.ok(detailText(w).includes(expectedSha), "consent shows the full local SHA-256");
  assert.match(detailText(w), /Side Demo 0\.1\.0/);
  assert.deepEqual(storeApi.load(w.localStorage), [], "nothing stored before consent");

  detailButton(w, "Confirm install").dispatchEvent(new w.Event("click"));
  await flush(); await flush();
  const stored = storeApi.load(w.localStorage);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].manifest.id, "side-demo");
  assert.equal(stored[0].enabled, false, "sideloaded plugins start disabled");
  assert.equal(stored[0].sha256, expectedSha);
  assert.match(gridText(w), /Side Demo/); // unlisted card, manageable offline
  assert.ok(gridButton(w, "Enable"), "sideloaded plugin can be enabled");
});

test("sideload refuses an archive with no plugin.json and stores nothing", async () => {
  const dom = makeDom();
  const w = dom.window;
  await w.mountBeemuuMarketplace({ host: {}, appVersion: "5.3.0" });
  pickFile(w, buildZip({ "main.js": "x" }), "broken.zip");
  await flush();
  assert.match(statusText(w), /Sideload failed: Archive has no plugin\.json/);
  assert.deepEqual(storeApi.load(w.localStorage), []);
  assert.equal(detailText(w), "");
});

test("sideload cancel leaves storage untouched", async () => {
  const dom = makeDom();
  const w = dom.window;
  await w.mountBeemuuMarketplace({ host: {}, appVersion: "5.3.0" });
  pickFile(w, SIDE_ZIP(), "side-demo.zip");
  await flush();
  detailButton(w, "Cancel").dispatchEvent(new w.Event("click"));
  await flush();
  assert.deepEqual(storeApi.load(w.localStorage), []);
  assert.match(statusText(w), /Sideload cancelled/);
});
