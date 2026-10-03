/* Host surface for read-only plugin capabilities.
 *
 * The counterpart to `plugin_capabilities.js`: that module decides which calls
 * a plugin may make, this one implements them. It maps app state to the three
 * granted methods, and it is pure — no DOM, no Tauri, no globals. The caller
 * injects accessors, so the whole surface is testable with fakes and the app
 * shell decides what the plugin can actually see.
 *
 * Every method returns a defensive copy. A plugin must not be able to mutate
 * app state by holding on to an array it was handed, and it must not be able to
 * make the app allocate without bound, so payloads are capped here rather than
 * trusted from the caller.
 *
 * `publish()` is deliberately part of the host object and NOT part of the
 * capability table, so the bridge never wraps it: the plugin's surface cannot
 * reach it, only the app can.
 */
(function (root) {
  "use strict";

  const MAX_DTCS = 200;
  const MAX_SERIES = 40;
  const MAX_POINTS_PER_SERIES = 600;

  function fail(message) { throw new Error(message); }

  /* A VIN is 17 characters of [A-HJ-NPR-Z0-9]. Anything else is not a VIN, and
   * returning a placeholder would let a plugin treat "unavailable" as a real
   * value. So: a string or null, never a stand-in. */
  const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

  function normalizeVin(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().toUpperCase();
    return VIN_PATTERN.test(trimmed) ? trimmed : null;
  }

  /* Copy one fault-memory row. Unknown fields are dropped rather than passed
   * through, so a future internal field cannot leak into plugin space by
   * default — it has to be added here deliberately. */
  function copyDtc(row) {
    if (!row || typeof row !== "object") return null;
    const code = typeof row.code === "string" ? row.code : null;
    if (!code) return null;
    const copy = { code };
    if (typeof row.description === "string") copy.description = row.description;
    if (typeof row.status === "string") copy.status = row.status;
    if (row.freeze_frame && typeof row.freeze_frame === "object") {
      copy.freeze_frame = JSON.parse(JSON.stringify(row.freeze_frame));
    }
    return copy;
  }

  function copySeries(entry) {
    if (!entry || typeof entry !== "object") return null;
    const id = entry.id === undefined ? null : entry.id;
    if (id === null) return null;
    const points = Array.isArray(entry.data) ? entry.data : [];
    const capped = [];
    for (const point of points) {
      if (capped.length >= MAX_POINTS_PER_SERIES) break;
      if (!point || typeof point !== "object") continue;
      if (typeof point.x !== "number" || typeof point.y !== "number") continue;
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      capped.push({ x: point.x, y: point.y });
    }
    return {
      id,
      label: typeof entry.label === "string" ? entry.label : String(id),
      unit: typeof entry.unit === "string" ? entry.unit : "",
      data: capped,
      truncated: points.length > capped.length,
    };
  }

  /* `state` is injected: each accessor is optional and a missing one degrades to
   * an empty answer rather than throwing, so a plugin declared for a capability
   * the current screen cannot serve gets nothing back instead of an error the
   * UI has to explain. */
  function createHost(state = {}) {
    if (typeof state !== "object" || state === null) fail("Host state must be an object.");
    const read = (name) => (typeof state[name] === "function" ? state[name] : () => undefined);

    const vinOf = read("vin");
    const dtcsOf = read("dtcs");
    const seriesOf = read("logSeries");

    const listeners = new Set();

    /* Read the VIN. Returns a validated VIN string or null. */
    function readVin() {
      try { return normalizeVin(vinOf()); } catch (_) { return null; }
    }

    /* Read fault memory. Returns a fresh, capped array of fresh objects. */
    function readDtc() {
      let rows;
      try { rows = dtcsOf(); } catch (_) { return []; }
      if (!Array.isArray(rows)) return [];
      const faults = [];
      for (const row of rows) {
        if (faults.length >= MAX_DTCS) break;
        const copy = copyDtc(row);
        if (copy) faults.push(copy);
      }
      return faults;
    }

    /* Deliver a bounded snapshot of live data to every listener. A listener
     * that throws must not stop the others — the same contract the v3 bridge
     * already uses in `src/js/main.js`. */
    function snapshot() {
      let raw;
      try { raw = seriesOf(); } catch (_) { return { series: [] }; }
      const series = [];
      if (raw instanceof Map) {
        for (const [id, entry] of raw) {
          if (series.length >= MAX_SERIES) break;
          const copy = copySeries({ ...entry, id });
          if (copy) series.push(copy);
        }
      } else if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (series.length >= MAX_SERIES) break;
          const copy = copySeries(entry);
          if (copy) series.push(copy);
        }
      }
      return { series };
    }

    /* Subscribe to live data. Returns an unsubscribe function that is safe to
     * call more than once. */
    function subscribeLive(listener) {
      if (typeof listener !== "function") fail("subscribeLive expects a function.");
      listeners.add(listener);
      let active = true;
      return function unsubscribe() {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    }

    /* Called by the app when new live data arrives. Not a capability, so the
     * bridge never exposes it to a plugin. */
    function publish() {
      if (!listeners.size) return 0;
      const payload = snapshot();
      let delivered = 0;
      for (const listener of [...listeners]) {
        try { listener(payload); delivered += 1; } catch (_) { /* one bad listener must not stop the rest */ }
      }
      return delivered;
    }

    return {
      readVin,
      readDtc,
      subscribeLive,
      publish,
      /* Exposed for tests and for the UI to reason about caps. */
      listenerCount: () => listeners.size,
    };
  }

  const api = { MAX_DTCS, MAX_SERIES, MAX_POINTS_PER_SERIES, createHost, normalizeVin };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BeemuuPluginHost = api;
})(typeof window !== "undefined" ? window : null);