/* v3 IIFE wrapper — see scripts/wrap_v3_iife.py. Every classic
 * tag shares one global lexical scope, so a bare top-level `const` in
 * one file is a redeclaration error in the next. */
(function () {
"use strict";

/* Beemuu Platform — Plugin Capability Bridge, v5.0.0 feature 1.
 *
 * VISION.md Phase 1 turns the bundled plugin runtime into a shareable
 * ecosystem, and the one piece still missing is the bridge between a
 * downloaded package and the vehicle. `docs/plugin_capability_bridge_plan.md`
 * calls it "unbuilt work, not deferred work": a package declares a list of
 * host *capabilities* it would like, and something has to decide — before any
 * plugin code runs — whether that list may be honoured.
 *
 * This module is that something, and only that something. It is the decision
 * layer, not the transport:
 *
 *   validateManifest   is the package a well-formed request at all?
 *   classifyCapability is this name a read, a write, or nothing we know?
 *   evaluateGrants      which of the declared capabilities may be granted?
 *   consentPrompt       what do we show the user before they agree?
 *   createRunner        hand back a runner that calls the host, per call
 *   auditLines          one line per decision, for a consent log
 *
 * It is *pure and inert*. It performs no I/O: no DOM, no window access beyond
 * the export line, no Tauri, no fetch, no timers, no eval, no new Function. It
 * never reads a VIN, never subscribes to live data, never talks to an ECU. It
 * only DECIDES, and it dispatches to host functions the *caller* injects. When
 * a host function was not injected the request fails closed — deny, never a
 * silent success.
 *
 * The rule the whole module is built on is deny-by-default. `granted` is
 * false unless every gate passes; an unknown capability name is denied and an
 * unrecognised string never falls through to allowed; a manifest that is not a
 * plain object, or is missing `id` or `version`, or carries a non-array
 * capability list, is *invalid* rather than coerced into something grantable.
 *
 * The recognised-but-refused write set (`WRITE_CAPABILITIES`) exists so the UI
 * can explain a refusal precisely instead of shrugging "unknown capability".
 * Those names are never grantable by this module and no option turns them on.
 * There is deliberately no ECU write path here to implement or expose; this is
 * the read-only half of a capability model whose write half is a security
 * review away and out of scope, per `docs/v3.8_to_v5.0_roadmap.md`.
 *
 * Dual export: `require()` under node --test, plain <script> in the webview.
 */

/* ------------------------------------------------------------------ *
 * The capability table. Every name the runtime can talk about lives
 * here, so the panel, the consent prompt and the tests all read one
 * source of truth. Read capabilities are grantable; write capabilities
 * are recognised and refused. Nothing here reaches an ECU.
 * ------------------------------------------------------------------ */
const READ_CAPABILITIES = Object.freeze([
  "read-vin",
  "read-dtc",
  "subscribe-live",
]);

/* Every name here mutates the vehicle, so the module recognises it and
 * refuses it. An empty evidential write set would be worse: an unknown string
 * would be the only signal, and a precise refusal is what the UI needs. */
const WRITE_CAPABILITIES = Object.freeze([
  "clear-dtc",
  "coding-write",
  "ecu-write",
  "flash-ecu",
]);

const KNOWN_CAPABILITIES = Object.freeze({
  "read-vin": Object.freeze({
    kind: "read",
    summary: "Read the vehicle identification number.",
    line: "read the vehicle's VIN",
  }),
  "read-dtc": Object.freeze({
    kind: "read",
    summary: "Read stored fault codes. Read-only; never clears.",
    line: "read stored fault codes",
  }),
  "subscribe-live": Object.freeze({
    kind: "read",
    summary: "Subscribe to live parameter values.",
    line: "subscribe to live parameter values",
  }),
  "clear-dtc": Object.freeze({
    kind: "write",
    summary: "Clear fault memory — writes to an ECU.",
    line: "clear the fault memory",
  }),
  "coding-write": Object.freeze({
    kind: "write",
    summary: "Write coding data — writes to an ECU.",
    line: "write coding data",
  }),
  "ecu-write": Object.freeze({
    kind: "write",
    summary: "Write to an ECU.",
    line: "write to an ECU",
  }),
  "flash-ecu": Object.freeze({
    kind: "write",
    summary: "Flash an ECU — safety-critical.",
    line: "flash an ECU",
  }),
});

/* The closed set of refusal reasons. A reason is a keyword, not prose; the
 * prose lives in `reasonText` so the audit log and the prompt agree. */
const REASONS = Object.freeze([
  "unknown_capability",
  "not_permitted",
  "not_declared",
  "denied_by_policy",
  "denied_by_user",
]);

/* Own-key check that ignores the prototype chain: `KNOWN_CAPABILITIES` is a
 * normal object, so `constructor` / `toString` are inherited and must never be
 * mistaken for a capability. */
function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/* A plain object is a non-null, non-array object whose prototype is
 * `Object.prototype` or null. Anything else — a class instance, a function, a
 * value with a tampered prototype — is not a manifest. */
function isPlainObject(value) {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/* `__proto__`, `constructor` and `prototype` are how a hostile manifest tries
 * to reach the runtime's own objects. A manifest has no legitimate use for any
 * of them, so an own key with one of these names is an invalid manifest. */
const DANGEROUS_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);

function dangerousKeys(value) {
  const found = [];
  for (const key of Object.getOwnPropertyNames(value)) {
    if (DANGEROUS_KEYS.indexOf(key) !== -1) found.push(key);
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * validateManifest — is this a manifest we can reason about at all?
 *
 * Returns `{ ok, errors, manifest }`. On failure `manifest` is null and
 * `errors` names every problem: a caller never gets a half-built object
 * it might act on. On success `manifest` is a fresh copy holding only
 * the fields the bridge acts on.
 * ------------------------------------------------------------------ */
function validateManifest(manifest) {
  if (!isPlainObject(manifest)) {
    return { ok: false, errors: ["manifest must be a plain object"], manifest: null };
  }
  const errors = [];

  const danger = dangerousKeys(manifest);
  if (danger.length) {
    errors.push(`manifest must not define ${danger.join(", ")}`);
  }

  if (typeof manifest.id !== "string" || manifest.id.trim() === "") {
    errors.push("manifest.id must be a non-empty string");
  }
  if (typeof manifest.version !== "string" || manifest.version.trim() === "") {
    errors.push("manifest.version must be a non-empty string");
  }

  const capabilities = manifest.capabilities;
  if (!Array.isArray(capabilities)) {
    errors.push("manifest.capabilities must be an array");
  } else {
    for (const capability of capabilities) {
      if (typeof capability !== "string" || capability === "") {
        errors.push("every capability must be a non-empty string");
        break;
      }
    }
  }

  if (errors.length) {
    return { ok: false, errors, manifest: null };
  }

  const clean = { id: manifest.id, version: manifest.version, capabilities: capabilities.slice() };
  if (typeof manifest.name === "string") clean.name = manifest.name;
  return { ok: true, errors: [], manifest: clean };
}

/* ------------------------------------------------------------------ *
 * classifyCapability — read, write or unknown. Unknown is the safe
 * default: a name we do not recognise is never read, and never falls
 * through to a granted read.
 * ------------------------------------------------------------------ */
function classifyCapability(name) {
  if (typeof name !== "string") return "unknown";
  if (!has(KNOWN_CAPABILITIES, name)) return "unknown";
  return KNOWN_CAPABILITIES[name].kind;
}

/* ------------------------------------------------------------------ *
 * evaluateGrants — apply every gate and split the request. `granted`
 * is an array of capability names that passed; `refused` pairs each
 * refused name with one reason. A write, an unknown and anything not
 * declared are all refused; the only gates the caller can add are
 * narrowings (`denied`, `policy`), never widenings.
 * ------------------------------------------------------------------ */
function evaluateGrants(manifest, opts) {
  const options = isPlainObject(opts) ? opts : {};
  const check = validateManifest(manifest);
  if (!check.ok) {
    return { granted: [], refused: [], requested: [], valid: false };
  }
  const declared = check.manifest.capabilities;
  const requested = Array.isArray(options.requested) ? options.requested.slice() : declared.slice();

  const denied = new Set(
    Array.isArray(options.denied) ? options.denied.filter((c) => typeof c === "string") : [],
  );
  const policy = isPlainObject(options.policy) ? options.policy : null;
  const allow = policy && Array.isArray(policy.allow) ? new Set(policy.allow) : null;
  const deny = policy && Array.isArray(policy.deny) ? new Set(policy.deny) : null;

  const granted = [];
  const refused = [];
  for (const capability of requested) {
    let reason = null;
    if (!declared.includes(capability)) {
      reason = "not_declared";
    } else if (classifyCapability(capability) === "write") {
      reason = "not_permitted";
    } else if (classifyCapability(capability) === "unknown") {
      reason = "unknown_capability";
    } else if (denied.has(capability)) {
      reason = "denied_by_user";
    } else if (deny && deny.has(capability)) {
      reason = "denied_by_policy";
    } else if (allow && !allow.has(capability)) {
      reason = "denied_by_policy";
    }
    if (reason) refused.push({ capability, reason });
    else granted.push(capability);
  }
  return { granted, refused, requested, valid: true };
}

/* ------------------------------------------------------------------ *
 * Plain-language text. Kept as data so the prompt and the audit log
 * cannot drift apart, and so neither can carry markup.
 * ------------------------------------------------------------------ */
function capabilityLine(capability) {
  if (has(KNOWN_CAPABILITIES, capability)) return KNOWN_CAPABILITIES[capability].line;
  return `use the unrecognised capability "${capability}"`;
}

function reasonText(reason) {
  switch (reason) {
    case "unknown_capability":
      return "it is not a capability this build recognises";
    case "not_permitted":
      return "this build never grants vehicle writes";
    case "not_declared":
      return "the plugin did not declare it";
    case "denied_by_policy":
      return "policy refuses it";
    case "denied_by_user":
      return "you declined it";
    case "not_granted":
    default:
      return "it was not granted";
  }
}

/* ------------------------------------------------------------------ *
 * consentPrompt — the shape a consent dialog renders. Pure data: one
 * plain-language line per capability, no HTML, nothing executable. The
 * risk band tells the UI how loud to be.
 * ------------------------------------------------------------------ */
function consentPrompt(manifest, evaluation) {
  const check = validateManifest(manifest);
  const clean = check.ok ? check.manifest : null;
  const pluginId = clean ? clean.id : null;
  const name = clean && typeof clean.name === "string" ? clean.name : pluginId;

  const given = isPlainObject(evaluation) ? evaluation : evaluateGrants(manifest);
  const requested = Array.isArray(given.requested)
    ? given.requested.slice()
    : clean
      ? clean.capabilities.slice()
      : [];
  const grantedSet = new Set(Array.isArray(given.granted) ? given.granted : []);
  const refusedBy = new Map();
  if (Array.isArray(given.refused)) {
    for (const entry of given.refused) {
      if (isPlainObject(entry) && typeof entry.capability === "string") {
        refusedBy.set(entry.capability, entry.reason);
      }
    }
  }

  const capabilities = [];
  const lines = [];
  let refusedWrite = false;
  let refusedOther = false;
  for (const capability of requested) {
    capabilities.push(capability);
    let reason = null;
    if (refusedBy.has(capability)) reason = refusedBy.get(capability);
    else if (!grantedSet.has(capability)) reason = "not_granted";
    if (reason) {
      if (reason === "not_permitted" || classifyCapability(capability) === "write") refusedWrite = true;
      else refusedOther = true;
      lines.push(`${capabilityLine(capability)} — refused: ${reasonText(reason)}`);
    } else {
      lines.push(`${capabilityLine(capability)} — allowed (read-only)`);
    }
  }

  const risk = refusedWrite ? "refused" : refusedOther ? "elevated" : "read-only";
  return {
    plugin_id: pluginId,
    title: `${name ? `"${name}"` : "This plugin"} requests plugin access`,
    lines,
    capabilities,
    risk,
  };
}

/* ------------------------------------------------------------------ *
 * createRunner — the only path from a plugin to the host.
 *
 * The runner does not trust the evaluation object it is handed: a
 * {granted:[...]} that was forged in the console grants nothing. Every
 * call re-derives the grants from the manifest and refuses anything
 * that is not a declared read. A missing host function fails closed.
 * ------------------------------------------------------------------ */
function createRunner(manifest, evaluation, host) {
  const check = validateManifest(manifest);
  const clean = check.ok ? check.manifest : null;

  /* The handed evaluation may only *narrow*: a capability the consent flow
   * records as declined by the user stays declined here. It can never widen,
   * because the grant itself is recomputed below. */
  const declined = new Set();
  if (isPlainObject(evaluation) && Array.isArray(evaluation.refused)) {
    for (const entry of evaluation.refused) {
      if (isPlainObject(entry) && entry.reason === "denied_by_user" && typeof entry.capability === "string") {
        declined.add(entry.capability);
      }
    }
  }

  function authorised(capability) {
    if (!clean) return false;
    if (typeof capability !== "string" || capability === "") return false;
    if (declined.has(capability)) return false;
    return evaluateGrants(clean).granted.includes(capability);
  }

  function run(intent) {
    let capability = null;
    let args = [];
    if (typeof intent === "string") {
      capability = intent;
    } else if (isPlainObject(intent)) {
      capability = intent.capability;
      args = Array.isArray(intent.args) ? intent.args.slice() : [];
    } else {
      return { ok: false, reason: "not_granted" };
    }

    /* Re-check at call time — the evaluation is a recording, not a warrant. */
    if (!authorised(capability)) return { ok: false, reason: "not_granted" };
    if (!isPlainObject(host) || typeof host[capability] !== "function") {
      return { ok: false, reason: "host_unavailable" };
    }
    try {
      return { ok: true, capability, result: host[capability](args) };
    } catch (_) {
      return { ok: false, reason: "host_unavailable" };
    }
  }

  return {
    run,
    /* What this runner will actually allow, recomputed — not the evaluation. */
    granted: clean ? evaluateGrants(clean).granted.slice() : [],
  };
}

/* ------------------------------------------------------------------ *
 * auditLines — one deterministic line per grant, refusal or run
 * attempt, for the consent log. Sorted so the log does not depend on
 * the order the events happened to be collected in.
 * ------------------------------------------------------------------ */
function auditLines(events) {
  if (!Array.isArray(events)) return [];
  const lines = [];
  for (const event of events) {
    if (!isPlainObject(event)) continue;
    const name = typeof event.capability === "string" ? event.capability : String(event.capability);
    const kind = classifyCapability(event.capability);
    const classNote = kind === "read" ? "read-only" : kind === "write" ? "vehicle write" : "unrecognised";
    if (event.type === "grant") {
      const allowed = kind === "read";
      lines.push(`grant ${name} (${classNote}) — ${allowed ? "allowed" : "refused: this build never grants it"}`);
    } else if (event.type === "refuse") {
      lines.push(`refuse ${name} (${classNote}) — ${reasonText(event.reason)}`);
    } else if (event.type === "run") {
      lines.push(event.ok
        ? `run ${name} (${classNote}) — allowed`
        : `run ${name} (${classNote}) — blocked: ${event.reason === "host_unavailable" ? "host function unavailable" : reasonText(event.reason)}`);
    }
  }
  return lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const api = {
  READ_CAPABILITIES,
  WRITE_CAPABILITIES,
  KNOWN_CAPABILITIES,
  REASONS,
  isPlainObject,
  has,
  classifyCapability,
  validateManifest,
  evaluateGrants,
  consentPrompt,
  createRunner,
  auditLines,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuPluginCapabilityBridge = api;
})();
