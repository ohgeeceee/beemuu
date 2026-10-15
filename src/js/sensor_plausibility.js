/* v3 IIFE wrapper — see scripts/wrap_v3_iife.py. Every classic
 * tag shares one global lexical scope, so a bare top-level `const` in
 * one file is a redeclaration error in the next. */
(function () {
"use strict";

/* Sensor Plausibility Cross-Check — v4.2.0.
 *
 * Every v3 engine reads one channel at a time. signal_quality.js asks whether
 * a *single* trace can be believed; the analyzers that follow ask what a
 * trace means. None of them asks the question a mechanic asks first: do two
 * channels that must agree actually agree? Coolant and oil converge once the
 * engine is warm. Intake air matches ambient on a cold soak. MAP is baro plus
 * boost. A lean lambda cannot sit beside a fuel trim pulling fuel out. A car
 * in gear above idle is not doing zero km/h. A running alternator is above
 * 13 V. When a pair disagrees, *one of the two traces is lying* — and a
 * diagnostics tool that guesses which is worse than one that refuses.
 *
 * This module pairs channels on a shared time grid and checks each documented
 * relationship. The hard part is not the arithmetic, it is the discipline:
 *
 *   - an unjudgeable pair is never scored. One side missing, fewer than
 *     MIN_PAIRED_SAMPLES overlapping samples, a flat/constant channel (no
 *     relationship can be measured), or a window with no expected range all
 *     return verdict `unknown`, score null, confidence 0, and an evidence
 *     line naming the missing piece.
 *   - a sensor is never blamed without evidence. A deviation is only
 *     attributed to side `a` or `b` when the check can point at one channel.
 *     When both sides could explain it — MAP high but still plausible, oil
 *     hotter than coolant, a lambda/trim contradiction with a sane lambda —
 *     the verdict is `inconclusive` and the attribution is null. Saying
 *     "cannot attribute" is as important as saying which side failed.
 *
 * It is pure: no DOM, no Tauri, no transport, no randomness, no window access
 * outside the export line. It reads the series shape every other engine reads
 * (`{ data: [{x, y}, ...], unit? }`, as a Map or a plain object) plus the
 * caller's declared channel-name mapping (opts.channels: role -> channel name;
 * an unmapped role is looked up under its own name).
 *
 * Dual export: `require()` under node --test, plain <script> in the webview.
 */

/* ------------------------------------------------------------------ *
 * Thresholds. Exported so the panel can label a pair with the same
 * numbers the engine acted on, and so the tests pin the real values.
 * ------------------------------------------------------------------ */
const MIN_PAIRED_SAMPLES = 5;    // fewer overlapping pairs -> unknown
const MAX_PAIR_DIST_S = 2;       // largest x gap a nearest-neighbour pair may span
const FLAT_EPS = 1e-9;           // a channel with this little range is flat
const OIL_CONVERGE_C = 15;       // oil must converge to coolant within this once warm
const COOLANT_WARM_C = 70;       // coolant at/above this counts as warmed up
const IAT_AMBIENT_TOL_C = 8;     // IAT vs ambient before start
const IAT_COLD_MAX_C = 40;       // at/below this IAT counts as "before start"
const BOOST_CONSISTENCY_KPA = 15;// MAP must equal baro + boost within this
const DEFAULT_BARO_KPA = 101.3;  // used only when no baro channel is supplied
const LAMBDA_LEAN = 1.02;        // lambda above this is lean
const LAMBDA_RICH = 0.98;        // lambda below this is rich
const LAMBDA_TRIM_TOL = 0.03;    // allowed lambda/trim contradiction margin
const TRIM_EPS_PCT = 3;          // trims inside +/- this do not contradict
const LAMBDA_MIN = 0.7;          // a lambda outside [MIN, MAX] is implausible on its own
const LAMBDA_MAX = 1.3;
const MOVING_RPM = 1200;         // rpm above this, in gear, implies the car moves
const MOVING_SPEED_MIN_KPH = 1;  // speed floor while moving
const MOVING_SPEED_TOL_KPH = 0.5;// allowance against that floor
const CHARGING_RPM = 1200;       // rpm above this, the alternator must charge
const CHARGING_MIN_V = 13.0;     // ... above this voltage
const CHARGING_TOL_V = 0.3;      // allowance against that floor

/* ------------------------------------------------------------------ *
 * Series plumbing. Accepts a Map or a plain object, the same two
 * shapes main.js has held over the years.
 * ------------------------------------------------------------------ */
function seriesEntries(series) {
  if (!series) return [];
  if (typeof series.entries === "function") return [...series.entries()];
  if (typeof series === "object") return Object.entries(series);
  return [];
}

function pointsOf(channel) {
  if (!channel) return [];
  if (Array.isArray(channel)) return channel;
  if (Array.isArray(channel.data)) return channel.data;
  if (Array.isArray(channel.points)) return channel.points;
  return [];
}

/* Drop anything that is not a finite (x, y) pair, then sort by x and keep the
 * last reading at a duplicated timestamp. A channel is judged on what it can
 * actually represent; unrepresentable samples are counted, not clamped. */
function cleanPoints(points) {
  const out = [];
  let dropped = 0;
  for (const p of points || []) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) { dropped++; continue; }
    out.push({ x: p.x, y: p.y });
  }
  out.sort((a, b) => a.x - b.x);
  const uniq = [];
  for (const p of out) {
    if (uniq.length && uniq[uniq.length - 1].x === p.x) uniq[uniq.length - 1] = p;
    else uniq.push(p);
  }
  return { points: uniq, dropped, collapsed: out.length - uniq.length };
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stats(values) {
  const n = values.length;
  if (!n) return { n: 0, min: null, max: null, mean: null, range: null, stddev: null };
  let sum = 0, min = Infinity, max = -Infinity;
  for (const v of values) { sum += v; if (v < min) min = v; if (v > max) max = v; }
  const mean = sum / n;
  let sq = 0;
  for (const v of values) sq += (v - mean) * (v - mean);
  return { n, min, max, mean, range: max - min, stddev: Math.sqrt(sq / n) };
}

/* ------------------------------------------------------------------ *
 * Pairing. Two channels become comparable only on a shared x grid.
 * ------------------------------------------------------------------ */

/* Nearest sample to `x` in a list already sorted by x. */
function nearestByX(points, x) {
  if (!points || !points.length) return null;
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x < x) lo = mid + 1; else hi = mid;
  }
  let best = points[lo];
  let dist = Math.abs(best.x - x);
  if (lo > 0) {
    const d = Math.abs(points[lo - 1].x - x);
    if (d < dist) { best = points[lo - 1]; dist = d; }
  }
  return { point: best, dist };
}

/* Nearest-neighbour pairing over the shared x grid (the sorted union of both
 * channels' timestamps). Each pair takes each channel's closest sample and is
 * kept only while both are within `maxDist` seconds — a pair stitched across a
 * gap is an interpolation, and an interpolation too wide is not evidence. */
function samplePairs(seriesA, seriesB, opts = {}) {
  const maxDist = Number.isFinite(opts.maxDist) ? opts.maxDist : MAX_PAIR_DIST_S;
  const A = cleanPoints(pointsOf(seriesA)).points;
  const B = cleanPoints(pointsOf(seriesB)).points;
  if (!A.length || !B.length) return [];

  const grid = [];
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    let x;
    if (j >= B.length || (i < A.length && A[i].x <= B[j].x)) { x = A[i].x; i++; }
    else { x = B[j].x; j++; }
    if (!grid.length || grid[grid.length - 1] !== x) grid.push(x);
  }

  const pairs = [];
  for (const x of grid) {
    const na = nearestByX(A, x);
    const nb = nearestByX(B, x);
    if (!na || !nb) continue;
    if (na.dist > maxDist || nb.dist > maxDist) continue;
    pairs.push({ x, a: na.point.y, b: nb.point.y, dxa: na.dist, dxb: nb.dist });
  }
  return pairs;
}

/* ------------------------------------------------------------------ *
 * Channel resolution. A check names *roles*; the caller declares which
 * channel plays each role. An undeclared role resolves to its own name.
 * ------------------------------------------------------------------ */
function channelName(opts, role) {
  const map = opts && opts.channels;
  if (map && typeof map === "object" && !Array.isArray(map) && map[role] != null) return map[role];
  return role;
}

function getChannel(series, name) {
  if (!series) return undefined;
  if (typeof series.entries === "function" && typeof series.get === "function") return series.get(name);
  if (typeof series === "object") return series[name];
  return undefined;
}

/* A channel with no measurable range carries no relationship to measure. */
function isFlat(points) {
  if (!points || points.length < 2) return true;
  let min = Infinity, max = -Infinity;
  for (const p of points) { if (p.y < min) min = p.y; if (p.y > max) max = p.y; }
  return (max - min) <= FLAT_EPS;
}

/* ------------------------------------------------------------------ *
 * The registry. Each entry documents a plausibility window (`window.tol`
 * is the allowed deviation) and returns, from the paired samples, a
 * signed `deviation`, which `side` it implicates (null when both sides
 * could explain it) and a one-line `detail`. An entry may `refuse` when
 * the pairs cannot support the check at all.
 * ------------------------------------------------------------------ */
const eachCheck = {
  coolant_oil_convergence: {
    id: "coolant_oil_convergence",
    a: "coolant",
    b: "oil",
    unit: "°C",
    window: { tol: OIL_CONVERGE_C, description: "oil must converge to coolant once warm" },
    evaluate(pairs) {
      const warm = pairs.filter((p) => p.a >= COOLANT_WARM_C);
      if (!warm.length) {
        return { refuse: true, detail: `coolant never reached ${COOLANT_WARM_C}°C — no convergence window` };
      }
      let dev = 0;
      for (const p of warm) {
        const d = p.b - p.a;
        if (Math.abs(d) > Math.abs(dev)) dev = d;
      }
      // Cold oil is oil's own failure to warm for the load. Oil *hotter* than
      // coolant could equally be a low coolant reading, so that side is not
      // attributed — the verdict comes back inconclusive.
      const side = dev < 0 ? "b" : null;
      return {
        deviation: dev,
        side,
        n: warm.length,
        detail: `oil is ${Math.abs(dev).toFixed(1)}°C from coolant after warm-up`,
      };
    },
  },

  iat_ambient_cold_start: {
    id: "iat_ambient_cold_start",
    a: "ambient",
    b: "iat",
    unit: "°C",
    window: { tol: IAT_AMBIENT_TOL_C, description: "IAT must match ambient before start" },
    evaluate(pairs) {
      const cold = pairs.filter((p) => p.b <= IAT_COLD_MAX_C);
      if (!cold.length) {
        return { refuse: true, detail: `no before-start samples (IAT never at or below ${IAT_COLD_MAX_C}°C)` };
      }
      let dev = 0;
      for (const p of cold) {
        const d = p.b - p.a;
        if (Math.abs(d) > Math.abs(dev)) dev = d;
      }
      // IAT is the channel under test against a cold-soaked ambient reference.
      return {
        deviation: dev,
        side: "b",
        n: cold.length,
        detail: `intake air is ${Math.abs(dev).toFixed(1)}°C from ambient before start`,
      };
    },
  },

  boost_map_consistency: {
    id: "boost_map_consistency",
    a: "boost",
    b: "map",
    unit: "kPa",
    window: { tol: BOOST_CONSISTENCY_KPA, description: "MAP must equal baro + boost" },
    evaluate(pairs, ctx) {
      let baro = DEFAULT_BARO_KPA;
      const baroPts = ctx && typeof ctx.pts === "function" ? ctx.pts("baro") : null;
      if (baroPts && baroPts.length) {
        const mean = baroPts.reduce((s, p) => s + p.y, 0) / baroPts.length;
        if (Number.isFinite(mean) && mean > 0) baro = mean;
      }
      let dev = 0;
      let mapBelowBaro = false;
      for (const p of pairs) {
        const expected = baro + p.a; // boost is gauge, MAP is absolute
        const d = p.b - expected;
        if (Math.abs(d) > Math.abs(dev)) dev = d;
        if (p.b < baro) mapBelowBaro = true; // impossible, so MAP is the liar
      }
      const side = mapBelowBaro ? "b" : null;
      return {
        deviation: dev,
        side,
        n: pairs.length,
        detail: `MAP is ${Math.abs(dev).toFixed(1)} kPa from baro+boost`,
      };
    },
  },

  lambda_fuel_trim_contradiction: {
    id: "lambda_fuel_trim_contradiction",
    a: "lambda",
    b: "fuel_trim",
    unit: "%",
    window: { tol: LAMBDA_TRIM_TOL, description: "lean lambda and negative trim cannot coexist" },
    evaluate(pairs) {
      let dev = 0;
      let contradictions = 0;
      let lambdaImplausible = false;
      for (const p of pairs) {
        const lam = p.a;
        const trim = p.b;
        if (lam < LAMBDA_MIN || lam > LAMBDA_MAX) lambdaImplausible = true;
        const lean = lam > LAMBDA_LEAN && trim < -TRIM_EPS_PCT;
        const rich = lam < LAMBDA_RICH && trim > TRIM_EPS_PCT;
        if (lean || rich) {
          contradictions++;
          const mag = Math.abs(lam - 1);
          if (mag > Math.abs(dev)) dev = lean ? mag : -mag;
        }
      }
      // A lambda that is itself outside its physical band is the liar; an
      // otherwise sane lambda in contradiction with the trim cannot be
      // attributed to either side without more evidence.
      const side = lambdaImplausible ? "a" : null;
      return {
        deviation: dev,
        side,
        n: pairs.length,
        detail: `${contradictions} lambda/trim contradiction${contradictions === 1 ? "" : "s"}`,
      };
    },
  },

  rpm_speed_movement: {
    id: "rpm_speed_movement",
    a: "rpm",
    b: "speed",
    unit: "km/h",
    requires: ["gear"],
    window: { tol: MOVING_SPEED_TOL_KPH, description: "speed must be non-zero above idle in gear" },
    evaluate(pairs, ctx) {
      const gearPts = ctx && typeof ctx.pts === "function" ? ctx.pts("gear") : null;
      let moving = 0;
      let minSpeed = Infinity;
      for (const p of pairs) {
        if (p.a <= MOVING_RPM) continue; // not moving fast enough to require motion
        const g = gearPts ? nearestByX(gearPts, p.x) : null;
        if (!g || !(g.point.y > 0)) continue; // neutral or unknown gear: no claim
        moving++;
        if (p.b < minSpeed) minSpeed = p.b;
      }
      if (!moving) {
        return { refuse: true, detail: `no moving samples (rpm above ${MOVING_RPM} with a gear engaged)` };
      }
      const dev = Math.max(0, MOVING_SPEED_MIN_KPH - minSpeed);
      return {
        deviation: dev,
        side: "b", // a stationary speed readout is the failure the rule names
        n: moving,
        detail: `speed reads ${minSpeed.toFixed(1)} km/h while rpm says moving`,
      };
    },
  },

  charging_voltage: {
    id: "charging_voltage",
    a: "rpm",
    b: "battery",
    unit: "V",
    window: { tol: CHARGING_TOL_V, description: `voltage must exceed ${CHARGING_MIN_V} V above ${CHARGING_RPM} rpm` },
    evaluate(pairs) {
      let charging = 0;
      let minV = Infinity;
      for (const p of pairs) {
        if (p.a <= CHARGING_RPM) continue;
        charging++;
        if (p.b < minV) minV = p.b;
      }
      if (!charging) {
        return { refuse: true, detail: `no samples above ${CHARGING_RPM} rpm — charging cannot be judged` };
      }
      const dev = Math.max(0, CHARGING_MIN_V - minV);
      return {
        deviation: dev,
        side: "b", // the voltage channel is under test against a known alternator rule
        n: charging,
        detail: `battery reads ${minV.toFixed(2)} V at speed`,
      };
    },
  },
};

/* ------------------------------------------------------------------ *
 * Judging. Every path that cannot support a verdict returns `unknown`
 * with score null and confidence 0, before any arithmetic is trusted.
 * ------------------------------------------------------------------ */
function refuse(id, reason) {
  return { id, verdict: "unknown", attribution: null, score: null, confidence: 0, deviation: null, evidence: [reason] };
}

function checkPair(entry, series, opts = {}) {
  if (!entry || typeof entry.evaluate !== "function" || !entry.id) {
    return refuse(entry && entry.id, "unknown cross-check");
  }
  const id = entry.id;

  // A window with no expected range cannot judge anything.
  const tol = entry.window && Number.isFinite(entry.window.tol) ? entry.window.tol : NaN;
  if (!(tol > 0)) return refuse(id, `no expected range declared for ${id} — cannot judge`);

  const nameA = channelName(opts, entry.a);
  const nameB = channelName(opts, entry.b);
  const chA = getChannel(series, nameA);
  const chB = getChannel(series, nameB);
  if (chA === undefined) return refuse(id, `channel "${nameA}" is missing`);
  if (chB === undefined) return refuse(id, `channel "${nameB}" is missing`);

  if (Array.isArray(entry.requires)) {
    for (const role of entry.requires) {
      const nm = channelName(opts, role);
      if (getChannel(series, nm) === undefined) {
        return refuse(id, `required channel "${nm}" is missing — cannot judge ${id}`);
      }
    }
  }

  const ptsA = cleanPoints(pointsOf(chA)).points;
  const ptsB = cleanPoints(pointsOf(chB)).points;
  if (isFlat(ptsA)) return refuse(id, `"${nameA}" is constant — no relationship can be measured`);
  if (isFlat(ptsB)) return refuse(id, `"${nameB}" is constant — no relationship can be measured`);

  const pairs = samplePairs(chA, chB, opts);
  if (pairs.length < MIN_PAIRED_SAMPLES) {
    return refuse(id, `only ${pairs.length} overlapping samples — too few to judge (need ${MIN_PAIRED_SAMPLES})`);
  }

  const ctx = {
    series,
    channels: (opts && opts.channels) || null,
    opts,
    pts(role) {
      const nm = channelName(opts, role);
      const ch = getChannel(series, nm);
      return ch === undefined ? null : cleanPoints(pointsOf(ch)).points;
    },
  };

  let res;
  try {
    res = entry.evaluate(pairs, ctx);
  } catch (err) {
    return refuse(id, `${id} evaluation failed: ${err && err.message ? err.message : err}`);
  }
  if (!res) return refuse(id, `${id} produced no result`);
  if (res.refuse) return refuse(id, res.detail || `${id} cannot be judged`);
  if (!Number.isFinite(res.deviation)) return refuse(id, `${id} produced no measurable deviation`);

  const magnitude = Math.abs(res.deviation);
  const usedPairs = Number.isFinite(res.n) ? res.n : pairs.length;
  const confidence = Number(Math.min(1, usedPairs / 40).toFixed(3));
  const evidence = res.detail ? [res.detail] : [];

  if (magnitude <= tol) {
    return { id, verdict: "ok", attribution: null, score: 100, confidence, deviation: res.deviation, evidence };
  }

  // Severity is how far past the window the pair sits, saturating at 1.
  const severity = Math.min(1, (magnitude - tol) / Math.max(tol, 1e-9));
  const score = Math.max(0, Math.round(50 - 50 * severity));

  if (res.side === "a" || res.side === "b") {
    const liar = res.side === "a" ? nameA : nameB;
    return {
      id,
      verdict: "mismatch",
      attribution: res.side,
      score,
      confidence,
      deviation: res.deviation,
      evidence: [...evidence, `"${liar}" is the deviating side`],
    };
  }

  return {
    id,
    verdict: "inconclusive",
    attribution: null,
    score,
    confidence,
    deviation: res.deviation,
    evidence: [...evidence, "both sides could explain the deviation — cannot attribute"],
  };
}

/* ------------------------------------------------------------------ *
 * Session analysis. Worst first: an attributed mismatch before an
 * inconclusive one, an unjudged pair before a pass, then by score.
 * ------------------------------------------------------------------ */
const VERDICT_RANK = { mismatch: 0, inconclusive: 1, unknown: 2, ok: 3 };

function worstFirst(x, y) {
  const r = (VERDICT_RANK[x.verdict] ?? 9) - (VERDICT_RANK[y.verdict] ?? 9);
  if (r !== 0) return r;
  const sx = x.score == null ? Infinity : x.score;
  const sy = y.score == null ? Infinity : y.score;
  if (sx !== sy) return sx - sy;
  return String(x.id).localeCompare(String(y.id));
}

function analyze(series, opts = {}) {
  const checks = [];
  for (const key of Object.keys(eachCheck)) {
    checks.push(checkPair(eachCheck[key], series, opts));
  }
  checks.sort(worstFirst);

  const count = (v) => checks.filter((c) => c.verdict === v).length;
  const summary = {
    n_checks: checks.length,
    ok: count("ok"),
    mismatched: count("mismatch"),
    inconclusive: count("inconclusive"),
    unknown: count("unknown"),
  };
  summary.headline = summary.mismatched > 0
    ? `${summary.mismatched} cross-check mismatch${summary.mismatched === 1 ? "" : "es"}`
    : summary.inconclusive > 0
      ? `${summary.inconclusive} cross-check${summary.inconclusive === 1 ? "" : "s"} inconclusive`
      : summary.unknown > 0
        ? `${summary.unknown} cross-check${summary.unknown === 1 ? "" : "s"} could not be judged`
        : "all cross-checks passed";

  const mismatches = checks.filter((c) => c.verdict === "mismatch" || c.verdict === "inconclusive");
  return { checks, mismatches, summary };
}

const api = {
  MIN_PAIRED_SAMPLES,
  MAX_PAIR_DIST_S,
  FLAT_EPS,
  OIL_CONVERGE_C,
  COOLANT_WARM_C,
  IAT_AMBIENT_TOL_C,
  IAT_COLD_MAX_C,
  BOOST_CONSISTENCY_KPA,
  DEFAULT_BARO_KPA,
  LAMBDA_LEAN,
  LAMBDA_RICH,
  LAMBDA_TRIM_TOL,
  TRIM_EPS_PCT,
  LAMBDA_MIN,
  LAMBDA_MAX,
  MOVING_RPM,
  MOVING_SPEED_MIN_KPH,
  MOVING_SPEED_TOL_KPH,
  CHARGING_RPM,
  CHARGING_MIN_V,
  CHARGING_TOL_V,
  seriesEntries,
  pointsOf,
  cleanPoints,
  median,
  stats,
  nearestByX,
  samplePairs,
  channelName,
  getChannel,
  isFlat,
  eachCheck,
  checkPair,
  analyze,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuSensorPlausibility = api;
})();
