"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "beemuu-pages-"));

const result = spawnSync(process.execPath, [path.join(root, "scripts", "build-github-pages.cjs")], {
  cwd: root,
  env: { ...process.env, BEEMUU_PAGES_OUT: out },
  encoding: "utf8",
});

assert.equal(result.status, 0, result.stderr || result.stdout);
assert.equal(fs.readFileSync(path.join(out, "CNAME"), "utf8"), "beemuu.com\n");
assert.ok(fs.existsSync(path.join(out, ".nojekyll")));
assert.ok(fs.existsSync(path.join(out, "index.html")));
assert.ok(fs.existsSync(path.join(out, "admin", "index.html")));
assert.ok(fs.existsSync(path.join(out, "site-config.json")));
assert.ok(!fs.existsSync(path.join(out, "app.test.js")), "test files must not ship in the Pages artifact");
assert.ok(!fs.existsSync(path.join(out, ".gitignore")), "repo-only metadata must not ship in the Pages artifact");

const config = JSON.parse(fs.readFileSync(path.join(out, "site-config.json"), "utf8"));
assert.equal(config.apiBaseUrl, "");
assert.equal(config.adminApiBaseUrl, "");
assert.equal(config.repository, "ohgeeceee/beemuu");
assert.equal(config.backendStatus, "pending-serverless-migration");

// Walk every shipped page and fail on a missing asset (css/js/image/font/json/xml).
// Missing content pages are printed with counts but do not fail, because the
// site deliberately links ~28 planned per-record pages (/dtc/*, /engines/*).
const assetExt = /\.(css|js|png|svg|jpg|jpeg|gif|ico|json|xml|woff|woff2|ttf|webmanifest)$/;
const shipped = new Set();
(function collect(dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".gitignore") continue;
    const rel = prefix + entry.name;
    if (entry.isDirectory()) collect(path.join(dir, entry.name), rel + "/");
    else if (!/\.test\.(js|cjs|mjs)$/.test(entry.name)) shipped.add(rel);
  }
})(out, "");

const missingAssets = [];
const missingContent = new Set();
for (const page of [...shipped].filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(out, page), "utf8");
  for (const m of html.matchAll(/(?:href|src)="\/([^"#?]+)"/g)) {
    const ref = m[1];
    if (!assetExt.test(ref)) continue;
    if (shipped.has(ref)) continue;
    if (shipped.has(ref + "/index.html")) continue;
    missingAssets.push(`${page} -> /${ref}`);
  }
  for (const m of html.matchAll(/href="\/([^"#?]+)"/g)) {
    const ref = m[1];
    if (assetExt.test(ref)) continue;
    if (shipped.has(ref) || shipped.has(ref + ".html") || shipped.has(ref + "/index.html")) continue;
    missingContent.add(ref);
  }
}
assert.deepEqual(missingAssets, [], `missing assets:\n${missingAssets.join("\n")}`);
if (missingContent.size) {
  console.log(`note: ${missingContent.size} planned content pages are linked but not shipped (deliberate backlog):`);
  for (const p of [...missingContent].sort()) console.log(`  /${p}`);
}

console.log("GitHub Pages build artifact looks publishable.");
