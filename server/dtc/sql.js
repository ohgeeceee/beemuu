"use strict";

const { normalizeRecord } = require("./normalizer");

function buildCreateTableSql() {
  return `
    CREATE TABLE IF NOT EXISTS dtc_codes (
      code TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('obd2', 'bmw_hex')),
      ecu_module TEXT NOT NULL,
      short_desc TEXT NOT NULL,
      symptoms TEXT[] NOT NULL DEFAULT '{}',
      causes TEXT[] NOT NULL DEFAULT '{}',
      fixes TEXT[] NOT NULL DEFAULT '{}',
      compatibility TEXT[] NOT NULL DEFAULT '{}',
      search_text TSVECTOR GENERATED ALWAYS AS (
        to_tsvector(
          'simple',
          coalesce(code, '') || ' ' ||
          coalesce(type, '') || ' ' ||
          coalesce(ecu_module, '') || ' ' ||
          coalesce(short_desc, '') || ' ' ||
          array_to_string(symptoms, ' ') || ' ' ||
          array_to_string(causes, ' ') || ' ' ||
          array_to_string(fixes, ' ') || ' ' ||
          array_to_string(compatibility, ' ')
        )
      ) STORED,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS dtc_codes_type_module_idx
      ON dtc_codes (type, ecu_module);

    CREATE INDEX IF NOT EXISTS dtc_codes_compatibility_gin_idx
      ON dtc_codes USING GIN (compatibility);

    CREATE INDEX IF NOT EXISTS dtc_codes_search_idx
      ON dtc_codes USING GIN (search_text);
  `;
}

function buildEmbeddingTableSql(dimensions = 1536) {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`Invalid embedding dimension: ${dimensions}`);
  }

  return `
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS dtc_embeddings (
      code TEXT PRIMARY KEY REFERENCES dtc_codes(code) ON DELETE CASCADE,
      embedding vector(${dimensions}) NOT NULL,
      embed_model TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS dtc_embeddings_hnsw_idx
      ON dtc_embeddings
      USING hnsw (embedding vector_cosine_ops);
  `;
}

function createUpsertStatement(records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("createUpsertStatement requires at least one record");
  }

  const normalized = records.map(normalizeRecord);
  const values = [];
  const placeholders = [];
  let p = 1;

  for (const record of normalized) {
    placeholders.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}::text[], $${p++}::text[], $${p++}::text[], $${p++}::text[])`
    );
    values.push(
      record.code,
      record.type,
      record.ecu_module,
      record.short_desc,
      record.symptoms,
      record.causes,
      record.fixes,
      record.compatibility
    );
  }

  return {
    text: `
      INSERT INTO dtc_codes (
        code,
        type,
        ecu_module,
        short_desc,
        symptoms,
        causes,
        fixes,
        compatibility
      )
      VALUES ${placeholders.join(",")}
      ON CONFLICT (code)
      DO UPDATE SET
        type = EXCLUDED.type,
        ecu_module = EXCLUDED.ecu_module,
        short_desc = EXCLUDED.short_desc,
        symptoms = EXCLUDED.symptoms,
        causes = EXCLUDED.causes,
        fixes = EXCLUDED.fixes,
        compatibility = EXCLUDED.compatibility,
        updated_at = now()
    `,
    values
  };
}

module.exports = {
  buildCreateTableSql,
  buildEmbeddingTableSql,
  createUpsertStatement
};
