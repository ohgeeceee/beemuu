// Tests for the pure helpers behind /dashboard.html.
// No jsdom here — these are plain functions so `node --test` stays fast.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatCount,
  normalizeRelease,
  summarizeReleases,
  normalizeRun,
  summarizeRuns,
  languageShares,
  weeklyActivity,
  normalizeContributor,
  githubErrorMessage,
  conclusionLabel,
} = require("./app.js");

test("formatCount compacts thousands and millions", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1234), "1.2k");
  assert.equal(formatCount(1500), "1.5k");
  assert.equal(formatCount(1500000), "1.5M");
  assert.equal(formatCount(2.1e9), "2.1B");
});

test("formatCount returns an em dash for unusable input", () => {
  assert.equal(formatCount(undefined), "—");
  assert.equal(formatCount("nope"), "—");
  assert.equal(formatCount(NaN), "—");
  // A missing count in a GitHub payload means zero, not unknown.
  assert.equal(formatCount(null), "0");
});

test("normalizeRelease sums per-asset download counts", () => {
  const release = normalizeRelease({
    tag_name: "v3.0.0",
    name: "Beemuu 3.0",
    published_at: "2026-10-01T00:00:00Z",
    html_url: "https://example.test/r",
    assets: [
      { name: "a.msi", download_count: 30, browser_download_url: "u1" },
      { name: "b.deb", download_count: 12, browser_download_url: "u2" },
    ],
  });
  assert.equal(release.tag, "v3.0.0");
  assert.equal(release.downloads, 42);
  assert.equal(release.assets.length, 2);
  assert.equal(release.assets[1].name, "b.deb");
});

test("normalizeRelease survives a payload with no assets", () => {
  const release = normalizeRelease({ tag_name: "v0.1.0" });
  assert.equal(release.downloads, 0);
  assert.deepEqual(release.assets, []);
});

test("summarizeReleases drops drafts and prefers a non-prerelease latest", () => {
  const summary = summarizeReleases([
    { tag_name: "v3.1.0-rc1", prerelease: true, assets: [] },
    { tag_name: "v3.0.0", published_at: "2026-10-01", assets: [{ download_count: 5 }] },
    { tag_name: "v9.9.9-draft", draft: true, assets: [{ download_count: 999 }] },
  ]);
  assert.equal(summary.count, 2);
  assert.equal(summary.totalDownloads, 5);
  assert.equal(summary.latest.tag, "v3.0.0");
});

test("summarizeReleases handles an empty or missing list", () => {
  assert.deepEqual(summarizeReleases(undefined), { count: 0, totalDownloads: 0, latest: null });
  assert.equal(summarizeReleases([]).latest, null);
});

test("summarizeRuns excludes queued and in-progress runs from the pass rate", () => {
  const summary = summarizeRuns([
    { conclusion: "success", status: "completed" },
    { conclusion: "success", status: "completed" },
    { conclusion: "failure", status: "completed" },
    { conclusion: null, status: "in_progress" },
    { conclusion: null, status: "queued" },
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.success, 2);
  assert.equal(summary.failure, 1);
  assert.equal(summary.passRate, 67);
});

test("summarizeRuns reports a null pass rate when nothing has finished", () => {
  const summary = summarizeRuns([{ status: "queued" }]);
  assert.equal(summary.total, 0);
  assert.equal(summary.passRate, null);
});

test("normalizeRun maps a running workflow to the in_progress badge", () => {
  const run = normalizeRun({ name: "CI", status: "in_progress", head_branch: "main", run_number: 7 });
  assert.equal(run.conclusion, "in_progress");
  assert.equal(run.branch, "main");
  assert.equal(run.number, 7);
});

test("languageShares sorts by bytes and rounds percentages to a tenth", () => {
  const shares = languageShares({ Rust: 750, Python: 250 });
  assert.equal(shares[0].name, "Rust");
  assert.equal(shares[0].percent, 75);
  assert.equal(shares[1].percent, 25);
});

test("languageShares ignores zero-byte languages and empty payloads", () => {
  assert.deepEqual(languageShares({}), []);
  assert.deepEqual(languageShares(null), []);
  const shares = languageShares({ Rust: 100, CSS: 0 });
  assert.equal(shares.length, 1);
  assert.equal(shares[0].percent, 100);
});

test("weeklyActivity keeps the most recent weeks and coerces days to numbers", () => {
  const weeks = Array.from({ length: 20 }, (_, i) => ({ week: i, total: i, days: ["1", "2"] }));
  const out = weeklyActivity(weeks, 12);
  assert.equal(out.length, 12);
  assert.equal(out[0].week, 8);
  assert.equal(out[11].week, 19);
  assert.deepEqual(out[0].days, [1, 2]);
});

test("weeklyActivity defaults to twelve weeks and tolerates junk", () => {
  assert.deepEqual(weeklyActivity(undefined), []);
  assert.equal(weeklyActivity(Array.from({ length: 30 }, (_, i) => ({ week: i }))).length, 12);
});

test("normalizeContributor keeps login and contributions", () => {
  const person = normalizeContributor({ login: "ohgeeceee", contributions: 210, html_url: "u" });
  assert.equal(person.login, "ohgeeceee");
  assert.equal(person.contributions, 210);
  assert.equal(normalizeContributor(null).contributions, 0);
});

test("githubErrorMessage explains the rate limit and 404 cases", () => {
  assert.match(githubErrorMessage({ status: 403 }), /rate limit/i);
  assert.match(githubErrorMessage({ status: 429 }), /rate limit/i);
  assert.match(githubErrorMessage({ status: 404 }), /404/);
  assert.match(githubErrorMessage({ status: 500 }), /500/);
});

test("conclusionLabel renders human labels for every CI state", () => {
  assert.equal(conclusionLabel("success"), "pass");
  assert.equal(conclusionLabel("failure"), "fail");
  assert.equal(conclusionLabel("timed_out"), "timed out");
  assert.equal(conclusionLabel("in_progress"), "running");
  assert.equal(conclusionLabel(""), "—");
  assert.equal(conclusionLabel("weird"), "weird");
});
