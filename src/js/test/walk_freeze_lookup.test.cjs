"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { lookupFreezeFrame, fromDtcList, normalizeFrame } = require("../walk_freeze_lookup.js");

test("normalizeFrame drops empty rows", () => {
  assert.deepEqual(normalizeFrame([{ label: "RPM", value: "800" }, null, {}]), [{ label: "RPM", value: "800" }]);
});

test("fromDtcList is case-insensitive", () => {
  const dtcs = [{ code: "2a82", freeze_frame: [{ label: "RPM", value: "1200" }] }];
  assert.deepEqual(fromDtcList(dtcs, "2A82"), [{ label: "RPM", value: "1200" }]);
});

test("lookupFreezeFrame prefers live dtcs over modules", () => {
  const got = lookupFreezeFrame({
    dtcs: [{ code: "2A82", freeze_frame: [{ label: "RPM", value: "900" }] }],
    modules: [{ address: 18, dtcs: [{ code: "2A82", freeze_frame: [{ label: "RPM", value: "1" }] }] }],
    address: 18,
    code: "2A82",
  });
  assert.equal(got[0].value, "900");
});

test("lookupFreezeFrame falls back to module snapshot", () => {
  const got = lookupFreezeFrame({
    dtcs: [],
    modules: [{ address: "12", dtcs: [{ code: "30FF", freeze_frame: [{ name: "Boost", value: "12.4" }] }] }],
    address: "12",
    code: "30FF",
  });
  assert.deepEqual(got, [{ label: "Boost", value: "12.4" }]);
});

test("lookupFreezeFrame empty when missing", () => {
  assert.deepEqual(lookupFreezeFrame({}), []);
  assert.deepEqual(lookupFreezeFrame({ dtcs: [{ code: "2A82" }], code: "2A82" }), []);
});
