"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FRM_ADDRESS,
  FRM_NAME,
  MIRROR_FOLD_STATE,
  LOCAL_PROBE,
  DID_PROBE,
  findFrm,
  identLabel,
  sanitizeVin,
  exportStamp,
  dumpFilename,
  formatIdentId,
  formatProbeSection,
  buildDumpText,
} = require("../frm_coding_dump.js");

test("constants are correct", () => {
  assert.equal(FRM_ADDRESS, 0x72);
  assert.equal(FRM_NAME, "FRM");
  assert.equal(MIRROR_FOLD_STATE, "Unknown");
  assert.deepEqual(LOCAL_PROBE, { mode: "local", start: 0, end: 0xff });
  assert.deepEqual(DID_PROBE, { mode: "did", start: 0, end: 0xff });
});

test("findFrm finds FRM by address", () => {
  const modules = [
    { address: 0x10, present: true, ident: "DME" },
    { address: 0x72, present: true, ident: "FRM3" },
  ];
  const frm = findFrm(modules);
  assert.ok(frm);
  assert.equal(frm.address, 0x72);
  assert.equal(frm.ident, "FRM3");
});

test("findFrm returns null when FRM missing", () => {
  const modules = [{ address: 0x10, present: true }];
  assert.equal(findFrm(modules), null);
});

test("findFrm returns null for non-array", () => {
  assert.equal(findFrm(null), null);
  assert.equal(findFrm(undefined), null);
});

test("identLabel when not connected", () => {
  assert.equal(identLabel(null, { connected: false }), "Not connected");
  assert.equal(identLabel(null), "Not connected");
});

test("identLabel when FRM present with ident", () => {
  const frm = { present: true, ident: "FRM3 hw12 sw34" };
  assert.equal(identLabel(frm, { connected: true }), "FRM3 hw12 sw34");
});

test("identLabel when FRM present without ident", () => {
  const frm = { present: true };
  assert.equal(identLabel(frm, { connected: true }), "FRM present (no ident string)");
});

test("identLabel when FRM not scanned", () => {
  assert.equal(identLabel(null, { connected: true }), "FRM not scanned — Export will identify 0x72");
});

test("sanitizeVin cleans valid VIN", () => {
  assert.equal(sanitizeVin("WBA8E9C50JA123456"), "WBA8E9C50JA123456");
});

test("sanitizeVin removes special characters", () => {
  assert.equal(sanitizeVin("WBA8E9-C50JA 123456"), "WBA8E9C50JA123456");
});

test("sanitizeVin returns unknown for empty/null", () => {
  assert.equal(sanitizeVin(null), "unknown");
  assert.equal(sanitizeVin(""), "unknown");
  assert.equal(sanitizeVin("   "), "unknown");
});

test("exportStamp produces ISO-like string", () => {
  const stamp = exportStamp(new Date("2026-09-01T12:30:45.000Z"));
  assert.ok(stamp.startsWith("2026-09-01"));
  assert.ok(!stamp.includes(":"));
});

test("dumpFilename includes VIN and stamp", () => {
  const filename = dumpFilename({
    vin: "WBA8E9C50JA123456",
    now: new Date("2026-09-01T12:30:45.000Z"),
  });
  assert.ok(filename.includes("WBA8E9C50JA123456"));
  assert.ok(filename.startsWith("beeemuu-frm-coding-"));
  assert.ok(filename.endsWith(".txt"));
});

test("dumpFilename uses unknown for missing VIN", () => {
  const filename = dumpFilename({ now: new Date("2026-09-01T12:30:45.000Z") });
  assert.ok(filename.includes("unknown"));
});

test("formatIdentId local mode", () => {
  assert.equal(formatIdentId("local", 0x00), "0x00");
  assert.equal(formatIdentId("local", 0xff), "0xFF");
  assert.equal(formatIdentId("local", 0x72), "0x72");
});

test("formatIdentId did mode", () => {
  assert.equal(formatIdentId("did", 0x0000), "0x0000");
  assert.equal(formatIdentId("did", 0x00ff), "0x00FF");
  assert.equal(formatIdentId("did", 0x1234), "0x1234");
});

test("formatProbeSection local mode", () => {
  const results = [
    { id: 0x00, hex: "01 02" },
    { id: 0x72, hex: "AA BB CC" },
  ];
  const text = formatProbeSection("local", results);
  assert.ok(text.includes("local (KWP 21)"));
  assert.ok(text.includes("2 answered"));
  assert.ok(text.includes("0x00  01 02"));
  assert.ok(text.includes("0x72  AA BB CC"));
});

test("formatProbeSection did mode", () => {
  const results = [{ id: 0x00ff, hex: "FF" }];
  const text = formatProbeSection("did", results);
  assert.ok(text.includes("did (UDS 22)"));
  assert.ok(text.includes("1 answered"));
  assert.ok(text.includes("0x00FF  FF"));
});

test("formatProbeSection empty results", () => {
  const text = formatProbeSection("local", []);
  assert.ok(text.includes("0 answered"));
});

test("buildDumpText produces complete dump", () => {
  const text = buildDumpText({
    ident: "FRM3 hw12 sw34",
    vin: "WBA8E9C50JA123456",
    localResults: [{ id: 0x00, hex: "01" }],
    didResults: [{ id: 0x00ff, hex: "FF" }],
    exportedAt: "2026-09-01T12:30:45Z",
  });
  assert.ok(text.includes("BeeEmUu FRM coding dump (read-only)"));
  assert.ok(text.includes("Mirror-fold state: Unknown"));
  assert.ok(text.includes("vin: WBA8E9C50JA123456"));
  assert.ok(text.includes("ident: FRM3 hw12 sw34"));
  assert.ok(text.includes("local (KWP 21)"));
  assert.ok(text.includes("did (UDS 22)"));
  assert.ok(text.includes("0x00  01"));
  assert.ok(text.includes("0x00FF  FF"));
});

test("buildDumpText handles missing fields", () => {
  const text = buildDumpText({});
  assert.ok(text.includes("vin: unavailable"));
  assert.ok(text.includes("ident: (none)"));
  assert.ok(text.includes("0 answered"));
});
