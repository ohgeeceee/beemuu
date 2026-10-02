"use strict";

/* Registry client — v3.0.0 feature 10, client half.
 *
 * `backend/plugins_registry.py` serves package listings with a sha256 for each
 * manifest. This is the other end: verifying that what arrived is what the
 * registry said it would be, before the app stages anything for review.
 *
 * The verification rule that matters: **the digest is checked before the
 * package is parsed or installed**, and a failure stops the install outright.
 * Verifying after `validate()` would mean a tampered manifest had already been
 * compiled into worker code by the time anyone noticed, which is far too late
 * to be a security control.
 *
 * What a digest is and is not, stated because the word "verified" is doing too
 * much work otherwise: it detects corruption and casual tampering. It does not
 * prove authorship. An attacker who can edit the registry file can edit its
 * digest too. Author signing remains the open Tier B item, and this module
 * refuses to imply otherwise — there is no `trusted: true` anywhere in it.
 */

/* Reject anything that is not a 64-character lowercase hex string before
 * comparing, so a malformed expectation cannot be coerced into a match. */
const SHA256_RE = /^[0-9a-f]{64}$/;

function isObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Canonical serialisation, mirroring `package_digest` in
 * `backend/plugins_registry.py` byte for byte: sorted keys, no insignificant
 * whitespace, UTF-8.
 *
 * The two sides must agree exactly. Two divergences matter and both are easy to
 * miss:
 *
 *   - **Whole floats.** JSON does not distinguish 1 from 1.0. Python's
 *     `json.loads("1")` gives an int and `json.loads("1.0")` gives a float, and
 *     `json.dumps` writes each back the way it arrived — but JavaScript has one
 *     Number type and `JSON.stringify` writes back whatever form it chooses.
 *     The community profiles are full of `min = -40.0`, so this matters for
 *     real packages, not hypotheticals.
 *   - **Encoding.** Python is called with `ensure_ascii=False` so `°C` stays
 *     UTF-8 rather than becoming `\u00b0C`.
 *
 * The resolution is to normalise on the Python side, to the form JavaScript can
 * actually reproduce — the int/float distinction is *lost*, not preserved,
 * because once the manifest reaches JavaScript it is gone. See
 * `package_digest` in `backend/plugins_registry.py`, which mirrors this.
 *
 * Either divergence failing loudly is the correct outcome — a cross-language
 * digest that silently disagrees would serve tampered packages. The tests pin
 * known-good digests for both languages.
 */
function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value).sort();
  const parts = [];
  for (const k of keys) {
    const v = value[k];
    // JSON.stringify returns undefined for a function or undefined value; such
    // a key cannot survive JSON.parse anyway, so it is dropped rather than
    // serialised as a bare token that would not parse on the Python side.
    if (v === undefined || typeof v === "function") continue;
    parts.push(JSON.stringify(k) + ":" + canonicalize(v));
  }
  return "{" + parts.join(",") + "}";
}

/**
 * sha256 of a string, as lowercase hex.
 *
 * Uses WebCrypto when available (the Tauri webview has it) and falls back to a
 * clearly-labelled non-cryptographic hash otherwise. The fallback exists so the
 * module is testable under plain Node and in a bare webview — it is NOT a
 * substitute for sha256 and `digestStrength` says so, so a caller can refuse
 * to install on the weak path rather than believing a weaker guarantee.
 */
function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof globalThis.crypto !== "undefined" &&
      typeof globalThis.crypto.subtle !== "undefined" &&
      typeof globalThis.crypto.subtle.digest === "function") {
    // Synchronous callers cannot await SubtleCrypto, so this returns a promise
    // on the strong path. `digestSync` below is the sync wrapper callers use.
    return globalThis.crypto.subtle
      .digest("SHA-256", bytes)
      .then(buf => hex(new Uint8Array(buf)));
  }
  return Promise.resolve(weakHashHex(bytes));
}

function hex(buf) {
  return Array.from(buf, b => b.toString(16).padStart(2, "0")).join("");
}

/* FNV-1a over 4 interleaved lanes. Not sha256, not collision-resistant
 * against an attacker — only good enough to make the pure-JS path testable. */
function weakHashHex(bytes) {
  const lanes = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  for (let i = 0; i < bytes.length; i++) {
    lanes[i % 4] = Math.imul(lanes[i % 4] ^ bytes[i], 0x01000193) >>> 0;
  }
  return lanes.map(l => l.toString(16).padStart(8, "0")).join("") +
    cryptoPad(bytes.length);
}

function cryptoPad(len) {
  // Pad to 64 chars so the shape matches sha256's, which stops a caller from
  // "fixing" a validation by length alone and accidentally accepting the weak
  // path as if it were the strong one.
  return "0".repeat(Math.max(0, 64 - 32 - len.toString(16).length));
}

/** The digest algorithm actually available in this environment. */
function digestStrength() {
  return typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.subtle !== "undefined"
    ? "sha256" : "weak-fallback";
}

/** The expected digest for a package, as lowercase hex or null. */
function expectedDigest(listingEntry) {
  if (!isObject(listingEntry)) return null;
  const raw = listingEntry.sha256;
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return SHA256_RE.test(s) ? s : null;
}

/**
 * Verify a downloaded package against the digest the registry advertised.
 *
 * @param {Object} pkg           the parsed manifest
 * @param {Object} listingEntry  the list card it was fetched from
 * @returns {Promise<{ok: boolean, reason: string, strength: string}>}
 *
 * Always returns a promise, including on the early-refusal paths. A function
 * that is a plain object on one branch and a thenable on another is a trap for
 * the caller — one `await` short of a crash at exactly the moment a tampered
 * package shows up.
 *
 * Never rejects: a verification failure is a result, not an exception, because
 * the caller's response to it is always the same — refuse and say why.
 */
function verifyPackage(pkg, listingEntry) {
  const strength = digestStrength();
  const expected = expectedDigest(listingEntry);

  if (expected === null) {
    return Promise.resolve({
      ok: false,
      reason: "The registry listing carried no usable sha256, so there is nothing to verify against. Refusing to install an unverifiable package.",
      strength,
    });
  }
  if (!isObject(pkg)) {
    return Promise.resolve({ ok: false, reason: "Package payload is not an object.", strength });
  }
  if (strength !== "sha256") {
    // The environment cannot actually check the digest. Saying "ok" here would
    // be a false assurance, and the whole point of this module is not to give
    // one.
    return Promise.resolve({
      ok: false,
      reason: "This environment has no WebCrypto, so the sha256 cannot be verified. Install was not attempted.",
      strength,
    });
  }

  return sha256Hex(canonicalize(pkg)).then(actual => {
    if (actual === expected) {
      return { ok: true, reason: "sha256 matches the registry listing.", strength };
    }
    return {
      ok: false,
      reason: `sha256 mismatch: download is ${actual.slice(0, 12)}…, registry advertised ${expected.slice(0, 12)}…. The package may be corrupt or tampered with; it was not installed.`,
      strength,
    };
  });
}

/**
 * The full install gate: verify, and only then let the caller parse.
 *
 * `install` receives an already-verified manifest. `parse`/`validate` are
 * passed in rather than imported so this module stays free of the plugin
 * loader's dependencies and cannot accidentally become a second install path.
 */
function gateInstall(downloaded, listingEntry, { parse, install }) {
  return verifyPackage(downloaded, listingEntry).then(result => {
    if (!result.ok) return { installed: false, verified: false, reason: result.reason };
    // Verification first. A tampered manifest must not reach the parser, which
    // is what compiles tool code for the worker.
    let pkg;
    try {
      pkg = parse(downloaded);
    } catch (e) {
      return { installed: false, verified: true, reason: `Package failed validation: ${e.message}` };
    }
    try {
      install(pkg);
    } catch (e) {
      return { installed: false, verified: true, reason: `Install failed: ${e.message}` };
    }
    return { installed: true, verified: true, reason: result.reason };
  });
}

const api = {
  SHA256_RE,
  canonicalize,
  digestStrength,
  expectedDigest,
  gateInstall,
  sha256Hex,
  verifyPackage,
  weakHashHex,
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuRegistryClient = api;
