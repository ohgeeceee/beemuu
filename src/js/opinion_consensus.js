/* v3 IIFE wrapper — see scripts/wrap_v3_iife.py. Every classic
 * tag shares one global lexical scope, so a bare top-level `const` in
 * one file is a redeclaration error in the next. */
(function () {
"use strict";

/* Second Opinion — v4.3.0 feature 4.
 *
 * The community repair library (community/opinions/*.toml) stores, per fault
 * code, a handful of [[opinion]] rows: a `perspective` (diy / indie / dealer),
 * a free-text `source`, the `action` someone proposes, and what it costs. It is
 * tempting to render that list as an answer — to show the most-repeated action
 * as "the fix". That is exactly the mistake this module refuses to make.
 *
 * AGREEMENT MUST BE EARNED, NOT ASSUMED.
 *
 * Three failure modes make a naive "most votes wins" wrong:
 *
 *   1. One voice, many posts. A single enthusiastic forum thread can be quoted
 *      ten times. Counting rows as votes turns one person's guess into a
 *      mandate. So a verdict needs MIN_DISTINCT_SOURCES independent sources,
 *      not just a pile of rows: ten identical rows from one source are one
 *      source.
 *
 *   2. A thin quorum. Two opinions that happen to agree are a coincidence, not
 *      a consensus. Below MIN_OPINIONS opinions or MIN_DISTINCT_SOURCES sources
 *      this module returns verdict "insufficient", a null score and confidence
 *      0, and says in plain language which quota was short. A single very
 *      confident opinion — a workshop, even — is NOT a consensus and must never
 *      be rendered as one.
 *
 *   3. A coin toss dressed as a majority. When the top two repairs are within
 *      CONTENTION_MARGIN of each other, neither has "won". The module returns
 *      contested true, winner null, and an explicit contention block naming the
 *      two candidates, rather than quietly crowning the leader.
 *
 * Sources are not equal, so opinions are weighted before they are tallied. A
 * workshop that has done the job outranks a verified owner, who outranks an
 * owner, who outranks an anonymous post. An unknown source tier is treated as
 * the LOWEST weight — never a neutral default of 1, which would let an
 * unattributable row count as much as a mechanic. An opinion is also
 * down-weighted when its mileage band is far from the vehicle's (the same fault
 * behaves differently at 30k and 200k miles) and when it is stale relative to
 * the injected `now`.
 *
 * The score this module returns is a WEIGHTED SHARE of the tally, not a
 * probability or a likelihood of the repair being correct. Nothing here is a
 * prediction; it is a summary of who said what, and how much that is worth.
 *
 * It is pure: no DOM, no window access except the export line, no Tauri, no
 * fetch, no randomness, and no Date.now() — the current time is passed in as an
 * option so a run is deterministic and testable.
 *
 * Consumed opinion shape. The loader normalises a stored row into:
 *
 *   { repair_id   : string,  // which repair is proposed (stored `action`)
 *     source      : string,  // who says so — a tier or a named origin
 *     mileage_band: number,  // odometer the opinion was formed at
 *     updated_at  : number } // epoch seconds the opinion was last touched
 *
 * Community field names are accepted as aliases so the raw TOML rows can be
 * handed straight in: `action`/`id` for repair_id, `perspective` for the source
 * tier, and `updated`/`created_at` for the timestamp.
 *
 * Dual export: `require()` under node --test, plain <script> in the webview.
 */

/* ------------------------------------------------------------------ *
 * Thresholds and source tiers. Exported so the panel can label a row
 * with the same numbers and weights the engine acted on, and so the
 * tests pin the real values.
 * ------------------------------------------------------------------ */

/* Source tiers, highest first. A named origin can be qualified ("workshop:autohaus-berlin");
 * the tier is the part before the colon. The three community `perspective`
 * values are aliases onto their nearest tier. */
const SOURCE_TIERS = {
  workshop: 1,           // a shop that has performed the repair
  dealer: 1,             // community perspective alias for workshop-class
  verified_owner: 0.75,  // an owner who has proven the fix with evidence
  owner: 0.5,            // an owner reporting from their own car
  indie: 0.5,            // community perspective alias for owner-class
  anonymous: 0.25,       // attribution unknown
  diy: 0.25,             // community perspective alias for anonymous-class
};
/* The floor. An unrecognised tier resolves here — deliberately not 1. */
const LOWEST_WEIGHT = 0.25;

const MIN_OPINIONS = 4;          // below this no verdict is possible
const MIN_DISTINCT_SOURCES = 2;  // ... and one voice, however loud, is not a quorum
const CONTENTION_MARGIN = 0.25;  // top two within this relative gap are "too close"
const MILEAGE_BAND_TOLERANCE = 30000; // miles; beyond this an opinion is off-band
const MILEAGE_FAR_FACTOR = 0.5;       // ... and is down-weighted by this
const STALE_AFTER_SECONDS = 63072000; // 730 days; older than this is stale
const STALE_FACTOR = 0.5;             // ... and is down-weighted by this

/* ------------------------------------------------------------------ *
 * Normalisation. A stored row — TOML opinion, JSON, or a test
 * literal — becomes the one shape the engine reasons about. Anything
 * that cannot name a repair is not an opinion and is dropped, never
 * defaulted into one.
 * ------------------------------------------------------------------ */
function firstString(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function firstFinite(...values) {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/* The tier key for an opinion: the first field that names a known tier wins,
 * so a bare community row (perspective only) still resolves. Unknown → null,
 * which sourceWeight() maps to the floor. */
function resolveTier(raw) {
  for (const c of [raw.source_tier, raw.source, raw.perspective]) {
    if (typeof c === "string") {
      const key = c.trim().toLowerCase();
      if (Object.prototype.hasOwnProperty.call(SOURCE_TIERS, key)) return key;
    }
  }
  return null;
}

function normalizeOpinion(raw) {
  if (!raw || typeof raw !== "object") return null;
  const repair_id = firstString(raw.repair_id, raw.repair, raw.id, raw.action);
  if (!repair_id) return null;
  // The source identity (for the distinct-source count) is the human origin;
  // the tier (for weighting) is resolved separately and may differ.
  const source = firstString(raw.source, raw.source_id, raw.author, raw.perspective)
    || resolveTier(raw) || "anonymous";
  return {
    repair_id,
    source: String(source).trim().toLowerCase(),
    tier: resolveTier(raw),
    mileage_band: firstFinite(raw.mileage_band, raw.mileage),
    updated_at: firstFinite(raw.updated_at, raw.updated, raw.created_at, raw.created),
  };
}

/* ------------------------------------------------------------------ *
 * Weighting
 * ------------------------------------------------------------------ */

/* Weight of a source tier. An unrecognised tier gets LOWEST_WEIGHT — an
 * unattributable row must never count as much as a workshop. */
function sourceWeight(source) {
  if (typeof source !== "string") return LOWEST_WEIGHT;
  const key = source.trim().toLowerCase();
  const tier = key.includes(":") ? key.split(":")[0].trim() : key;
  return Object.prototype.hasOwnProperty.call(SOURCE_TIERS, tier)
    ? SOURCE_TIERS[tier]
    : LOWEST_WEIGHT;
}

/* 1 when the opinion's mileage band is within tolerance of the vehicle's, else
 * the far factor. Without either number the band cannot be judged, so it is
 * left at full weight rather than guessed at. The boundary is inclusive. */
function mileageFactor(normalized, opts) {
  const vehicle = firstFinite(opts.vehicle_mileage, opts.mileage);
  const band = normalized.mileage_band;
  if (vehicle == null || band == null) return 1;
  return Math.abs(band - vehicle) <= MILEAGE_BAND_TOLERANCE ? 1 : MILEAGE_FAR_FACTOR;
}

/* 1 when the opinion is fresh relative to the injected now, else the stale
 * factor. The boundary is inclusive: exactly STALE_AFTER_SECONDS is fresh. */
function recencyFactor(normalized, opts) {
  const now = firstFinite(opts.now);
  const at = normalized.updated_at;
  if (now == null || at == null) return 1;
  return (now - at) > STALE_AFTER_SECONDS ? STALE_FACTOR : 1;
}

/* One opinion's contribution: tier weight bent by mileage and recency. Returns
 * null for anything that is not an opinion (no repair to name). */
function weightOpinion(opinion, opts = {}) {
  const n = normalizeOpinion(opinion);
  if (!n) return null;
  const source_weight = sourceWeight(n.source);
  const mf = mileageFactor(n, opts);
  const rf = recencyFactor(n, opts);
  return {
    repair_id: n.repair_id,
    source: n.source,
    tier: n.tier,
    mileage_band: n.mileage_band,
    weight_source: source_weight,
    mileage_factor: mf,
    recency_factor: rf,
    weight: Number((source_weight * mf * rf).toFixed(6)),
  };
}

/* ------------------------------------------------------------------ *
 * Tally
 * ------------------------------------------------------------------ */

/* Group weighted opinions by repair. `weighted` is the sum of earned weights;
 * `distinct_sources` counts independent origins, so ten rows from one source
 * still read as one. `supporters`/`dissenters` split the field for this repair.
 */
function tally(opinions, opts = {}) {
  const list = Array.isArray(opinions) ? opinions : [];
  const byId = new Map();
  const allSources = new Set();
  let n = 0;
  for (const raw of list) {
    const w = weightOpinion(raw, opts);
    if (!w) continue;
    n++;
    allSources.add(w.source);
    let rec = byId.get(w.repair_id);
    if (!rec) {
      rec = { repair_id: w.repair_id, raw_count: 0, weighted: 0, sources: new Set() };
      byId.set(w.repair_id, rec);
    }
    rec.raw_count++;
    rec.weighted += w.weight;
    rec.sources.add(w.source);
  }
  const repairs = [...byId.values()].map(r => ({
    repair_id: r.repair_id,
    raw_count: r.raw_count,
    weighted: Number(r.weighted.toFixed(6)),
    distinct_sources: r.sources.size,
    sources: [...r.sources].sort(),
    supporters: r.raw_count,
    dissenters: n - r.raw_count,
  }));
  repairs.sort((a, b) => b.weighted - a.weighted || a.repair_id.localeCompare(b.repair_id));
  const total_weight = Number(repairs.reduce((a, r) => a + r.weighted, 0).toFixed(6));
  return { repairs, n_opinions: n, n_sources: allSources.size, n_repairs: repairs.length, total_weight };
}

/* ------------------------------------------------------------------ *
 * Consensus. Reads a tally and decides whether agreement was earned —
 * or whether the field was too thin, or too evenly split, to say.
 * ------------------------------------------------------------------ */
function consensus(t, opts = {}) {
  const tt = t && typeof t === "object" ? t : {};
  const repairs = Array.isArray(tt.repairs) ? tt.repairs : [];
  const n = tt.n_opinions || 0;
  const ns = tt.n_sources || 0;
  const evidence = [];

  // Refuse first. A quota missed is not a weak verdict; it is no verdict.
  if (n < MIN_OPINIONS) {
    evidence.push(`only ${n} opinion${n === 1 ? "" : "s"} — a quorum needs ${MIN_OPINIONS}`);
  }
  if (ns < MIN_DISTINCT_SOURCES) {
    evidence.push(`only ${ns} distinct source${ns === 1 ? "" : "s"} — a quorum needs ${MIN_DISTINCT_SOURCES}`);
  }
  if (n < MIN_OPINIONS || ns < MIN_DISTINCT_SOURCES) {
    return { winner: null, contested: false, margin: null, contention: null, verdict: "insufficient", score: null, confidence: 0, evidence };
  }
  if (!repairs.length) {
    evidence.push("no repair attracted any opinion");
    return { winner: null, contested: false, margin: null, contention: null, verdict: "insufficient", score: null, confidence: 0, evidence };
  }

  const top = repairs[0];
  const second = repairs[1] || null;

  // The margin is the leader's relative lead over the runner-up. With a single
  // repair the field is unanimous, and the lead is full.
  const margin = second && top.weighted > 0
    ? Number(((top.weighted - second.weighted) / top.weighted).toFixed(6))
    : 1;

  const contested = repairs.length > 1 && margin <= CONTENTION_MARGIN;

  // Confidence rises with the size of the quorum and with the leader's lead.
  // It describes the tally's solidity, not the repair's truth.
  const quorumFactor = Math.min(1, n / (MIN_OPINIONS * 2));
  const sourceFactor = Math.min(1, ns / (MIN_DISTINCT_SOURCES * 2));
  const marginFactor = Math.max(0, Math.min(1, margin));
  const confidence = Number((0.4 * quorumFactor + 0.3 * sourceFactor + 0.3 * marginFactor).toFixed(3));

  if (contested) {
    evidence.push(`${top.repair_id} and ${second.repair_id} lead by a gap inside the ${CONTENTION_MARGIN} contention threshold — no winner is picked`);
    return {
      winner: null,
      contested: true,
      margin,
      contention: {
        leader: top.repair_id,
        challenger: second.repair_id,
        margin,
        threshold: CONTENTION_MARGIN,
        note: `${top.repair_id} and ${second.repair_id} are within ${CONTENTION_MARGIN} of each other`,
      },
      verdict: "contested",
      score: null,
      confidence,
      evidence,
    };
  }

  evidence.push(`agreement on ${top.repair_id}: ${top.raw_count} opinion${top.raw_count === 1 ? "" : "s"} across ${top.distinct_sources} source${top.distinct_sources === 1 ? "" : "s"}`);
  const score = tt.total_weight > 0 ? Number((top.weighted / tt.total_weight).toFixed(6)) : null;
  return { winner: top.repair_id, contested: false, margin, contention: null, verdict: "agreed", score, confidence, evidence };
}

/* ------------------------------------------------------------------ *
 * Public entry point. Everything a panel needs in one shape.
 * ------------------------------------------------------------------ */
function analyze(opinions, opts = {}) {
  const t = tally(opinions, opts);
  const c = consensus(t, opts);
  const dissent = c.winner == null
    ? t.repairs.slice()
    : t.repairs.filter(r => r.repair_id !== c.winner);

  let headline;
  if (c.verdict === "insufficient") {
    headline = `no second opinion: ${t.n_opinions} opinion${t.n_opinions === 1 ? "" : "s"} from ${t.n_sources} source${t.n_sources === 1 ? "" : "s"} is below the ${MIN_OPINIONS}-opinion / ${MIN_DISTINCT_SOURCES}-source quorum`;
  } else if (c.verdict === "contested") {
    headline = `contested: ${c.contention.leader} and ${c.contention.challenger} are too close to call`;
  } else {
    const leader = t.repairs[0];
    headline = `${c.winner} has community agreement (${leader.raw_count} opinion${leader.raw_count === 1 ? "" : "s"} across ${leader.distinct_sources} source${leader.distinct_sources === 1 ? "" : "s"})`;
  }

  return {
    ranking: t.repairs,
    consensus: c,
    dissent,
    summary: {
      n_opinions: t.n_opinions,
      n_sources: t.n_sources,
      n_repairs: t.n_repairs,
      headline,
    },
  };
}

const api = {
  SOURCE_TIERS,
  LOWEST_WEIGHT,
  MIN_OPINIONS,
  MIN_DISTINCT_SOURCES,
  CONTENTION_MARGIN,
  MILEAGE_BAND_TOLERANCE,
  MILEAGE_FAR_FACTOR,
  STALE_AFTER_SECONDS,
  STALE_FACTOR,
  normalizeOpinion,
  resolveTier,
  sourceWeight,
  mileageFactor,
  recencyFactor,
  weightOpinion,
  tally,
  consensus,
  analyze,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuOpinionConsensus = api;
})();
