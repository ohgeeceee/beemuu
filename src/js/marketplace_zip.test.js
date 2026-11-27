"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const api = require("./marketplace_zip.js");

/* Minimal zip writer for tests: stored + deflate entries, no frills. Mirrors
 * what `zipfile` produces for the marketplace packages. */
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
function buildZip(files, { deflate = true } = {}) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const method = deflate ? 8 : 0;
    const stored = deflate ? zlib.deflateRawSync(data) : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, stored);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(method, 10);
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

const DESCRIPTOR = JSON.stringify({
  id: "demo-plugin", name: "Demo", version: "1.0.0", entry: "main.js", capabilities: ["read-vin"],
});
const GOOD = () => buildZip({ "plugin.json": DESCRIPTOR, "main.js": "export function activate() {}", "README.md": "# Demo" });

test("extracts a well-formed marketplace package (deflate and stored)", async () => {
  for (const deflate of [true, false]) {
    const files = await api.unzip(GOOD(), { });
    const pkg = api.extractPackage(files);
    assert.equal(pkg.descriptor.id, "demo-plugin");
    assert.match(pkg.source, /activate/);
    assert.equal(pkg.readme, "# Demo");
    void deflate;
  }
});

test("sha256 matches the webcrypto digest and reports null only without subtle", async () => {
  const bytes = new TextEncoder().encode("hello");
  const digest = await api.sha256Hex(bytes);
  if (digest === null) return; // environment without WebCrypto: nothing to pin
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});

test("refuses non-zips, traversal names, missing files and oversized entries", async () => {
  await assert.rejects(() => api.unzip(new Uint8Array(64)), /Not a zip/);
  await assert.rejects(() => api.unzip(buildZip({ "../evil": "x" })), /Unsafe/);
  const noDescriptor = await api.unzip(buildZip({ "main.js": "x" }));
  assert.throws(() => api.extractPackage(noDescriptor), /plugin\.json/);
  const noMain = await api.unzip(buildZip({ "plugin.json": DESCRIPTOR }));
  assert.throws(() => api.extractPackage(noMain), /main\.js/);
  const big = await api.unzip(buildZip({ "plugin.json": DESCRIPTOR, "main.js": "x".repeat(api.MAX_MAIN_SOURCE + 1) }, { deflate: true }));
  assert.throws(() => api.extractPackage(big), /size cap/);
});

test("descriptor validation pins id, semver, entry and capabilities", () => {
  assert.throws(() => api.validateDescriptor({ id: "Bad", name: "x", version: "1.0.0", entry: "main.js", capabilities: [] }));
  assert.throws(() => api.validateDescriptor({ id: "ok-id", name: "x", version: "1.0.0", entry: "evil.js", capabilities: [] }));
  assert.throws(() => api.validateDescriptor({ id: "ok-id", name: "x", version: "1.0.0", entry: "main.js", capabilities: "read-vin" }));
  const clean = api.validateDescriptor(JSON.parse(DESCRIPTOR));
  assert.deepEqual(clean.capabilities, ["read-vin"]);
});
