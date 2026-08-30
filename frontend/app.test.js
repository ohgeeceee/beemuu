"use strict";

// Tests for the dashboard's Live activity panel — pure-function tests
// over `buildCommitsFragment`, `buildPrsFragment`, `relativeTime`,
// and `formatTimestampLabel`. The DOM-touching wiring (auto-refresh
// timer, document.hidden pause) is exercised manually on beemuu.com.
//
// CommonJS module: frontend/app.js dual-exports the helpers we test.

const { test } = require("node:test");
const assert = require("node:assert/strict");

// JSDOM is not in the test deps; we fake just enough DOM to let the
// fragment builders run. The pattern: a tiny stub `document` with
// `createElement`, `createDocumentFragment`, plus a `classList` polyfill.
function makeStubDocument() {
  class StubClassList {
    constructor() { this._set = new Set(); }
    add(...names) { for (const n of names) this._set.add(n); }
    remove(...names) { for (const n of names) this._set.delete(n); }
    toggle(name, force) {
      if (force === true || (force === undefined && !this._set.has(name))) this._set.add(name);
      else this._set.delete(name);
      return this._set.has(name);
    }
    contains(name) { return this._set.has(name); }
  }
  function makeEl(tag) {
    const node = {
      tagName: tag.toUpperCase(),
      className: "",
      textContent: "",
      children: [],
      classList: new StubClassList(),
      appendChild(child) { this.children.push(child); return child; },
      append(...nodes) { for (const n of nodes) this.appendChild(n); },
      get firstElementChild() { return this.children[0] || null; },
    };
    // Keep `className` (set by production code) and `classList` (read by
    // tests) in sync via a Proxy. When the test stub sees a className
    // assignment, it propagates the new tokens to the classList. When
    // it sees a classList.add() call, it reflects back to className.
    return new Proxy(node, {
      set(target, key, value) {
        if (key === "className" && typeof value === "string") {
          target.className = value;
          // Clear the set, then add each token.
          for (const n of [...target.classList._set]) target.classList.remove(n);
          for (const tok of value.split(/\s+/).filter(Boolean)) target.classList.add(tok);
          return true;
        }
        if (key === "classList") return true; // ignore direct reassignment
        target[key] = value;
        return true;
      },
    });
  }
  return {
    createElement: makeEl,
    createDocumentFragment() {
      const frag = makeEl("#document-fragment");
      return frag;
    },
  };
}

// Stub the global document BEFORE requiring frontend/app.js.
global.document = makeStubDocument();
const app = require("./app.js");

// ---- relativeTime ----

test("relativeTime: < 60 seconds", () => {
  const now = Date.parse("2026-07-27T12:00:30Z");
  assert.equal(app.relativeTime("2026-07-27T12:00:00Z", now), "30s ago");
});

test("relativeTime: minutes", () => {
  const now = Date.parse("2026-07-27T12:05:00Z");
  assert.equal(app.relativeTime("2026-07-27T12:00:00Z", now), "5m ago");
});

test("relativeTime: hours", () => {
  const now = Date.parse("2026-07-27T15:00:00Z");
  assert.equal(app.relativeTime("2026-07-27T12:00:00Z", now), "3h ago");
});

test("relativeTime: days", () => {
  const now = Date.parse("2026-07-30T12:00:00Z");
  assert.equal(app.relativeTime("2026-07-27T12:00:00Z", now), "3d ago");
});

test("relativeTime: empty / malformed input returns ''", () => {
  assert.equal(app.relativeTime(""), "");
  assert.equal(app.relativeTime("not-a-date"), "");
  assert.equal(app.relativeTime(null), "");
  assert.equal(app.relativeTime(undefined), "");
});

test("formatTimestampLabel: 'Updated Xs ago'", () => {
  const now = Date.parse("2026-07-27T12:00:30Z");
  const lastFetch = new Date(Date.parse("2026-07-27T12:00:00Z")).getTime();
  assert.equal(app.formatTimestampLabel(lastFetch, now), "Updated 30s ago");
});

test("formatTimestampLabel: empty when lastFetch is null", () => {
  assert.equal(app.formatTimestampLabel(null), "");
  assert.equal(app.formatTimestampLabel(undefined), "");
});

// ---- buildCommitsFragment ----

test("buildCommitsFragment: renders one <li> per commit", () => {
  const frag = app.buildCommitsFragment([
    { short: "a1b2c3d", subject: "feat: add X", author: "alice", iso: "2026-07-27T12:00:00Z" },
    { short: "b2c3d4e", subject: "fix: typo", author: "bob", iso: "2026-07-27T11:00:00Z" },
  ]);
  assert.equal(frag.children.length, 2);
  const first = frag.children[0];
  assert.equal(first.children.length, 3); // sha + subject + author
  assert.equal(first.children[0].textContent, "a1b2c3d");
  assert.equal(first.children[1].textContent, "feat: add X");
  assert.ok(first.children[2].textContent.includes("alice"));
});

test("buildCommitsFragment: empty / non-array input shows empty-state", () => {
  const frag = app.buildCommitsFragment([]);
  assert.equal(frag.children.length, 1);
  assert.ok(frag.children[0].classList.contains("live-empty"));
  assert.match(frag.children[0].textContent, /No commits/);

  const frag2 = app.buildCommitsFragment(null);
  assert.match(frag2.children[0].textContent, /No commits/);

  const frag3 = app.buildCommitsFragment("not an array");
  assert.match(frag3.children[0].textContent, /No commits/);
});

test("buildCommitsFragment: missing fields fall back to placeholders", () => {
  const frag = app.buildCommitsFragment([{ /* everything missing */ }]);
  const li = frag.children[0];
  assert.equal(li.children[0].textContent, "—"); // sha
  assert.equal(li.children[1].textContent, "(no subject)"); // subject
  assert.ok(li.children[2].textContent.includes("?")); // author
});

// ---- buildPrsFragment ----

test("buildPrsFragment: open PRs render with state badge", () => {
  const frag = app.buildPrsFragment({
    available: true,
    open_count: 2,
    open: [
      { number: 168, title: "feat: Y", author: "alice", created_at: "2026-07-26T12:00:00Z" },
      { number: 169, title: "fix: Z", author: "bob", created_at: "2026-07-26T11:00:00Z" },
    ],
    recently_merged: [],
  });
  // Two open PR rows (no merged section).
  assert.equal(frag.children.length, 2);
  const first = frag.children[0];
  assert.equal(first.children[0].textContent, "#168");
  assert.equal(first.children[1].textContent, "open");
  assert.equal(first.children[2].textContent, "feat: Y");
  // State badge class
  assert.ok(first.children[1].classList.contains("live-pr-state"));
});

test("buildPrsFragment: merged PRs render with merged badge + section sep", () => {
  const frag = app.buildPrsFragment({
    available: true,
    open_count: 0,
    open: [],
    recently_merged: [
      { number: 167, title: "feat: W", merged_at: "2026-07-27T12:00:00Z" },
    ],
  });
  // "No open PRs" line + section-sep + 1 merged row = 3 nodes
  assert.equal(frag.children.length, 3);
  assert.match(frag.children[0].textContent, /No open/);
  assert.equal(frag.children[1].textContent, "Recently merged");
  assert.equal(frag.children[2].children[1].textContent, "merged");
  assert.ok(frag.children[2].children[1].classList.contains("live-pr-merged"));
});

test("buildPrsFragment: available=false → degraded-state copy", () => {
  const frag = app.buildPrsFragment({ available: false, open_count: 0, open: [], recently_merged: [] });
  assert.equal(frag.children.length, 1);
  assert.ok(frag.children[0].classList.contains("live-empty"));
  assert.match(frag.children[0].textContent, /PR data unavailable/);
});

test("buildPrsFragment: null / undefined → degraded-state copy", () => {
  const frag1 = app.buildPrsFragment(null);
  assert.match(frag1.children[0].textContent, /unavailable/);
  const frag2 = app.buildPrsFragment(undefined);
  assert.match(frag2.children[0].textContent, /unavailable/);
});

test("buildPrsFragment: missing author / title fall back to placeholders", () => {
  const frag = app.buildPrsFragment({
    available: true,
    open_count: 1,
    open: [{ number: 200, /* no title, no author */ }],
    recently_merged: [],
  });
  const row = frag.children[0];
  assert.equal(row.children[2].textContent, "(untitled)");
  assert.ok(row.children[3].textContent.includes("?"));
});

test("buildPrsFragment: empty open + empty merged = single empty-state line", () => {
  const frag = app.buildPrsFragment({
    available: true,
    open_count: 0,
    open: [],
    recently_merged: [],
  });
  assert.equal(frag.children.length, 1);
  assert.match(frag.children[0].textContent, /No open/);
});

test("module.exports shape matches window surface (parity check)", () => {
  const expected = ["relativeTime", "formatTimestampLabel", "buildCommitsFragment", "buildPrsFragment"];
  for (const key of expected) {
    assert.equal(typeof app[key], "function", `missing or wrong-typed: ${key}`);
  }
});