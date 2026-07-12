"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildCreateTableSql, createUpsertStatement } = require("../sql");
const { seedDtcCodes } = require("../seed-dtc-codes");

test("buildCreateTableSql creates an index-optimized PostgreSQL catalog schema", () => {
  const sql = buildCreateTableSql();

  assert.match(sql, /CREATE TABLE IF NOT EXISTS dtc_codes/);
  assert.match(sql, /code TEXT PRIMARY KEY/);
  assert.match(sql, /type TEXT NOT NULL CHECK \(type IN \('obd2', 'bmw_hex'\)\)/);
  assert.match(sql, /symptoms TEXT\[\]/);
  assert.match(sql, /search_text TSVECTOR GENERATED ALWAYS AS/);
  assert.match(sql, /dtc_codes_compatibility_gin_idx/);
  assert.match(sql, /dtc_codes_search_idx/);
});

test("createUpsertStatement batches records into a single ON CONFLICT query", () => {
  const { text, values } = createUpsertStatement(seedDtcCodes.slice(0, 2));

  assert.match(text, /INSERT INTO dtc_codes/);
  assert.match(text, /ON CONFLICT \(code\)/);
  assert.match(text, /DO UPDATE SET/);
  assert.match(text, /\$16::text\[\]/);
  assert.equal(values.length, 16);
  assert.equal(values[0], "2A82");
  assert.equal(values[8], "P0301");
});

test("createUpsertStatement refuses empty batches", () => {
  assert.throws(() => createUpsertStatement([]), /at least one record/);
});
