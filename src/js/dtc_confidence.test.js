"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const conf = require("./dtc_confidence.js");

test("built-in high-confidence code returns Verified badge", () => {
  const badge = conf.badgeFor({ code: "2A82", text: "VANOS intake: control fault, camshaft stuck" });
  assert.equal(badge.level, "verified");
  assert.equal(badge.label, "Verified");
});

test("community overlay code returns Community badge", () => {
  const badge = conf.badgeFor({ code: "2A98", text: "DISA intake manifold runner fault" });
  assert.equal(badge.level, "community");
  assert.equal(badge.label, "Community");
});

test("unknown code returns Needs verification badge", () => {
  const badge = conf.badgeFor({ code: "ABCDE", text: "No description in local database — look up code in module documentation" });
  assert.equal(badge.level, "unknown");
  assert.equal(badge.label, "Needs verification");
});

test("rowHtml appends a badge after the existing description", () => {
  const html = conf.rowHtml({ code: "2A98", text: "DISA intake manifold runner fault" }, '<td class="fault-code">2A98</td>');
  assert.match(html, /<td class="fault-code">2A98<\/td>/);
  assert.match(html, /dtc-badge-community/);
});