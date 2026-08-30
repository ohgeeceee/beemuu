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

test("sourceLinkHtml escapes unsafe URLs and renders http(s) links", () => {
  assert.equal(conf.sourceLinkHtml(""), "");
  assert.equal(conf.sourceLinkHtml(null), "");
  assert.equal(conf.sourceLinkHtml("javascript:alert(1)"), "");
  assert.match(conf.sourceLinkHtml("https://bimmerfest.com/x"), /href="https:\/\/bimmerfest\.com\/x"/);
  assert.match(conf.sourceLinkHtml("http://example.com"), /target="_blank"/);
  assert.match(conf.sourceLinkHtml("https://example.com"), /rel="noopener noreferrer"/);
});

test("rowHtmlWithSource appends a Source link when the lookup resolves", async () => {
  const html = await conf.rowHtmlWithSource(
    { code: "2A98", text: "DISA intake manifold runner fault" },
    '<td class="fault-code">2A98</td>',
    async () => "https://bimmerfest.com/threads/error-code-2a82-and-2a99.604589/"
  );
  assert.match(html, /dtc-badge-community/);
  assert.match(html, /dtc-source/);
  assert.match(html, /href="https:\/\/bimmerfest\.com/);
});

test("rowHtmlWithSource degrades gracefully when the lookup throws", async () => {
  const html = await conf.rowHtmlWithSource(
    { code: "2A98", text: "DISA intake manifold runner fault" },
    '<td class="fault-code">2A98</td>',
    async () => { throw new Error("offline"); }
  );
  assert.match(html, /dtc-badge-community/);
  assert.doesNotMatch(html, /dtc-source/);
});

test("rowHtmlWithSource works without a lookup function", async () => {
  const html = await conf.rowHtmlWithSource(
    { code: "2A98", text: "DISA intake manifold runner fault" },
    '<td class="fault-code">2A98</td>',
    null
  );
  assert.match(html, /dtc-badge-community/);
  assert.doesNotMatch(html, /dtc-source/);
});