/* Plugin host bridge — the wire between a sandboxed plugin worker, the runner
 * frame, and the app shell.
 *
 * `plugin_capabilities.js` decides which calls a plugin may make and hands it a
 * guarded surface. `plugin_host.js` implements the read-only host side over
 * accessors the app injects. Neither was reachable from a running plugin, which
 * is what this module fixes: it carries a call from the worker out to the app
 * and the answer back, and it is the only path a plugin has to host state.
 *
 * Three hops, each with one job:
 *
 *   worker → frame   `{t:"call", id, method, args}` from the generated stubs
 *   frame  → app     the same call, resolved against the run's granted surface
 *   app    → frame   the value, or a host event for a subscription
 *
 * Two independent gates stand in the way of a call, and neither is advisory:
 *
 *  - The frame builds the plugin's surface with `createBridge()`, so an
 *    undeclared method throws before it can be relayed. The surface is built
 *    from the capabilities the *app* put on the run message, never from
 *    anything the worker sends.
 *  - The app re-derives the capabilities from the installed package it is
 *    running, ignoring the frame's copy. A frame that lied — or a worker that
 *    guessed a method name — gets nothing.
 *
 * Events go the other way: `deliver(token, payload)` pushes a live-data
 * snapshot to whichever worker asked for it. The frame never invents data, it
 * only forwards what the app published.
 *
 * Pure: no DOM, no postMessage, no timers. The frame wires `send`/`relay` to
 * real channels, tests wire them to fakes.
 */
(function (root, factory) {
  const capabilities = (typeof module === "object" && module.exports)
    ? require("./plugin_capabilities.js")
    : (root && root.BeemuuPluginCapabilities);
  const api = factory(capabilities);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BeemuuPluginBridge = api;
})(typeof window !== "undefined" ? window : null, function (capabilities) {
  "use strict";

  if (!capabilities || typeof capabilities.createBridge !== "function") {
    throw new Error("plugin_bridge.js requires plugin_capabilities.js to be loaded first.");
  }

  const MAX_VALUE_BYTES = 64000;

  /* A value crossing the wire has to be plain JSON: a function or a cyclic
   * object would either throw in the channel or smuggle behaviour across it.
   * Anything that will not survive a stringify is refused, and so is anything
   * over the cap — a plugin cannot make the app fork memory by asking twice. */
  function cloneValue(value) {
    if (value === undefined) return null;
    let text;
    try {
      text = JSON.stringify(value);
    } catch (_) {
      throw new Error("Host returned a value that cannot be sent.");
    }
    if (text === undefined) throw new Error("Host returned a value that cannot be sent.");
    if (new TextEncoder().encode(text).length > MAX_VALUE_BYTES) {
      throw new Error("Host answer exceeds 64 KiB.");
    }
    return JSON.parse(text);
  }

  /* Frame side. `relay(method, args)` resolves with the app's answer (and, for
   * `subscribeLive`, with a subscription token). `send(message)` delivers to
   * the worker. Both are injected so this is testable without an iframe. */
  function createFrameBridge(options = {}) {
    const { capabilities: declared, relay, send } = options;
    if (typeof relay !== "function") throw new Error("createFrameBridge needs a relay function.");
    if (typeof send !== "function") throw new Error("createFrameBridge needs a send function.");

    /* token -> worker listener, so an app event can find the worker that asked
     * for it and a released subscription stops receiving. */
    const listeners = new Map();
    /* worker call id -> that subscription's unsubscribe, for `release`. */
    const subscriptions = new Map();

    const remoteHost = {
      readVin: () => relay("readVin", []),
      readDtc: () => relay("readDtc", []),
      /* Subscribe is deliberately synchronous at this boundary: the contract a
       * plugin sees is "call it, get back an unsubscribe". The token arrives
       * asynchronously, so the closure handles both orders — release before the
       * token lands unsubscribes as soon as it does rather than leaking. */
      subscribeLive: (listener) => {
        if (typeof listener !== "function") throw new Error("subscribeLive expects a function.");
        let token = null;
        let released = false;
        relay("subscribeLive", []).then((value) => {
          if (released) { relay("releaseSubscription", [value]); return; }
          token = value;
          listeners.set(token, listener);
        }).catch(() => { /* a refusal just means no events */ });
        return function unsubscribe() {
          if (released) return;
          released = true;
          if (token === null) return;
          listeners.delete(token);
          relay("releaseSubscription", [token]);
        };
      },
    };

    const bridge = capabilities.createBridge(Array.isArray(declared) ? declared : [], remoteHost);
    const surface = bridge.surface;

    function reply(id, message) {
      send({ t: "reply", id, ...message });
    }

    /* Handle one worker message. Anything malformed is dropped rather than
     * answered, so a bad message cannot be used as a ping. */
    function handle(message) {
      if (!message || typeof message !== "object") return;
      if (message.t === "call") {
        const id = message.id;
        const method = message.method;
        if (typeof id !== "number" || typeof method !== "string") return;
        if (method === "subscribeLive") {
          try {
            /* Reach the guarded method through the proxy: an undeclared
             * subscribeLive throws here, before any host code runs. */
            const off = surface.subscribeLive((payload) => send({ t: "event", id, payload }));
            subscriptions.set(id, off);
            reply(id, { ok: true, value: null });
          } catch (error) {
            reply(id, { ok: false, error: messageOf(error) });
          }
          return;
        }
        try {
          const value = surface[method](...(Array.isArray(message.args) ? message.args : []));
          Promise.resolve(value).then(
            (resolved) => { try { reply(id, { ok: true, value: cloneValue(resolved) }); } catch (error) { reply(id, { ok: false, error: messageOf(error) }); } },
            (error) => reply(id, { ok: false, error: messageOf(error) }),
          );
        } catch (error) {
          reply(id, { ok: false, error: messageOf(error) });
        }
        return;
      }
      if (message.t === "release") {
        const off = subscriptions.get(message.id);
        if (!off) return;
        subscriptions.delete(message.id);
        try { off(); } catch (_) { /* an unsubscribe that throws is already off */ }
      }
    }

    /* Push a host event to the worker subscribed to `token`. The payload is
     * forwarded as the app published it and never invented here. */
    function deliver(token, payload) {
      const listener = listeners.get(token);
      if (!listener) return false;
      let safe;
      try {
        safe = cloneValue(payload);
      } catch (_) {
        return false; /* a payload we cannot safely forward is dropped, not sent */
      }
      try {
        listener(safe);
        return true;
      } catch (_) {
        return false; /* a listener that throws must not stop delivery to others */
      }
    }

    return {
      handle,
      deliver,
      capabilities: bridge.capabilities,
      denials: bridge.denials,
      listenerCount: () => listeners.size,
      subscriptionCount: () => subscriptions.size,
    };
  }

  function messageOf(error) {
    return error && error.message ? String(error.message) : String(error);
  }

  /* The stubs a plugin actually calls. Generated per run, from the granted
   * capabilities only, so a plugin without `read-dtc` has no `readDtc` to call
   * — the absence is the first line of defence and the frame's proxy is the
   * second. Returns the source defining `context`.
   *
   * The plugin's body is async (the runner awaits it), so the methods return
   * promises. `subscribeLive` keeps the synchronous "returns an unsubscribe"
   * shape and routes payloads to the listener through the worker's own message
   * channel. */
  function contextSource(declared) {
    if (!Array.isArray(declared)) throw new Error("Granted capabilities must be an array.");
    const granted = capabilities.validateCapabilities(declared);
    const methods = [];
    if (granted.includes("read-vin")) methods.push('  vehicle.readVin = () => call("readVin");');
    if (granted.includes("read-dtc")) methods.push('  vehicle.readDtc = () => call("readDtc");');
    if (granted.includes("live-data")) {
      methods.push(
        '  vehicle.subscribeLive = (listener) => {',
        '    if (typeof listener !== "function") throw new TypeError("subscribeLive expects a function.");',
        '    /* One id serves both the request and its events, so the frame\'s reply',
        '     * and the snapshots that follow land on the same subscription. */',
        '    const id = ++seq;',
        '    handlers.set(id, listener);',
        '    post({ t: "call", id, method: "subscribeLive", args: [] });',
        '    return () => {',
        '      if (!handlers.delete(id)) return;',
        '      post({ t: "release", id });',
        '    };',
        '  };',
      );
    }
    return [
      'const context = (() => {',
      '  let seq = 0;',
      '  const pending = new Map();',
      '  const handlers = new Map();',
      '  const post = (message) => globalThis.postMessage(message);',
      '  const call = (method) => new Promise((resolve, reject) => {',
      '    const id = ++seq;',
      '    pending.set(id, { resolve, reject });',
      '    post({ t: "call", id, method, args: [] });',
      '  });',
      '  globalThis.addEventListener("message", (event) => {',
      '    const message = event.data;',
      '    if (!message || typeof message !== "object") return;',
      '    if (message.t === "reply") {',
      '      const entry = pending.get(message.id);',
      '      if (!entry) return;',
      '      pending.delete(message.id);',
      '      if (message.ok) entry.resolve(message.value); else entry.reject(new Error(String(message.error)));',
      '      return;',
      '    }',
      '    if (message.t === "event") {',
      '      const listener = handlers.get(message.id);',
      '      if (listener) { try { listener(message.payload); } catch (_) {} }',
      '    }',
      '  });',
      '  const vehicle = {};',
      ...methods,
      '  return Object.freeze({ vehicle: Object.freeze(vehicle) });',
      '})();',
    ].join("\n");
  }

  return {
    MAX_VALUE_BYTES,
    createFrameBridge,
    contextSource,
    cloneValue,
  };
});