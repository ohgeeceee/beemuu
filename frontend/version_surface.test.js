"use strict";

// Public-site version-surface regression test.
//
// The beemuu.com download banner and press page hardcode the current
// release version + tag URL (index.html hero/CTA, press.html highlights).
// These rot silently — v2.0.0 stayed in the banner through the v2.1.0
// patch. This test pins them to the CURRENT_RELEASE constant so a release
// that forgets to bump the site fails CI instead of shipping a stale
// "Download vX" link to the homepage.
//
// Bump CURRENT_RELEASE when you cut a new release AND update the banner.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CURRENT_RELEASE = process.env.BEEMUU_TEST_RELEASE || "v2.2.0";
const TAG = `releases/tag/${CURRENT_RELEASE}`;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("index.html hero banner points at the current release", () => {
  const html = read("frontend/index.html");
  assert.ok(html.includes(`BeeEmUu ${CURRENT_RELEASE} is here`), "hero names current release");
  assert.ok(html.includes(`class="banner-tag">${CURRENT_RELEASE}</span>`), "banner tag = current release");
  assert.ok(html.includes(TAG), `download CTA links to the ${CURRENT_RELEASE} tag`);
  assert.ok(html.includes(`Download ${CURRENT_RELEASE}`), "CTA label = current release");
});

test("press.html frames the current release and links to its tag", () => {
  const html = read("frontend/press.html");
  assert.ok(html.includes(`BeeEmUu ${CURRENT_RELEASE} &mdash; what's new`), "press header names current release");
  assert.ok(html.includes(TAG), "press download link points at current release tag");
  // The v2.0.0 mention may remain, but only as a historical "milestone" —
  // it must not still be the framed/downloadable release.
  assert.ok(!/v2\.0\.0 is the project/i.test(html), "v2.0.0 no longer framed as the latest release");
});