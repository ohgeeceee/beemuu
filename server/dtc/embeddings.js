"use strict";

const crypto = require("node:crypto");

const { toEmbeddingText } = require("./supermemory");

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

function toEmbeddingInput(record) {
  return toEmbeddingText(record);
}

function createEmbeddingClient({
  apiKey = process.env.EMBEDDING_API_KEY,
  endpoint = process.env.EMBEDDING_ENDPOINT || "https://api.openai.com/v1/embeddings",
  model = process.env.EMBEDDING_MODEL || "text-embedding-3-small",
  fetchImpl = globalThis.fetch
} = {}) {
  if (!apiKey) throw new Error("EMBEDDING_API_KEY is required");
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");

  async function embedText(input) {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, input })
    });

    if (!res.ok) {
      const text = typeof res.text === "function" ? await res.text() : "";
      throw new Error(`Embedding request failed: ${res.status} ${text}`.trim());
    }

    const json = await res.json();
    const embedding = json && json.data && json.data[0] && json.data[0].embedding;
    if (!Array.isArray(embedding)) {
      throw new Error("Embedding response did not include data[0].embedding");
    }
    return embedding;
  }

  return { embedText, model, endpoint };
}

module.exports = {
  createEmbeddingClient,
  toEmbeddingInput,
  sha256Hex
};
