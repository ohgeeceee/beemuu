"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { formatBytes, formatReleaseDate, groupAssets, platformForAsset } = require("./downloads.js");

test("classifies only known desktop installer formats", () => {
  assert.equal(platformForAsset("BeeEmUu_5.0.0_x64-setup.exe"), "Windows");
  assert.equal(platformForAsset("BeeEmUu_5.0.0_x64_en-US.msi"), "Windows");
  assert.equal(platformForAsset("BeeEmUu_5.0.0_amd64.AppImage"), "Linux");
  assert.equal(platformForAsset("BeeEmUu_5.0.0_amd64.deb"), "Linux");
  assert.equal(platformForAsset("BeeEmUu_5.0.0_universal.dmg"), "macOS");
  assert.equal(platformForAsset("Source code (zip)"), null);
});

test("groups published assets by platform and skips missing download URLs", () => {
  const groups = groupAssets([
    { name: "app.deb", browser_download_url: "https://example.test/app.deb", size: 1024 },
    { name: "setup.exe", browser_download_url: "https://example.test/setup.exe" },
    { name: "source.zip", browser_download_url: "https://example.test/source.zip" },
    { name: "other.msi" },
  ]);
  assert.deepEqual(groups.map(({ platform }) => platform), ["Windows", "Linux"]);
  assert.equal(groups[0].assets[0].name, "setup.exe");
  assert.equal(groups[1].assets[0].size, 1024);
});

test("formats sizes and valid dates without failing on missing metadata", () => {
  assert.equal(formatBytes(0), "Size unavailable");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(1572864), "1.5 MB");
  assert.equal(formatReleaseDate("not-a-date"), "");
  assert.equal(formatReleaseDate("2026-01-02T00:00:00Z"), "January 2, 2026");
});
