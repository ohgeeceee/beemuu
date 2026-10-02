"use strict";

/* Flash Counter & History Auditor — v3.0.0 feature 4.
 *
 * The most valuable diagnostic data on a used car is the one nobody shows you:
 * how many times each module has been programmed, and when. A DME flashed
 * three times on a car with 60,000 km on the clock has a story. A used-car
 * buyer reading that story walks away.
 *
 * ISTA shows it, buried in a programming menu. This module takes snapshots the
 * user *already saved* — the app has had a snapshot library since v0.7 — and
 * reconstructs the history from them. That matters: it needs no new DID
 * mappings, no unverified BMW-specific identifiers, and no live session. Every
 * claim it makes is derived from two readings the user took themselves.
 *
 * What it deliberately does NOT do:
 *   - It does not read flash counters from the ECU. `TECH_SPECS.md` §14.3
 *     sketches DID 0xF199 for a programming date, and admits `flash_count:
 *     None, // requires BMW-specific DID`. Inventing a byte layout for an
 *     identifier no capture pins is how this project ends up confidently
 *     displaying the wrong date on someone's car. It parses counters the caller
 *     supplies and stays silent about the ones it cannot source.
 *   - It does not diagnose a brick or a failed flash. It reports what changed
 *     and lets the user draw the conclusion.
 *
 * The interesting part is the inference. A counter that went up between two of
 * your own snapshots is hard evidence. A counter that is *missing* from one
 * snapshot and present in another is a coverage gap, not a flash — conflating
 * those two would invent history, which is the cardinal sin here.
 *
 * Dual export: `require()`-able, no DOM, no Tauri, no transport.
 */

/* Two readings closer together than this are treated as the same visit rather
 * than a flash event. Two snapshots taken minutes apart during one diagnostic
 * session are not two flashes. */
const MIN_FLASH_INTERVAL_MS = 60 * 60 * 1000; // one hour

/* UDS DID 0xF184 is Active Diagnostic Session, not a flash count. A naive
 * reader that treats any "programming date" field as authoritative will happily
 * report the current session. Sessions are tracked separately and never counted
 * as programming. */
const SESSION_KEYS = ["active_session", "active_diagnostic_session", "session"];

function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/* Normalize a timestamp to epoch ms, accepting a Date, an ISO string, or millis.
 * Returns null rather than guessing at an unparseable value.
 *
 * The Date check must come first. `instanceof Date` is the only thing
 * distinguishing a Date from a number, and a Date is also an object, so a
 * later `typeof === "object"` branch would call Date.parse on it and silently
 * return the wrong instant. */
function toMs(t) {
  if (t == null) return null;
  if (t instanceof Date) {
    const ms = t.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof t === "number") return Number.isFinite(t) ? t : null;
  if (typeof t === "string") {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Reading extraction
 * ------------------------------------------------------------------ */

/* Pull the per-module programming readings out of one snapshot.
 *
 * A snapshot's module records are the app's existing shape: each module has an
 * address, a name, and a bag of DID reads. This accepts the readings under
 * either a flat per-address object or the snapshot's `modules` array, because
 * both shapes exist in the wild and guessing wrong would silently return an
 * empty history.
 *
 * @returns {Map<number, Object>} address -> { address, name, flash_count,
 *                                           programming_date, versions }
 */
function extractModules(snapshot) {
  const out = new Map();
  if (!snapshot || typeof snapshot !== "object") return out;

  const add = (address, name, record) => {
    const addr = Number(address);
    if (!Number.isFinite(addr)) return;
    if (out.has(addr)) return; // first module wins; a snapshot should not have dupes
    const flashCount = pickCount(record);
    const versions = pickVersions(record);
    const programmingDate = toMs(pickDate(record));
    out.set(addr, {
      address: addr,
      name: typeof name === "string" && name ? name : `Module 0x${addr.toString(16).toUpperCase()}`,
      flash_count: flashCount,
      programming_date: programmingDate,
      // A current session is not a flash. Kept so the report can say "this
      // snapshot was taken in an extended session" without counting it.
      active_session: pickSession(record),
      versions,
    });
  };

  // Shape A: { address: { name, dids: {...} } }
  const byAddress = snapshot.modules_by_address || snapshot.modulesByAddress;
  if (byAddress && typeof byAddress === "object" && !Array.isArray(byAddress)) {
    for (const key of Object.keys(byAddress)) {
      const m = byAddress[key];
      if (!m || typeof m !== "object") continue;
      add(m.address != null ? m.address : key, m.name, m.dids || m.ident || m.reads || m);
    }
  }

  // Shape B: { modules: [{ address, name, dids }] }
  if (Array.isArray(snapshot.modules)) {
    for (const m of snapshot.modules) {
      if (!m || typeof m !== "object") continue;
      add(m.address, m.name, m.dids || m.ident || m.reads || m);
    }
  }

  // Shape C: a flat record keyed by DID name at the top level, for a
  // single-module scan.
  if (!out.size && !Array.isArray(snapshot.modules) && !byAddress) {
    add(snapshot.address, snapshot.module_name || snapshot.name, snapshot);
  }
  return out;
}

/* Find the flash counter in a DID record, accepting the spellings different
 * ECUs and different snapshot writers use. Returns null when there is none —
 * never 0, because "absent" and "never flashed" are different facts. */
function pickCount(record) {
  if (!record || typeof record !== "object") return null;
  for (const key of [
    "flash_count", "flashCount", "programming_count", "programmingCount",
    "flashCounter", "program_count", "number_of_flashings",
  ]) {
    const v = record[key];
    // Reject null/undefined before any numeric coercion. `Number(null)` is 0,
    // so a DID record carrying an explicit `flash_count: null` — what a module
    // that does not implement the identifier returns — would otherwise be read
    // as "programmed zero times" and render as "never flashed". Absent and
    // zero are different facts, and only one of them is a statement about the
    // car's history.
    if (v == null) continue;
    if (typeof v === "string") {
      const s = v.trim();
      // An empty string is an absent reading, not a count of zero. `Number("")`
      // is 0, so without this the same bug as `Number(null)` reappears through
      // a different door.
      if (!/^\d+$/.test(s)) continue;
      return parseInt(s, 10);
    }
    if (typeof v === "boolean") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickDate(record) {
  if (!record || typeof record !== "object") return null;
  for (const key of [
    "programming_date", "programmingDate", "last_programmed",
    "lastProgrammed", "flash_date", "flashDate", "date",
  ]) {
    if (record[key] != null) return record[key];
  }
  return null;
}

function pickSession(record) {
  if (!record || typeof record !== "object") return null;
  for (const key of SESSION_KEYS) {
    if (record[key] != null) return record[key];
  }
  return null;
}

function pickVersions(record) {
  if (!record || typeof record !== "object") return {};
  const v = {};
  for (const key of [
    "software_version", "softwareVersion", "sw_version", "swVersion", "sw_id",
    "hardware_version", "hardwareVersion", "hw_version", "hwVersion", "hw_id",
    "boot_version", "bootVersion", "boot_version_id",
  ]) {
    if (typeof record[key] === "string" && record[key].trim()) v[key] = record[key].trim();
  }
  return v;
}

/* ------------------------------------------------------------------ *
 * History reconstruction
 * ------------------------------------------------------------------ */

/* Reconstruct one module's programming history from a time-ordered list of
 * readings.
 *
 * @param {Array} readings  [{ at, module }] oldest first
 * @param {number} [librarySize]  total snapshots in the library, for coverage gaps
 * @returns {Object} history for one address
 */
function historyForModule(readings, librarySize) {
  const sorted = readings
    .filter(r => r && r.module && toMs(r.at) != null)
    .map(r => ({ at: toMs(r.at), module: r.module }))
    .sort((a, b) => a.at - b.at);

  const first = sorted[0] ? sorted[0].module : null;
  const last = sorted.length ? sorted[sorted.length - 1].module : null;

  const events = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].module;
    const cur = sorted[i].module;
    const gapMs = sorted[i].at - sorted[i - 1].at;
    const kind = classifyChange(prev, cur, gapMs);
    if (kind) {
      events.push({
        at: new Date(sorted[i].at).toISOString(),
        kind,
        from: prev.flash_count,
        to: cur.flash_count,
      });
    }
  }

  const known = sorted.filter(r => r.module.flash_count != null);
  return {
    address: first ? first.address : null,
    name: first ? first.name : null,
    readings: sorted.length,
    first_seen: sorted.length ? new Date(sorted[0].at).toISOString() : null,
    last_seen: sorted.length ? new Date(sorted[sorted.length - 1].at).toISOString() : null,
    first_count: known.length ? known[0].module.flash_count : null,
    current_count: last ? last.flash_count : null,
    programming_date: last ? last.programming_date : null,
    active_session: last ? last.active_session : null,
    versions: last ? last.versions : {},
    events,
    // Coverage gaps are reported as gaps. A module missing from a middle
    // snapshot means we did not read it then, which is not evidence that
    // anything was or was not programmed in between.
    gaps: countGaps(sorted, librarySize),
    note: noteFor(sorted, events, known),
  };
}

/* Decide what changed between two consecutive readings of the same module.
 * Returns null when nothing can honestly be said. */
function classifyChange(prev, cur, gapMs) {
  // A counter that moved is the strongest evidence available, and it is only
  // believable when the two readings are far enough apart to be separate
  // visits. Two snapshots five minutes apart in one session are one visit.
  if (prev.flash_count != null && cur.flash_count != null) {
    if (cur.flash_count > prev.flash_count && gapMs >= MIN_FLASH_INTERVAL_MS) {
      return "flash";
    }
    if (cur.flash_count < prev.flash_count) {
      // Counters do not go down. Either the ECU was replaced or the new module
      // reports a different scale. Saying "flashed" here would be a guess.
      return "counter_reset";
    }
    if (cur.flash_count > prev.flash_count) {
      // Moved, but too close in time to be a separate event. Report nothing
      // rather than manufacture a flash from one session's re-read.
      return null;
    }
    return null;
  }
  // A counter that appeared where there was none before is a coverage
  // difference, not a flash.
  if (prev.flash_count == null && cur.flash_count != null) {
    return "counter_appeared";
  }
  // A programming date that moved forward is real evidence of programming.
  if (prev.programming_date != null && cur.programming_date != null &&
      cur.programming_date > prev.programming_date &&
      gapMs >= MIN_FLASH_INTERVAL_MS) {
    return "reprogrammed";
  }
  return null;
}

/* How many library snapshots the module was missing from, between the first and
 * last snapshot that did read it.
 *
 * `librarySize` is the total number of snapshots in the library; the module was
 * present in `sorted.length` of them. The difference is coverage the user does
 * not have, which is worth reporting: a module missing from the middle of a
 * library cannot be shown to have been *un*flashed in that window. */
function countGaps(sorted, librarySize) {
  if (librarySize == null) return 0;
  return Math.max(0, librarySize - sorted.length);
}

function noteFor(sorted, events, known) {
  if (!sorted.length) return "No readings for this module.";
  if (!known.length) {
    return "This module never reported a flash counter in any snapshot, so nothing can be said about its programming history.";
  }
  if (known.length === 1) {
    // Distinguish "only one snapshot in the library read this module at all"
    // from "the library has several snapshots but only one carried a counter".
    // The second case means the counter is unreadable on this module, not that
    // the user needs to go and take more snapshots.
    return sorted.length > 1
      ? `Read in ${sorted.length} snapshots but only one carried a flash counter, so there is nothing to compare it against.`
      : "One reading only — a counter needs two snapshots, taken at least an hour apart, before it can show movement.";
  }
  if (!events.length) {
    return `Flash counter steady at ${known[known.length - 1].module.flash_count} across ${known.length} readings. No evidence of programming.`;
  }
  const flashes = events.filter(e => e.kind === "flash").length;
  if (flashes) {
    return `Flash counter moved ${flashes} time${flashes === 1 ? "" : "s"} across your snapshots — the most recent at ${events[events.length - 1].at.slice(0, 10)}.`;
  }
  return "Readings changed in a way that is not a clean flash event; see the events list.";
}

/* Reconstruct every module's history from a snapshot library.
 *
 * @param {Array} snapshots  [{ taken_at | timestamp | date, modules... }]
 * @returns {{modules: Array, summary: Object}}
 */
function audit(snapshots) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  const byAddress = new Map();

  for (const snap of list) {
    if (!snap || typeof snap !== "object") continue;
    const at = toMs(snap.taken_at != null ? snap.taken_at
      : (snap.timestamp != null ? snap.timestamp : snap.date));
    if (at == null) continue;
    for (const [addr, mod] of extractModules(snap)) {
      if (!byAddress.has(addr)) byAddress.set(addr, []);
      byAddress.get(addr).push({ at, module: mod });
    }
  }

  const modules = [...byAddress.entries()]
    .map(([addr, readings]) => historyForModule(readings, list.length))
    .sort((a, b) => {
      const af = a.events.filter(e => e.kind === "flash").length;
      const bf = b.events.filter(e => e.kind === "flash").length;
      if (bf !== af) return bf - af; // flashed modules first: the interesting ones
      return String(a.name).localeCompare(String(b.name));
    });

  const flashed = modules.filter(m => m.events.some(e => e.kind === "flash"));
  const resets = modules.filter(m => m.events.some(e => e.kind === "counter_reset"));
  return {
    modules,
    summary: {
      snapshots: list.length,
      modules: modules.length,
      flashed: flashed.length,
      counter_resets: resets.length,
      // A single snapshot can never show movement. Saying so up front stops a
      // user reading "no flashes" as "this car was never flashed".
      sufficient_history: list.length >= 2,
      note: list.length < 2
        ? "One snapshot cannot show programming history — a counter needs two readings at least an hour apart."
        : null,
    },
  };
}

/* Software-version mismatches across modules, which is what a partial or
 * botched flash actually looks like from the outside.
 *
 * Compares the software version's *series* across modules, not the exact
 * string: a DME at ME17.2.42 and a TCM at ME17.2.40 are perfectly matched —
 * patch-level differences within a series are normal, and flagging them would
 * cry wolf on every car. A real mismatch is the opposite case, modules sitting
 * on *different* series (an ME17 alongside an ME18), which is the signature of
 * a partial or interrupted flash.
 *
 * @param {Array} histories  output of `audit().modules`
 * @returns {Array} one entry per series, but only when they disagree
 */
function versionMismatches(histories) {
  const list = Array.isArray(histories) ? histories : [];
  const series = new Map(); // series key -> [{name, version}]
  for (const h of list) {
    if (!h || !h.versions) continue;
    const sw = h.versions.software_version || h.versions.softwareVersion ||
      h.versions.sw_version || h.versions.swVersion || h.versions.sw_id;
    if (typeof sw !== "string" || !sw.trim()) continue;
    const match = /^([A-Z]{1,4}\d{0,2})\./i.exec(sw.trim());
    if (!match) continue;
    const key = match[1].toUpperCase();
    if (!series.has(key)) series.set(key, []);
    series.get(key).push({ name: h.name, version: sw.trim() });
  }
  if (series.size < 2) return []; // one series, or none: nothing can disagree
  return [...series.values()].filter(entries => entries.length > 0);
}

const api = {
  MIN_FLASH_INTERVAL_MS,
  SESSION_KEYS,
  audit,
  classifyChange,
  extractModules,
  historyForModule,
  toMs,
  versionMismatches,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuFlashAudit = api;
