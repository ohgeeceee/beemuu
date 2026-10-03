"use strict";

/* Detect top-level declaration collisions across the classic <script> tags in
 * index.html.
 *
 * Every classic script shares one global lexical scope, so two files declaring
 * `const api` is a SyntaxError and the *second* file never executes. It is
 * silent in `node --test` (each require() gets its own module scope) and silent
 * under jsdom (each window.eval is scoped separately) — only a real browser
 * shows it. This scans statically so it is cheap and runs anywhere.
 *
 * Usage: node scripts/check-script-collisions.cjs [--verbose]
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "src/index.html"), "utf8");
const verbose = process.argv.includes("--verbose");

const scripts = [...HTML.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m => m[1]);

/* Names declared at the top level of a classic script. Only `const`/`let`/`class`
 * create lexical bindings — `var` and `function` go on the global object and
 * legitimately redeclare, so they are excluded. */
const LEXICAL = /^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/;

/* True when a line is inside a function, block or IIFE rather than at the top
 * level. Counting braces is crude but adequate: these files are hand-written
 * with consistent indentation, and a false negative only costs a manual look. */
function topLevelNames(src) {
  const names = [];
  let depth = 0;
  for (const rawLine of src.split("\n")) {
    const line = rawLine.trim();
    if (depth === 0 && !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*")) {
      const m = LEXICAL.exec(line);
      if (m) names.push({ name: m[1], line: rawLine.trim().slice(0, 90) });
    }
    // Strip strings and comments before counting braces.
    let inStr = null;
    let inLineComment = false;
    for (let i = 0; i < rawLine.length; i++) {
      const c = rawLine[i];
      const prev = rawLine[i - 1];
      if (inLineComment) break;
      if (inStr) {
        if (c === inStr && prev !== "\\") inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
      if (c === "/" && rawLine[i + 1] === "/") { inLineComment = true; continue; }
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
  }
  return names;
}

const byName = new Map();
const missing = [];
for (const src of scripts) {
  const file = path.join(ROOT, "src", src);
  if (!fs.existsSync(file)) { missing.push(src); continue; }
  for (const { name, line } of topLevelNames(fs.readFileSync(file, "utf8"))) {
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push({ src, line });
  }
}

if (missing.length) {
  console.error("index.html loads missing files: " + missing.join(", "));
  process.exit(1);
}

const collisions = [...byName.entries()].filter(([, hits]) => hits.length > 1);

if (collisions.length) {
  console.error(`${collisions.length} top-level lexical collision(s) across ${scripts.length} scripts:`);
  console.error("Every classic <script> shares one global lexical scope, so these");
  console.error("files cannot all load: the second and later ones throw a");
  console.error("SyntaxError and never execute.\n");
  for (const [name, hits] of collisions) {
    console.error(`  '${name}' declared in:`);
    for (const h of hits) console.error(`    ${h.src}  —  ${h.line}`);
    console.error("");
  }
  console.error("Fix: wrap the file body in an IIFE, which is what cbs_predict.js,");
  console.error("plugins.js and wiring_detect.js already do.");
  process.exit(1);
}

console.log(`no top-level collisions across ${scripts.length} scripts`);
if (verbose) {
  for (const [name, hits] of [...byName.entries()].sort()) {
    console.log(`  ${name} (${hits.length}): ${hits.map(h => h.src).join(", ")}`);
  }
}