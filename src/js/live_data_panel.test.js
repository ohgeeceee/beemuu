"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  POLL_RATE_MS_OPTIONS,
  DEFAULT_POLL_RATE_MS,
  resolvePollRateMs,
  applyValuesToPeaks,
  formatPeakForLabel,
  buildSnapshotCsv,
  snapshotCsvFilename,
  parseNrcError,
  isUnsupportedNrc,
  UNSUPPORTED_NRCS,
} = require("./live_data_panel.js");

// ---------------------------------------------------------------------------
// Polling rate
// ---------------------------------------------------------------------------

test("resolvePollRateMs: accepts the four configured delays", () => {
  for (const ms of POLL_RATE_MS_OPTIONS) {
    assert.equal(resolvePollRateMs(ms), ms);
    assert.equal(resolvePollRateMs(String(ms)), ms);
  }
});

test("resolvePollRateMs: falls back to the default for unknown / out-of-range / non-numeric input", () => {
  assert.equal(resolvePollRateMs(0), DEFAULT_POLL_RATE_MS);
  assert.equal(resolvePollRateMs(999), DEFAULT_POLL_RATE_MS);
  assert.equal(resolvePollRateMs("fast"), DEFAULT_POLL_RATE_MS);
  assert.equal(resolvePollRateMs(null), DEFAULT_POLL_RATE_MS);
  assert.equal(resolvePollRateMs(undefined), DEFAULT_POLL_RATE_MS);
  assert.equal(resolvePollRateMs(Number.NaN), DEFAULT_POLL_RATE_MS);
});

// ---------------------------------------------------------------------------
// Peak tracking
// ---------------------------------------------------------------------------

test("applyValuesToPeaks: tracks the highest numeric value per id since reset", () => {
  let state = {};
  state = applyValuesToPeaks(state, [{ id: "rpm", value: 1500 }]);
  state = applyValuesToPeaks(state, [{ id: "rpm", value: 3000 }]);
  state = applyValuesToPeaks(state, [{ id: "rpm", value: 2500 }]);
  assert.equal(state.rpm, 3000);
});

test("applyValuesToPeaks: tracks each id independently", () => {
  let state = {};
  state = applyValuesToPeaks(state, [
    { id: "rpm", value: 4000 },
    { id: "coolant", value: 88 },
    { id: "volt", value: 14.2 },
  ]);
  assert.equal(state.rpm, 4000);
  assert.equal(state.coolant, 88);
  assert.equal(state.volt, 14.2);
  // A higher sweep on one channel does not bump the others.
  state = applyValuesToPeaks(state, [{ id: "rpm", value: 5000 }]);
  assert.equal(state.rpm, 5000);
  assert.equal(state.coolant, 88);
  assert.equal(state.volt, 14.2);
});

test("applyValuesToPeaks: skips text/enum points and non-finite values", () => {
  let state = {};
  state = applyValuesToPeaks(state, [
    { id: "gear", value: 0, text: "3rd" }, // enum — skipped
    { id: "rpm", value: Number.NaN }, // non-finite — skipped
    { id: "coolant", value: 91 },
  ]);
  assert.equal(state.gear, undefined);
  assert.equal(state.rpm, undefined);
  assert.equal(state.coolant, 91);
});

test("applyValuesToPeaks: returns the existing state when values is not an array", () => {
  // null/undefined input: pass the existing state through unchanged.
  const seed = { rpm: 1500 };
  assert.equal(applyValuesToPeaks(seed, null), seed);
  assert.equal(applyValuesToPeaks(seed, undefined), seed);
  // Other non-array input (string, number, object): still pass the
  // existing state through — the caller decides when to reset. We
  // never mutate the input state, which is what the no-mutation
  // test below pins.
  assert.equal(applyValuesToPeaks(seed, "not an array"), seed);
  assert.equal(applyValuesToPeaks(seed, 42), seed);
});

test("applyValuesToPeaks: returns a fresh object — no mutation of the input state", () => {
  const state = { rpm: 1000 };
  const next = applyValuesToPeaks(state, [{ id: "rpm", value: 2000 }]);
  assert.equal(state.rpm, 1000, "input state must not be mutated");
  assert.equal(next.rpm, 2000);
  assert.notEqual(next, state);
});

test("formatPeakForLabel: integer units get no decimals; other units get one decimal", () => {
  assert.equal(formatPeakForLabel(1500.7, "rpm"), "1501");
  assert.equal(formatPeakForLabel(120.3, "km/h"), "120");
  assert.equal(formatPeakForLabel(82.4, "%"), "82");
  assert.equal(formatPeakForLabel(91.23, "°C"), "91.2");
  assert.equal(formatPeakForLabel(14.27, "V"), "14.3");
  assert.equal(formatPeakForLabel(Number.NaN, "rpm"), "—");
  assert.equal(formatPeakForLabel(undefined, "rpm"), "—");
});

// ---------------------------------------------------------------------------
// Snapshot CSV
// ---------------------------------------------------------------------------

test("buildSnapshotCsv: includes a metadata header, a unit/column header row, and one data row per value", () => {
  const csv = buildSnapshotCsv(
    [
      { id: "rpm", label: "Engine speed", unit: "rpm", value: 1500, text: null },
      { id: "coolant", label: "Coolant temp", unit: "°C", value: 91.2, text: null },
      { id: "gear", label: "Gear", unit: "", value: 0, text: "3rd" },
    ],
    "n62"
  );
  const lines = csv.split("\n");
  // metadata header
  assert.match(lines[0], /^# beemuu live snapshot v1 profile=/);
  assert.match(lines[0], /profile="n62"/);
  // column header
  assert.equal(lines[1], "id,label,unit,value,text");
  // data rows — numeric values are emitted raw (no quotes) per CSV
  // convention; string fields are JSON-quoted so commas in labels
  // round-trip safely. A trailing comma on a numeric row is the
  // empty `text` field — JS Array.join() drops the last empty
  // string but keeps the preceding comma (the field count is
  // unchanged: 5 columns either way).
  assert.equal(lines[2], '"rpm","Engine speed","rpm",1500.00,');
  assert.equal(lines[3], '"coolant","Coolant temp","°C",91.20,');
  // enum text is JSON-quoted so commas survive the round-trip
  assert.equal(lines[4], '"gear","Gear","",0.00,"3rd"');
  // trailing newline
  assert.equal(csv.endsWith("\n"), true);
});

test("buildSnapshotCsv: handles an empty / non-array values arg without crashing", () => {
  const csv = buildSnapshotCsv([], "n62");
  const lines = csv.split("\n");
  assert.equal(lines.length, 3); // meta + header + trailing empty
  assert.equal(lines[0].startsWith("# beemuu live snapshot"), true);
  assert.equal(lines[1], "id,label,unit,value,text");
});

test("snapshotCsvFilename: matches the project's beeemuu-<kind>-<stamp>.csv pattern", () => {
  const name = snapshotCsvFilename(new Date("2026-07-28T12:34:56.789Z"));
  assert.match(name, /^beeemuu-live-snapshot-2026-07-28T12-34-56-789Z\.csv$/);
});

// ---------------------------------------------------------------------------
// NRC error parsing
// ---------------------------------------------------------------------------

test("parseNrcError: extracts the (sid, nrc) pair from the protocol::service error format", () => {
  const parsed = parseNrcError("ECU rejected service 22: conditionsNotCorrect (NRC 22)");
  assert.equal(parsed.sid, 0x22);
  assert.equal(parsed.nrc, 0x22);
  assert.equal(parsed.raw, "ECU rejected service 22: conditionsNotCorrect (NRC 22)");
});

test("parseNrcError: parses uppercase hex correctly", () => {
  const parsed = parseNrcError("ECU rejected service 22: requestOutOfRange (NRC 31)");
  assert.equal(parsed.sid, 0x22);
  assert.equal(parsed.nrc, 0x31);
});

test("parseNrcError: returns null for non-NRC error strings", () => {
  assert.equal(parseNrcError(""), null);
  assert.equal(parseNrcError("timed out"), null);
  assert.equal(parseNrcError("Unknown profile"), null);
  assert.equal(parseNrcError(null), null);
  assert.equal(parseNrcError(undefined), null);
  // Missing hex digits — not a real NRC.
  assert.equal(parseNrcError("something (NRC ZZ)"), null);
});

test("isUnsupportedNrc: flags the four canonical 'unsupported' NRCs only", () => {
  // 0x11 serviceNotSupported
  assert.equal(isUnsupportedNrc({ sid: 0x22, nrc: 0x11 }), true);
  // 0x12 subFunctionNotSupported
  assert.equal(isUnsupportedNrc({ sid: 0x22, nrc: 0x12 }), true);
  // 0x31 requestOutOfRange — DID not present on this ECU
  assert.equal(isUnsupportedNrc({ sid: 0x22, nrc: 0x31 }), true);
  // 0x14 responseTooLong
  assert.equal(isUnsupportedNrc({ sid: 0x22, nrc: 0x14 }), true);
  // Transient / condition NRCs — NOT flagged
  assert.equal(isUnsupportedNrc({ sid: 0x22, nrc: 0x22 }), false); // conditionsNotCorrect
  assert.equal(isUnsupportedNrc({ sid: 0x22, nrc: 0x33 }), false); // securityAccessRequired
  assert.equal(isUnsupportedNrc({ sid: 0x22, nrc: 0x78 }), false); // responsePending
  // The set itself is what we ship — pinned so a future edit doesn't silently change it.
  assert.equal(UNSUPPORTED_NRCS.size, 4);
  assert.equal(UNSUPPORTED_NRCS.has(0x31), true);
});
