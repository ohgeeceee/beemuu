/* Plugin capability bridge — manifest validation and per-call enforcement.
 *
 * The marketplace spec (`beemuu-plugins/PLUGIN_FORMAT.md`) lets a plugin declare
 * host capabilities and call into the app (`context.vehicle.readVin()`,
 * `context.vehicle.readDtc()`, `context.vehicle.subscribeLive()`). The runtime
 * shipped here grants no host access at all: `validate()` in `plugins.js`
 * rejects any non-empty `permissions` array, and a tool only ever sees the JSON
 * it was handed. This module is the enforcement core that sits between the two.
 * It decides which capabilities a package may declare, and it hands a plugin a
 * surface exposing only the calls it declared — never the host object itself.
 *
 * Scope is deliberately narrow. `docs/v3_plan.md` ("Explicitly out of scope for
 * v3") refuses ECU writes, `filesystem`, `network` and `ui`. Those names are
 * still *recognised* here so a marketplace package is refused with a precise
 * reason rather than "unknown capability", and so enabling one later is a
 * one-line change to a table rather than a redesign.
 *
 * The invariant that matters: an undeclared call is rejected before it reaches
 * vehicle or comms code. That is enforced structurally — the plugin never holds
 * a reference to the host object, only to wrappers for the methods it declared,
 * behind a proxy that throws on any other host method.
 */
(function (root) {
  "use strict";

  const MAX_CAPABILITIES = 12;

  /* Capabilities the runtime can serve today. Read-only by construction: there
   * is no member here that writes to an ECU. */
  const GRANTABLE = Object.freeze({
    "read-vin": Object.freeze({
      method: "readVin",
      summary: "Read the vehicle identification number.",
    }),
    "read-dtc": Object.freeze({
      method: "readDtc",
      summary: "Read fault memory. Read-only; never clears.",
    }),
    "live-data": Object.freeze({
      method: "subscribeLive",
      summary: "Subscribe to live parameter values.",
    }),
  });

  /* Recognised, never granted. Each entry carries the reason a package is
   * refused so the install UI can say something useful. */
  const RESERVED = Object.freeze({
    "clear-dtc": "clearing fault memory writes to an ECU and needs maintainer review",
    "coding-write": "coding writes to an ECU and needs maintainer review",
    "ecu-flash": "flashing writes to an ECU and needs maintainer review",
    filesystem: "plugins get no disk access; the filesystem capability is out of scope",
    network: "plugins cannot open connections; the network capability is out of scope",
    ui: "the sandbox has no safe DOM surface; the ui capability is out of scope",
  });

  const METHOD_TO_CAPABILITY = Object.create(null);
  for (const capability of Object.keys(GRANTABLE)) {
    METHOD_TO_CAPABILITY[GRANTABLE[capability].method] = capability;
  }

  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  function fail(message) { throw new Error(message); }

  /* Normalise a declared capability list. Returns a sorted, de-duplicated copy.
   * Rejects anything not in GRANTABLE — reserved names with their reason, and
   * everything else as unknown. */
  function validateCapabilities(value) {
    if (!Array.isArray(value)) fail("Capabilities must be an array.");
    if (value.length > MAX_CAPABILITIES) {
      fail(`At most ${MAX_CAPABILITIES} capabilities may be declared.`);
    }
    const declared = new Set();
    for (const capability of value) {
      if (typeof capability !== "string") fail("Every capability must be a string.");
      if (declared.has(capability)) fail(`Duplicate capability: ${capability}.`);
      declared.add(capability);
      if (has(RESERVED, capability)) {
        fail(`Capability "${capability}" is not grantable: ${RESERVED[capability]}.`);
      }
      if (!has(GRANTABLE, capability)) fail(`Unknown capability: ${capability}.`);
    }
    return [...declared].sort();
  }

  /* Build the surface a plugin is allowed to call through.
   *
   * Returns `{ surface, capabilities, denials }`. `surface` exposes one method
   * per declared capability. Calling any other known host method throws, and
   * records the attempt — it never reaches `host`. Reading an unrelated
   * property yields `undefined`, so ordinary JavaScript (JSON.stringify, a
   * `then` check, feature detection) behaves normally instead of exploding.
   */
  function createBridge(declared, host) {
    const capabilities = validateCapabilities(declared);
    if (!host || typeof host !== "object") fail("A host object is required.");
    for (const capability of capabilities) {
      const method = GRANTABLE[capability].method;
      if (typeof host[method] !== "function") {
        fail(`Host does not implement "${method}" for capability "${capability}".`);
      }
    }
    const surface = {};
    for (const capability of capabilities) {
      const method = GRANTABLE[capability].method;
      /* The host method is called on the host object, so `this` stays correct,
       * but the plugin only ever holds this wrapper. */
      surface[method] = function (...args) { return host[method](...args); };
    }
    Object.freeze(surface);

    const denied = [];
    const guarded = new Proxy(surface, {
      get(target, property) {
        if (typeof property === "symbol") return target[property];
        if (has(target, property)) return target[property];
        const capability = METHOD_TO_CAPABILITY[property];
        if (capability) {
          denied.push({ call: property, capability });
          fail(`Plugin called "${property}" without declaring the "${capability}" capability.`);
        }
        /* Not a host method: fall through to normal object semantics, so
         * inherited members (`toString`, `valueOf`) and feature detection keep
         * working rather than returning `undefined` and breaking implicitly. */
        return Reflect.get(target, property);
      },
      set(_target, property) {
        fail(`Plugin may not assign to the host bridge ("${String(property)}").`);
      },
      defineProperty(_target, property) {
        fail(`Plugin may not redefine the host bridge ("${String(property)}").`);
      },
      deleteProperty(_target, property) {
        fail(`Plugin may not delete from the host bridge ("${String(property)}").`);
      },
    });

    return {
      surface: guarded,
      capabilities,
      /* Copy on read: a caller cannot mutate the record of what was refused. */
      denials: () => denied.map(entry => ({ ...entry })),
    };
  }

  /* Human-readable capability summaries, for the install preview and the
   * registry entry detail view. */
  function summarize(declared) {
    return validateCapabilities(declared).map(capability => GRANTABLE[capability].summary);
  }

  const api = { MAX_CAPABILITIES, GRANTABLE, RESERVED, validateCapabilities, createBridge, summarize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BeemuuPluginCapabilities = api;
})(typeof window !== "undefined" ? window : null);