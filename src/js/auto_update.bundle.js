(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // src/js/update_status.js
  var require_update_status = __commonJS({
    "src/js/update_status.js"(exports, module) {
      (function(root) {
        "use strict";
        const SEMVER_IN_TEXT = /\bv?(\d+\.\d+\.\d+)\b/;
        const SEMVER = /^\d+\.\d+\.\d+$/;
        function versionFromText(text) {
          const match = SEMVER_IN_TEXT.exec(String(text || ""));
          return match ? match[1] : null;
        }
        function releaseNotesUrl(version) {
          if (!SEMVER.test(String(version || ""))) return null;
          return `https://github.com/ohgeeceee/beemuu/releases/tag/v${version}`;
        }
        function progressFromEvent(state, event) {
          const previous = state && typeof state === "object" ? state : {};
          const next = { downloaded: previous.downloaded || 0, total: previous.total || 0 };
          if (!event || typeof event !== "object") return next;
          if (event.event === "Started") {
            next.total = Number(event.data && event.data.contentLength) || 0;
            next.downloaded = 0;
          } else if (event.event === "Progress") {
            next.downloaded += Number(event.data && event.data.chunkLength) || 0;
          } else if (event.event === "Finished") {
            next.downloaded = next.total || next.downloaded;
          }
          return next;
        }
        function percent(state) {
          if (!state || !state.total) return null;
          return Math.min(100, Math.round(state.downloaded / state.total * 100));
        }
        const api = { versionFromText, releaseNotesUrl, progressFromEvent, percent };
        if (typeof module !== "undefined" && module.exports) module.exports = api;
        if (root) root.BeemuuUpdateStatus = api;
      })(typeof window !== "undefined" ? window : null);
    }
  });

  // node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
  function __classPrivateFieldGet(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
  }
  function __classPrivateFieldSet(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
  }

  // node_modules/@tauri-apps/api/core.js
  var _Channel_instances;
  var _Channel_onmessage;
  var _Channel_nextMessageIndex;
  var _Channel_pendingMessages;
  var _Channel_messageEndIndex;
  var _Channel_deliver;
  var _Resource_rid;
  var SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
  function transformCallback(callback, once = false) {
    return window.__TAURI_INTERNALS__.transformCallback(callback, once);
  }
  var Channel = class {
    constructor(onmessage) {
      _Channel_instances.add(this);
      _Channel_onmessage.set(this, void 0);
      _Channel_nextMessageIndex.set(this, 0);
      _Channel_pendingMessages.set(this, []);
      _Channel_messageEndIndex.set(this, void 0);
      __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {
      }), "f");
      this.id = transformCallback((rawMessage) => {
        const index = rawMessage.index;
        if ("end" in rawMessage) {
          if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
            this.cleanupCallback();
          } else {
            __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
          }
          return;
        }
        const message = rawMessage.message;
        if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
          __classPrivateFieldGet(this, _Channel_instances, "m", _Channel_deliver).call(this, message);
          __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
          while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
            const message2 = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
            __classPrivateFieldGet(this, _Channel_instances, "m", _Channel_deliver).call(this, message2);
            delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
            __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
          }
          if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) {
            this.cleanupCallback();
          }
        } else {
          __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
        }
      });
    }
    cleanupCallback() {
      window.__TAURI_INTERNALS__.unregisterCallback(this.id);
    }
    /**
     * The handler called for every message sent by the Rust side of this channel.
     *
     * Assigning a new handler replaces the previous one; messages that arrived
     * before a handler was set are not replayed, so set it (or pass it to the
     * constructor) before sending the channel to the backend.
     */
    set onmessage(handler) {
      __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
    }
    get onmessage() {
      return __classPrivateFieldGet(this, _Channel_onmessage, "f");
    }
    [(_Channel_onmessage = /* @__PURE__ */ new WeakMap(), _Channel_nextMessageIndex = /* @__PURE__ */ new WeakMap(), _Channel_pendingMessages = /* @__PURE__ */ new WeakMap(), _Channel_messageEndIndex = /* @__PURE__ */ new WeakMap(), _Channel_instances = /* @__PURE__ */ new WeakSet(), _Channel_deliver = function _Channel_deliver2(message) {
      try {
        __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }, SERIALIZE_TO_IPC_FN)]() {
      return `__CHANNEL__:${this.id}`;
    }
    toJSON() {
      return this[SERIALIZE_TO_IPC_FN]();
    }
  };
  async function invoke(cmd, args = {}, options) {
    return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
  }
  var Resource = class {
    get rid() {
      return __classPrivateFieldGet(this, _Resource_rid, "f");
    }
    constructor(rid) {
      _Resource_rid.set(this, void 0);
      __classPrivateFieldSet(this, _Resource_rid, rid, "f");
    }
    /**
     * Destroys and cleans up this resource from memory.
     * **You should not call any method on this object anymore and should drop any reference to it.**
     *
     * @remarks Uses the `core:resources:allow-close` permission, which is part of
     * the `core:resources:default` permission set enabled by default.
     */
    async close() {
      return invoke("plugin:resources|close", {
        rid: this.rid
      });
    }
    async [(_Resource_rid = /* @__PURE__ */ new WeakMap(), Symbol.asyncDispose)]() {
      await this.close();
    }
  };

  // node_modules/@tauri-apps/plugin-updater/dist-js/index.js
  var Update = class extends Resource {
    /**
     * Creates an update from the metadata returned by the backend.
     * You should not need to call this yourself, use {@linkcode check} instead.
     *
     * @param metadata The update information returned by the backend, including the resource identifier of the update.
     *
     * @example
     * ```typescript
     * import { check } from '@tauri-apps/plugin-updater';
     * // the update instance is created for you by `check`
     * const update = await check();
     * ```
     */
    constructor(metadata) {
      super(metadata.rid);
      this.available = true;
      this.currentVersion = metadata.currentVersion;
      this.version = metadata.version;
      this.date = metadata.date;
      this.body = metadata.body;
      this.rawJson = metadata.rawJson;
    }
    /**
     * Downloads the updater package. Call {@linkcode install} later to install it.
     *
     * @example
     * ```typescript
     * import { check } from '@tauri-apps/plugin-updater';
     *
     * const update = await check();
     * if (update) {
     *   let downloaded = 0;
     *   await update.download((event) => {
     *     if (event.event === 'Progress') {
     *       downloaded += event.data.chunkLength;
     *       console.log(`downloaded ${downloaded} bytes`);
     *     }
     *   });
     *   await update.install();
     * }
     * ```
     *
     * @param onEvent Callback invoked with a `Started` event when the first chunk is received, a `Progress` event for every downloaded chunk and a `Finished` event when the download completes.
     * @param options The headers and the timeout to use for the download request.
     */
    async download(onEvent, options) {
      const channel = new Channel();
      if (onEvent) {
        channel.onmessage = onEvent;
      }
      const downloadedBytesRid = await invoke("plugin:updater|download", {
        onEvent: channel,
        rid: this.rid,
        ...options,
        headers: toRustHeaders(options?.headers)
      });
      await this.downloadedBytes?.close().catch(() => {
      });
      this.downloadedBytes = new Resource(downloadedBytesRid);
    }
    /**
     * Install downloaded updater package. Must be called after {@linkcode download}.
     *
     * ## Platform-specific:
     *
     * - **Windows:** This function exits the app after launching the updater installer successfully
     * - **macOS / Linux:** You need to relaunch the app to run the newly install version
     *
     * @example
     * ```typescript
     * import { check } from '@tauri-apps/plugin-updater';
     *
     * const update = await check();
     * if (update) {
     *   await update.download();
     *   await update.install();
     * }
     * ```
     *
     * @param options Options for the installation, such as whether the Windows installer should restart the app afterwards.
     */
    async install(options) {
      if (!this.downloadedBytes) {
        throw new Error("Update.install called before Update.download");
      }
      await invoke("plugin:updater|install", {
        updateRid: this.rid,
        bytesRid: this.downloadedBytes.rid,
        ...options
      });
      this.downloadedBytes = void 0;
    }
    /**
     * Downloads the updater package and installs it
     *
     * ## Platform-specific:
     *
     * - **Windows:** This function exits the app after launching the updater installer successfully
     * - **macOS / Linux:** You need to relaunch the app to run the newly install version
     *
     * @example
     * ```typescript
     * import { check } from '@tauri-apps/plugin-updater';
     *
     * const update = await check();
     * if (update) {
     *   await update.downloadAndInstall((event) => {
     *     console.log(event.event);
     *   });
     * }
     * ```
     *
     * @param onEvent Callback invoked with a `Started` event when the first chunk is received, a `Progress` event for every downloaded chunk and a `Finished` event when the download completes.
     * @param options The headers and the timeout to use for the download request, and the installation options.
     */
    async downloadAndInstall(onEvent, options) {
      const channel = new Channel();
      if (onEvent) {
        channel.onmessage = onEvent;
      }
      await invoke("plugin:updater|download_and_install", {
        onEvent: channel,
        rid: this.rid,
        ...options,
        headers: toRustHeaders(options?.headers)
      });
    }
    /**
     * Releases the update resource and the downloaded bytes held by the backend.
     *
     * @example
     * ```typescript
     * import { check } from '@tauri-apps/plugin-updater';
     *
     * const update = await check();
     * if (update) {
     *   await update.close();
     * }
     * ```
     */
    async close() {
      await this.downloadedBytes?.close();
      await super.close();
    }
  };
  async function check(options) {
    const metadata = await invoke("plugin:updater|check", {
      ...options,
      headers: toRustHeaders(options?.headers)
    });
    return metadata ? new Update(metadata) : null;
  }
  function toRustHeaders(headers) {
    return headers ? Array.from(new Headers(headers).entries()) : void 0;
  }

  // node_modules/@tauri-apps/plugin-process/dist-js/index.js
  async function relaunch() {
    await invoke("plugin:process|restart");
  }

  // src/js/auto_update.js
  var import_update_status = __toESM(require_update_status());
  (function() {
    const RETRY_MS = 30 * 60 * 1e3;
    const IDLE_POLL_MS = 10 * 1e3;
    let busy = false;
    const byId = (id) => document.getElementById(id);
    function setMessage(message) {
      const log = byId("status-log");
      if (log) log.textContent = message;
      const target = byId("app-update-status");
      if (target) target.textContent = message;
    }
    function setProgress(state) {
      const bar = byId("app-update-progress");
      if (!bar) return;
      const pct = import_update_status.default.percent(state);
      if (pct === null) {
        bar.style.display = "none";
        return;
      }
      bar.style.display = "";
      bar.value = pct;
    }
    function showNotes(version) {
      const link = byId("app-update-notes");
      const url = import_update_status.default.releaseNotesUrl(version);
      if (!link || !url) return;
      link.href = url;
      link.style.display = "";
    }
    function currentVersion() {
      for (const node of document.querySelectorAll(".brand-sub")) {
        const version = import_update_status.default.versionFromText(node.textContent);
        if (version) return version;
      }
      return null;
    }
    function setCurrentVersion() {
      const target = byId("app-update-current");
      if (!target) return;
      const version = currentVersion();
      target.textContent = version ? `Current version: v${version}` : "Current version: unknown";
    }
    function isConnected() {
      return typeof window.beeemuuIsConnected === "function" && window.beeemuuIsConnected();
    }
    async function downloadAndRelaunch(update) {
      showNotes(update.version);
      let state = { downloaded: 0, total: 0 };
      setMessage(`Downloading update ${update.version}\u2026`);
      setProgress(state);
      await update.downloadAndInstall((event) => {
        state = import_update_status.default.progressFromEvent(state, event);
        setProgress(state);
        if (event && event.event === "Finished") setMessage(`Update ${update.version} downloaded. Installing\u2026`);
      });
      const relaunchWhenIdle = () => {
        if (isConnected()) {
          window.setTimeout(relaunchWhenIdle, IDLE_POLL_MS);
          return;
        }
        setMessage("Update installed. Restarting\u2026");
        relaunch().catch((error) => {
          console.error("BeeEmUu update restart failed", error);
          setMessage("Update ready. Restart Beemuu to finish installing.");
        });
      };
      relaunchWhenIdle();
    }
    async function runCheck(manual) {
      if (!window.__TAURI__) {
        if (manual) setMessage("Update checks are available in the desktop app.");
        return;
      }
      if (busy) {
        if (manual) setMessage("An update check is already in progress.");
        return;
      }
      if (isConnected()) {
        if (manual) setMessage("Disconnect from the vehicle before checking for updates.");
        return;
      }
      busy = true;
      try {
        if (manual) setMessage("Checking for updates\u2026");
        const update = await check();
        if (!update) {
          if (manual) {
            const version = currentVersion();
            setMessage(version ? `BeeEmUu v${version} is up to date.` : "No update available.");
          }
          return;
        }
        setMessage(`Installing update ${update.version}\u2026`);
        await downloadAndRelaunch(update);
      } catch (error) {
        console.warn("BeeEmUu update check failed", error);
        setMessage(manual ? `Update check failed: ${error.message || error}. You can retry.` : "Update check unavailable");
        if (!manual) window.setTimeout(() => runCheck(false), RETRY_MS);
      } finally {
        busy = false;
      }
    }
    function autoLoop() {
      if (!window.__TAURI__) return;
      if (isConnected()) {
        window.setTimeout(autoLoop, IDLE_POLL_MS);
        return;
      }
      runCheck(false).catch(() => {
      });
    }
    const manualButton = byId("app-update-check");
    if (manualButton) {
      manualButton.addEventListener("click", () => {
        runCheck(true).catch(() => {
        });
      });
    }
    setCurrentVersion();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => window.setTimeout(autoLoop, 2500), { once: true });
    } else {
      window.setTimeout(autoLoop, 2500);
    }
  })();
})();
