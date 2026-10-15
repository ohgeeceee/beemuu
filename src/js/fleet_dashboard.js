/* v3 IIFE wrapper — see scripts/wrap_v3_iife.py. Every classic
 * tag shares one global lexical scope, so a bare top-level `const` in
 * one file is a redeclaration error in the next. */
(function () {
"use strict";

/* The Fleet — v4.0.0 feature 1.
 *
 * Every engine up to v3 looks at *one* car at a time: one log, one channel,
 * one drive cycle. But an owner with a garage does not ask "is this signal
 * flat" — they ask "which of my cars needs attention this month, and what is
 * it going to cost me?" This module answers that, across the whole garage.
 *
 * It is deliberately built on service *records*, not sensor logs, because that
 * is the data a fleet actually has: an odometer, a list of service events
 * (each with a date, an odometer and the items replaced), open fault codes,
 * and the cost of each visit. From that it derives, per vehicle:
 *
 *   - serviceItems : for every item ever serviced, when it is next due by
 *                    distance (interval_km) and by calendar (interval_days),
 *                    how much room is left, and a status.
 *   - odometerHealth : is the odometer sequence believable? (monotonic,
 *                    duplicates, out-of-order, unparseable readings)
 *   - costProfile : total / mean / median spend, plus robust outliers.
 *   - gradeVehicle : a 0-100 score, a letter grade, and the reasons.
 *   - fleet : every vehicle ranked best-first with a one-line headline.
 *
 * REFUSE TO GUESS. The most important rule in this file: a vehicle we cannot
 * trust is *not* given a grade. No service history, no odometer, or a date we
 * cannot parse means `score: null, grade: null` and a reasons array that names
 * exactly what was missing. We never invent a service interval the caller did
 * not supply, and an item with no interval is reported `unknown`, never `ok`.
 * A non-monotonic or duplicated odometer is surfaced as a data problem and
 * scored as such — never quietly sorted into a tidy story.
 *
 * It is pure: no DOM, no Tauri, no transport, no fetch, no randomness, and no
 * `Date.now()` anywhere in the logic. "Now" is an injected argument, so a
 * grade is a deterministic function of the inputs.
 *
 * Dual export: `require()` under node --test, plain <script> in the webview.
 */

/* ------------------------------------------------------------------ *
 * Thresholds. Exported so the panel can label a row with the same
 * numbers the engine acted on, and so the tests pin the real values.
 * ------------------------------------------------------------------ */
const MIN_COST_ENTRIES = 4;     // below this, no cost-outlier rule runs
const OUTLIER_MAD_Z = 3.5;      // robust modified z-score cut for a cost outlier
const MAD_SCALE = 0.6745;       // 0.75-quantile of the normal distribution
const DUE_SOON_KM = 1000;       // distance-remaining at/under this is due_soon
const DUE_SOON_DAYS = 30;       // days-remaining at/under this is due_soon
const OVERDUE_PENALTY = 15;     // score points per overdue item
const DUE_SOON_PENALTY = 5;     // score points per due-soon item
const DTC_PENALTY = 8;          // score points per open DTC (capped)
const DTC_PENALTY_CAP = 40;
const OUT_OF_ORDER_PENALTY = 10; // score points for a non-monotonic odometer
const DUPLICATE_PENALTY = 5;     // score points for duplicate odometer readings
const COST_OUTLIER_PENALTY = 2;  // score points per cost outlier (capped)
const COST_OUTLIER_CAP = 10;
const GRADE_A = 90;             // letter-grade bands
const GRADE_B = 80;
const GRADE_C = 70;
const GRADE_D = 60;

/* ------------------------------------------------------------------ *
 * Date plumbing. Dates are ISO yyyy-mm-dd only — anything else is a
 * data problem we surface rather than a value we guess at.
 * ------------------------------------------------------------------ */
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86400000;

/* Parse a strict ISO calendar date to whole days since the epoch (UTC), or
 * null. A missing/loose/shifting value is not silently coerced. */
function parseDate(s) {
  if (typeof s !== "string") return null;
  const m = DATE_RE.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  // Reject roll-overs (2024-02-31 → 2024-03-02) instead of accepting them.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.floor(ms / MS_PER_DAY);
}

/* Epoch-day form of a date: a finite number is already epoch days, a string
 * goes through parseDate. Anything else is null. */
function dayOf(x) {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  return parseDate(x);
}

function isoDate(day) {
  if (!Number.isFinite(day)) return null;
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/* Whole days from a to b (b - a), or null if either side is unparseable. */
function daysBetween(a, b) {
  const da = dayOf(a), db = dayOf(b);
  if (da === null || db === null) return null;
  return db - da;
}

/* Distance from a to b (b - a), or null if either side is not a real number. */
function kmBetween(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return b - a;
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* ------------------------------------------------------------------ *
 * Record plumbing.
 * ------------------------------------------------------------------ */
/* The usable service entries of a vehicle, in the order the caller
 * recorded them. Junk entries are dropped, never repaired. */
function historyOf(vehicle) {
  if (!vehicle || !Array.isArray(vehicle.service_history)) return [];
  return vehicle.service_history.filter(e => e && typeof e === "object");
}

function textOf(v) {
  if (typeof v === "string") return v.trim();
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/* Open DTCs: every array entry carrying a non-empty code. A DTC with no code
 * is not counted — we do not invent fault codes. */
function openDtcs(vehicle) {
  const out = { count: 0, codes: [] };
  if (!vehicle || !Array.isArray(vehicle.dtcs)) return out;
  for (const d of vehicle.dtcs) {
    if (!d || typeof d !== "object") continue;
    const code = textOf(d.code);
    if (!code) continue;
    out.count++;
    out.codes.push(code);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Service items. For every item the garage has ever seen, work out the
 * most recent time it was done and when it is next due.
 * ------------------------------------------------------------------ */
function serviceItems(vehicle, now) {
  const nowDay = dayOf(now);
  const odometerNow = vehicle && Number.isFinite(vehicle.odometer_km) ? vehicle.odometer_km : null;
  const history = historyOf(vehicle);

  // Latest occurrence of each item, by (date, odometer). We sort a *copy* for
  // this lookup; the vehicle's stored order is left exactly as recorded.
  const latest = new Map();
  history.forEach((entry, ei) => {
    if (!Array.isArray(entry.items)) return;
    const day = parseDate(entry.date);
    const odo = Number.isFinite(entry.odometer_km) ? entry.odometer_km : null;
    entry.items.forEach((item, ii) => {
      if (!item || typeof item !== "object") return;
      const key = item.id != null ? "id:" + item.id
        : item.label != null ? "label:" + item.label
        : "at:" + ei + ":" + ii;
      const rankDay = day === null ? -Infinity : day;
      const rankKm = odo === null ? -Infinity : odo;
      const prev = latest.get(key);
      if (!prev || rankDay > prev.rankDay || (rankDay === prev.rankDay && rankKm > prev.rankKm)) {
        latest.set(key, { key, rankDay, rankKm, entry, item });
      }
    });
  });

  const items = [];
  for (const occ of latest.values()) {
    const entry = occ.entry, item = occ.item;
    const last_done_km = Number.isFinite(entry.odometer_km) ? entry.odometer_km : null;
    const lastDay = parseDate(entry.date);
    const last_done_date = isoDate(lastDay);
    // An interval is only an interval if the caller actually supplied a
    // positive finite one. We never default one in.
    const interval_km = Number.isFinite(item.interval_km) && item.interval_km > 0 ? item.interval_km : null;
    const interval_days = Number.isFinite(item.interval_days) && item.interval_days > 0 ? item.interval_days : null;

    const due_at_km = interval_km != null && last_done_km != null ? last_done_km + interval_km : null;
    const dueDay = interval_days != null && lastDay != null ? lastDay + interval_days : null;
    const km_remaining = due_at_km != null && odometerNow != null ? due_at_km - odometerNow : null;
    const days_remaining = dueDay != null && nowDay != null ? dueDay - nowDay : null;

    // Each available signal votes; the worst vote wins. A signal that cannot
    // be computed (no odometer, no clock) simply does not vote.
    const signals = [];
    if (km_remaining != null) signals.push(km_remaining <= 0 ? "overdue" : km_remaining <= DUE_SOON_KM ? "due_soon" : "ok");
    if (days_remaining != null) signals.push(days_remaining <= 0 ? "overdue" : days_remaining <= DUE_SOON_DAYS ? "due_soon" : "ok");

    let status;
    if (!signals.length) status = "unknown";
    else if (signals.includes("overdue")) status = "overdue";
    else if (signals.includes("due_soon")) status = "due_soon";
    else status = "ok";

    items.push({
      id: item.id != null ? item.id : null,
      label: item.label != null ? item.label : (item.id != null ? String(item.id) : null),
      interval_km,
      interval_days,
      last_done_km,
      last_done_date,
      due_at_km,
      due_at_date: isoDate(dueDay),
      km_remaining,
      days_remaining,
      status,
    });
  }

  // Overdue first, then due soon, then ok, then unknown; ties by urgency.
  const rank = s => (s === "overdue" ? 0 : s === "due_soon" ? 1 : s === "ok" ? 2 : 3);
  items.sort((a, b) => {
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    const ra = a.km_remaining != null ? a.km_remaining : (a.days_remaining != null ? a.days_remaining : Infinity);
    const rb = b.km_remaining != null ? b.km_remaining : (b.days_remaining != null ? b.days_remaining : Infinity);
    if (ra !== rb) return ra - rb;
    return String(a.label == null ? "" : a.label).localeCompare(String(b.label == null ? "" : b.label));
  });
  return items;
}

/* ------------------------------------------------------------------ *
 * Odometer health. The recorded order is the evidence; we never
 * reorder readings to make a history look consistent.
 * ------------------------------------------------------------------ */
function odometerHealth(vehicle) {
  const out = { entries: 0, monotonic: null, duplicates: false, out_of_order: false, problems: [] };
  const history = historyOf(vehicle);
  out.entries = history.length;
  if (!history.length) return out;
  let prev = null;
  let allFinite = true;
  const seen = new Set();
  history.forEach((entry, i) => {
    const km = entry.odometer_km;
    if (!Number.isFinite(km)) {
      allFinite = false;
      out.problems.push({ index: i, kind: "unparseable_odometer", value: km === undefined ? null : km });
      return;
    }
    if (seen.has(km)) {
      out.duplicates = true;
      out.problems.push({ index: i, kind: "duplicate_odometer", value: km });
    }
    seen.add(km);
    if (prev !== null && km < prev) {
      out.out_of_order = true;
      out.problems.push({ index: i, kind: "out_of_order", value: km, previous: prev });
    }
    prev = km;
  });
  out.monotonic = allFinite && !out.out_of_order && !out.duplicates;
  return out;
}

/* ------------------------------------------------------------------ *
 * Cost profile. Mean/median always; outliers only with enough entries
 * to make a robust rule meaningful.
 * ------------------------------------------------------------------ */
function costProfile(vehicle) {
  const out = { total: 0, entries: 0, mean: null, median: null, outlier_entries: 0, outliers: [] };
  const history = historyOf(vehicle);
  const costs = [];
  history.forEach((entry, i) => {
    if (Number.isFinite(entry.cost)) costs.push({ index: i, cost: entry.cost });
  });
  out.entries = costs.length;
  if (!costs.length) return out;

  const values = costs.map(c => c.cost);
  out.total = values.reduce((a, b) => a + b, 0);
  out.mean = out.total / values.length;
  const med = median([...values].sort((a, b) => a - b));
  out.median = med;

  if (costs.length >= MIN_COST_ENTRIES) {
    const mad = median(values.map(v => Math.abs(v - med)).sort((a, b) => a - b));
    for (const c of costs) {
      const dev = Math.abs(c.cost - med);
      // With a zero MAD (a mostly-identical set) any departure is an outlier;
      // this is the only honest reading when there is no spread to measure.
      const isOutlier = mad > 0 ? (MAD_SCALE * dev) / mad > OUTLIER_MAD_Z : dev > 0;
      if (isOutlier) {
        out.outlier_entries++;
        out.outliers.push({ index: c.index, cost: c.cost });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Grading.
 * ------------------------------------------------------------------ */
function gradeFor(score) {
  if (score == null) return null;
  if (score >= GRADE_A) return "A";
  if (score >= GRADE_B) return "B";
  if (score >= GRADE_C) return "C";
  if (score >= GRADE_D) return "D";
  return "F";
}

/* The refusal result: no score, no grade, and a reason that names what was
 * missing. Fields we can still state honestly are populated; the ones that
 * depend on a trustworthy history are null. */
function ungradedResult(reasons, problems, open) {
  return {
    score: null,
    grade: null,
    confidence: 0,
    open_dtcs: open.count,
    open_dtc_codes: open.codes,
    overdue_count: null,
    due_soon_count: null,
    cost_total: null,
    reasons,
    problems: problems || [],
    items: [],
    odometer: null,
    cost: null,
  };
}

function gradeVehicle(vehicle, now) {
  const nowDay = dayOf(now);
  const open = openDtcs(vehicle);

  if (!vehicle || typeof vehicle !== "object") {
    return ungradedResult(["cannot grade: no vehicle record"], [], open);
  }

  const history = historyOf(vehicle);
  const missing = [];
  if (history.length === 0) missing.push("no service history");
  if (!Number.isFinite(vehicle.odometer_km)) missing.push("no odometer reading");

  // Any date we cannot parse is a blocker: a km interval without a date is a
  // half-truth, and a grade built on it would be a guess.
  const badDates = [];
  history.forEach((entry, i) => {
    if (parseDate(entry.date) === null) badDates.push({ index: i, date: entry.date === undefined ? null : entry.date });
  });
  if (badDates.length) {
    const listed = badDates.map(b => JSON.stringify(b.date)).join(", ");
    missing.push(`unparseable date${badDates.length === 1 ? "" : "s"} (${listed})`);
  }

  if (missing.length) {
    return ungradedResult(["cannot grade: " + missing.join("; ")], badDates, open);
  }

  const items = serviceItems(vehicle, now);
  const odometer = odometerHealth(vehicle);
  const cost = costProfile(vehicle);
  const overdue = items.filter(i => i.status === "overdue");
  const dueSoon = items.filter(i => i.status === "due_soon");
  const unknown = items.filter(i => i.status === "unknown");

  let score = 100;
  const reasons = [];

  for (const it of overdue) {
    const name = it.label || it.id || "service item";
    const detail = it.km_remaining != null
      ? `${Math.abs(it.km_remaining)} km overdue`
      : it.days_remaining != null ? `${Math.abs(it.days_remaining)} days overdue` : "overdue";
    reasons.push(`${name} ${detail}`);
  }
  for (const it of dueSoon) {
    const name = it.label || it.id || "service item";
    const detail = it.km_remaining != null
      ? `due within ${it.km_remaining} km`
      : it.days_remaining != null ? `due within ${it.days_remaining} days` : "due soon";
    reasons.push(`${name} ${detail}`);
  }
  score -= overdue.length * OVERDUE_PENALTY;
  score -= dueSoon.length * DUE_SOON_PENALTY;

  if (open.count) {
    score -= Math.min(DTC_PENALTY_CAP, open.count * DTC_PENALTY);
    reasons.push(`${open.count} open DTC${open.count === 1 ? "" : "s"}: ${open.codes.join(", ")}`);
  }

  if (odometer.problems.some(p => p.kind === "unparseable_odometer")) {
    score -= OUT_OF_ORDER_PENALTY;
    reasons.push("a service entry has an unreadable odometer value");
  }
  if (odometer.out_of_order) {
    score -= OUT_OF_ORDER_PENALTY;
    reasons.push("odometer readings decrease over time — history is not monotonic");
  }
  if (odometer.duplicates) {
    score -= DUPLICATE_PENALTY;
    reasons.push("the same odometer reading appears more than once");
  }

  if (cost.outlier_entries) {
    score -= Math.min(COST_OUTLIER_CAP, cost.outlier_entries * COST_OUTLIER_PENALTY);
    reasons.push(`${cost.outlier_entries} service cost${cost.outlier_entries === 1 ? "" : "s"} outside the expected range`);
  }

  if (unknown.length) {
    reasons.push(`${unknown.length} service item${unknown.length === 1 ? "" : "s"} has no interval — state unknown`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Confidence: how much of the picture is actually filled in. Fewer usable
  // items, a broken odometer or a missing clock all lower it.
  let confidence = 1;
  if (items.length) confidence -= 0.5 * (unknown.length / items.length);
  else confidence -= 0.5;
  if (odometer.out_of_order) confidence -= 0.15;
  if (odometer.duplicates) confidence -= 0.1;
  if (odometer.problems.some(p => p.kind === "unparseable_odometer")) confidence -= 0.15;
  if (nowDay === null) confidence -= 0.2;
  confidence -= Math.max(0, 0.2 - 0.1 * history.length);
  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(3))));

  return {
    score,
    grade: gradeFor(score),
    confidence,
    open_dtcs: open.count,
    open_dtc_codes: open.codes,
    overdue_count: overdue.length,
    due_soon_count: dueSoon.length,
    cost_total: cost.total,
    reasons,
    problems: odometer.problems.slice(),
    items,
    odometer,
    cost,
  };
}

/* ------------------------------------------------------------------ *
 * Fleet. Grade everything, rank best-first (ungraded last), and boil
 * it down to one headline a garage board can show.
 * ------------------------------------------------------------------ */
function fleet(vehicles, now) {
  const list = Array.isArray(vehicles) ? vehicles : [];
  const rows = list.map(v => {
    const g = gradeVehicle(v, now);
    return {
      id: v && typeof v === "object" && v.id != null ? v.id : null,
      label: v && typeof v === "object" && v.label != null ? v.label : null,
      score: g.score,
      grade: g.grade,
      confidence: g.confidence,
      open_dtcs: g.open_dtcs,
      open_dtc_codes: g.open_dtc_codes,
      overdue_count: g.overdue_count,
      due_soon_count: g.due_soon_count,
      cost_total: g.cost_total,
      reasons: g.reasons,
    };
  });

  rows.sort((a, b) => {
    const ra = a.score == null ? -1 : a.score;
    const rb = b.score == null ? -1 : b.score;
    if (ra !== rb) return rb - ra;
    const la = String(a.label == null ? (a.id == null ? "" : a.id) : a.label);
    const lb = String(b.label == null ? (b.id == null ? "" : b.id) : b.label);
    return la.localeCompare(lb);
  });

  const n_vehicles = rows.length;
  const n_graded = rows.filter(r => r.grade !== null).length;
  const n_ungraded = n_vehicles - n_graded;
  const urgent = rows.filter(r => r.overdue_count != null && r.overdue_count > 0).length;
  const dueSoon = rows.filter(r => r.due_soon_count != null && r.due_soon_count > 0).length;
  const total_cost = rows.reduce((a, r) => a + (Number.isFinite(r.cost_total) ? r.cost_total : 0), 0);

  let headline;
  if (n_vehicles === 0) headline = "no vehicles to grade";
  else if (n_graded === 0) headline = `no vehicle could be graded (${n_ungraded} with incomplete records)`;
  else if (urgent > 0) headline = `${urgent} vehicle${urgent === 1 ? "" : "s"} overdue for service`;
  else if (dueSoon > 0) headline = `${dueSoon} vehicle${dueSoon === 1 ? "" : "s"} due for service soon`;
  else headline = "all vehicles up to date";

  return {
    vehicles: rows,
    summary: { n_vehicles, n_graded, n_ungraded, urgent, total_cost, headline },
  };
}

const api = {
  MIN_COST_ENTRIES,
  OUTLIER_MAD_Z,
  DUE_SOON_KM,
  DUE_SOON_DAYS,
  OVERDUE_PENALTY,
  DUE_SOON_PENALTY,
  DTC_PENALTY,
  DTC_PENALTY_CAP,
  OUT_OF_ORDER_PENALTY,
  DUPLICATE_PENALTY,
  GRADE_A,
  GRADE_B,
  GRADE_C,
  GRADE_D,
  parseDate,
  dayOf,
  isoDate,
  daysBetween,
  kmBetween,
  median,
  historyOf,
  openDtcs,
  serviceItems,
  odometerHealth,
  costProfile,
  gradeFor,
  gradeVehicle,
  fleet,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuFleetDashboard = api;
})();
