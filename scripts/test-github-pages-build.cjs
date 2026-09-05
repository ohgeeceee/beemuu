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

console.log("GitHub Pages build artifact looks publishable.");
