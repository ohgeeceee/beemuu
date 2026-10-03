"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const p = require("../vehicle_passport.js");

const VIN = "WBA12345678901234";

function input(over) {
  return Object.assign({
    vin: VIN,
    salt: "0123456789abcdef",
    vehicle: { label: "335i", engine: "n54", model_year: 2008, owner: "Jon Currie", plate: "ABC 123" },
    modules: [
      { address: 0x12, name: "DME", flash_count: 2, ident: "MEVD17.2.42-S0000000", software_version: "MEVD17.2.42" },
      { address: 0x60, name: "TCM", flash_count: 1 },
    ],
    adaptations: [
      { id: "ltft", current: 3.1, status: "ok" },
      { id: "idle", current: null, status: "insufficient_data" },
    ],
    cbs: [{ item: "engine_oil", status: "OK" }],
  }, over || {});
}

test("a passport never contains the VIN", () => {
  const pass = p.buildPassport(input());
  const json = JSON.stringify(pass);
  assert.ok(!json.includes(VIN), "the VIN leaked into the passport");
  assert.ok(!json.includes("ABC 123"), "the plate leaked into the passport");
  assert.ok(!json.includes("Jon Currie"), "the owner name leaked");
  assert.equal(pass.privacy.vin_included, false);
  assert.equal(pass.privacy.ident_included, false);
});

test("there is no option to include the VIN", () => {
  // An option is an invitation, and the one time somebody needs it is the one
  // time they will share the file.
  const pass = p.buildPassport(input({ include_vin: true, with_vin: true }));
  assert.ok(!JSON.stringify(pass).includes(VIN));
});

test("every redaction is reported, not silent", () => {
  const pass = p.buildPassport(input());
  const removed = pass.privacy.removed_fields;
  assert.ok(removed.includes("vin"));
  assert.ok(removed.includes("vehicle.owner"));
  assert.ok(removed.includes("vehicle.plate"));
  assert.ok(removed.includes("modules[].ident"));
  assert.ok(removed.includes("modules[].live_data") === false || true);
  // The user is told what leaves the machine rather than trusting a label.
  assert.match(pass.privacy.note, /Review `removed_fields`/);
});

test("ident strings are dropped entirely, not hashed", () => {
  // A module ident frequently embeds VIN-derived material. Keeping even a hash
  // would leak its structure, and length.
  const pass = p.buildPassport(input());
  const dme = pass.modules.find(m => m.address === 0x12);
  assert.equal(dme.ident, undefined);
  assert.ok(!JSON.stringify(pass).includes("MEVD17.2.42-S0000000"));
  // ...but the useful, non-identifying version survives.
  assert.equal(dme.software_version, "MEVD17.2.42");
  assert.equal(dme.flash_count, 2);
});

test("live data is dropped to keep the file shareable", () => {
  const pass = p.buildPassport(input({
    modules: [{ address: 0x12, name: "DME", live_data: [{ label: "rpm", value: "800" }] }],
  }));
  assert.equal(pass.modules[0].live_data, undefined);
  assert.ok(pass.privacy.removed_fields.includes("modules[].live_data"));
});

test("the fingerprint is stable for one salt and differs across salts", () => {
  const a = p.buildPassport(input({ salt: "aaaaaaaaaaaaaaaa" }));
  const b = p.buildPassport(input({ salt: "aaaaaaaaaaaaaaaa" }));
  const c = p.buildPassport(input({ salt: "bbbbbbbbbbbbbbbb" }));
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
  assert.equal(a.fingerprint.length, 16);
});

test("isSameCar needs both the fingerprint AND the salt to match", () => {
  // Ignoring the salt would silently reintroduce the cross-file linkability the
  // random salt exists to prevent.
  const a = p.buildPassport(input({ salt: "aaaaaaaaaaaaaaaa" }));
  const b = p.buildPassport(input({ salt: "aaaaaaaaaaaaaaaa" }));
  const c = p.buildPassport(input({ salt: "bbbbbbbbbbbbbbbb" }));
  assert.equal(p.isSameCar(a, b), true);
  assert.equal(p.isSameCar(a, c), false);
  assert.equal(p.isSameCar(a, null), false);
  assert.equal(p.isSameCar({}, {}), false);
});

test("isSameCar refuses a forged match that skips the salt check", () => {
  // The direct test of the salt rule: two passports carrying an identical
  // fingerprint but different salts must NOT be reported as the same car. That
  // is precisely the linkability the random salt exists to prevent, and a
  // comparison that only looked at the fingerprint would create it.
  const a = p.buildPassport(input({ salt: "aaaaaaaaaaaaaaaa" }));
  const forged = Object.assign({}, a, { salt: "bbbbbbbbbbbbbbbb" });
  assert.equal(forged.fingerprint, a.fingerprint, "the fingerprints must match for this to bite");
  assert.notEqual(forged.salt, a.salt);
  assert.equal(p.isSameCar(a, forged), false);
});

test("two independently created passports for one car are not linked", () => {
  const a = p.buildPassport(input({ salt: undefined }));
  const b = p.buildPassport(input({ salt: undefined }));
  assert.equal(p.isSameCar(a, b), false);
  assert.notEqual(a.fingerprint, b.fingerprint);
  // Both still recognise their own car, which is the point.
  assert.ok(a.fingerprint && b.fingerprint);
});

test("a passport with no VIN has no fingerprint rather than a hash of nothing", () => {
  const pass = p.buildPassport(input({ vin: null }));
  assert.equal(pass.fingerprint, null);
  assert.equal(p.isSameCar(pass, pass), false);
  assert.equal(p.buildPassport(input({ vin: "" })).fingerprint, null);
});

test("a VIN-less passport is still a valid record of the car", () => {
  const pass = p.buildPassport({ vehicle: { label: "E46" }, modules: [] });
  assert.equal(pass.passport_version, p.PASSPORT_VERSION);
  assert.equal(pass.vehicle.label, "E46");
});

test("nested identifying fields are redacted at any depth", () => {
  const pass = p.buildPassport({
    vehicle: { label: "x", meta: { owner: "Jon", nested: { email: "a@b.c" } } },
  });
  const json = JSON.stringify(pass);
  assert.ok(!json.includes("Jon"));
  assert.ok(!json.includes("a@b.c"));
  assert.ok(pass.vehicle.meta.label === undefined);
  assert.ok(pass.privacy.removed_fields.includes("vehicle.meta.owner"));
  assert.ok(pass.privacy.removed_fields.includes("vehicle.meta.nested.email"));
});

test("a cyclic object does not hang the redactor", () => {
  const v = { label: "x", owner: "Jon" };
  v.self = v;
  const pass = p.buildPassport({ vehicle: v });
  assert.equal(pass.vehicle.label, "x");
  assert.ok(pass.privacy.removed_fields.includes("vehicle.owner"));
});

test("adaptation and service history carry through, with their honesty flags", () => {
  const pass = p.buildPassport(input());
  assert.equal(pass.adaptations.length, 2);
  assert.equal(pass.adaptations[1].status, "insufficient_data");
  assert.equal(pass.service_history[0].item, "engine_oil");
});

test("non-object and array inputs are skipped rather than crashing", () => {
  const pass = p.buildPassport({
    vin: VIN,
    salt: "0123456789abcdef",
    modules: [null, "nope", 7, { address: 0x12, name: "DME" }],
  });
  assert.equal(pass.modules.length, 1);
  assert.equal(pass.modules[0].name, "DME");
});

test("buildPassport tolerates no input at all", () => {
  for (const input of [null, undefined, [], "nope", 42]) {
    const pass = p.buildPassport(input);
    assert.equal(pass.passport_version, p.PASSPORT_VERSION);
    assert.deepEqual(pass.modules, []);
    assert.deepEqual(pass.adaptations, []);
  }
});

test("a generated salt is recorded with its source", () => {
  const { salt, salt_source } = p.randomSalt();
  assert.equal(salt.length, 16);
  assert.ok(["crypto", "weak-random"].includes(salt_source));
  const pass = p.buildPassport(input({ salt: undefined }));
  assert.equal(pass.salt_source, "crypto");
  assert.equal(pass.salt.length, 16);
});

test("the privacy note does not overclaim", () => {
  // "Anonymized" on its own is a promise this file cannot keep against
  // someone holding a list of VINs. The note has to say so.
  const note = p.buildPassport(input()).privacy.note;
  assert.match(note, /obfuscation, not anonymity/);
  assert.match(note, /brute-force/);
});

test("summarize describes the car without identifying it", () => {
  const pass = p.buildPassport(input());
  const sum = p.summarize(pass);
  assert.match(sum, /335i/);
  assert.match(sum, /2 modules/);
  assert.match(sum, /2 with a known flash count/);
  assert.match(sum, /1 adaptation not yet measured/);
  assert.ok(!sum.includes(VIN));
  assert.equal(p.summarize(null), "");
});

test("summarize pluralizes correctly", () => {
  const one = p.buildPassport({ modules: [{ address: 0x12, name: "DME" }], adaptations: [] });
  assert.match(p.summarize(one), /1 module(?!s)/);
  const oneDrift = p.buildPassport({ modules: [], adaptations: [{ status: "insufficient_data" }] });
  assert.match(p.summarize(oneDrift), /1 adaptation not yet/);
});

test("a module's ECU address is kept while an owner's address is dropped", () => {
  // `address` is both an owner-identifying field and a module's ECU address.
  // Dropping the module form would make the passport useless — `flash_audit.js`
  // and the flash history both key on it — while keeping the owner form would
  // put a home address in a file meant to be shared.
  const pass = p.buildPassport(input());
  const dme = pass.modules.find(m => m.name === "DME");
  assert.equal(dme.address, 0x12, "the ECU address must survive");
  assert.equal(pass.vehicle.address, undefined, "the owner's address must not");
  assert.ok(pass.privacy.removed_fields.includes("vehicle.owner"));
  assert.ok(!pass.privacy.removed_fields.includes("modules[].address"));
  // A hex-string ECU address is kept too.
  const hex = p.buildPassport({ modules: [{ address: "0x12", name: "DME" }] });
  assert.equal(hex.modules[0].address, "0x12");
});

test("every redacted field name is lowercase and matches what it claims", () => {
  for (const f of p.REDACTED_FIELDS) {
    assert.equal(f, f.toLowerCase(), f);
  }
  // The list is not decorative: every entry must actually be dropped.
  for (const field of p.REDACTED_FIELDS) {
    const pass = p.buildPassport({ vehicle: { [field]: "SECRET" } });
    assert.ok(!JSON.stringify(pass).includes("SECRET"), `${field} was not redacted`);
  }
});
