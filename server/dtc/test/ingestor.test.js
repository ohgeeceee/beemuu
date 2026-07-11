"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { DtcIngestor } = require("../ingestor");
const { seedDtcCodes } = require("../seed-dtc-codes");

test("DtcIngestor ensures schema then upserts in bounded batches", async () => {
  const calls = [];
  const fakePool = {
    async connect() {
      calls.push(["connect"]);
      return {
        async query(text, values) {
          calls.push([text, values]);
        },
        release() {
          calls.push(["release"]);
        }
      };
    }
  };

  const ingestor = new DtcIngestor({ pool: fakePool, batchSize: 2 });
  const result = await ingestor.upsertDtcCodes(seedDtcCodes);

  assert.deepEqual(result, { received: 3, upserted: 3 });
  assert.match(calls[1][0], /BEGIN/);
  assert.match(calls[2][0], /INSERT INTO dtc_codes/);
  assert.equal(calls[2][1].length, 16);
  assert.match(calls[3][0], /INSERT INTO dtc_codes/);
  assert.equal(calls[3][1].length, 8);
  assert.match(calls[4][0], /COMMIT/);
  assert.deepEqual(calls.at(-1), ["release"]);
});

test("DtcIngestor rolls back and releases the client when a batch fails", async () => {
  const calls = [];
  const fakePool = {
    async connect() {
      return {
        async query(text) {
          calls.push(text);
          if (/INSERT INTO dtc_codes/.test(text)) throw new Error("db failed");
        },
        release() {
          calls.push("release");
        }
      };
    }
  };

  const ingestor = new DtcIngestor({ pool: fakePool, batchSize: 500 });

  await assert.rejects(() => ingestor.upsertDtcCodes(seedDtcCodes), /db failed/);
  assert.ok(calls.some((text) => /ROLLBACK/.test(text)));
  assert.equal(calls.at(-1), "release");
});
