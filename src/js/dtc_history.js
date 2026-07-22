"use strict";

// DTC History (v0.12.0 "Fault Memory") — frontend wrapper around the
// three Tauri commands added in PR #144:
//
//   record_dtc_read(vin, address, dtcs)  -> RecordSummary
//   query_dtc_history(vin, since_iso)    -> DtcHistorySummary
//   clear_dtc_history()                  -> ()
//
// Why a separate module: the IPC surface is small but distinct (three
// commands, a serializable schema, a small grouping/transformation), and
// lifting it out of `main.js` makes it testable under `node --test`
// without a browser or Tauri runtime. `main.js` becomes a thin caller.
//
// The module accepts an injected backend (`invoke`) so tests can mock the
// Tauri IPC layer in-memory. Production usage (`window.__TAURI__?.invoke`
// or `window.__TAURI_INTERNALS__?.invoke`) is set up by the caller — the
// default reads from `window.__TAURI_INTERNALS__.invoke` (Tauri 2.x) and
// falls back to the older `window.__TAURI__.invoke` (Tauri 1.x). If no
// backend is available, the functions return a clear "no backend" error
// instead of crashing.
//
// Dual export — CommonJS for `node --test`, browser via
// `window.beeemuuDtcHistory` for `main.js`.

/**
 * @typedef {Object} DtcRecord
 * @property {string} code
 * @property {number} status
 * @property {string} status_text
 * @property {string} text
 */

/**
 * @typedef {Object} RecordSummary
 * @property {number} appended
 * @property {number} deduped
 * @property {string} file_path
 */

/**
 * @typedef {Object} DtcHistoryEntry
 * @property {string} code
 * @property {number} address
 * @property {string} status_text
 * @property {string} text
 * @property {string} first_seen_iso
 * @property {string} last_seen_iso
 * @property {number} occurrences
 */

/**
 * @typedef {Object} DtcHistorySummary
 * @property {DtcHistoryEntry[]} entries
 * @property {number} total_lines
 * @property {string} file_path
 * @property {number} skipped_lines
 */

/**
 * Resolve the Tauri IPC `invoke` function. Production: Tauri 2.x's
 * `window.__TAURI_INTERNALS__.invoke`, falling back to Tauri 1.x's
 * `window.__TAURI__.invoke`. Tests: pass `invoke` explicitly via the
 * second argument to the module's exported functions, or set
 * `__invokeOverride` on the module for a session-wide mock.
 *
 * @returns {Function|null} The `invoke` function, or null if none is wired.
 */
function resolveInvoke() {
  if (typeof globalThis !== "undefined") {
    // Explicit override — used by the test suite to inject an in-memory
    // mock without touching the window globals.
    if (typeof globalThis.__beeemuuDtcHistoryInvokeOverride === "function") {
      return globalThis.__beeemuuDtcHistoryInvokeOverride;
    }
  }
  if (typeof window === "undefined") return null;
  // Tauri 2.x internal IPC surface.
  const internals = window.__TAURI_INTERNALS__;
  if (internals && typeof internals.invoke === "function") return internals.invoke.bind(internals);
  // Tauri 1.x public API.
  const tauri = window.__TAURI__;
  if (tauri && typeof tauri.invoke === "function") return tauri.invoke.bind(tauri);
  return null;
}

function backendError(label) {
  return new Error(
    `dtc_history: ${label} requires a Tauri invoke() backend; ` +
      `inject one via setInvokeForTesting(fn) or run inside the Tauri webview.`
  );
}

/**
 * Append a batch of DTC reads to the local history. Called by `main.js`
 * after a successful `read_faults` IPC. Returns the append/dedup counts
 * so the UI can surface a "recorded N DTCs to ~/..." confirmation.
 *
 * @param {string|null|undefined} vin - VIN of the car (or null if unknown).
 * @param {number} address - UDS target id of the module just read.
 * @param {DtcRecord[]} dtcs - DTC records from `read_faults`.
 * @returns {Promise<RecordSummary>}
 */
async function recordDtcRead(vin, address, dtcs) {
  const invoke = resolveInvoke();
  if (!invoke) throw backendError("recordDtcRead");
  if (!Array.isArray(dtcs)) throw new TypeError("dtc_history.recordDtcRead: dtcs must be an array");
  return await invoke("record_dtc_read", { vin: vin || null, address, dtcs });
}

/**
 * Read the local DTC history. Returns a grouped summary sorted by
 * `last_seen_iso` descending (most recent first). Optional `vin` filter
 * scopes the result to one car; optional `sinceIso` filter limits to
 * entries whose timestamp is >= `sinceIso` (string comparison works
 * because the Rust side emits zero-padded ISO-8601).
 *
 * @param {string|null|undefined} [vin]
 * @param {string|null|undefined} [sinceIso]
 * @returns {Promise<DtcHistorySummary>}
 */
async function queryDtcHistory(vin, sinceIso) {
  const invoke = resolveInvoke();
  if (!invoke) throw backendError("queryDtcHistory");
  return await invoke("query_dtc_history", { vin: vin || null, since_iso: sinceIso || null });
}

/**
 * Delete the local DTC history file. Idempotent at the Rust layer
 * (clearing when no file exists is a no-op, not an error). The UI gates
 * this behind a confirm dialog.
 *
 * @returns {Promise<void>}
 */
async function clearDtcHistory() {
  const invoke = resolveInvoke();
  if (!invoke) throw backendError("clearDtcHistory");
  return await invoke("clear_dtc_history");
}

/**
 * Inject an `invoke`-shaped function for the duration of the test
 * session. Useful when a test file wants a mock that survives across
 * multiple calls. Production code should never touch this; it mutates
 * a process-wide global.
 *
 * @param {Function|null} fn - The mock to use, or null to clear.
 */
function setInvokeForTesting(fn) {
  if (typeof globalThis === "undefined") return;
  if (fn === null) {
    delete globalThis.__beeemuuDtcHistoryInvokeOverride;
  } else {
    if (typeof fn !== "function") throw new TypeError("setInvokeForTesting: fn must be a function or null");
    globalThis.__beeemuuDtcHistoryInvokeOverride = fn;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    recordDtcRead,
    queryDtcHistory,
    clearDtcHistory,
    setInvokeForTesting,
  };
}
if (typeof window !== "undefined") {
  window.beeemuuDtcHistory = {
    recordDtcRead,
    queryDtcHistory,
    clearDtcHistory,
    setInvokeForTesting,
  };
}
