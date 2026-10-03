

/* v3 IIFE wrapper — see scripts/wrap_v3_iife.py. Every classic
 * tag shares one global lexical scope, so a bare top-level `const` in
 * one file is a redeclaration error in the next. */
(function () {
"use strict";
"use strict";

/* Parameter Hunt — v3.0.0 feature 6.
 *
 * The E-series data desert is a labour problem. There is no published KWP2000
 * local identifier table for any BMW E-series DME, and `research/bmw_diag_dim07
 * _local_ids.md` is the record of an exhaustive search finding none. Every
 * table that does exist was built by somebody sitting in a parking lot with a
 * laptop, revving the engine and watching which bytes moved. Almost nobody has
 * that Saturday free.
 *
 * This makes the work a sport. `ByteExplorerEngine` already does the hard part
 * — telling live bytes from static config — and this module turns that output
 * into scoring, challenges and a shareable record of what a contributor found.
 *
 * The design problem here is integrity, not fun. A leaderboard that awards
 * points for guesses produces a leaderboard full of wrong answers, and a
 * community table built from wrong answers is worse than no table. So:
 *
 *   - **Nothing scores on its own.** A responding identifier earns discovery
 *     points, but only once the contributor attaches what they actually did —
 *     the engine, the module, and the conditions. An unattributed finding is
 *     recorded and shown as such, never counted.
 *   - **Local points never outrank confirmed points.** A guess about a byte's
 *     meaning is capped below a merge that someone with the car could verify.
 *   - **Points are awarded once per (engine, identifier) pair.** Re-probing the
 *     same identifier a hundred times cannot farm the score, which is the
 *     obvious way a leaderboard dies.
 *   - **Verification is external and explicit.** `verified: true` is only ever
 *     set from a merge record, never from anything a contributor types.
 *
 * Pure: no DOM, no Tauri, no network. The leaderboard is data the app ships.
 */

const SCORES = {
  /* An identifier that responded where the app had no mapping. */
  discovery: 10,
  /* A byte mapped to a known physical value, self-reported. */
  byte_mapping: 50,
  /* A freeze-frame schema contributed and merged. */
  freeze_schema: 100,
  /* The first verified mapping of an engine's oil condition sensor. */
  first_oil_sensor: 500,
  /* A simulator or decoder bug fixed and merged. */
  bug_fix: 200,
  /* A DTC story entry merged. */
  dtc_story: 25,
};

const KINDS = Object.keys(SCORES);

/* A discovery only counts once the contributor says which car it was on. An
 * identifier that responds on an N54 and one that responds on an N52 are
 * different facts, and an unattributed one cannot be checked by anyone. */
const REQUIRED_FIELDS = ["engine", "module"];

function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function normalizeEngine(e) {
  return String(e || "").trim().toLowerCase();
}

/**
 * Validate a discovery and score it.
 *
 * @param {Object} d
 * @param {string} d.kind        one of KINDS
 * @param {string} [d.engine]    e.g. "n54", "b58"
 * @param {string} [d.module]    module name or address
 * @param {string} [d.ident]     the local identifier / DID, if applicable
 * @param {string} [d.label]     what the contributor believes it is
 * @param {boolean} [d.verified] only from a merge record, never user input
 * @returns {Object} { valid, points, reason, ... }
 */
function scoreDiscovery(d) {
  if (!d || typeof d !== "object") {
    return { valid: false, points: 0, reason: "No discovery supplied." };
  }
  const kind = String(d.kind || "");
  if (!KINDS.includes(kind)) {
    return {
      valid: false,
      points: 0,
      reason: `Unknown discovery kind "${kind}". Expected one of: ${KINDS.join(", ")}.`,
    };
  }
  const engine = normalizeEngine(d.engine);
  const module = String(d.module || "").trim();
  const missing = REQUIRED_FIELDS.filter(f =>
    !(f === "engine" ? engine : module));
  if (missing.length) {
    return {
      valid: false,
      points: 0,
      kind,
      engine,
      module,
      reason: `Missing ${missing.join(" and ")}. A finding that cannot be checked by someone else is recorded but never scored.`,
    };
  }

  const base = SCORES[kind];
  // An unverified claim is worth something — the probing is real work — but it
  // is capped below a verified one so the leaderboard cannot be won by volume.
  const points = d.verified === true ? base : Math.min(Math.floor(base / 2), 50);
  return {
    valid: true,
    kind,
    engine,
    module,
    ident: d.ident != null ? String(d.ident) : null,
    label: d.label != null ? String(d.label) : null,
    verified: d.verified === true,
    points,
    base_points: base,
    reason: d.verified === true
      ? `Confirmed by a merge: ${base} points.`
      : `Self-reported, awaiting confirmation: ${points} points (a confirmed ${kind.replace(/_/g, " ")} is worth ${base}).`,
  };
}

/**
 * A hunter's record: what they found, and what it is worth.
 *
 * Deduplication is on (kind, engine, module, ident) — the identity of the
 * finding, not of the submission. Re-probing the same identifier is how a
 * leaderboard gets farmed, so a repeat scores zero and says why.
 */
function createHunter(name) {
  const hunterName = String(name || "").trim() || "anonymous";
  const findings = [];

  function key(f) {
    return [f.kind, f.engine, f.module, f.ident == null ? "" : f.ident].join("|");
  }

  return {
    name: hunterName,

    /**
     * Record a discovery.
     * @returns {Object} the scored discovery, with `duplicate` set if it is one
     */
    add(d) {
      const scored = scoreDiscovery(d);
      if (!scored.valid) {
        findings.push(Object.assign({}, scored, {
          id: findings.length,
          counted: false,
          duplicate: false,
          recorded_at: null,
        }));
        return findings[findings.length - 1];
      }
      const k = key(scored);
      const prior = findings.find(f => f.counted && f.key === k);
      if (prior) {
        const dup = Object.assign({}, scored, {
          id: findings.length,
          counted: false,
          duplicate: true,
          duplicate_of: prior.id,
          points: 0,
          key: k,
          reason: `Already recorded as finding #${prior.id}. Re-probing the same identifier does not score again.`,
        });
        findings.push(dup);
        return dup;
      }
      const rec = Object.assign({}, scored, {
        id: findings.length,
        counted: true,
        duplicate: false,
        key: k,
      });
      findings.push(rec);
      return rec;
    },

    findings: () => findings.slice(),

    /* Only counted findings contribute. A recorded-but-unscored entry is kept
     * for the contributor's own record, never for the total. */
    total: () => findings.reduce((a, f) => a + (f.counted ? f.points : 0), 0),

    /* What a confirmation would add, so the UI can show the gap. */
    pending: () => findings
      .filter(f => f.counted && !f.verified)
      .map(f => ({ id: f.id, kind: f.kind, would_gain: f.base_points - f.points }))
      .sort((a, b) => b.would_gain - a.would_gain),
  };
}

/**
 * Build a leaderboard from hunters. Shipped as data, computed locally.
 *
 * @param {Array} hunters  from `createHunter()`
 * @returns {Array} ranked, with an `unconfirmed` flag so the UI can show that
 *   a lead built on self-reports is not yet a confirmed lead
 */
function leaderboard(hunters) {
  const rows = (Array.isArray(hunters) ? hunters : []).map(h => ({
    name: h.name,
    points: h.total(),
    // A hunter whose entire record is unconfirmed has not actually proven
    // anything yet; the leaderboard says so rather than implying otherwise.
    unconfirmed: h.pending().length > 0 && h.findings().every(f => !f.verified),
    confirmed: h.findings().filter(f => f.counted && f.verified).length,
    findings: h.findings().filter(f => f.counted).length,
  }));
  // Points first, then confirmed findings as the tiebreak: on equal points the
  // better-evidenced record wins, which is the whole point of the split.
  rows.sort((a, b) => (b.points - a.points) || (b.confirmed - a.confirmed) ||
    a.name.localeCompare(b.name));
  return rows.map((r, i) => Object.assign({ rank: i + 1 }, r));
}

/**
 * Evaluate a set of challenges against a set of discoveries.
 *
 * A challenge is a community goal ("map 5 new local identifiers on the N54
 * this month"). Progress counts only *counted* findings, so a hunter cannot
 * complete a challenge by spamming unverified guesses.
 */
function evaluateChallenges(challenges, hunters) {
  const list = Array.isArray(challenges) ? challenges : [];
  const all = [];
  for (const h of (Array.isArray(hunters) ? hunters : [])) {
    for (const f of h.findings()) {
      if (f.counted) all.push(Object.assign({ hunter: h.name }, f));
    }
  }
  return list.map(c => {
    const engine = normalizeEngine(c.engine);
    const matching = all.filter(f =>
      (!engine || f.engine === engine) &&
      (!c.kind || f.kind === c.kind));
    const unique = new Set(matching.map(f =>
      [f.kind, f.engine, f.module, f.ident == null ? "" : f.ident].join("|"))).size;
    const target = finite(c.target) ? c.target : 0;
    return {
      id: c.id,
      title: c.title,
      target,
      // Unique findings, not submissions: three probes of one identifier is
      // one discovery, and counting it as three would make every challenge
      // trivially completable. This is the number a challenge is judged on, so
      // it is the line worth defending.
      progress: unique,
      complete: target > 0 && unique >= target,
      contributors: [...new Set(matching.map(f => f.hunter))],
    };
  });
}

const api = {
  SCORES,
  KINDS,
  REQUIRED_FIELDS,
  createHunter,
  scoreDiscovery,
  leaderboard,
  evaluateChallenges,
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuParameterHunt = api;
})();
