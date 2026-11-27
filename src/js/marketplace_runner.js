/* Marketplace plugin runner — executes a marketplace package (plugin.json +
 * main.js, `export function activate(context)`) inside a sandboxed iframe.
 *
 * The iframe is the isolation boundary: sandbox="allow-scripts allow-downloads"
 * gives the plugin an opaque origin with its own DOM — enough for the
 * marketplace `ui` capability (panels render inside the frame) and for the
 * `filesystem` capability, which is implemented as a browser download (the
 * plugin never touches app storage or the real filesystem). The frame's CSP
 * refuses all network access, so a `network` declaration is never honoured.
 *
 * Vehicle access crosses the boundary only as postMessage calls that the
 * parent resolves against the injected host, gated by the capabilities the
 * manifest declared — the same deny-by-default rule as plugin_capabilities.js,
 * whose createBridge is reused here. Reserved write capabilities
 * (clear-dtc, coding-write, ecu-flash) are refused outright.
 *
 * Pure decision helpers are exported for tests; startPlugin is the only part
 * that touches the DOM. */
(function (root) {
  "use strict";

  const NOTIFY_MAX = 300;
  const FILENAME_MAX = 80;

  /* Vehicle read capabilities the host can serve. Everything else the
   * marketplace vocabulary knows is decided in grantsFor below. */
  const VEHICLE_READS = Object.freeze(["read-vin", "read-dtc", "live-data"]);

  const REFUSAL_REASONS = Object.freeze({
    network: "plugins have no network access in this app",
    "clear-dtc": "clearing fault memory writes to an ECU and is not grantable in this build",
    "coding-write": "coding writes to an ECU and is not grantable in this build",
    "ecu-flash": "flashing an ECU is not grantable in this build",
  });

  /* Decide what a manifest gets. Granted capabilities are what the harness
   * will build `context` from; refused ones come with a reason the install
   * consent panel can show. Unknown names are refused, never granted. */
  function grantsFor(declared) {
    const granted = [];
    const refused = [];
    for (const capability of Array.isArray(declared) ? declared : []) {
      if (VEHICLE_READS.includes(capability)) {
        granted.push(capability);
      } else if (capability === "ui") {
        granted.push(capability); // panels render inside the isolated frame
      } else if (capability === "filesystem") {
        granted.push(capability); // download-only writeFile, no disk access
      } else if (Object.prototype.hasOwnProperty.call(REFUSAL_REASONS, capability)) {
        refused.push({ capability, reason: REFUSAL_REASONS[capability] });
      } else {
        refused.push({ capability, reason: "unknown capability" });
      }
    }
    return { granted, refused };
  }

  /* The iframe document. Inline because the Tauri webview cannot fetch
   * relative assets for a srcdoc, and because a fixed harness string is
   * auditable in one place. The plugin source arrives later, by message —
   * nothing plugin-controlled is ever written into this HTML. */
  function harnessHtml() {
    return [
      "<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
      /* No network, no popups, no forms; scripts only from this document and
       * the blob: module the harness itself creates for the plugin. */
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src data:;\">",
      "<style>",
      "html,body{margin:0;padding:6px;background:transparent;color:inherit;font:14px/1.45 system-ui,sans-serif;}",
      "h2{font-size:15px;margin:10px 0 6px;}",
      "button{font:inherit;}",
      "input,select,textarea{font:inherit;max-width:100%;box-sizing:border-box;}",
      "table{font-size:13px;}",
      "</style></head><body>",
      "<script>",
      harnessScript(),
      "</" + "script></body></html>",
    ].join("\n");
  }

  /* The harness running inside the frame. Builds `context` strictly from the
   * granted capability list the parent sends — an undeclared capability means
   * the corresponding context member simply does not exist. */
  function harnessScript() {
    return String.raw`
"use strict";
(() => {
  let seq = 0;
  let plugin = null;
  let stopped = false;
  const pending = new Map();
  const liveListeners = new Map();
  const post = message => parent.postMessage(message, "*");

  function call(method) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      post({ t: "beemuu:mkt-call", id, method });
    });
  }

  function valuesFromSnapshot(payload) {
    const values = {};
    const series = payload && Array.isArray(payload.series) ? payload.series : [];
    for (const entry of series) {
      const data = Array.isArray(entry.data) ? entry.data : [];
      const last = data.length ? data[data.length - 1] : null;
      if (!last || typeof last.y !== "number") continue;
      if (entry.id != null) values[String(entry.id)] = last.y;
      if (typeof entry.label === "string" && entry.label) {
        values[entry.label.toLowerCase().replace(/[^a-z0-9]+/g, "_")] = last.y;
      }
    }
    return values;
  }

  function buildContext(granted, appVersion) {
    const context = { app: Object.freeze({ version: String(appVersion || "") }) };
    const vehicle = {};
    if (granted.includes("read-vin")) vehicle.readVin = () => call("readVin");
    if (granted.includes("read-dtc")) vehicle.readDtc = () => call("readDtc");
    if (granted.includes("live-data")) {
      /* Marketplace shape: subscribeLive(pids, cb) — pids are advisory; the
       * app publishes whatever the live session carries. Also accept the
       * single-argument subscribeLive(cb) form. */
      vehicle.subscribeLive = (pids, cb) => {
        const listener = typeof pids === "function" ? pids : cb;
        if (typeof listener !== "function") throw new TypeError("subscribeLive expects a listener function.");
        const id = ++seq;
        liveListeners.set(id, listener);
        post({ t: "beemuu:mkt-call", id, method: "subscribeLive" });
        return () => {
          if (!liveListeners.delete(id)) return;
          post({ t: "beemuu:mkt-release", id });
        };
      };
    }
    context.vehicle = Object.freeze(vehicle);

    if (granted.includes("ui")) {
      context.ui = Object.freeze({
        registerPanel({ title, render } = {}) {
          if (typeof render !== "function") throw new TypeError("registerPanel expects a render function.");
          const section = document.createElement("section");
          const heading = document.createElement("h2");
          heading.textContent = String(title || "Plugin panel");
          const body = document.createElement("div");
          section.append(heading, body);
          document.body.append(section);
          try { render(body); } catch (e) {
            post({ t: "beemuu:mkt-error", message: "Panel render failed: " + (e && e.message ? e.message : e) });
          }
          return Object.freeze({ remove() { section.remove(); } });
        },
        notify(message) {
          post({ t: "beemuu:mkt-notify", message: String(message).slice(0, ${NOTIFY_MAX}) });
        },
      });
    }

    if (granted.includes("filesystem")) {
      context.fs = Object.freeze({
        /* Download-only: the file goes to the user's download folder via the
         * browser save path. The plugin never sees a path or a disk. */
        writeFile(name, data) {
          const clean = String(name || "beemuu-export.txt")
            .replace(/[\\/:*?"<>|]/g, "_").slice(0, ${FILENAME_MAX});
          const blob = new Blob([String(data)], { type: "text/plain;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = clean;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          return Promise.resolve();
        },
      });
    }
    return context;
  }

  async function boot(message) {
    try {
      const granted = Array.isArray(message.granted) ? message.granted : [];
      const context = buildContext(granted, message.appVersion);
      const url = URL.createObjectURL(new Blob([message.source], { type: "text/javascript" }));
      try {
        plugin = await import(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      if (typeof plugin.activate === "function") await plugin.activate(context);
      post({ t: "beemuu:mkt-ready" });
    } catch (e) {
      post({ t: "beemuu:mkt-error", message: e && e.message ? e.message : String(e) });
    }
  }

  async function shutdown() {
    if (stopped) return;
    stopped = true;
    liveListeners.clear();
    pending.clear();
    try {
      if (plugin && typeof plugin.deactivate === "function") await plugin.deactivate();
    } catch (_) { /* a throwing deactivate must not block teardown */ }
    post({ t: "beemuu:mkt-stopped" });
  }

  window.addEventListener("message", event => {
    if (event.source !== parent) return;
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.t === "beemuu:mkt-reply") {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.ok) entry.resolve(message.value);
      else entry.reject(new Error(String(message.error)));
    } else if (message.t === "beemuu:mkt-event") {
      const listener = liveListeners.get(message.id);
      if (listener) {
        try { listener(valuesFromSnapshot(message.payload)); } catch (_) { /* one bad listener must not stall the frame */ }
      }
    } else if (message.t === "beemuu:mkt-init") {
      boot(message);
    } else if (message.t === "beemuu:mkt-shutdown") {
      shutdown();
    }
  });
  post({ t: "beemuu:mkt-loaded" });
})();`;
  }

  function messageOf(error) {
    return error && error.message ? String(error.message) : String(error);
  }

  /* Parent side. options:
   *   container  element the frame is appended to
   *   entry      installed store entry ({manifest, source})
   *   host       plugin_host.js createHost() instance (vehicle reads)
   *   appVersion string handed to context.app.version
   *   notify     (text) => void — plugin notifications reach the app UI
   *   onError    (text) => void — plugin failures reach the app UI
   *   onReady    () => void
   * Returns { iframe, granted, refused, stop() }.
   */
  function startPlugin(options) {
    const { container, entry, host, appVersion, notify, onError, onReady } = options;
    const capabilitiesApi = root && root.BeemuuPluginCapabilities;
    if (!capabilitiesApi) throw new Error("plugin_capabilities.js is not loaded.");
    if (!host || typeof host.subscribeLive !== "function") throw new Error("A plugin host is required.");

    const { granted, refused } = grantsFor(entry.manifest.capabilities);
    const vehicleCaps = granted.filter(c => VEHICLE_READS.includes(c));
    /* The bridge re-validates and guards every vehicle call; it throws if the
     * host cannot serve a granted read, which fails the start loudly. */
    const bridge = capabilitiesApi.createBridge(vehicleCaps, host);
    const surface = bridge.surface;

    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts allow-downloads");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.className = "plugin-marketplace-frame";
    iframe.title = `Plugin: ${entry.manifest.name}`;
    iframe.srcdoc = harnessHtml();

    const subscriptions = new Map();
    let stopped = false;

    function post(message) {
      try { iframe.contentWindow.postMessage(message, "*"); } catch (_) { /* frame already gone */ }
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      window.removeEventListener("message", receive);
      post({ t: "beemuu:mkt-shutdown" });
      for (const off of subscriptions.values()) {
        try { off(); } catch (_) { /* already off */ }
      }
      subscriptions.clear();
      setTimeout(() => iframe.remove(), 150);
    }

    function handleCall(message) {
      const { id, method } = message;
      if (method === "subscribeLive") {
        if (!vehicleCaps.includes("live-data")) return; // undeclared: no reply, no events
        const off = host.subscribeLive(payload => post({ t: "beemuu:mkt-event", id, payload }));
        subscriptions.set(id, off);
        return;
      }
      const hostMethod = method === "readVin" ? surface.readVin : method === "readDtc" ? surface.readDtc : null;
      if (!hostMethod) return; // undeclared or unknown: dropped, not answered
      Promise.resolve()
        .then(() => hostMethod())
        .then(value => post({ t: "beemuu:mkt-reply", id, ok: true, value: value === undefined ? null : value }))
        .catch(error => post({ t: "beemuu:mkt-reply", id, ok: false, error: messageOf(error) }));
    }

    function receive(event) {
      if (event.source !== iframe.contentWindow) return;
      const message = event.data;
      if (!message || typeof message !== "object") return;
      if (message.t === "beemuu:mkt-loaded") {
        post({ t: "beemuu:mkt-init", granted, source: entry.source, appVersion });
      } else if (message.t === "beemuu:mkt-call") {
        handleCall(message);
      } else if (message.t === "beemuu:mkt-release") {
        const off = subscriptions.get(message.id);
        if (off) { subscriptions.delete(message.id); try { off(); } catch (_) { /* already off */ } }
      } else if (message.t === "beemuu:mkt-notify") {
        if (typeof notify === "function") notify(String(message.message || "").slice(0, NOTIFY_MAX));
      } else if (message.t === "beemuu:mkt-ready") {
        if (typeof onReady === "function") onReady();
      } else if (message.t === "beemuu:mkt-error") {
        if (typeof onError === "function") onError(String(message.message || "Plugin failed."));
      }
    }

    window.addEventListener("message", receive);
    container.append(iframe);
    return { iframe, granted, refused, stop };
  }

  const api = { REFUSAL_REASONS, VEHICLE_READS, grantsFor, harnessHtml, harnessScript, startPlugin };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BeemuuMarketplaceRunner = api;
})(typeof window !== "undefined" ? window : null);
