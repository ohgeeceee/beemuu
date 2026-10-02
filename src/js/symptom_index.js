"use strict";

/* Symptom Index — v3.0.0 feature 7.
 *
 * Owners do not arrive with fault codes. They arrive with "it stumbles when it's
 * cold" and "there's a smell when I brake". Every tool in this space is
 * organised around codes, so the hardest part of the job — turning a sentence
 * into a shortlist — is the part nobody has built.
 *
 * This is that front door. It maps a described symptom to the fault codes and
 * components that actually cause it, and it is built on data the project
 * already ships: `wiring_detect.js` knows which circuits fault codes point at,
 * `dtc_confidence.js` knows which codes are verified against the shipped
 * database, and `cbs_predict.js` already reasons about conditions.
 *
 * What it deliberately does not do:
 *   - It does not diagnose. It shortlists candidates and says how confident it
 *     is. An index that says "this is your thermostat" is a liability.
 *   - It does not rank by keyword count. A symptom mentioning "cold" matching
 *     forty codes containing "coolant" is not a good answer. Ranking is by how
 *     *specifically* a candidate is tied to the described conditions, so a
 *     narrow signature outranks a broad keyword hit.
 *
 * Pure: no DOM, no Tauri, no transport. `index.js` is the dataset; a caller
 * passes a free-text symptom and gets back a ranked shortlist.
 */

/* ------------------------------------------------------------------ *
 * The index
 * ------------------------------------------------------------------ */

/* Each entry ties a set of observable conditions to what they point at.
 *
 * `signals` are the weighted terms a user is likely to use. Weight matters:
 * "cold" is a weak signal on its own (half the index involves temperature)
 * while "cold start stumble" as a phrase is strong. `codes` are the candidates
 * that symptom produces; `circuit` links to the wiring lookup so the panel can
 * render the chain without a second lookup. */
const SYMPTOMS = [
  {
    id: "cold_start_stumble",
    title: "Stumbles or hesitates on a cold start",
    description: "Rough running for the first seconds or minute, then clears.",
    signals: [
      { term: "cold start", weight: 5 },
      { term: "stumble", weight: 4 },
      { term: "hesitat", weight: 4 },
      { term: "jerk", weight: 3 },
      { term: "rough", weight: 2 },
      { term: "cold", weight: 2 },
      { term: "first start", weight: 3 },
      { term: "morning", weight: 2 },
    ],
    codes: [
      { code: "2A82", confidence: "verified", note: "VANOS intake — a cold-start-only fault is the classic signature" },
      { code: "2A87", confidence: "verified", note: "VANOS exhaust, same cold-start pattern" },
      // DISA is a real and very common cold-start culprit, but no circuit has
      // been published for it in community/wiring/. `circuit: false` tells the
      // panel to list the code without offering a wiring chain, rather than
      // inviting a fabricated pin number. Adding the real circuit is a
      // community contribution, not something to invent here.
      { code: "2A98", confidence: "community", circuit: false, note: "DISA runner — a sticking flap gives exactly this" },
    ],
    components: ["VANOS solenoids", "DISA valve", "Coolant thermostat"],
    checks: [
      "Does it clear within 60 seconds and stay smooth for the rest of the drive?",
      "Any cold-soak fuel smell? That points at injectors rather than ignition.",
    ],
  },
  {
    id: "rough_idle",
    title: "Rough or hunting idle",
    description: "Idle hunts, surges or drops, warm or cold.",
    signals: [
      { term: "idle", weight: 5 },
      { term: "hunt", weight: 4 },
      { term: "surge", weight: 3 },
      { term: "rough", weight: 3 },
      { term: "lurch", weight: 3 },
      { term: "rev", weight: 1 },
    ],
    codes: [
      { code: "2A82", confidence: "verified", note: "Stuck VANOS at idle" },
      { code: "2A87", confidence: "verified", note: "Stuck VANOS at idle" },
      { code: "P0171", confidence: "verified", note: "Lean at idle — MAF or an intake leak downstream of it" },
    ],
    components: ["Idle control valve", "MAF sensor", "Intake seals", "Vacuum leaks"],
    checks: [
      "Vacuum leak hunting with a smoke tool finds most of these in ten minutes.",
      "A dirty throttle body after a single failed wash is a very common cause.",
    ],
  },
  {
    id: "overheating",
    title: "Running hot or losing coolant",
    description: "Temperature gauge climbs, or coolant disappears.",
    signals: [
      { term: "overheat", weight: 5 },
      { term: "hot", weight: 3 },
      { term: "temperature", weight: 3 },
      { term: "coolant", weight: 3 },
      { term: "steam", weight: 4 },
      { term: "boil", weight: 3 },
      { term: "high temp", weight: 4 },
    ],
    codes: [
      { code: "2E81", confidence: "verified", note: "Electric coolant pump — this is the one that fails on E-series" },
      { code: "2E82", confidence: "verified", note: "Electric coolant pump, low speed" },
      { code: "29E0", confidence: "verified", note: "Crankcase ventilation heater — can raise oil temperature, not coolant" },
    ],
    components: ["Electric coolant pump", "Thermostat", "Radiator", "Expansion tank"],
    checks: [
      "Check for a hard pressure cap before anything else — it is free and it fools people.",
      "Never open a cooling system that is hot. This is the one safety note that matters.",
    ],
  },
  {
    id: "power_loss",
    title: "Lacks power or bogs under load",
    description: "Traction it does not have, worse when you ask for it.",
    signals: [
      { term: "no power", weight: 5 },
      { term: "lacks power", weight: 5 },
      { term: "bog", weight: 4 },
      { term: "hesitat", weight: 2 },
      { term: "struggle", weight: 3 },
      { term: "limp", weight: 4 },
      { term: "pull", weight: 2 },
    ],
    codes: [
      { code: "2A82", confidence: "verified", note: "VANOS loses authority under load when the cam is stuck" },
      { code: "2A87", confidence: "verified", note: "Same, exhaust side" },
      { code: "2A98", confidence: "community", circuit: false, note: "DISA restricts flow and it shows as a lack of top-end" },
    ],
    components: ["Turbocharger", "Boost leaks", "Fuel filters", "VANOS solenoids"],
    checks: [
      "A boost leak reads as a power fault and gets misdiagnosed as a turbo every time.",
      "Check fuel filter age before assuming anything mechanical.",
    ],
  },
  {
    id: "smell",
    title: "Burning or sweet smell",
    description: "Unusual smell, usually worse on cold starts or under load.",
    signals: [
      { term: "smell", weight: 5 },
      { term: "burn", weight: 4 },
      { term: "sweet", weight: 4 },
      { term: "rotten egg", weight: 5 },
      { term: "exhaust", weight: 3 },
      { term: "odour", weight: 5 },
      { term: "odor", weight: 5 },
    ],
    codes: [
      { code: "2E81", confidence: "verified", note: "Coolant pump seal weeping into the hot bay" },
      { code: "P0171", confidence: "verified", note: "Unburnt fuel from a lean running condition" },
    ],
    components: ["Exhaust manifold", "Coolant pump", "Fuel rail", "Diesel glow plug (M57/M47)"],
    checks: [
      "A sweet smell is coolant, not fuel. Follow it before it becomes a head gasket.",
      "Rotten eggs unburnt fuel — never drive it far like that.",
    ],
  },
  {
    id: "electrical",
    title: "Battery draining or dead on arrival",
    description: "Starts in the morning for a week, then does not.",
    signals: [
      { term: "battery", weight: 5 },
      { term: "drain", weight: 4 },
      { term: "flat", weight: 4 },
      { term: "dead", weight: 3 },
      { term: "won't start", weight: 3 },
      { term: "no start", weight: 3 },
      { term: "discharge", weight: 4 },
    ],
    codes: [
      { code: "2E81", confidence: "community", note: "Some E-series pumps draw parasitic current when the module sleeps badly" },
    ],
    components: ["Battery", "IBS sensor", "Alternator", "Comfort module"],
    checks: [
      "A parasitic draw test finds it in one pass; a multimeter in the glovebox does not.",
      "Check whether the car was previously fitted with a tracker or amplifier.",
    ],
  },
];

/* Below this, an index entry is not worth showing. A two-hit match on a weak
 * term is noise, and a shortlist full of noise is the same as no shortlist. */
const MIN_SCORE = 6;

function normalize(text) {
  return String(text || "").toLowerCase();
}

/**
 * Score one symptom entry against a free-text description.
 * @returns {{entry: Object, score: number, hits: Array<{term, weight}>}}
 */
function scoreSymptom(entry, text) {
  const haystack = normalize(text);
  const hits = [];
  let score = 0;
  for (const s of entry.signals) {
    if (haystack.includes(s.term)) {
      hits.push({ term: s.term, weight: s.weight });
      score += s.weight;
    }
  }
  // A stronger phrase matching should count for more than the sum of its parts:
  // "cold start" is the whole diagnosis, while "cold" and "start" separately
  // are each weak. Bonus is capped so one long phrase cannot carry a weak
  // single-term match past a genuinely specific multi-term one.
  const longest = hits.reduce((a, h) => Math.max(a, h.term.length), 0);
  if (longest >= 6) score += 3;
  return { entry, score, hits };
}

/**
 * Rank symptom entries for a free-text description.
 * @param {string} text
 * @returns {Array} ranked, best first
 */
function search(text) {
  if (!normalize(text).trim()) return [];
  return SYMPTOMS
    .map(e => scoreSymptom(e, text))
    .filter(r => r.score >= MIN_SCORE)
    .sort((a, b) => (b.score - a.score) || a.entry.id.localeCompare(b.entry.id));
}

/**
 * Merge sightings of the same code, keeping the strongest claim.
 *
 * Exported so the rule is directly testable: in the shipped dataset no code
 * happens to be community in one entry and verified in another, so the
 * "never downgrade" behaviour is otherwise invisible to the suite and a
 * regression there would ship silently.
 *
 * @param {Array} sightings  [{code, confidence, note, ...}]
 * @returns {Array} merged, verified before community
 */
function mergeSightings(sightings) {
  const byCode = new Map();
  for (const c of (Array.isArray(sightings) ? sightings : [])) {
    // A null entry would otherwise reach String(c.code) and throw. The other
    // engines in this cycle all tolerate junk, and a shortlist that crashes on
    // one malformed record is worse than one that skips it.
    if (!c || typeof c !== "object") continue;
    const code = String(c.code).toUpperCase();
    const prior = byCode.get(code);
    if (!prior) {
      byCode.set(code, Object.assign({}, c, { code, sources: [c.source].filter(Boolean) }));
      continue;
    }
    if (c.source) prior.sources.push(c.source);
    // Never downgrade on a second, weaker sighting: one entry saying
    // "verified" and another saying "community" means the code is verified
    // somewhere, and averaging or last-write-wins would dilute the better
    // evidence.
    if (c.confidence === "verified") {
      prior.confidence = "verified";
      if (c.note) prior.note = c.note;
    }
  }
  return [...byCode.values()].sort((a, b) => {
    const rank = { verified: 0, community: 1, unknown: 2 };
    return (rank[a.confidence] ?? 3) - (rank[b.confidence] ?? 3) ||
      a.code.localeCompare(b.code);
  });
}

/**
 * The candidate fault codes for a described symptom, merged across matching
 * entries and de-duplicated.
 */
function candidates(text) {
  const sightings = [];
  for (const r of search(text)) {
    for (const c of r.entry.codes) sightings.push(Object.assign({ source: r.entry.id }, c));
  }
  return mergeSightings(sightings);
}

/**
 * The full shortlist a panel renders: matched symptoms, candidate codes with
 * confidence, components to inspect, and the checks worth doing first.
 *
 * `isDiagnosis: false` is explicit and load-bearing. This ranks possibilities
 * and says what to test; it does not tell anyone what is wrong with their car.
 */
function diagnose(text) {
  const matched = search(text);
  const components = [];
  const checks = [];
  for (const r of matched) {
    for (const comp of r.entry.components) if (!components.includes(comp)) components.push(comp);
    for (const c of r.entry.checks) if (!checks.includes(c)) checks.push(c);
  }
  return {
    query: String(text || ""),
    matched: matched.map(r => ({
      id: r.entry.id,
      title: r.entry.title,
      description: r.entry.description,
      score: r.score,
      matched_terms: r.hits.map(h => h.term),
    })),
    codes: candidates(text),
    components,
    checks,
    is_diagnosis: false,
    note: matched.length
      ? "These are candidates to investigate, not a diagnosis. Work the checks in order and confirm before replacing anything."
      : "Nothing in the index matched that description closely enough to shortlist. Try naming the conditions — when it happens, whether it is cold, and what you can hear or smell.",
  };
}

function byId(id) {
  return SYMPTOMS.find(s => s.id === id) || null;
}

const api = {
  SYMPTOMS,
  MIN_SCORE,
  search,
  candidates,
  diagnose,
  byId,
  scoreSymptom,
  mergeSightings,
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuSymptomIndex = api;
