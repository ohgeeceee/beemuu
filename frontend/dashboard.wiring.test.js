// Wiring smoke test for /dashboard.html: load the real page + app.js in
// jsdom with a stubbed GitHub API and prove every panel actually fills.
// Guards the failure mode where the HTML ids drift from what app.js looks up.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const pageHtml = fs.readFileSync(path.join(root, "frontend", "dashboard.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function routes(url) {
  const u = String(url);
  if (u.includes("/search/issues")) {
    return json({ items: [{ number: 41, title: "Merge train: tier A slice", state: "closed", user: { login: "ohgeeceee" }, merged_at: "2026-10-13T10:00:00Z", html_url: "p41" }] });
  }
  if (u.includes("/actions/runs")) {
    return json({
      workflow_runs: [
        { name: "CI & Autonomous Merge", status: "completed", conclusion: "success", head_branch: "main", created_at: new Date(Date.now() - 3600e3).toISOString(), html_url: "r1" },
        { name: "CI & Autonomous Merge", status: "completed", conclusion: "failure", head_branch: "main", created_at: new Date(Date.now() - 7200e3).toISOString(), html_url: "r2" },
        { name: "release", status: "in_progress", head_branch: "main", created_at: new Date().toISOString(), html_url: "r3" },
      ],
    });
  }
  if (u.includes("/releases")) {
    return json([
      { tag_name: "v3.1.0", published_at: "2026-10-10T00:00:00Z", html_url: "rel1", assets: [{ name: "beemuu.msi", download_count: 120, browser_download_url: "d1" }, { name: "beemuu.deb", download_count: 31, browser_download_url: "d2" }] },
      { tag_name: "v3.0.0", published_at: "2026-09-01T00:00:00Z", html_url: "rel0", assets: [{ name: "beemuu.msi", download_count: 400, browser_download_url: "d0" }] },
    ]);
  }
  if (u.includes("/commits")) {
    return json([
      { sha: "abcdef1234567890", html_url: "c1", commit: { message: "dashboard: live project board\n\nbody", author: { name: "ohgeeceee", date: new Date(Date.now() - 1800e3).toISOString() } } },
      { sha: "1234567890abcdef", html_url: "c2", commit: { message: "ci: tier a slice", author: { name: "ohgeeceee", date: new Date(Date.now() - 90000e3).toISOString() } } },
    ]);
  }
  if (u.includes("/pulls")) {
    return json([{ number: 42, title: "Roadmap item", state: "open", user: { login: "ohgeeceee" }, html_url: "pr42", head: { ref: "feat/x" } }]);
  }
  if (u.includes("/contributors")) {
    return json([{ login: "ohgeeceee", contributions: 512, html_url: "u", avatar_url: "a" }]);
  }
  if (u.includes("/languages")) {
    return json({ Rust: 700, Python: 250, Shell: 50 });
  }
  if (u.includes("/stats/commit_activity")) {
    return json(Array.from({ length: 16 }, (_, i) => ({ week: 1700000000 + i * 604800, total: i, days: [0, 1, 2, 3, 4, 5, 6] })));
  }
  return json({ full_name: "ohgeeceee/beemuu", open_issues_count: 7, stargazers_count: 42, forks_count: 5, subscribers_count: 3, html_url: "https://github.com/ohgeeceee/beemuu" });
}

async function boot() {
  const dom = new JSDOM(pageHtml, { url: "https://beemuu.com/dashboard.html", runScripts: "outside-only" });
  const { window } = dom;
  window.fetch = async (url) => routes(url);
  window.eval(appJs);
  // loadBoard fans out over several awaits; give it a couple of macrotasks.
  await new Promise((resolve) => setTimeout(resolve, 80));
  return dom;
}

test("dashboard page + app.js fill every live panel", async (t) => {
  const dom = await boot();
  const doc = dom.window.document;
  t.after(() => dom.window.close());

  // Stat cards: 8 tiles, driven by repo meta + releases + CI runs.
  const cards = [...doc.querySelectorAll("#dash-stats .card")];
  assert.equal(cards.length, 8, "eight stat tiles");
  const statText = cards.map((c) => c.textContent);
  assert.ok(statText.some((s) => s.includes("v3.1.0")), "latest release tag shown");
  assert.ok(statText.some((s) => s.includes("551")), "downloads summed (120+31+400)");
  assert.ok(statText.some((s) => s.includes("42")), "stars shown");
  // 1 success + 1 failure finished; the in-progress run is excluded, so
  // the pass rate is 50% rather than a misleading 33%.
  assert.ok(statText.some((s) => s.includes("50%")), "CI pass rate 1/2 -> 50%");

  assert.match(doc.getElementById("dash-ci-summary").textContent, /1\/2 finished runs passed · 1 failed/);

  // The hero's hard-coded version is corrected to the newest release tag.
  assert.equal(doc.getElementById("dash-version").textContent, "v3.1.0");

  // CI runs: in-progress run still listed, labelled "running".
  const runs = [...doc.querySelectorAll("#dash-runs .dash-run")];
  assert.equal(runs.length, 3);
  assert.ok(runs.some((r) => r.textContent.includes("running")));
  assert.ok(runs.some((r) => r.querySelector(".dash-badge-failure")));

  // Releases: lead card + asset breakdown.
  assert.match(doc.getElementById("dash-releases").textContent, /v3\.1\.0/);
  assert.equal(doc.querySelectorAll("#dash-releases .dash-assets li").length, 2);

  // Commits / PRs / contributors / languages / activity.
  assert.equal(doc.querySelectorAll("#dash-commits .live-subject").length, 2);
  assert.equal(doc.querySelector("#dash-commits .live-sha").textContent, "abcdef1");
  assert.match(doc.getElementById("dash-prs").textContent, /#42/);
  assert.match(doc.getElementById("dash-prs").textContent, /Roadmap item/);
  assert.equal(doc.querySelectorAll("#dash-prs .live-pr").length, 2);
  assert.match(doc.getElementById("dash-contributors").textContent, /ohgeeceee/);
  const langs = [...doc.querySelectorAll("#dash-languages .dash-lang")];
  assert.equal(langs.length, 3);
  assert.match(langs[0].textContent, /Rust/);
  assert.match(langs[0].textContent, /70%/);
  assert.equal(doc.querySelectorAll("#dash-activity .dash-week").length, 12);

  // No notice when everything answered, and the timestamp is set.
  assert.equal(doc.getElementById("dash-notice").hidden, true);
  assert.notEqual(doc.getElementById("dash-updated").textContent.trim(), "—");
});

test("a rate-limited GitHub degrades to a notice instead of a broken board", async (t) => {
  const dom = new JSDOM(pageHtml, { url: "https://beemuu.com/dashboard.html", runScripts: "outside-only" });
  const { window } = dom;
  t.after(() => window.close());
  window.fetch = async () => json({ message: "API rate limit exceeded" }, 403);
  window.eval(appJs);
  await new Promise((resolve) => setTimeout(resolve, 80));

  const doc = window.document;
  const notice = doc.getElementById("dash-notice");
  assert.equal(notice.hidden, false, "notice is visible");
  assert.match(notice.textContent, /rate limit/i);
  // The page still has its skeleton-free, human-readable fallbacks.
  assert.ok(doc.querySelectorAll("#dash-runs .dash-run").length >= 1);
  assert.equal(doc.getElementById("dash-updated").textContent.trim() !== "", true);
});

test("a warming-up commit-activity cache is retried, then shows the blank note", async (t) => {
  // GitHub answers 202 with `{}` while it builds the stats cache. First call
  // empty, second call real data -> the chart fills. Exercised for real, so
  // this test also documents the 3s retry wait.
  const dom = new JSDOM(pageHtml, { url: "https://beemuu.com/dashboard.html", runScripts: "outside-only" });
  const { window } = dom;
  t.after(() => window.close());
  let statCalls = 0;
  window.fetch = async (url) => {
    if (String(url).includes("/stats/commit_activity")) {
      statCalls += 1;
      if (statCalls === 1) return json({});
      return routes(url);
    }
    return routes(url);
  };
  window.eval(appJs);
  await new Promise((resolve) => setTimeout(resolve, 3600));

  const doc = window.document;
  assert.equal(statCalls, 2, "retried once");
  assert.equal(doc.querySelectorAll("#dash-activity .dash-week").length, 12);
  assert.equal(doc.querySelector("#dash-activity .dash-blank"), null);
});

test("commit activity that never warms up says so instead of showing an empty chart", async (t) => {
  const dom = new JSDOM(pageHtml, { url: "https://beemuu.com/dashboard.html", runScripts: "outside-only" });
  const { window } = dom;
  t.after(() => window.close());
  window.fetch = async (url) => (String(url).includes("/stats/commit_activity") ? json({}) : routes(url));
  window.eval(appJs);
  await new Promise((resolve) => setTimeout(resolve, 3600));

  const doc = window.document;
  assert.match(doc.getElementById("dash-activity").textContent, /being computed by GitHub/);
});

test("app.js is inert on a page without the board, and vice versa", async (t) => {
  // A page with only the landing widgets must not throw on the missing
  // dashboard shell (this is the regression guard for the guarded boot).
  const bare = new JSDOM('<!doctype html><html><body><p id="status">idle</p></body></html>', { url: "https://beemuu.com/", runScripts: "outside-only" });
  t.after(() => bare.window.close());
  bare.window.fetch = async () => json({});
  assert.doesNotThrow(() => bare.window.eval(appJs));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(bare.window.document.getElementById("status").textContent, "idle");
});
