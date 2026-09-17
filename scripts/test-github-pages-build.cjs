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

// Every local ASSET a shipped page references must exist in the artifact.
//
// This is the guard for a real defect: 16 guide pages linked `/guide.css` —
// a file that never existed in the repository — so beemuu.com served them as
// unstyled HTML and logged a 404 on every visit. Nothing failed, because
// nothing checked the references. Stylesheets, scripts and images are fatal:
// they are unambiguous, they are what makes a page render, and no page plans a
// future stylesheet.
//
// Links to content PAGES are reported but not fatal: the site links ~29
// targets (`/dtc/<code>.html`, `/engines/<engine>.html`, `/dtc/`) that are
// planned per-record pages, and inventing or retargeting those is a content
// decision, not a build error. Keep the count visible so the backlog cannot
// grow unnoticed.
const ASSET_EXTENSIONS = new Set([
  ".css", ".js", ".mjs", ".cjs", ".json", ".png", ".jpg", ".jpeg", ".webp",
  ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".xml", ".txt", ".webmanifest",
]);

function htmlFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(full, acc);
    else if (e.name.endsWith(".html")) acc.push(full);
  }
  return acc;
}

const missingAssets = [];
const missingPageLinks = new Map();
let checkedRefs = 0;
for (const file of htmlFiles(out)) {
  const html = fs.readFileSync(file, "utf8");
  const refs = [...html.matchAll(/\b(?:href|src)="(\/[^"#?]+)(?:\?[^"]*)?"/g)].map(m => m[1]);
  for (const ref of refs) {
    checkedRefs++;
    const target = path.join(out, decodeURIComponent(ref));
    if (fs.existsSync(target) && fs.statSync(target).isFile()) continue;
    const entry = `${path.relative(out, file)} -> ${ref}`;
    if (ASSET_EXTENSIONS.has(path.extname(ref).toLowerCase())) missingAssets.push(entry);
    else missingPageLinks.set(ref, (missingPageLinks.get(ref) || 0) + 1);
  }
}
assert.ok(checkedRefs > 50, `expected to check many local references, checked ${checkedRefs}`);
assert.deepEqual(missingAssets, [], "shipped pages reference assets that do not exist in the artifact");

if (missingPageLinks.size) {
  const backlog = [...missingPageLinks.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`note: ${missingPageLinks.size} content pages are linked but not written ` +
    `(site content backlog, not a build error):`);
  for (const [ref, n] of backlog.slice(0, 8)) console.log(`  ${String(n).padStart(3)}x  ${ref}`);
  if (backlog.length > 8) console.log(`  ... and ${backlog.length - 8} more`);
}

console.log(`GitHub Pages build artifact looks publishable ` +
  `(${checkedRefs} local references checked, all assets resolve).`);
