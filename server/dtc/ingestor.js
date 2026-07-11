"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { normalizeRecord } = require("./normalizer");
const { buildCreateTableSql, buildEmbeddingTableSql, createUpsertStatement } = require("./sql");

function createDefaultPool() {
  // Lazy require keeps unit tests dependency-free and lets the Tauri desktop app
  // install only its existing dev deps. Production beemuu.com installs `pg`.
  // eslint-disable-next-line global-require
  const { Pool } = require("pg");
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "beemuu-dtc-ingestor"
  });
}

class DtcIngestor {
  constructor({ pool = createDefaultPool(), batchSize = 500 } = {}) {
    if (!pool || typeof pool.connect !== "function") {
      throw new Error("DtcIngestor requires a pg-compatible pool");
    }
    this.pool = pool;
    this.batchSize = batchSize;
  }

  async ensureSchema({ embeddings = false, dimensions = 1536 } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query(buildCreateTableSql());
      if (embeddings) await client.query(buildEmbeddingTableSql(dimensions));
    } finally {
      client.release();
    }
  }

  async upsertDtcCodes(records) {
    if (!Array.isArray(records)) {
      throw new Error("upsertDtcCodes expects an array of records");
    }

    const normalized = records.map(normalizeRecord);
    if (normalized.length === 0) {
      return { received: 0, upserted: 0 };
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      let upserted = 0;
      for (let i = 0; i < normalized.length; i += this.batchSize) {
        const batch = normalized.slice(i, i + this.batchSize);
        const statement = createUpsertStatement(batch);
        await client.query(statement.text, statement.values);
        upserted += batch.length;
      }

      await client.query("COMMIT");
      return { received: records.length, upserted };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

async function readJsonRecords(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a JSON array of DTC records`);
  }
  return parsed;
}

async function main(argv = process.argv.slice(2)) {
  const filePath = argv[0];
  if (!filePath) {
    throw new Error("Usage: node server/dtc/ingestor.js ./dtc-codes.json");
  }

  const absolute = path.resolve(filePath);
  const records = await readJsonRecords(absolute);
  const ingestor = new DtcIngestor();

  try {
    await ingestor.ensureSchema({ embeddings: process.env.DTC_ENABLE_PGVECTOR === "1" });
    const result = await ingestor.upsertDtcCodes(records);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (typeof ingestor.pool.end === "function") {
      await ingestor.pool.end();
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = {
  DtcIngestor,
  createDefaultPool,
  readJsonRecords,
  main
};
