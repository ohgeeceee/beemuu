"use strict";

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const dtcHistory = require("../../src/js/dtc_history.js");

// Helper: a tiny in-memory mock of the three Tauri commands. Records every
// call into `calls` and lets the test seed the underlying state via
// `state.lines`.
function makeMockBackend(initialState) {
  const calls = [];
  const state = initialState || { lines: [] };
  const invoke = async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "record_dtc_read") {
      // Mirror the Rust dedup window (60 s) so tests exercise the
      // real dedup logic, not just the wrapper.
      const now = args.now_iso || new Date().toISOString().replace(/\.\d+Z$/, "Z");
      const dedupWindowMs = 60_000;
      let appended = 0, deduped = 0;
      for (const d of args.dtcs) {
        const prev = [...state.lines].reverse().find((h) =>
          h.code === d.code && h.address === args.address && h.vin === (args.vin || null)
        );
        if (prev) {
          const prevTs = Date.parse(prev.ts_iso);
          const newTs = Date.parse(now);
          if (Number.isFinite(prevTs) && Number.isFinite(newTs) && newTs - prevTs >= 0 && newTs - prevTs <= dedupWindowMs) {
            deduped += 1;
            continue;
          }
        }
        state.lines.push({
          ts_iso: now,
          vin: args.vin || null,
          address: args.address,
          code: d.code,
          status: d.status,
          status_text: d.status_text,
          text: d.text,
        });
        appended += 1;
      }
      return { appended, deduped, file_path: "/mock/beeemuu-exports/dtc-history.jsonl" };
    }
    if (cmd === "query_dtc_history") {
      let lines = state.lines.slice();
      if (args.vin) lines = lines.filter((l) => l.vin === args.vin);
      if (args.since_iso) lines = lines.filter((l) => l.ts_iso >= args.since_iso);
      const buckets = new Map();
      for (const line of lines) {
        const key = `${line.code}@${line.address}`;
        if (!buckets.has(key)) {
          buckets.set(key, {
            code: line.code,
            address: line.address,
            status_text: line.status_text,
            text: line.text,
            first_seen_iso: line.ts_iso,
            last_seen_iso: line.ts_iso,
            occurrences: 0,
          });
        }
        const e = buckets.get(key);
        e.status_text = line.status_text;
        e.text = line.text;
        if (line.ts_iso < e.first_seen_iso) e.first_seen_iso = line.ts_iso;
        if (line.ts_iso > e.last_seen_iso) e.last_seen_iso = line.ts_iso;
        e.occurrences += 1;
      }
      const entries = [...buckets.values()].sort((a, b) =>
        b.last_seen_iso.localeCompare(a.last_seen_iso)
      );
      return {
        entries,
        total_lines: state.lines.length,
        file_path: "/mock/beeemuu-exports/dtc-history.jsonl",
        skipped_lines: 0,
      };
    }
    if (cmd === "clear_dtc_history") {
      state.lines = [];
      return null;
    }
    throw new Error(`mock backend: unknown command ${cmd}`);
  };
  return { invoke, calls, state };
}

afterEach(() => {
  // Always clear the test override so a failing test doesn't leak
  // state into the next one (or into other test files via require cache).
  dtcHistory.setInvokeForTesting(null);
});

test("recordDtcRead: invokes 'record_dtc_read' with vin/address/dtcs", async () => {
  const { invoke, calls } = makeMockBackend();
  dtcHistory.setInvokeForTesting(invoke);
  const dtcs = [
    { code: "2A82", status: 0x24, status_text: "confirmed", text: "VANOS intake" },
    { code: "29E0", status: 0x24, status_text: "confirmed", text: "VANOS exhaust" },
  ];
  const result = await dtcHistory.recordDtcRead("VIN1", 0x12, dtcs);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "record_dtc_read");
  assert.equal(calls[0].args.vin, "VIN1");
  assert.equal(calls[0].args.address, 0x12);
  assert.deepEqual(calls[0].args.dtcs, dtcs);
  assert.equal(result.appended, 2);
  assert.equal(result.deduped, 0);
});

test("recordDtcRead: null vin is passed through as null (not undefined)", async () => {
  const { invoke, calls } = makeMockBackend();
  dtcHistory.setInvokeForTesting(invoke);
  await dtcHistory.recordDtcRead(null, 0x12, [{ code: "X", status: 0, status_text: "", text: "" }]);
  // The Rust side expects Option<String>; passing `undefined` would
  // deserialize to None (also fine) but null is the explicit shape we
  // commit to. Either way, the wire shape is `vin: null`.
  assert.equal(calls[0].args.vin, null);
});

test("recordDtcRead: rejects non-array dtcs with a TypeError before invoking", async () => {
  const { invoke, calls } = makeMockBackend();
  dtcHistory.setInvokeForTesting(invoke);
  await assert.rejects(
    () => dtcHistory.recordDtcRead("V", 0x12, "not an array"),
    (err) => err instanceof TypeError && /dtcs must be an array/.test(err.message)
  );
  assert.equal(calls.length, 0, "invoke should not be called when input is invalid");
});

test("recordDtcRead: returns RecordSummary {appended, deduped, file_path}", async () => {
  const { invoke } = makeMockBackend();
  dtcHistory.setInvokeForTesting(invoke);
  const result = await dtcHistory.recordDtcRead("V", 0x12, [
    { code: "A", status: 0, status_text: "", text: "" },
    { code: "A", status: 0, status_text: "", text: "" },
  ]);
  assert.equal(typeof result.appended, "number");
  assert.equal(typeof result.deduped, "number");
  assert.equal(typeof result.file_path, "string");
  assert.ok(result.file_path.includes("dtc-history.jsonl"));
});

test("recordDtcRead: 60s dedup window drops re-reads of the same (vin, address, code)", async () => {
  const { invoke } = makeMockBackend();
  dtcHistory.setInvokeForTesting(invoke);
  const dtcs = [{ code: "2A82", status: 0, status_text: "", text: "" }];
  const r1 = await dtcHistory.recordDtcRead("V", 0x12, dtcs);
  assert.equal(r1.appended, 1);
  assert.equal(r1.deduped, 0);
  // Immediate re-read of the same DTC -> deduped.
  const r2 = await dtcHistory.recordDtcRead("V", 0x12, dtcs);
  assert.equal(r2.appended, 0);
  assert.equal(r2.deduped, 1);
});

test("queryDtcHistory: invokes 'query_dtc_history' with vin and since_iso", async () => {
  const { invoke, calls } = makeMockBackend();
  dtcHistory.setInvokeForTesting(invoke);
  await dtcHistory.queryDtcHistory("VIN_A", "2026-01-01T00:00:00Z");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "query_dtc_history");
  assert.equal(calls[0].args.vin, "VIN_A");
  assert.equal(calls[0].args.since_iso, "2026-01-01T00:00:00Z");
});

test("queryDtcHistory: returns the DtcHistorySummary shape (entries + totals)", async () => {
  const { invoke, state } = makeMockBackend({
    lines: [
      { ts_iso: "2026-01-01T00:00:00Z", vin: "V", address: 0x12, code: "A", status: 0, status_text: "", text: "" },
      { ts_iso: "2026-02-01T00:00:00Z", vin: "V", address: 0x12, code: "A", status: 0, status_text: "", text: "" },
      { ts_iso: "2026-03-01T00:00:00Z", vin: "V", address: 0x18, code: "B", status: 0, status_text: "", text: "" },
    ],
  });
  dtcHistory.setInvokeForTesting(invoke);
  const summary = await dtcHistory.queryDtcHistory(null, null);
  assert.equal(summary.total_lines, 3);
  assert.equal(summary.entries.length, 2);
  // Sorted most-recent first.
  assert.equal(summary.entries[0].code, "B", "B@0x18 is more recent");
  assert.equal(summary.entries[0].last_seen_iso, "2026-03-01T00:00:00Z");
  // A@0x12 occurrences = 2.
  const a012 = summary.entries.find((e) => e.code === "A" && e.address === 0x12);
  assert.equal(a012.occurrences, 2);
  assert.equal(a012.first_seen_iso, "2026-01-01T00:00:00Z");
  assert.equal(a012.last_seen_iso, "2026-02-01T00:00:00Z");
});

test("queryDtcHistory: filters by vin", async () => {
  const { invoke, state } = makeMockBackend({
    lines: [
      { ts_iso: "2026-01-01T00:00:00Z", vin: "VIN_A", address: 0x12, code: "A", status: 0, status_text: "", text: "" },
      { ts_iso: "2026-01-01T00:00:00Z", vin: "VIN_B", address: 0x12, code: "B", status: 0, status_text: "", text: "" },
    ],
  });
  dtcHistory.setInvokeForTesting(invoke);
  const sA = await dtcHistory.queryDtcHistory("VIN_A", null);
  assert.equal(sA.entries.length, 1);
  assert.equal(sA.entries[0].code, "A");
  // No vin filter -> both.
  const sAll = await dtcHistory.queryDtcHistory(null, null);
  assert.equal(sAll.entries.length, 2);
});

test("queryDtcHistory: filters by since_iso", async () => {
  const { invoke } = makeMockBackend({
    lines: [
      { ts_iso: "2020-01-01T00:00:00Z", vin: "V", address: 0x12, code: "OLD", status: 0, status_text: "", text: "" },
      { ts_iso: "2030-01-01T00:00:00Z", vin: "V", address: 0x12, code: "NEW", status: 0, status_text: "", text: "" },
    ],
  });
  dtcHistory.setInvokeForTesting(invoke);
  const s = await dtcHistory.queryDtcHistory(null, "2025-01-01T00:00:00Z");
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].code, "NEW");
});

test("clearDtcHistory: invokes 'clear_dtc_history' and returns void", async () => {
  const { invoke, calls } = makeMockBackend();
  dtcHistory.setInvokeForTesting(invoke);
  // Seed something so we can verify it gets cleared.
  await dtcHistory.recordDtcRead("V", 0x12, [{ code: "X", status: 0, status_text: "", text: "" }]);
  const result = await dtcHistory.clearDtcHistory();
  // The Tauri IPC layer serialises Rust `()` as JSON `null`, so the
  // resolved value comes through as `null` (not `undefined`). The
  // module returns whatever the backend gave it — for the production
  // Rust command that means `null`.
  assert.equal(result, null);
  assert.equal(calls[calls.length - 1].cmd, "clear_dtc_history");
  // And the next query shows zero entries.
  const s = await dtcHistory.queryDtcHistory(null, null);
  assert.equal(s.entries.length, 0);
});

test("setInvokeForTesting(null) clears the override", async () => {
  const { invoke } = makeMockBackend();
  dtcHistory.setInvokeForTesting(invoke);
  await dtcHistory.recordDtcRead("V", 0x12, [{ code: "X", status: 0, status_text: "", text: "" }]);
  dtcHistory.setInvokeForTesting(null);
  // With no backend wired, calls should throw a backendError.
  await assert.rejects(
    () => dtcHistory.recordDtcRead("V", 0x12, [{ code: "Y", status: 0, status_text: "", text: "" }]),
    (err) => /requires a Tauri invoke\(\) backend/.test(err.message)
  );
});

test("setInvokeForTesting rejects non-function non-null values", () => {
  assert.throws(
    () => dtcHistory.setInvokeForTesting(42),
    (err) => err instanceof TypeError && /must be a function or null/.test(err.message)
  );
  assert.throws(
    () => dtcHistory.setInvokeForTesting("string"),
    (err) => err instanceof TypeError
  );
});

test("all three commands throw a clear backendError when no Tauri is wired", async () => {
  dtcHistory.setInvokeForTesting(null);
  // The real Tauri webview provides __TAURI_INTERNALS__; under node
  // `window` is undefined, so resolveInvoke returns null. Production
  // hits this path only if someone runs the module outside the webview
  // (e.g. a test that forgot to inject the backend).
  await assert.rejects(
    () => dtcHistory.recordDtcRead("V", 0x12, []),
    /recordDtcRead requires a Tauri invoke/
  );
  await assert.rejects(
    () => dtcHistory.queryDtcHistory(null, null),
    /queryDtcHistory requires a Tauri invoke/
  );
  await assert.rejects(
    () => dtcHistory.clearDtcHistory(),
    /clearDtcHistory requires a Tauri invoke/
  );
});

test("window.__TAURI_INTERNALS__.invoke is the default backend in a browser", () => {
  // Simulate the Tauri 2.x webview by stashing a fake invoke on the
  // global `window` object, then re-importing the module via the require
  // cache so resolveInvoke() picks up the new state.
  const fakeInvoke = async (cmd) => ({ from_fake_internals: true, cmd });
  global.window = { __TAURI_INTERNALS__: { invoke: fakeInvoke } };
  try {
    // Clear the require cache for the module so its top-level code re-runs.
    delete require.cache[require.resolve("../../src/js/dtc_history.js")];
    const fresh = require("../../src/js/dtc_history.js");
    // Calling should NOT throw a backendError — it should call our fake.
    return fresh.recordDtcRead("V", 0x12, []).then((result) => {
      assert.equal(result.from_fake_internals, true);
      assert.equal(result.cmd, "record_dtc_read");
    });
  } finally {
    delete global.window;
    delete require.cache[require.resolve("../../src/js/dtc_history.js")];
  }
});
