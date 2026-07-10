#!/usr/bin/env node
// Lint all .toml files in the repo: no tabs, no trailing whitespace,
// file ends with a newline. Mirrors the checks the CI workflow enforces.
// Exits 0 if every file is clean, 1 otherwise.

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'dist', 'build']);

let ok = true;
let scanned = 0;
let problems = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p);
    } else if (entry.isFile() && p.endsWith('.toml')) {
      check(p);
    }
  }
}

function check(p) {
  scanned++;
  const data = fs.readFileSync(p, 'utf8');
  const lines = data.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (line.includes('\t')) {
      console.error(`TAB in ${p}:${lineNo}`);
      problems++; ok = false;
    }
    if (/[ \t]+$/.test(line)) {
      console.error(`Trailing whitespace in ${p}:${lineNo}`);
      problems++; ok = false;
    }
  }
  if (data.length > 0 && !data.endsWith('\n')) {
    console.error(`Missing trailing newline in ${p}`);
    problems++; ok = false;
  }
}

walk(ROOT);
console.log(`\n${ok ? 'OK' : 'FAIL'} — scanned ${scanned} .toml file(s), ${problems} problem(s)`);
process.exit(ok ? 0 : 1);