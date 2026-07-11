# beemuu.com DTC Supermemory

This directory contains the minimal Node.js data layer for the public beemuu.com
DTC catalog and AI Supermemory feature. It is intentionally vanilla CommonJS:
no build step, no framework lock-in, and only one production DB dependency
(`pg`) when the code is wired into the Express backend.

## Canonical DTC record

```js
{
  code: "2A82",                 // unique primary key, normalized uppercase
  type: "bmw_hex",              // "obd2" | "bmw_hex"
  ecu_module: "DME",            // DME, EGS, DSC, ABS, etc.
  short_desc: "VANOS intake mechanism fault",
  symptoms: ["rough idle"],
  causes: ["sticking VANOS solenoid"],
  fixes: ["1. Check oil level and condition."],
  compatibility: ["N54", "E90"]
}
```

## Files

- `seed-dtc-codes.js` — production starter dataset: `2A82`, `P0301`, `30FF`.
- `normalizer.js` — schema validation, code/type inference, array cleanup.
- `sql.js` / `schema.js` — PostgreSQL + pgvector DDL and bulk upsert SQL.
- `ingestor.js` — batch insert/upsert pipeline for thousands of records.
- `source-parser.js` — JSON/CSV parsing + source reconciliation helpers.
- `embeddings.js` — OpenAI-compatible embedding client and text hashing.
- `supermemory.js` — exact DTC lookup, semantic search, context construction,
  and the beemuu Diagnostic Agent system prompt.

## Production DB strategy

The catalog table is global/read-optimized; tenant-specific vehicle scans and
user history should live elsewhere with tenant IDs. Exact code lookup uses the
`code` primary key. Compatibility filters use a GIN array index. Broad text
fallback uses the generated `search_text` tsvector. Semantic matching uses
`dtc_embeddings` with pgvector HNSW.

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

If the embedding provider returns a dimension other than 1536, call
`buildEmbeddingTableSql(dimensions)` with that dimension before migration.

## CLI ingestion

```bash
# Production install in the Node/Express app:
npm install pg

DATABASE_URL='postgres://user:pass@host:5432/beemuu' \
  node server/dtc/ingestor.js ./data/canonical-dtcs.json
```

The CLI is idempotent: it creates schema if needed and upserts by `code`.

## Source ingestion architecture

Recommended autonomous worker split:

1. `fetch-source` mirrors licensed/open source inputs under `data/raw/<source>/`
   with URL, source commit, and content hash.
2. `parse-source` converts JSON/CSV/text exports to raw records. Keep parser
   output deterministic.
3. `normalize-source` runs `normalizeRecord()` and rejects malformed rows.
4. `reconcile-records` merges duplicate codes, preserving richer arrays.
5. `ingestor` performs transactional batch upserts.
6. `refresh-embeddings` rebuilds embeddings only when `sha256Hex(toEmbeddingInput(record))`
   changes.

Important: do not scrape proprietary BMW/ISTA text into the public repo. Codes
and short factual statements are fine; copied proprietary repair prose is not.

## Express integration sketch

```js
const { Pool } = require("pg");
const { createEmbeddingClient } = require("./server/dtc/embeddings");
const {
  createSupermemorySearcher,
  buildSupermemoryContext,
  BEEMUU_DIAGNOSTIC_AGENT_SYSTEM_PROMPT
} = require("./server/dtc/supermemory");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const embeddingClient = createEmbeddingClient();
const supermemory = createSupermemorySearcher({
  pool,
  embedText: embeddingClient.embedText
});

app.post("/api/ai/diagnose", async (req, res, next) => {
  try {
    const { message, vehicle = {} } = req.body;
    const hits = await supermemory.searchSupermemory(message, vehicle, { limit: 8 });
    const context = buildSupermemoryContext({ userMessage: message, vehicle, hits });

    const messages = [
      { role: "system", content: BEEMUU_DIAGNOSTIC_AGENT_SYSTEM_PROMPT },
      {
        role: "system",
        content: "Trusted beemuu Supermemory context follows as JSON.\n\n" +
          JSON.stringify(context)
      },
      { role: "user", content: message }
    ];

    // Send `messages` to the configured LLM provider.
    res.json({ supermemory: context });
  } catch (err) {
    next(err);
  }
});
```
