"use strict";

/* Misfire Pattern Recognition — v3.0.0 feature 1.
 *
 * A DME will happily tell you *how many* times cylinder 3 misfired. It will
 * never tell you *when*, and the "when" is the whole diagnosis: a coil that
 * only fails above 4000 rpm under load is a different part, a different test,
 * and a different ££ than one that only fails cold.
 *
 * This module takes misfire events (each carrying the live values that were
 * true at the instant of the misfire) and turns them into per-cylinder
 * distributions plus a rule-based classification with a confidence and the
 * evidence behind it.
 *
 * Pure by design: no DOM, no Tauri, no transport. It is fed either
 *   - directly, by a caller holding misfire events, or
 *   - via `collectEvents()`, which walks a log session's series and derives
 *     events from per-cylinder misfire-counter channels.
 * Every number that reaches a diagnosis carries the evidence it came from, so
 * a user can audit the call rather than trust it. A pattern this module cannot
 * see returns `confidence: 0` and a reason — it never guesses.
 *
 * Dual export: `require()` under node --test, plain <script> in the webview.
 */

/* ------------------------------------------------------------------ *
 * Bin edges. Exported so a caller can label an axis in the UI without
 * re-deriving them, and so the tests pin the same numbers the panel uses.
 * ------------------------------------------------------------------ */
const RPM_BINS = [0, 1000, 2000, 3000, 4000, 5000, 6000];
const LOAD_BINS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const TEMP_BINS = [-20, 0, 20, 40, 60, 80, 100, 120];

/* Rule thresholds. Named so the diagnosis text and the tests quote the same
 * constant rather than a magic number repeated in three places. */
const RULES = {
  high_rpm: 4000,
  high_load: 80,
  cold_coolant: 60,
  hot_coolant: 95,
  cold_start_window_s: 60,
  /* A rule must own at least this share of the cylinder's events before it is
   * allowed to claim the diagnosis. Below it we keep collecting data rather
   * than naming a part on a coincidence. */
  dominance: 0.7,
  /* Below this many events a cylinder's pattern is noise, not a signal. */
  min_events: 8,
  /* A "single cylinder" pattern needs the others to be quiet for it to mean
   * anything. */
  single_cylinder_ratio: 0.5,
  /* Knock retard at or above this (degrees) alongside a misfire points at
   * detonation rather than ignition. */
  knock_retard: 3,
  idle_rpm: 1200,
};

function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/* Index of the bin containing `v`, or -1 when out of range / not a number. */
function binIndex(edges, v) {
  if (!finite(v)) return -1;
  if (v < edges[0] || v > edges[edges.length - 1]) return -1;
  for (let i = edges.length - 1; i > 0; i--) {
    if (v >= edges[i - 1]) return i - 1;
  }
  return 0;
}

/* Count values into `edges.length - 1` buckets. Unrepresentable values (NaN,
 * out of range) are dropped rather than clamped into a bucket that would lie
 * about the distribution. */
function histogram(values, edges) {
  const bins = new Array(edges.length - 1).fill(0);
  let dropped = 0;
  for (const v of values) {
    const i = binIndex(edges, v);
    if (i < 0) { dropped++; continue; }
    bins[i]++;
  }
  return { bins, dropped, edges };
}

function share(n, total) {
  return total > 0 ? n / total : 0;
}

/* ------------------------------------------------------------------ *
 * Event collection from a log session
 * ------------------------------------------------------------------ */

/* Normalize one channel id so `MisfireCyl3`, `misfire_cyl_3` and
 * `misfire3` all resolve. Returns the cylinder number, or null. */
function cylinderFromId(id) {
  const m = /misfire[^a-z0-9]*?(?:cyl(?:inder)?)?[^a-z0-9]*(\d{1,2})$/i.exec(String(id));
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 && n <= 12 ? n : null;
}

/* Find the misfire-counter channels in a series map.
 * `series` is the Map the app's log session already builds:
 *   id -> { label, unit, data: [{x, y, text?}] } */
function misfireChannels(series) {
  const out = [];
  if (!series || typeof series.forEach !== "function") return out;
  series.forEach((s, id) => {
    const cyl = cylinderFromId(id);
    if (cyl == null || !s || !Array.isArray(s.data)) return;
    out.push({ id, cylinder: cyl, data: s.data });
  });
  return out.sort((a, b) => a.cylinder - b.cylinder);
}

/* A misfire counter increments; it does not toggle. A channel that returns 0
 * between increments is a boolean-ish flag, and treating its rising edges as
 * single events is the correct read. Channels that hold a nonzero value for a
 * run of samples are cumulative counters, where the *rise* is the event count.
 * Both shapes are handled so the caller does not have to know which ECU it is
 * talking to. */
function counterDeltas(data) {
  const out = [];
  let prev = null;
  for (const p of data) {
    if (!p || !finite(p.y)) { prev = null; continue; }
    if (prev === null) { prev = p.y; continue; }
    const delta = p.y - prev;
    // A cumulative counter rises by N and we report N events. A boolean-ish
    // flag (0 -> 1) rises by 1 and reports the same thing, so both channel
    // shapes read correctly without the caller knowing which ECU produced it.
    // A fall is a counter reset (session restart or ECU reset): re-seed on it
    // rather than report a negative delta as an event.
    if (delta > 0) out.push({ x: p.x, count: delta, cumulative: true });
    prev = p.y;
  }
  return out;
}

/* Value of `series.get(id)` at time x, or null. Log samples are not aligned
 * across channels, so this takes the most recent sample at or before x within
 * `tolerance` seconds rather than demanding an exact match. */
function valueAt(series, id, x, tolerance) {
  const s = series && typeof series.get === "function" ? series.get(id) : null;
  if (!s || !Array.isArray(s.data)) return null;
  let best = null;
  for (const p of s.data) {
    if (!p || !finite(p.y) || !finite(p.x)) continue;
    if (p.x <= x && (best === null || p.x > best.x)) best = p;
  }
  if (!best) return null;
  return x - best.x <= tolerance ? best.y : null;
}

/* Time of the most recent step (rising edge) at or before `x` on a
 * step-shaped channel such as an engine-start marker, or null.
 *
 * The marker's *timestamp* is what matters, not its value: once the engine has
 * started it stays started, so a marker 20 seconds old is still the truth.
 * Applying the sample tolerance used for continuous channels would report "no
 * start marker" for every event in a normal-length log.
 *
 * Only a rising edge counts. A channel that holds 1 from the top of the log is
 * "engine was already running when we started recording", which is not a
 * start time — treating it as one would report a 0-second-old start for every
 * event and make the cold-start rule fire on a warm engine. */
function lastRiseTime(series, id, x) {
  const s = series && typeof series.get === "function" ? series.get(id) : null;
  if (!s || !Array.isArray(s.data)) return null;
  let best = null;
  let prev = null;
  for (const p of s.data) {
    if (!p || !finite(p.y) || !finite(p.x)) { prev = null; continue; }
    if (p.x > x) break;
    const rose = prev !== null && p.y > prev && p.y > 0;
    if (rose) best = p.x;
    prev = p.y;
  }
  return best;
}

/* Derive misfire events from a log session.
 *
 * @param {Map} series       id -> {label, unit, data:[{x,y}]}
 * @param {Object} opts
 * @param {string} [opts.loadId="load"]       engine load channel
 * @param {string} [opts.rpmId="rpm"]
 * @param {string} [opts.coolantId="coolant"]
 * @param {string} [opts.oilTempId="oilTemp"]
 * @param {string} [opts.iatId="intakeTemp"]
 * @param {string} [opts.knockId="knockRetard"]
 * @param {string} [opts.startId]             channel marking engine start;
 *                                           supplies `since_start_s`
 * @param {number} [opts.tolerance=1.0]       seconds for sample alignment
 * @returns {Array} misfire events, each with the live values at that instant
 */
function collectEvents(series, opts) {
  const o = opts || {};
  const tolerance = finite(o.tolerance) ? o.tolerance : 1.0;
  const channels = misfireChannels(series);
  const events = [];
  for (const ch of channels) {
    for (const d of counterDeltas(ch.data)) {
      const startAt = o.startId ? lastRiseTime(series, o.startId, d.x) : null;
      const event = {
        cylinder: ch.cylinder,
        channel: ch.id,
        time_s: d.x,
        count: d.count,
        since_start_s: startAt != null ? d.x - startAt : null,
      };
      for (const [key, id] of [
        ["rpm", o.rpmId || "rpm"],
        ["load", o.loadId || "load"],
        ["coolant", o.coolantId || "coolant"],
        ["oil_temp", o.oilTempId || "oilTemp"],
        ["iat", o.iatId || "intakeTemp"],
        ["knock_retard", o.knockId || "knockRetard"],
      ]) {
        const v = valueAt(series, id, d.x, tolerance);
        if (v != null) event[key] = v;
      }
      events.push(event);
    }
  }
  events.sort((a, b) => a.time_s - b.time_s);
  return events;
}

/* ------------------------------------------------------------------ *
 * Classification
 * ------------------------------------------------------------------ */

/* The ordered rule set. First rule that meets its dominance threshold on a
 * cylinder wins. Order is deliberate: the more specific ignition and
 * injection signatures are tested before the catch-all vacuum/pressure one,
 * because "all cylinders at idle" is the residual diagnosis, not the first
 * guess. */
const CLASSIFIERS = [
  {
    id: "knock_detonation",
    confidence: 80,
    test: (e) => finite(e.knock_retard) && e.knock_retard >= RULES.knock_retard,
    diagnosis: "Misfires coincide with high knock retard. This is detonation under an aggressive or mis-tuned calibration, not an ignition fault — check fuel quality and boost before replacing parts.",
  },
  {
    id: "cold_start_injector",
    confidence: 80,
    test: (e) => finite(e.since_start_s) && e.since_start_s >= 0 &&
      e.since_start_s < RULES.cold_start_window_s &&
      finite(e.coolant) && e.coolant < RULES.cold_coolant,
    diagnosis: "Misfires cluster in the first minute after a cold start. Points to injector leak-down or poor fuel atomization when cold — a warm-engine retest will not reproduce it.",
  },
  {
    id: "hot_ignition",
    confidence: 75,
    test: (e) => finite(e.coolant) && e.coolant >= RULES.hot_coolant,
    diagnosis: "Misfires only appear at high coolant temperature. Heat-related ignition coil breakdown is the usual cause; the coil tests fine cold, which is why it reads as intermittent.",
  },
  {
    id: "high_load_ignition",
    confidence: 85,
    test: (e) => finite(e.rpm) && e.rpm > RULES.high_rpm &&
      finite(e.load) && e.load > RULES.high_load,
    diagnosis: "Misfires only under high load and revs. Classic single-coil or plug failure under cylinder pressure — it passes every warm idle test.",
  },
  {
    id: "idle_vacuum",
    confidence: 60,
    test: (e) => finite(e.rpm) && e.rpm <= RULES.idle_rpm,
    diagnosis: "Misfire spread across all cylinders at idle. Points to a vacuum leak or a fuel-pressure problem rather than one bad component.",
  },
];

function classify(events) {
  const total = events.length;
  if (total < RULES.min_events) {
    return {
      id: "insufficient_data",
      confidence: 0,
      diagnosis: `Only ${total} misfire event${total === 1 ? "" : "s"} recorded — under the ${RULES.min_events} needed to call a pattern. Log longer or under more varied conditions.`,
      evidence: [],
    };
  }
  const evidence = [];
  let best = null;
  for (const rule of CLASSIFIERS) {
    const hits = events.filter(rule.test);
    const ratio = share(hits.length, total);
    evidence.push({ rule: rule.id, events: hits.length, share: ratio });
    if (ratio >= RULES.dominance && !best) {
      best = { rule, hits, ratio };
    }
  }
  if (!best) {
    return {
      id: "unclear",
      confidence: 25,
      diagnosis: "No single condition explains these misfires — they are spread across the operating range. Log a full drive cycle from cold to warm and try again.",
      evidence,
    };
  }
  // Confidence scales with how lopsided the match is: a rule that owns
  // exactly the dominance threshold is weaker evidence than one that owns
  // everything, and the number should say so.
  const span = (best.ratio - RULES.dominance) / (1 - RULES.dominance);
  const confidence = Math.round(
    best.rule.confidence * (0.7 + 0.3 * Math.min(1, span))
  );
  return {
    id: best.rule.id,
    confidence,
    diagnosis: best.rule.diagnosis,
    evidence,
  };
}

/* ------------------------------------------------------------------ *
 * Per-cylinder analysis
 * ------------------------------------------------------------------ */

function analyzeCylinder(cylinder, events, allTotals) {
  const rpm = histogram(events.map(e => e.rpm), RPM_BINS);
  const load = histogram(events.map(e => e.load), LOAD_BINS);
  const temp = histogram(events.map(e => e.coolant), TEMP_BINS);
  const verdict = classify(events);
  const others = allTotals - events.length;
  const dominant = allTotals > 0 && share(events.length, allTotals) >= RULES.single_cylinder_ratio;
  return {
    cylinder,
    total_events: events.length,
    share_of_all: share(events.length, allTotals),
    single_cylinder: dominant && others < events.length,
    rpm_distribution: rpm,
    load_distribution: load,
    temp_distribution: temp,
    diagnosis: verdict.diagnosis,
    pattern: verdict.id,
    confidence: verdict.confidence,
    evidence: verdict.evidence,
  };
}

/* Group events by cylinder and analyze each.
 *
 * @param {Array} events  from `collectEvents()` or hand-built
 * @returns {{patterns: Array, total_events: number, cylinders: Array<number>}}
 */
function analyze(events) {
  if (!Array.isArray(events)) events = [];
  const byCylinder = new Map();
  for (const e of events) {
    if (!e || e.cylinder == null) continue;
    if (!byCylinder.has(e.cylinder)) byCylinder.set(e.cylinder, []);
    byCylinder.get(e.cylinder).push(e);
  }
  const total = events.length;
  const cylinders = [...byCylinder.keys()].sort((a, b) => a - b);
  const patterns = cylinders.map(c =>
    analyzeCylinder(c, byCylinder.get(c), total)
  );
  return { patterns, total_events: total, cylinders };
}

/* Build a cylinder x rpm-bin matrix for a heatmap. Returns rows ordered by
 * cylinder, each an array of counts aligned to RPM_BINS. */
function rpmHeatmap(analysis) {
  return analysis.patterns.map(p => ({
    cylinder: p.cylinder,
    counts: p.rpm_distribution.bins,
  }));
}

const api = {
  RPM_BINS,
  LOAD_BINS,
  TEMP_BINS,
  RULES,
  CLASSIFIERS,
  analyze,
  analyzeCylinder,
  collectEvents,
  misfireChannels,
  rpmHeatmap,
  binIndex,
  histogram,
  cylinderFromId,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuMisfirePatterns = api;
