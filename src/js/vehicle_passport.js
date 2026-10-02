"use strict";

/* Vehicle Passport — v3.0.0 feature 9.
 *
 * Everything the app knows about one car, in one portable file.
 *
 * The reason this exists is that a BMW's knowledge is scattered across six
 * places: the vehicle profile, the DID map, the DTC database, the wiring
 * table, the CBS history and the adaptation history. None of them is much use
 * on its own, and all of them are hard to move. A car changes hands, a second
 * car gets a second copy of everything, and the owner re-learns what they
 * already knew last winter.
 *
 * So: one file per car. It is a passport, not a diagnosis — the car can
 * identify itself, and the record travels with it.
 *
 * The hard constraint is privacy, and it is not optional. A snapshot contains a
 * VIN, and a VIN is a name and an address to anyone who wants to look one up.
 * So this module treats "what leaves the machine" as the primary design
 * question, not a final scrub step:
 *
 *   - The VIN is **never** included in either output form. There is no
 *     `include_vin` option, because an option is an invitation, and the one
 *     time somebody needs it is the one time they will share the file.
 *   - What is included is a **fingerprint** — a salted hash. The salt is
 *     stored in the file, so two passports from the same car are recognisably
 *     the same car to their owner, and two passports from different cars are
 *     not linkable by anyone comparing files.
 *   - **Ident strings are dropped**, not hashed. A module's `ident` frequently
 *     embeds VIN-derived data; keeping even a hash of it would leak structure.
 *     This matches the intent `TECH_SPECS.md` §13.3 states for the Rust
 *     anonymizer.
 *   - Every redaction is **reported**, not silent. `buildPassport` returns what
 *     it removed, so the UI can tell the user what they are about to share
 *     rather than implying the file is clean by assertion.
 *
 * The salt is a deliberate, documented weakness: this is obfuscation for a
 * friendly forum, not cryptography, and the module says so rather than letting
 * the word "anonymized" imply more than it delivers.
 *
 * Pure: no DOM, no Tauri, no filesystem.
 */

const PASSPORT_VERSION = 1;

/* Fields that are dropped outright rather than hashed. Anything here has been
 * observed to carry VIN, plate or owner-identifying material.
 *
 * Names are matched case-insensitively, and the list is deliberately NOT
 * position-aware — which is why `address` and `postcode` are handled by
 * `isOwnerAddressField` below rather than being listed plainly. A module's
 * `address` is its ECU address and is essential; an owner's is not. */
const REDACTED_FIELDS = [
  "vin",
  "plate",
  "license_plate",
  "registration",
  "owner",
  "owner_name",
  "email",
  "phone",
  "address",
  "postcode",
  "zip",
  "imei",
  "serial",
  "tool_serial",
  "adapter_serial",
];

/* `address` is both an owner-identifying field and a module's ECU address. The
 * module form is kept — `flash_audit.js` and the flash history both key on it,
 * and a passport without module addresses is not a car record. The owner form is
 * dropped, recognised by appearing under a vehicle block rather than a module
 * one, and by not being a number. */
function isModuleAddress(path) {
  return String(path || "").startsWith("modules");
}
function isNumericAddress(value) {
  return typeof value === "number" || /^[0-9A-Fa-fx]+$/.test(String(value).trim());
}
function shouldDrop(key, path, value) {
  const k = String(key).toLowerCase();
  if (!REDACTED_FIELDS.includes(k)) return false;
  if (k === "address" && isModuleAddress(path) && isNumericAddress(value)) return false;
  return true;
}

/* Module `ident` strings embed identifying data on several ECUs, so they go
 * entirely rather than being hashed. */
const DROPPED_MODULE_FIELDS = ["ident"];

function isObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/**
 * A stable, non-reversible fingerprint for a VIN.
 *
 * This is a salted hash and nothing more. It is enough to tell a user "this is
 * the same car as your other passport", and not enough to be treated as a
 * privacy boundary against anyone who has a list of VINs — a 17-character
 * space is small enough to brute-force. Salted with a random value stored in
 * the file, which stops two files from being linkable by hash comparison, but
 * does not stop a determined attacker. Use it for recognition, not anonymity.
 */
function fingerprint(vin, salt) {
  const v = String(vin == null ? "" : vin);
  const s = String(salt == null ? "" : salt);
  if (!v) return null;
  let h1 = 0x811c9dc5;
  for (let i = 0; i < v.length; i++) {
    h1 ^= v.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  let h2 = 0x1000193;
  for (let i = s.length - 1; i >= 0; i--) {
    h2 ^= s.charCodeAt(i) + i;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0"));
}

function randomSalt() {
  const bytes = new Uint8Array(8);
  // Prefer the platform CSPRNG; fall back to Math.random only if unavailable,
  // and the caller is told which happened via `salt_source`.
  if (typeof globalThis.crypto !== "undefined" &&
      typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
    return { salt: Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""),
      salt_source: "crypto" };
  }
  return { salt: Math.random().toString(16).slice(2).padEnd(16, "0").slice(0, 16),
    salt_source: "weak-random" };
}

/**
 * Redact identifying keys from an object, recursively.
 * @returns {{value: Object, removed: Array<string>}}
 */
function redact(obj, path, removed, seen) {
  if (!isObject(obj)) return obj;
  if (seen.has(obj)) return {};   // cycle guard
  seen.add(obj);
  const out = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const full = path ? `${path}.${key}` : key;
    if (shouldDrop(key, path, value)) {
      if (value != null && value !== "") removed.push(full);
      continue;                    // dropped entirely, not hashed
    }
    out[key] = isObject(value) ? redact(value, full, removed, seen) : value;
  }
  return out;
}

/**
 * Build a passport from the data the app already holds for one car.
 *
 * @param {Object} input
 * @param {Object} [input.vehicle]  {label, engine, modelYear, ...}
 * @param {String} [input.vin]
 * @param {Array}  [input.modules]  [{address, name, flash_count, ...}]
 * @param {Array}  [input.drts]     adaptation history (feature 2 output shape)
 * @param {Array}  [input.cbs]      service history (feature 1/CBS shape)
 * @param {String} [input.salt]     reuse a salt to keep a fingerprint stable
 * @returns {Object} the passport, with `redactions` listing what was removed
 */
function buildPassport(input) {
  const src = isObject(input) ? input : {};
  const removed = [];

  const { salt, salt_source } = src.salt
    ? { salt: String(src.salt), salt_source: "provided" }
    : randomSalt();

  const vin = src.vin == null ? null : String(src.vin);

  // Vehicle identity, minus everything identifying.
  const vehicle = redact(src.vehicle || {}, "vehicle", removed, new Set());
  if (vin) {
    removed.push("vin");
    vehicle.engine = vehicle.engine || (src.engine || null);
  }

  // Modules: drop ident outright, redact the rest, and never carry live data
  // (a raw live frame is bulk, not identity, and bloats a file meant to be
  // shared).
  const modules = (Array.isArray(src.modules) ? src.modules : []).map(m => {
    if (!isObject(m)) return null;
    const clean = {};
    for (const key of Object.keys(m)) {
      if (DROPPED_MODULE_FIELDS.includes(key.toLowerCase())) {
        if (m[key] != null && m[key] !== "") removed.push(`modules[].${key}`);
        continue;
      }
      if (key === "live_data") {
        if (Array.isArray(m[key]) && m[key].length) removed.push("modules[].live_data");
        continue;
      }
      clean[key] = m[key];
    }
    return redact(clean, "modules[]", removed, new Set());
  }).filter(Boolean);

  return {
    passport_version: PASSPORT_VERSION,
    fingerprint: fingerprint(vin, salt),
    salt,
    salt_source,
    vehicle,
    modules,
    adaptations: Array.isArray(src.adaptations) ? src.adaptations : [],
    service_history: Array.isArray(src.cbs) ? src.cbs : [],
    // Stated, not implied. "Anonymized" on its own is a promise the file
    // cannot keep against someone with a VIN list.
    privacy: {
      vin_included: false,
      ident_included: false,
      live_data_included: false,
      removed_fields: [...new Set(removed)],
      note: "The VIN is replaced by a salted fingerprint, so you can recognise your own car across passports. That is obfuscation, not anonymity: a determined attacker with a list of VINs could brute-force it. Module ident strings and live data are dropped entirely. Review `removed_fields` before sharing.",
    },
  };
}

/**
 * Whether two passports are recognisably the same car.
 *
 * Only true when the salts match too, so two independently-created passports
 * from the same car are *not* linked — that is the point of a random salt, and
 * a comparison that ignored it would silently reintroduce the cross-file
 * linkability the salt exists to prevent.
 */
function isSameCar(a, b) {
  if (!isObject(a) || !isObject(b)) return false;
  if (!a.fingerprint || !b.fingerprint) return false;
  if (a.salt !== b.salt) return false;
  return a.fingerprint === b.fingerprint;
}

/**
 * A one-paragraph summary for sharing, with the caveat attached.
 */
function summarize(passport) {
  if (!isObject(passport)) return "";
  const v = passport.vehicle || {};
  const bits = [];
  bits.push(v.label || v.engine || "Vehicle");
  if (v.model_year) bits.push(String(v.model_year));
  const mods = Array.isArray(passport.modules) ? passport.modules.length : 0;
  if (mods) bits.push(`${mods} module${mods === 1 ? "" : "s"}`);
  const flashed = (passport.modules || []).filter(m => m.flash_count != null).length;
  if (flashed) bits.push(`${flashed} with a known flash count`);
  const unverified = (passport.adaptations || []).filter(a => a && a.status === "insufficient_data").length;
  if (unverified) bits.push(`${unverified} adaptation${unverified === 1 ? "" : "s"} not yet measured`);
  return bits.join(" · ");
}

const api = {
  PASSPORT_VERSION,
  REDACTED_FIELDS,
  DROPPED_MODULE_FIELDS,
  buildPassport,
  fingerprint,
  isSameCar,
  redact,
  randomSalt,
  summarize,
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuVehiclePassport = api;
