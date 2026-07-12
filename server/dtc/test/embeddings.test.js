"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createEmbeddingClient, toEmbeddingInput, sha256Hex } = require("../embeddings");
const { seedDtcCodes } = require("../seed-dtc-codes");

test("toEmbeddingInput creates stable compact diagnostic text", () => {
  const text = toEmbeddingInput(seedDtcCodes[0]);

  assert.match(text, /Code: 2A82/);
  assert.match(text, /ECU: DME/);
  assert.match(text, /Symptoms:/);
  assert.match(text, /Compatibility: .*N54/);
});

test("sha256Hex is stable for embedding change detection", () => {
  assert.equal(
    sha256Hex("beemuu"),
    "2dc7359a2e402a973f82ca8fc17e8b34e5c21d3ec481121dff40b7a4dcefbf18"
  );
});

test("createEmbeddingClient calls an OpenAI-compatible embeddings endpoint", async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { data: [{ embedding: [0.1, 0.2, 0.3] }] };
      }
    };
  };

  const client = createEmbeddingClient({
    apiKey: "test-key",
    endpoint: "https://embeddings.example/v1/embeddings",
    model: "text-embedding-small",
    fetchImpl: fakeFetch
  });

  const embedding = await client.embedText("rough idle and VANOS code");

  assert.deepEqual(embedding, [0.1, 0.2, 0.3]);
  assert.equal(calls[0].url, "https://embeddings.example/v1/embeddings");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-key");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: "text-embedding-small",
    input: "rough idle and VANOS code"
  });
});

test("createEmbeddingClient surfaces provider errors", async () => {
  const client = createEmbeddingClient({
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      async text() {
        return "rate limited";
      }
    })
  });

  await assert.rejects(() => client.embedText("x"), /Embedding request failed: 429 rate limited/);
});
