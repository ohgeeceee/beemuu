"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "frontend");
const out = path.resolve(process.env.BEEMUU_PAGES_OUT || path.join(root, "_site"));

const skipNames = new Set([
  ".gitignore",
]);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skipNames.has(entry.name)) continue;
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else if (entry.isFile()) {
      if (/\.test\.(js|cjs|mjs)$/.test(entry.name)) continue;
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

fs.rmSync(out, { recursive: true, force: true });
copyDir(src, out);

fs.writeFileSync(path.join(out, "CNAME"), "beemuu.com\n");
fs.writeFileSync(path.join(out, ".nojekyll"), "");

writeJson(path.join(out, "site-config.json"), {
  apiBaseUrl: "",
  adminApiBaseUrl: "",
  repository: "ohgeeceee/beemuu",
  generatedAt: new Date().toISOString(),
  backendStatus: "pending-serverless-migration",
});

const releaseTag = process.env.GITHUB_REF_TYPE === "tag"
  ? process.env.GITHUB_REF_NAME
  : "";
if (releaseTag && /^v\d+\.\d+\.\d+/.test(releaseTag)) {
  const version = releaseTag.replace(/^v/, "");
  const releasesBase = `https://github.com/ohgeeceee/beemuu/releases/download/${releaseTag}`;
  writeJson(path.join(out, "_release_info.json"), {
    tag: releaseTag,
    version,
    released_at: new Date().toISOString(),
    downloads: {
      msi: `${releasesBase}/BeeEmUu_${version}_x64_en-US.msi`,
      nsis: `${releasesBase}/BeeEmUu_${version}_x64-setup.exe`,
    },
  });
}

console.log(`Built GitHub Pages artifact at ${path.relative(root, out)}`);
