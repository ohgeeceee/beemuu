"use strict";

// Public-site version-surface regression test.
//
// The beemuu.com download banner, press page, roadmap, changelog and dashboard
// all hardcode the current release version (index.html hero/CTA and banner,
// press.html highlights, roadmap.html "desktop app is at", changelog.html
// "latest release is", dashboard.html version chip). These rot silently, and
// the app itself carries the same number in package.json, tauri.conf.json,
// Cargo.toml, Cargo.lock and the README badge. This test pins every surface to
// the CURRENT_RELEASE constant so a release that forgets to bump the site, the
// generated pages, or the app manifest fails CI instead of shipping a stale
// "Download vX" link to the homepage.
//
// History: v2.0.0 stayed in the banner through the v2.1.0 patch, and v3.0.0
// stayed in every site surface across six minor releases because this file's
// own constant was never bumped.
//
// Bump CURRENT_RELEASE with each release, bump the app manifests, and re-run
// scripts/gen-content-pages.py so the generated pages pick it up.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CURRENT_RELEASE = process.env.BEEMUU_TEST_RELEASE || "v3.8.0";
const SEMVER = CURRENT_RELEASE.replace(/^v/, "");
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
  assert.ok(!/v2\.2\.0 is the latest release/i.test(html), "v2.2.0 no longer framed as the latest release");
});

test("generated pages name the current release", () => {
  const roadmap = read("frontend/roadmap.html");
  assert.ok(roadmap.includes(`desktop app is at <strong>${CURRENT_RELEASE}</strong>`), "roadmap names current release");

  const changelog = read("frontend/changelog.html");
  assert.ok(changelog.includes(`The latest release is <strong>${CURRENT_RELEASE}</strong>`), "changelog names current release");

  const dashboard = read("frontend/dashboard.html");
  assert.ok(dashboard.includes(`id="dash-version">${CURRENT_RELEASE}</span>`), "dashboard version chip = current release");
  assert.ok(dashboard.includes('id="dash-root"'), "dashboard keeps its hand-authored live board");
});

test("the generator emits the current release and leaves the dashboard alone", () => {
  const gen = read("scripts/gen-content-pages.py");
  assert.ok(!/v3\.0\.0/.test(gen), "generator no longer emits the stale v3.0.0 release");
  const n = (gen.match(new RegExp(CURRENT_RELEASE.replace(/\./g, "\\."), "g")) || []).length;
  assert.ok(n >= 3, `generator names the current release in every surface it owns (found ${n})`);
  assert.ok(!/write\(\s*"dashboard\.html"/.test(gen), "generator does not emit dashboard.html (hand-authored, PR #362)");
});

test("the app manifests, changelog and README agree with the site release", () => {
  assert.equal(JSON.parse(read("package.json")).version, SEMVER, "package.json version");
  assert.equal(JSON.parse(read("src-tauri/tauri.conf.json")).version, SEMVER, "tauri.conf.json version");
  const cargo = read("src-tauri/Cargo.toml").match(/^version = "([^"]+)"/m);
  assert.ok(cargo && cargo[1] === SEMVER, `Cargo.toml version = ${SEMVER}`);
  assert.ok(read("src-tauri/Cargo.lock").includes(`name = "beeemuu"\nversion = "${SEMVER}"`), "Cargo.lock version");
  assert.ok(read("CHANGELOG.md").includes(`## [${SEMVER}]`), `CHANGELOG has a ${SEMVER} section`);
  assert.ok(read("README.md").includes(CURRENT_RELEASE), "README badge names the release");
});
