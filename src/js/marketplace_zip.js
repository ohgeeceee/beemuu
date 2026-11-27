/* Marketplace package download: sha256 verification and zip extraction.
 *
 * The marketplace ships plugins as zip archives (plugin.json + main.js +
 * README.md). This module turns downloaded bytes into a verified package:
 *
 *   1. `sha256Hex`   — hash the archive; no WebCrypto means no install.
 *   2. `unzip`       — minimal, bounded zip reader (stored + deflate entries
 *                      via DecompressionStream). Not a general unzip: capped
 *                      entry counts and sizes, no data descriptors, no z64.
 *   3. `extractPackage` — require plugin.json and main.js, validate the
 *                      plugin descriptor, and hand back exactly the files the
 *                      runner is allowed to see.
 *
 * The digest is checked by the caller BEFORE `unzip` runs — the same rule
 * plugins_registry_client.js documents for the package registry: a tampered
 * archive must never reach the parser. No DOM, no fetch; bytes in, files out. */
(function (root) {
  "use strict";

  const MAX_ARCHIVE_BYTES = 1024 * 1024;   // marketplace zips are a few KiB; this is generous
  const MAX_ENTRIES = 16;
  const MAX_ENTRY_BYTES = 256 * 1024;
  const MAX_MAIN_SOURCE = 120000;          // matches the existing tool-code cap

  function fail(message) { throw new Error(message); }

  /* sha256 of a Uint8Array as lowercase hex, or null when this environment
   * has no WebCrypto. Callers must treat null as "cannot verify → refuse". */
  async function sha256Hex(bytes) {
    if (!globalThis.crypto || !globalThis.crypto.subtle) return null;
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  }

  function u16(view, at) { return view.getUint16(at, true); }
  function u32(view, at) { return view.getUint32(at, true); }

  /* Inflate one deflate (raw) entry. */
  async function inflate(bytes, expectedSize) {
    if (typeof DecompressionStream !== "function") {
      fail("This system cannot decompress zip entries (no DecompressionStream).");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    if (buffer.byteLength > expectedSize) fail("Zip entry is larger than its declared size.");
    return new Uint8Array(buffer);
  }

  /* Parse a zip archive into a Map of name -> Uint8Array. Central-directory
   * driven; local headers are only trusted for the data offset. Sizes are
   * checked against the caps before any decompression happens. */
  async function unzip(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) fail("Archive exceeds the marketplace size cap.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    /* Locate the end-of-central-directory record by scanning backwards for
     * its signature. A comment is legal but capped, so the scan is bounded. */
    let eocd = -1;
    const minScan = Math.max(0, bytes.byteLength - 22 - 65535);
    for (let i = bytes.byteLength - 22; i >= minScan; i--) {
      if (u32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) fail("Not a zip archive (no end-of-central-directory record).");
    const count = u16(view, eocd + 10);
    if (count > MAX_ENTRIES) fail(`Archive has ${count} entries; the cap is ${MAX_ENTRIES}.`);
    let at = u32(view, eocd + 16);

    const files = new Map();
    for (let n = 0; n < count; n++) {
      if (u32(view, at) !== 0x02014b50) fail("Corrupt zip central directory.");
      const method = u16(view, at + 10);
      const compressedSize = u32(view, at + 20);
      const size = u32(view, at + 24);
      const nameLength = u16(view, at + 28);
      const extraLength = u16(view, at + 30);
      const commentLength = u16(view, at + 32);
      const localAt = u32(view, at + 42);
      const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
      at += 46 + nameLength + extraLength + commentLength;

      /* Directories and path tricks are not packages. */
      if (name.endsWith("/")) continue;
      if (name.includes("..") || name.includes("\\") || name.startsWith("/")) fail(`Unsafe zip entry name: "${name}".`);
      if (size > MAX_ENTRY_BYTES) fail(`Zip entry "${name}" exceeds the per-file cap.`);
      if (method !== 0 && method !== 8) fail(`Zip entry "${name}" uses an unsupported compression method.`);

      if (u32(view, localAt) !== 0x04034b50) fail("Corrupt zip local header.");
      const localName = u16(view, localAt + 26);
      const localExtra = u16(view, localAt + 28);
      const dataAt = localAt + 30 + localName + localExtra;
      if (dataAt + compressedSize > bytes.byteLength) fail("Corrupt zip: entry data out of bounds.");
      const raw = bytes.subarray(dataAt, dataAt + compressedSize);
      files.set(name, method === 0 ? new Uint8Array(raw) : await inflate(raw, size));
    }
    return files;
  }

  /* Validate the marketplace plugin.json descriptor. Kept deliberately small:
   * the registry entry was already validated; this is the archive telling the
   * same truth. A mismatch between the two is an error, not a merge. */
  function validateDescriptor(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("plugin.json must be an object.");
    if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(raw.id)) fail("plugin.json: invalid id.");
    if (typeof raw.name !== "string" || !raw.name.trim()) fail("plugin.json: invalid name.");
    if (typeof raw.version !== "string" || !/^\d+\.\d+\.\d+$/.test(raw.version)) fail("plugin.json: version must be semver.");
    if (raw.entry !== "main.js") fail("plugin.json: entry must be main.js.");
    if (!Array.isArray(raw.capabilities)) fail("plugin.json: capabilities must be an array.");
    for (const capability of raw.capabilities) {
      if (typeof capability !== "string") fail("plugin.json: every capability must be a string.");
    }
    return {
      id: raw.id,
      name: raw.name,
      version: raw.version,
      entry: raw.entry,
      capabilities: raw.capabilities.slice(),
    };
  }

  /* Extract a verified marketplace package from unzipped files. Returns
   * { descriptor, source, readme }. Anything else in the archive is dropped. */
  function extractPackage(files) {
    if (!(files instanceof Map)) fail("Expected unzipped files.");
    const descriptorBytes = files.get("plugin.json");
    const sourceBytes = files.get("main.js");
    if (!descriptorBytes) fail("Archive has no plugin.json.");
    if (!sourceBytes) fail("Archive has no main.js.");
    let descriptor;
    try {
      descriptor = validateDescriptor(JSON.parse(new TextDecoder().decode(descriptorBytes)));
    } catch (e) {
      fail(`Invalid plugin.json: ${e.message}`);
    }
    const source = new TextDecoder().decode(sourceBytes);
    if (new TextEncoder().encode(source).length > MAX_MAIN_SOURCE) fail("main.js exceeds the source size cap.");
    const readmeBytes = files.get("README.md");
    const readme = readmeBytes ? new TextDecoder().decode(readmeBytes) : null;
    return { descriptor, source, readme };
  }

  const api = {
    MAX_ARCHIVE_BYTES, MAX_ENTRIES, MAX_ENTRY_BYTES, MAX_MAIN_SOURCE,
    sha256Hex, unzip, extractPackage, validateDescriptor,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BeemuuMarketplaceZip = api;
})(typeof window !== "undefined" ? window : null);
