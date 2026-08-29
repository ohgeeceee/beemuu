"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const dump = require("./frm_coding_dump.js");

test("FRM address and probes stay in the existing probe_range contract", () => {
  assert.equal(dump.FRM_ADDRESS, 0x72);
  assert.equal(dump.MIRROR_FOLD_STATE, "Unknown");
  assert.equal(dump.LOCAL_PROBE.mode, "local");
  assert.equal(dump.LOCAL_PROBE.start, 0);
  assert.equal(dump.LOCAL_PROBE.end, 0xff);
  assert.equal(dump.DID_PROBE.mode, "did");
  assert.equal(dump.DID_PROBE.start, 0);
  assert.equal(dump.DID_PROBE.end, 0xff);
  const localSpan = dump.LOCAL_PROBE.end - dump.LOCAL_PROBE.start;
  const didSpan = dump.DID_PROBE.end - dump.DID_PROBE.start;
  assert.ok(localSpan <= 512, "local range must fit probe_range max");
  assert.ok(didSpan <= 512, "DID range must fit probe_range max");
});

test("findFrm matches address 0x72 only", () => {
  assert.equal(dump.findFrm(null), null);
  assert.equal(dump.findFrm([]), null);
  const frm = { address: 0x72, present: true, ident: "FRM2 9241322 hw22 sw16.10 ci07" };
  assert.equal(dump.findFrm([{ address: 0x40, present: true }, frm]), frm);
});

test("identLabel covers disconnected / unscanned / present", () => {
  assert.equal(dump.identLabel(null, { connected: false }), "Not connected");
  assert.equal(
    dump.identLabel(null, { connected: true }),
    "FRM not scanned — Export will identify 0x72"
  );
  assert.equal(
    dump.identLabel({ address: 0x72, present: true }, { connected: true }),
    "FRM present (no ident string)"
  );
  assert.equal(
    dump.identLabel(
      { address: 0x72, present: true, ident: "FRM2 9241322 hw22 sw16.10 ci07" },
      { connected: true }
    ),
    "FRM2 9241322 hw22 sw16.10 ci07"
  );
});

test("sanitizeVin and dumpFilename never emit path separators", () => {
  assert.equal(dump.sanitizeVin(null), "unknown");
  assert.equal(dump.sanitizeVin(""), "unknown");
  assert.equal(dump.sanitizeVin("  WBAVB33526NX12345  "), "WBAVB33526NX12345");
  assert.equal(dump.sanitizeVin("../etc/passwd"), "etcpasswd");
  const now = new Date("2026-08-29T02:11:00.000Z");
  assert.equal(
    dump.dumpFilename({ vin: "WBAVB33526NX12345", now }),
    "beeemuu-frm-coding-WBAVB33526NX12345-2026-08-29T02-11-00.txt"
  );
  assert.equal(
    dump.dumpFilename({ vin: null, now }),
    "beeemuu-frm-coding-unknown-2026-08-29T02-11-00.txt"
  );
});

test("buildDumpText is read-only and pins Unknown mirror-fold state", () => {
  const text = dump.buildDumpText({
    ident: "FRM2 9241322 hw22 sw16.10 ci07",
    vin: "WBAVB33526NX12345",
    exportedAt: "2026-08-29T02:11:00.000Z",
    localResults: [
      { id: 0x01, hex: "02 EE 2C 8B" },
      { id: 0x02, hex: "00 1F 42 00" },
    ],
    didResults: [],
  });
  assert.match(text, /read-only/i);
  assert.match(text, /Mirror-fold state: Unknown/);
  assert.match(text, /Does not decode Spiegel_Komfort_einklapp/);
  assert.match(text, /target: 0x72 FRM/);
  assert.match(text, /ident: FRM2 9241322 hw22 sw16.10 ci07/);
  assert.match(text, /local \(KWP 21\) — 2 answered/);
  assert.match(text, /0x01  02 EE 2C 8B/);
  assert.match(text, /did \(UDS 22\) — 0 answered/);
  assert.doesNotMatch(text, /write_did|0x3B|set_coding|Set on|Set off/i);
});

test("formatProbeSection uses 4-digit DID ids and 2-digit local ids", () => {
  assert.equal(dump.formatIdentId("local", 0x0a), "0x0A");
  assert.equal(dump.formatIdentId("did", 0x0a), "0x000A");
  const section = dump.formatProbeSection("did", [{ id: 0x10, hex: "AA BB" }]);
  assert.match(section, /0x0010  AA BB/);
});

test("helper is IIFE-wrapped so it cannot clash with can_decoders const api", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "frm_coding_dump.js"), "utf8");
  assert.match(src, /\(function \(root, factory\)/);
  assert.doesNotMatch(src, /^const api = /m);
});

test("Service Functions card is read-only in index.html", () => {
  const fs = require("fs");
  const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const start = html.indexOf('id="frm-coding-card"');
  assert.ok(start >= 0, "frm-coding-card must exist");
  const end = html.indexOf("</div>", html.indexOf('id="btn-frm-coding-export"'));
  const card = html.slice(start, end + 6);
  assert.match(card, /READ ONLY/);
  assert.match(card, /Export backup/);
  assert.match(card, /frm-coding-state/);
  assert.doesNotMatch(card, /Set on|Set off|btn-frm-coding-write/i);
});
