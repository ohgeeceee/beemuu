"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { compareSnapshots, diffFreezeFrames, diffWalk } = require("../snapshot_compare.js");

test("compareSnapshots: normalizes empty", () => {
  const res = compareSnapshots(null, {});
  assert.equal(res.freezeFrame.length, 0);
  assert.equal(res.walk.length, 0);
});

test("diffFreezeFrames: detects same and different values", () => {
  const left = [{ label: "rpm", value: "680" }, { label: "coolant", value: "91" }];
  const right = [{ label: "rpm", value: "680" }, { label: "coolant", value: "88" }, { label: "vin", value: "WBA" }];
  const d = diffFreezeFrames(left, right);
  const rpm = d.find(r => r.label === "rpm");
  const cool = d.find(r => r.label === "coolant");
  const vin = d.find(r => r.label === "vin");
  assert.equal(rpm.same, true);
  assert.equal(cool.same, false);
  assert.equal(cool.left, "91");
  assert.equal(cool.right, "88");
  assert.ok(vin && vin.left == null && vin.right === "WBA");
});

test("diffWalk: aligns answers and flags diffs", () => {
  const d = diffWalk(["pass", "fail"], ["pass", "next"]);
  assert.equal(d.length, 2);
  assert.equal(d[0].same, true);
  assert.equal(d[1].same, false);
  assert.equal(d[1].left, "fail");
  assert.equal(d[1].right, "next");
});

test("compareSnapshots: full roundtrip diff", () => {
  const a = { freezeFrame: [{ label: "speed", value: 42 }], walkAnswers: ["pass"], meta: { vin: "ABC" } };
  const b = { freezeFrame: [{ label: "speed", value: 43 }], walkAnswers: ["fail"], meta: { vin: "ABC" } };
  const cmp = compareSnapshots(a, b);
  assert.equal(cmp.freezeFrame[0].same, false);
  assert.equal(cmp.walk[0].same, false);
  assert.equal(cmp.meta.left.vin, "ABC");
});

test("renderCompareHtml produces html with diffs", () => {
  const { renderCompareHtml } = require("../snapshot_compare.js");
  const cmp = { freezeFrame: [{label:"rpm", left:800, right:820, same:false}], walk: [{idx:1,left:"pass",right:"fail",same:false}], meta:{left:{},right:{}} };
  const html = renderCompareHtml(cmp);
  assert.ok(html.includes("Freeze-frame"));
  assert.ok(html.includes("rpm"));
});
