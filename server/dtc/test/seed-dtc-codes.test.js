"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { seedDtcCodes } = require("../seed-dtc-codes");
const { toEmbeddingText } = require("../supermemory");

test("seed dataset exposes the three production starter DTCs", () => {
  const byCode = new Map(seedDtcCodes.map((record) => [record.code, record]));

  assert.equal(seedDtcCodes.length, 3);
  assert.ok(byCode.has("2A82"));
  assert.ok(byCode.has("P0301"));
  assert.ok(byCode.has("30FF"));
});

test("seed records match the canonical DTC schema and stay detailed enough for RAG", () => {
  for (const record of seedDtcCodes) {
    assert.deepEqual(Object.keys(record), [
      "code",
      "type",
      "ecu_module",
      "short_desc",
      "symptoms",
      "causes",
      "fixes",
      "compatibility"
    ]);
    assert.match(record.code, /^([PCBU][0-9A-F]{4}|[0-9A-F]{4})$/);
    assert.ok(["obd2", "bmw_hex"].includes(record.type));
    assert.equal(typeof record.ecu_module, "string");
    assert.equal(typeof record.short_desc, "string");
    assert.ok(record.symptoms.length >= 5, `${record.code} needs rich symptoms`);
    assert.ok(record.causes.length >= 5, `${record.code} needs rich causes`);
    assert.ok(record.fixes.length >= 6, `${record.code} needs step-by-step fixes`);
    assert.ok(record.compatibility.length >= 3, `${record.code} needs compatibility tags`);
  }
});

test("embedding text includes code, symptoms, causes, fixes, and compatibility", () => {
  const text = toEmbeddingText(seedDtcCodes.find((record) => record.code === "30FF"));

  assert.match(text, /Code: 30FF/);
  assert.match(text, /Description: Turbocharger charge-air pressure too low/);
  assert.match(text, /Symptoms:/);
  assert.match(text, /wastegate rattle/i);
  assert.match(text, /Causes:/);
  assert.match(text, /Fixes:/);
  assert.match(text, /Compatibility:/);
  assert.match(text, /N54/);
});
