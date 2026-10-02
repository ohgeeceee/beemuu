"use strict";

/* Signal Library — v3.0.0 feature 8.
 *
 * The Parameter Explorer is a wall of identifiers. It is the right tool for
 * someone who already knows what they are looking for and the wrong front door
 * for someone who does not. "What does the DME actually tell me?" has 218
 * answers scattered across 12 TOML files, and the only way to find the oil
 * temperature one today is to know it is in n55.toml.
 *
 * This is the missing index: every decodable signal in one searchable catalog,
 * with the engines that support it, the identifier it lives at, and — the part
 * that matters most — an honest confidence flag.
 *
 * The confidence work is the point. `community/profiles/n55.toml` says so
 * itself: "The `local:10` placeholder is unverified for E-series and has no
 * open-source evidence; confirm with the Parameter Explorer before trusting
 * it." A library that flattens that into a searchable list would let someone
 * trust a number nobody has confirmed, which on a car means chasing a
 * nonexistent fault. So:
 *
 *   - OBD-II mode 01/02 queries are **verified by design** — every compliant
 *     ECU implements them, so no per-engine confirmation is needed.
 *   - Anything using a `local:` identifier is **unverified** unless the profile
 *     says otherwise. A local ID is engine-specific and unpublished.
 *   - UDS DIDs are **community**, sourced from the OBDb set and flagged
 *     accordingly.
 *   - An explicit `[needs verification]` note in the label wins over all of it.
 *
 * Pure: no DOM, no Tauri, no filesystem. A caller hands in already-parsed
 * profiles — the app already imports them through Rust — and gets an index.
 */

/* The three confidence grades, best first. */
const CONFIDENCE = {
  /* OBD-II standard PIDs/MIDs: mandated on every compliant ECU, identical
   * everywhere, so engine-specific confirmation would add nothing. */
  verified: "verified",
  /* A UDS DID from the community-sourced set: real and usually right, but not
   * confirmed for this chassis. */
  community: "community",
  /* A `local:` identifier with no open-source evidence. */
  unverified: "unverified",
};

const RANK = { verified: 0, community: 1, unverified: 2 };

/* OBD-II mode 01 (current data) and mode 02 (freeze frame) standard PIDs. */
const OBD_MODE01 = new Set([
  "0C", "05", "04", "0F", "11", "0D", "42", "43", "45", "46",
  "01", "1C", "2F", "5C", "51", "5D", "5E",
]);

function norm(s) {
  return String(s == null ? "" : s).trim();
}

/* Strip the unit/condition noise from a profile label so the searchable text is
 * the signal's name rather than a bracketed caveat. */
function cleanLabel(label) {
  return norm(label)
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Classify one query string.
 *
 * The order matters: the explicit "[needs verification]" marker in a label is
 * the author telling us directly, and it outranks whatever the query form
 * would otherwise imply. */
function classify(query, label) {
  const l = norm(label).toLowerCase();
  if (/needs verification|unverified|no open-source evidence|placeholder/.test(l)) {
    return CONFIDENCE.unverified;
  }
  const q = norm(query).toLowerCase();
  if (q.startsWith("obd:")) {
    // Normalise the PID to two uppercase hex digits, upper-casing rather than
    // stripping leading zeros. Stripping turns "0C" into "C" and "05" into
    // "5", neither of which is in the table, so every standard PID would fall
    // through to `community` and the whole verified tier would be empty.
    const raw = q.slice(4);
    const pid = raw.length ? raw.toUpperCase().padStart(2, "0") : "";
    return OBD_MODE01.has(pid) ? CONFIDENCE.verified : CONFIDENCE.community;
  }
  if (q.startsWith("local:")) return CONFIDENCE.unverified;
  if (q.startsWith("uds:")) return CONFIDENCE.community;
  // A bare `did:` is the form the community profiles use for BMW-specific
  // identifiers sourced from the OBDb set (101 of them across the shipped
  // profiles). Real and usually right, but not confirmed per chassis.
  if (q.startsWith("did:")) return CONFIDENCE.community;
  // An empty or unrecognised query cannot be verified by anything. Defaulting
  // it to anything better than unverified would be a claim nobody made.
  return CONFIDENCE.unverified;
}

/* The address a parameter is read from, rendered for display. */
function targetLabel(param) {
  const t = param.target;
  if (t == null) return "";
  if (typeof t === "number") {
    // 0x12 is the engine; anything else is a module address.
    return t === 0x12 ? "DME" : `0x${t.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return norm(t);
}

/**
 * Build the index from already-parsed profiles.
 *
 * @param {Array} profiles  [{id, label, param: [{id, label, unit, query, target, decode, min, max, enum}]}]
 * @returns {{signals: Array, engines: Array, summary: Object}}
 */
function build(profiles) {
  const byId = new Map();

  for (const p of (Array.isArray(profiles) ? profiles : [])) {
    if (!p || typeof p !== "object") continue;
    const engineId = norm(p.id);
    if (!engineId) continue;
    for (const param of (Array.isArray(p.param) ? p.param : [])) {
      if (!param || typeof param !== "object") continue;
      const id = norm(param.id);
      // A profile entry with no id cannot be searched for or looked up. Skip it
      // rather than index it under "".
      if (!id) continue;

      const label = cleanLabel(param.label);
      const confidence = classify(param.query, param.label);
      const record = byId.get(id);
      if (record) {
        // The same signal on a second engine. Keep the best confidence seen
        // (an OBD PID verified on an N55 is not less verified on an N54) and
        // record the extra engine rather than duplicating the row.
        if (!record.engines.includes(engineId)) record.engines.push(engineId);
        if (RANK[confidence] < RANK[record.confidence]) {
          record.confidence = confidence;
          record.verified_on = engineId;
        }
        // ...but the best grade must never hide a per-engine caveat. The real
        // profiles are full of this: `oil` is `obd:5C` (a standard PID) on the
        // diesels and `local:10` (an explicitly unverified placeholder) on the
        // N55, N57, S55 and S58. A flat "verified" on that row would send an
        // N55 owner chasing a number the profile itself says not to trust.
        if (confidence === CONFIDENCE.unverified && record.confidence !== CONFIDENCE.unverified) {
          if (!record.unverified_on.includes(engineId)) record.unverified_on.push(engineId);
          record.partially_verified = true;
        }
        continue;
      }
      byId.set(id, {
        id,
        label: label || id,
        unit: norm(param.unit),
        query: norm(param.query),
        target: targetLabel(param),
        decode: norm(param.decode),
        min: typeof param.min === "number" ? param.min : null,
        max: typeof param.max === "number" ? param.max : null,
        has_enum: !!param.enum,
        confidence,
        verified_on: confidence === CONFIDENCE.verified ? engineId : null,
        engines: [engineId],
        // Engines where this signal is listed but not trustworthy. A row with
        // a non-empty list is a split verdict, and the panel must say so rather
        // than showing the best grade on its own.
        unverified_on: confidence === CONFIDENCE.unverified ? [engineId] : [],
        partially_verified: false,
      });
    }
  }

  const signals = [...byId.values()].sort((a, b) =>
    (RANK[a.confidence] - RANK[b.confidence]) ||
    a.label.localeCompare(b.label));

  const engineIds = new Set();
  for (const s of signals) for (const e of s.engines) engineIds.add(e);

  return {
    signals,
    engines: [...engineIds].sort(),
    summary: {
      total: signals.length,
      verified: signals.filter(s => s.confidence === CONFIDENCE.verified).length,
      community: signals.filter(s => s.confidence === CONFIDENCE.community).length,
      unverified: signals.filter(s => s.confidence === CONFIDENCE.unverified).length,
      // Stated plainly so the panel can say it: a good number of these numbers
      // are somebody's best guess, and the user deserves to know before
      // trusting one.
      note: "OBD-II standard PIDs are verified by design. UDS DIDs are community-sourced. Anything using a `local:` identifier is unverified — confirm it on your own car before trusting it.",
    },
  };
}

/**
 * Search the index.
 *
 * @param {Object} index  from `build()`
 * @param {string} query
 * @param {Object} opts
 * @param {string} [opts.engine]  restrict to engines supporting the signal
 * @param {boolean} [opts.verifiedOnly]  hide unverified and community signals
 */
function search(index, query, opts) {
  const o = opts || {};
  const all = index && Array.isArray(index.signals) ? index.signals : [];
  const q = norm(query).toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);

  let out = all;
  if (o.engine) {
    const e = norm(o.engine).toLowerCase();
    out = out.filter(s => s.engines.some(x => x.toLowerCase() === e));
  }
  if (o.verifiedOnly) {
    out = out.filter(s => s.confidence === CONFIDENCE.verified);
    // ...and when a specific engine is in view, a signal that is unverified on
    // *that* engine must drop out even though it is verified elsewhere. Without
    // this, filtering an N55 to verified signals would still offer `oil`, whose
    // N55 entry is the explicitly unverified `local:10` placeholder.
    if (o.engine) {
      const e = norm(o.engine).toLowerCase();
      out = out.filter(s => !s.unverified_on.some(x => x.toLowerCase() === e));
    }
  }
  if (!terms.length) return out.slice();

  // Every term must match somewhere. An OR search on short queries returns the
  // whole catalog and is worse than useless.
  return out.filter(s => {
    const hay = `${s.id} ${s.label} ${s.unit} ${s.query} ${s.engines.join(" ")}`.toLowerCase();
    return terms.every(t => hay.includes(t));
  });
}

/* Every engine that supports a given signal, for a profile-picker. */
function enginesFor(index, id) {
  const s = index && Array.isArray(index.signals)
    ? index.signals.find(x => x.id === id)
    : null;
  return s ? s.engines.slice() : [];
}

const api = {
  CONFIDENCE,
  RANK,
  build,
  search,
  classify,
  cleanLabel,
  enginesFor,
  targetLabel,
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuSignalLibrary = api;
