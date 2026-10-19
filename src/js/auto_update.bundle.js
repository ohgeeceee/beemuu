(() => {
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
  (function() {
    const RETRY_MS = 30 * 60 * 1e3;
    const IDLE_POLL_MS = 10 * 1e3;
    function setMessage(message) {
      const target = document.getElementById("status-log");
      if (target) target.textContent = message;
    }
    function isConnected() {
      return typeof window.beeemuuIsConnected === "function" && window.beeemuuIsConnected();
    }
    async function checkAndInstall() {
      if (!window.__TAURI__) return;
      if (isConnected()) {
        window.setTimeout(checkAndInstall, IDLE_POLL_MS);
        return;
      }
      try {
        const update = await check();
        if (!update) return;
        setMessage(`Installing update ${update.version}\u2026`);
        await update.downloadAndInstall();
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
      } catch (error) {
        console.warn("BeeEmUu automatic update check failed", error);
        setMessage("Update check unavailable");
        window.setTimeout(checkAndInstall, RETRY_MS);
      }
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => window.setTimeout(checkAndInstall, 2500), { once: true });
    } else {
      window.setTimeout(checkAndInstall, 2500);
    }
  })();
})();
