"use strict";

const { normalizeCode } = require("./normalizer");

function extractDtcCodes(text) {
  const input = String(text || "").toUpperCase();
  const pattern = /(^|[^A-Z0-9])(?:0X)?([PCBU][0-9A-F]{4}|[0-9A-F]{4})(?=$|[^A-Z0-9])/g;
  const seen = new Set();
  const codes = [];

  for (const match of input.matchAll(pattern)) {
    const code = normalizeCode(match[2]);
    if (seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }

  return codes;
}

function toPgVector(vector) {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("toPgVector requires a non-empty embedding array");
  }
  return `[${vector.map((n) => Number(n)).join(",")}]`;
}

function createSupermemorySearcher({ pool, embedText, semanticLimit = 8 } = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("createSupermemorySearcher requires a pg-compatible pool");
  }
  if (typeof embedText !== "function") {
    throw new Error("createSupermemorySearcher requires an embedText function");
  }

  async function findExactCodes(codes) {
    if (!codes.length) return [];
    const { rows } = await pool.query(
      `
        SELECT
          code,
          type,
          ecu_module,
          short_desc,
          symptoms,
          causes,
          fixes,
          compatibility,
          1.0::float AS score,
          true AS exact_match
        FROM dtc_codes
        WHERE code = ANY($1::text[])
      `,
      [codes]
    );
    return rows;
  }

  async function semanticDtcSearch(userText, vehicle = {}, options = {}) {
    const limit = options.limit || semanticLimit;
    const tags = vehicleTags(vehicle);
    const embeddingInput = [
      vehicle.year,
      vehicle.make || "BMW",
      vehicle.model,
      vehicle.engine,
      vehicle.chassis,
      userText
    ]
      .filter(Boolean)
      .join(" ");

    const embedding = await embedText(embeddingInput);
    const { rows } = await pool.query(
      `
        SELECT
          d.code,
          d.type,
          d.ecu_module,
          d.short_desc,
          d.symptoms,
          d.causes,
          d.fixes,
          d.compatibility,
          1 - (e.embedding <=> $1::vector) AS score,
          false AS exact_match,
          CASE
            WHEN cardinality($3::text[]) = 0 THEN 'vehicle_unknown'
            WHEN d.compatibility && $3::text[] THEN 'match'
            WHEN d.type = 'obd2' THEN 'generic_obd2'
            ELSE 'unverified_for_vehicle'
          END AS compatibility_status
        FROM dtc_embeddings e
        JOIN dtc_codes d ON d.code = e.code
        ORDER BY
          CASE
            WHEN d.compatibility && $3::text[] THEN 0
            WHEN d.type = 'obd2' THEN 1
            ELSE 2
          END,
          e.embedding <=> $1::vector
        LIMIT $2
      `,
      [toPgVector(embedding), limit, tags]
    );
    return rows;
  }

  async function searchSupermemory(userText, vehicle = {}, options = {}) {
    const exactCodes = extractDtcCodes(userText);
    const [exactHits, semanticHits] = await Promise.all([
      findExactCodes(exactCodes),
      semanticDtcSearch(userText, vehicle, options)
    ]);

    const byCode = new Map();
    for (const hit of [...exactHits, ...semanticHits]) {
      if (!byCode.has(hit.code)) byCode.set(hit.code, hit);
    }

    return [...byCode.values()].slice(0, options.limit || semanticLimit);
  }

  return { findExactCodes, semanticDtcSearch, searchSupermemory };
}

function vehicleTags(vehicle = {}) {
  return [vehicle.engine, vehicle.chassis, vehicle.platform, vehicle.model]
    .filter(Boolean)
    .map((value) => String(value).trim().toUpperCase())
    .filter(Boolean);
}

function toEmbeddingText(record) {
  if (!record) throw new Error("toEmbeddingText requires a DTC record");

  return [
    `Code: ${record.code}`,
    `Type: ${record.type}`,
    `ECU: ${record.ecu_module}`,
    `Description: ${record.short_desc}`,
    `Symptoms: ${(record.symptoms || []).join("; ")}`,
    `Causes: ${(record.causes || []).join("; ")}`,
    `Fixes: ${(record.fixes || []).join("; ")}`,
    `Compatibility: ${(record.compatibility || []).join(", ")}`
  ].join("\n");
}

function compatibilityStatus(record, tags) {
  if (!tags.length) return "vehicle_unknown";
  const compatibility = new Set((record.compatibility || []).map((tag) => String(tag).toUpperCase()));
  if (tags.some((tag) => compatibility.has(tag))) return "match";
  if (record.type === "obd2") return "generic_obd2";
  return "unverified_for_vehicle";
}

function buildSupermemoryContext({ userMessage, vehicle = {}, hits = [] }) {
  const tags = vehicleTags(vehicle);

  return {
    source: "beemuu_supermemory",
    version: 1,
    user_problem: userMessage,
    vehicle: {
      year: vehicle.year || null,
      make: vehicle.make || "BMW",
      model: vehicle.model || null,
      engine: vehicle.engine || null,
      chassis: vehicle.chassis || null,
      mileage: vehicle.mileage || null
    },
    vehicle_tags: tags,
    diagnostic_candidates: hits.map((hit) => ({
      code: hit.code,
      type: hit.type,
      ecu_module: hit.ecu_module,
      short_desc: hit.short_desc,
      score: Number(hit.score || 0),
      exact_match: Boolean(hit.exact_match),
      compatibility_status: hit.compatibility_status || compatibilityStatus(hit, tags),
      compatibility: hit.compatibility || [],
      symptoms: (hit.symptoms || []).slice(0, 6),
      causes: (hit.causes || []).slice(0, 6),
      fixes: (hit.fixes || []).slice(0, 8)
    })),
    rules: [
      "Exact DTC matches have priority over semantic matches.",
      "Do not apply engine-specific BMW factory faults to incompatible engines or chassis without saying compatibility is unverified.",
      "If vehicle engine/chassis is unknown, ask for it before making engine-specific claims.",
      "Use fixes as diagnostic steps, not as guaranteed repairs."
    ]
  };
}

const BEEMUU_DIAGNOSTIC_AGENT_SYSTEM_PROMPT = `You are the beemuu Diagnostic Agent, an expert BMW troubleshooting assistant for beemuu.com.

Your job is to help users and autonomous agents reason about BMW diagnostic trouble codes, drivability symptoms, ECU faults, and physical troubleshooting steps.

Brand voice:
- Calm, sharp, technically credible.
- Plain English first, technician detail second.
- No fluff, no fearmongering, no fake certainty.
- beemuu is diagnostic-first: test before parts.

You will often receive trusted backend-injected JSON called "beemuu Supermemory context". This context contains matching DTC records from the beemuu diagnostic database, including code, type, ECU module, symptoms, causes, fixes, compatibility, exact-match status, and semantic similarity score.

Core rules:
1. Use Supermemory first. Ground your diagnosis in injected Supermemory whenever it is present. Prefer exact DTC matches over semantic matches. Cite relevant codes by code ID.
2. Do not hallucinate BMW compatibility. Never claim a BMW factory code applies to a specific engine or chassis unless the compatibility list or confirmed vehicle data supports it. Do not transfer N54-specific, N55-specific, B58-specific, diesel-specific, or chassis-specific advice across platforms without warning that compatibility is unverified.
3. Distinguish code types. OBD-II codes such as P0301 are generic starting points. BMW proprietary hex codes such as 2A82 or 30FF are usually more specific to BMW ECU logic.
4. Diagnose, do not guess. Rank likely causes by evidence, prefer verification before replacement, and avoid parts-cannon advice.
5. Safety and mechanical caution. Warn users not to continue hard driving with flashing check-engine lights, severe misfires, overheating, oil-pressure warnings, brake faults, or steering/suspension safety faults. Do not advise bypassing emissions systems, safety systems, immobilizers, or inspection requirements.
6. Output format: start with a short direct summary, then provide: most likely matches, why they fit, what to check first, step-by-step diagnostic path, and what information would improve confidence.
7. Be honest about limitations. You cannot actually scan the vehicle unless scan data was provided. If the user provides only vague symptoms, provide a ranked diagnostic path, not a definitive answer.

When responding, use the Supermemory context as the trusted diagnostic memory layer and the user's message as the current symptom report. If the two conflict, explain the conflict and ask for scan data, engine, chassis, and freeze-frame details.`;

module.exports = {
  extractDtcCodes,
  toPgVector,
  createSupermemorySearcher,
  vehicleTags,
  toEmbeddingText,
  compatibilityStatus,
  buildSupermemoryContext,
  BEEMUU_DIAGNOSTIC_AGENT_SYSTEM_PROMPT
};
