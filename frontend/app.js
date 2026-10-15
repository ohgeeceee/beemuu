"use strict";

// v0.14.0 — dashboard activity feed + auto-refresh.
//
// Pure-function helpers (relativeTime, formatTimestampLabel,
// buildCommitsFragment, buildPrsFragment) are defined first so they
// can be unit-tested under Node without jsdom. The DOM-touching
// wiring (loadDashboard, loadLive, loadReleaseInfo, the auto-refresh
// timer) runs only when `document` exists. Tests stub a minimal
// `document` so the pure functions can be exercised directly.

// ---- pure helpers (testable) ----

const DEFAULT_SITE_CONFIG = {
  apiBaseUrl: "",
  repository: "ohgeeceee/beemuu",
};

function getSiteConfig() {
  if (typeof window !== "undefined" && window.BEEMUU_CONFIG) {
    return { ...DEFAULT_SITE_CONFIG, ...window.BEEMUU_CONFIG };
  }
  return DEFAULT_SITE_CONFIG;
}

function joinUrl(base, path) {
  if (!base) return path;
  return `${String(base).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}

function relativeTime(iso, nowMs) {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatTimestampLabel(lastFetch, nowMs) {
  if (!lastFetch) return "";
  return `Updated ${relativeTime(new Date(lastFetch).toISOString(), nowMs)}`;
}

function buildCommitsFragment(commits) {
  const frag = document.createDocumentFragment();
  if (!Array.isArray(commits) || commits.length === 0) {
    const li = document.createElement("li");
    li.className = "live-empty";
    li.textContent = "No commits available.";
    frag.appendChild(li);
    return frag;
  }
  for (const commit of commits) {
    const li = document.createElement("li");
    const sha = document.createElement("span");
    sha.className = "live-sha";
    sha.textContent = commit.short || "—";
    const subject = document.createElement("span");
    subject.className = "live-subject";
    subject.textContent = commit.subject || "(no subject)";
    const author = document.createElement("span");
    author.className = "live-author";
    author.textContent = `${commit.author || "?"} · ${relativeTime(commit.iso)}`;
    li.append(sha, subject, author);
    frag.appendChild(li);
  }
  return frag;
}

function buildPrsFragment(prBlock) {
  const frag = document.createDocumentFragment();
  if (!prBlock || prBlock.available === false) {
    const p = document.createElement("div");
    p.className = "live-empty";
    p.textContent = "PR data unavailable — `gh` CLI may not be installed or rate-limited on the VPS.";
    frag.appendChild(p);
    return frag;
  }
  const opens = prBlock.open || [];
  if (opens.length === 0) {
    const p = document.createElement("div");
    p.className = "live-empty";
    p.textContent = "No open pull requests.";
    frag.appendChild(p);
  } else {
    for (const pr of opens) {
      const row = document.createElement("div");
      row.className = "live-pr";
      const num = document.createElement("span");
      num.className = "live-pr-num";
      num.textContent = `#${pr.number}`;
      const state = document.createElement("span");
      state.className = "live-pr-state";
      state.textContent = "open";
      const title = document.createElement("span");
      title.className = "live-pr-title";
      title.textContent = pr.title || "(untitled)";
      const meta = document.createElement("div");
      meta.className = "live-pr-meta";
      meta.textContent = `${pr.author || "?"} · opened ${relativeTime(pr.created_at)}`;
      row.append(num, state, title, meta);
      frag.appendChild(row);
    }
  }
  const merged = prBlock.recently_merged || [];
  if (merged.length > 0) {
    const sep = document.createElement("div");
    sep.className = "live-pr-section-sep";
    sep.textContent = "Recently merged";
    frag.appendChild(sep);
    for (const pr of merged) {
      const row = document.createElement("div");
      row.className = "live-pr";
      const num = document.createElement("span");
      num.className = "live-pr-num";
      num.textContent = `#${pr.number}`;
      const state = document.createElement("span");
      state.className = "live-pr-state live-pr-merged";
      state.textContent = "merged";
      const title = document.createElement("span");
      title.className = "live-pr-title";
      title.textContent = pr.title || "(untitled)";
      const meta = document.createElement("div");
      meta.className = "live-pr-meta";
      meta.textContent = `merged ${relativeTime(pr.merged_at)}`;
      row.append(num, state, title, meta);
      frag.appendChild(row);
    }
  }
  return frag;
}

function normalizeGithubCommit(item) {
  const sha = item?.sha || "";
  const message = item?.commit?.message || "";
  return {
    short: sha ? sha.slice(0, 7) : "",
    subject: message.split("\n")[0],
    author: item?.commit?.author?.name || item?.author?.login || "",
    iso: item?.commit?.author?.date || item?.commit?.committer?.date || "",
  };
}

function normalizeGithubPull(item) {
  return {
    number: item?.number,
    title: item?.title,
    author: item?.user?.login,
    created_at: item?.created_at,
    merged_at: item?.pull_request?.merged_at || item?.closed_at,
  };
}

// ---- pure helpers for the project dashboard (testable) ----
//
// These feed /dashboard.html — the site's own command center. They are
// pure so they run under `node --test` without jsdom; only the render
// wiring at the bottom of this file touches the DOM.

// Compact number for stat cards: 1234 -> "1.2k", 1500000 -> "1.5M".
function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  const units = [[1e9, "B"], [1e6, "M"], [1e3, "k"]];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = n / size;
      return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1)}${suffix}`;
    }
  }
  return String(Math.round(n));
}

// GitHub release payload -> the shape the dashboard renders. Download
// totals are summed from the per-asset `download_count` GitHub keeps.
function normalizeRelease(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return {
    tag: release?.tag_name || release?.name || "",
    name: release?.name || release?.tag_name || "",
    published_at: release?.published_at || release?.created_at || "",
    prerelease: Boolean(release?.prerelease),
    draft: Boolean(release?.draft),
    html_url: release?.html_url || "",
    downloads: assets.reduce((sum, a) => sum + (Number(a?.download_count) || 0), 0),
    assets: assets.map((a) => ({
      name: a?.name || "",
      downloads: Number(a?.download_count) || 0,
      url: a?.browser_download_url || "",
    })),
  };
}

// Roll a releases list up to { count, totalDownloads, latest }. `latest`
// prefers the newest non-prerelease; drafts are dropped entirely.
function summarizeReleases(releases) {
  const list = (Array.isArray(releases) ? releases : [])
    .map(normalizeRelease)
    .filter((r) => !r.draft);
  return {
    count: list.length,
    totalDownloads: list.reduce((sum, r) => sum + r.downloads, 0),
    latest: list.find((r) => !r.prerelease) || list[0] || null,
  };
}

// GitHub Actions run payload -> dashboard row.
function normalizeRun(run) {
  const status = run?.status || "";
  return {
    name: run?.name || run?.workflow_name || "",
    number: run?.run_number,
    conclusion: run?.conclusion || (status === "in_progress" || status === "queued" ? status : ""),
    branch: run?.head_branch || "",
    event: run?.event || "",
    created_at: run?.created_at || run?.run_started_at || "",
    url: run?.html_url || "",
  };
}

// Pass rate over finished runs. Queued / in-progress runs are excluded
// rather than counted as failures — a running job is not a broken one.
function summarizeRuns(runs) {
  const finished = (Array.isArray(runs) ? runs : [])
    .map(normalizeRun)
    .filter((r) => r.conclusion && r.conclusion !== "in_progress" && r.conclusion !== "queued");
  const total = finished.length;
  const success = finished.filter((r) => r.conclusion === "success").length;
  const failure = finished.filter((r) => r.conclusion === "failure").length;
  return {
    total,
    success,
    failure,
    other: total - success - failure,
    passRate: total ? Math.round((success / total) * 100) : null,
  };
}

// GitHub languages payload (bytes per language) -> sorted shares.
function languageShares(languages) {
  const entries = Object.entries(languages && typeof languages === "object" ? languages : {})
    .filter(([, bytes]) => Number(bytes) > 0);
  const total = entries.reduce((sum, [, bytes]) => sum + Number(bytes), 0);
  if (!total) return [];
  return entries
    .map(([name, bytes]) => ({
      name,
      bytes: Number(bytes),
      percent: Math.round((Number(bytes) / total) * 1000) / 10,
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

// GitHub stats/commit_activity payload -> the last `count` weeks.
function weeklyActivity(weeks, count) {
  const n = Number(count) > 0 ? Number(count) : 12;
  return (Array.isArray(weeks) ? weeks : []).slice(-n).map((w) => ({
    week: Number(w?.week) || 0,
    total: Number(w?.total) || 0,
    days: Array.isArray(w?.days) ? w.days.map((d) => Number(d) || 0) : [],
  }));
}

function normalizeContributor(contributor) {
  return {
    login: contributor?.login || "",
    contributions: Number(contributor?.contributions) || 0,
    url: contributor?.html_url || "",
    avatar: contributor?.avatar_url || "",
  };
}

// Turn a failed GitHub response into a human sentence for the notice bar.
function githubErrorMessage(response) {
  const status = response?.status;
  if (status === 403 || status === 429) {
    return "GitHub rate limit reached — the board refreshes itself once the window resets (it is unauthenticated, 60 requests/hour).";
  }
  if (status === 404) return "GitHub returned 404 — the repository may be private or renamed.";
  return `GitHub API error (HTTP ${status ?? "?"}) — some panels are stale.`;
}

function conclusionLabel(conclusion) {
  switch (conclusion) {
    case "success": return "pass";
    case "failure": return "fail";
    case "cancelled": return "cancelled";
    case "skipped": return "skipped";
    case "timed_out": return "timed out";
    case "in_progress": return "running";
    case "queued": return "queued";
    default: return conclusion || "—";
  }
}

// ---- Node-test export (no DOM required) ----
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    relativeTime,
    formatTimestampLabel,
    buildCommitsFragment,
    buildPrsFragment,
    normalizeGithubCommit,
    normalizeGithubPull,
    getSiteConfig,
    joinUrl,
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
  };
}

// ---- Browser-only wiring (skipped under Node --test) ----
// The Node test harness stubs `document` with a minimal shim that has
// only `createElement` and `createDocumentFragment`. We detect that
// case by checking for `getElementById` — the real browser always has
// it, the test shim doesn't.
if (typeof document !== "undefined" && typeof document.getElementById === "function") {

// ---- DOM wiring ----
const statusEl = document.getElementById("status");
const artifactsEl = document.getElementById("artifacts");
const rawEl = document.getElementById("raw");
const refreshBtn = document.getElementById("refresh");

// Live activity panel — populated by /api/live. Auto-refreshes every
// 30 s; pauses when the tab is hidden so a backgrounded tab doesn't
// burn through the rate-limit budget. The `lastFetchAt` timestamp in
// the panel header shows visitors when the data was last pulled.
const liveCommitsEl = document.getElementById("live-commits");
const livePrsEl = document.getElementById("live-prs");
const liveTsEl = document.getElementById("live-ts");
let lastFetchAt = null;
let liveTimer = null;
let timestampTimer = null;
const LIVE_REFRESH_MS = 30000;
const siteConfig = getSiteConfig();

function text(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

// ---- card / dashboard render ----

function card(label, value) {
  const article = document.createElement("article");
  article.className = "card";
  const span = document.createElement("span");
  span.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = text(value);
  article.append(span, strong);
  return article;
}

function render(data) {
  statusEl.replaceChildren(
    card("API", "online"),
    card("Commit", data.repo?.commit),
    card("Profiles", data.counts?.community_profiles),
    card("Bundles", data.counts?.bundles),
    card("Branch", data.repo?.branch),
    card("Dirty tree", data.repo?.dirty ? "yes" : "no"),
    card("Vehicle connected", data.runtime?.vehicle_connected ? "yes" : "no"),
    card("Mode", data.runtime?.mode),
  );

  const artifacts = data.artifacts || [];
  artifactsEl.replaceChildren(...(artifacts.length ? artifacts.map((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    return li;
  }) : [document.createElement("li")]));
  if (!artifacts.length) artifactsEl.firstChild.textContent = "No release bundles found yet.";

  rawEl.textContent = JSON.stringify(data, null, 2);
}

function renderStaticDashboard() {
  statusEl.replaceChildren(
    card("Site", "GitHub Pages"),
    card("Backend", "serverless migration pending"),
    card("Repo", siteConfig.repository),
    card("Admin", "static UI staged"),
  );
  artifactsEl.replaceChildren();
  const li = document.createElement("li");
  li.textContent = "Release downloads load from GitHub releases when release metadata is available.";
  artifactsEl.append(li);
  rawEl.textContent = JSON.stringify({
    ok: true,
    hosting: "github-pages",
    backend: siteConfig.backendStatus || "pending-serverless-migration",
    repository: siteConfig.repository,
  }, null, 2);
}

async function loadDashboard() {
  if (!siteConfig.apiBaseUrl) {
    renderStaticDashboard();
    return;
  }
  refreshBtn.disabled = true;
  try {
    const response = await fetch(joinUrl(siteConfig.apiBaseUrl, "/api/dashboard"), { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    statusEl.replaceChildren(card("API", `offline: ${error.message}`));
    artifactsEl.replaceChildren();
    const li = document.createElement("li");
    li.textContent = "API unreachable. Static frontend loaded.";
    artifactsEl.append(li);
    rawEl.textContent = "";
  } finally {
    refreshBtn.disabled = false;
  }
}

// ---- /api/live render ----

function renderLive(data) {
  if (!data || !data.ok) {
    liveCommitsEl.replaceChildren();
    const li = document.createElement("li");
    li.className = "live-empty";
    li.textContent = "Live activity unavailable.";
    liveCommitsEl.appendChild(li);
    livePrsEl.replaceChildren();
    const p = document.createElement("div");
    p.className = "live-empty";
    p.textContent = "Live activity unavailable.";
    livePrsEl.appendChild(p);
    return;
  }
  liveCommitsEl.replaceChildren(buildCommitsFragment(data.commits));
  livePrsEl.replaceChildren(buildPrsFragment(data.pull_requests));
  lastFetchAt = Date.now();
  updateLiveTimestamp();
}

function updateLiveTimestamp() {
  if (liveTsEl) liveTsEl.textContent = formatTimestampLabel(lastFetchAt);
}

async function loadLive() {
  try {
    if (!siteConfig.apiBaseUrl) {
      await loadGithubLive();
      return;
    }
    const response = await fetch(joinUrl(siteConfig.apiBaseUrl, "/api/live"), { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderLive(await response.json());
  } catch (error) {
    if (liveCommitsEl && liveCommitsEl.firstElementChild?.classList.contains("live-empty")) {
      liveCommitsEl.firstElementChild.textContent = `Live feed unreachable: ${error.message}`;
    }
    if (livePrsEl && livePrsEl.firstElementChild?.classList.contains("live-empty")) {
      livePrsEl.firstElementChild.textContent = `Live feed unreachable: ${error.message}`;
    }
  }
}

async function loadGithubLive() {
  const repo = siteConfig.repository || DEFAULT_SITE_CONFIG.repository;
  const headers = { "Accept": "application/vnd.github+json" };
  const [commitsRes, prsRes, mergedRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${repo}/commits?per_page=5`, { headers, cache: "no-store" }),
    fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=5`, { headers, cache: "no-store" }),
    fetch(`https://api.github.com/search/issues?q=repo:${repo}+is:pr+is:merged&sort=updated&order=desc&per_page=5`, { headers, cache: "no-store" }),
  ]);
  if (!commitsRes.ok) throw new Error(`GitHub commits HTTP ${commitsRes.status}`);
  if (!prsRes.ok) throw new Error(`GitHub pulls HTTP ${prsRes.status}`);
  const commits = (await commitsRes.json()).map(normalizeGithubCommit);
  const open = (await prsRes.json()).map(normalizeGithubPull);
  let recentlyMerged = [];
  if (mergedRes.ok) {
    const merged = await mergedRes.json();
    recentlyMerged = (merged.items || []).map(normalizeGithubPull);
  }
  renderLive({
    ok: true,
    commits,
    pull_requests: {
      available: true,
      open,
      recently_merged: recentlyMerged,
    },
  });
}

function startLiveTimer() {
  if (liveTimer) return;
  liveTimer = setInterval(() => {
    if (document.hidden) return;
    loadLive();
  }, LIVE_REFRESH_MS);
  // Tick the timestamp every 5 s so "Updated 12s ago" doesn't lag.
  timestampTimer = setInterval(() => {
    if (!document.hidden) updateLiveTimestamp();
  }, 5000);
}

// ---- release-info loader (unchanged from v0.13.0 PR #155) ----

async function loadReleaseInfo() {
  const versionEl = document.getElementById("release-version");
  const dateEl = document.getElementById("release-date");
  const msiEl = document.getElementById("release-msi");
  const nsisEl = document.getElementById("release-nsis");
  try {
    const response = await fetch("/_release_info.json", { cache: "no-store" });
    if (response.status === 404) {
      await loadGithubReleaseInfo({ versionEl, dateEl, msiEl, nsisEl });
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const info = await response.json();
    versionEl.textContent = info.tag || info.version || "unknown";
    if (info.released_at) dateEl.textContent = info.released_at;
    if (info.downloads?.msi) msiEl.href = info.downloads.msi;
    if (info.downloads?.nsis) nsisEl.href = info.downloads.nsis;
  } catch (error) {
    versionEl.textContent = `unavailable: ${error.message}`;
  }
}

async function loadGithubReleaseInfo({ versionEl, dateEl, msiEl, nsisEl }) {
  const repo = siteConfig.repository || DEFAULT_SITE_CONFIG.repository;
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { "Accept": "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!response.ok) {
    versionEl.textContent = response.status === 404 ? "no public release yet" : `unavailable: GitHub HTTP ${response.status}`;
    return;
  }
  const release = await response.json();
  versionEl.textContent = release.tag_name || release.name || "latest";
  if (release.published_at) dateEl.textContent = release.published_at;
  const assets = release.assets || [];
  const msi = assets.find((asset) => /\.msi$/i.test(asset.name || ""));
  const nsis = assets.find((asset) => /setup\.exe$/i.test(asset.name || ""));
  if (msi?.browser_download_url) msiEl.href = msi.browser_download_url;
  if (nsis?.browser_download_url) nsisEl.href = nsis.browser_download_url;
}

// Each bootstrap is guarded on its own element: app.js now ships on two
// pages (index.html and dashboard.html) and neither has the other's DOM.
if (refreshBtn) refreshBtn.addEventListener("click", () => { loadDashboard(); loadLive(); });
// The static-status renderer writes to all three of these; a page with a
// partial board (or none) must not blow up on it.
if (statusEl && artifactsEl && rawEl) loadDashboard();
if (liveCommitsEl) { loadLive(); startLiveTimer(); }
if (document.getElementById("release-version")) loadReleaseInfo();

// ---- /dashboard.html live project board ----
//
// Everything below is a no-op unless the dashboard shell exists, so the
// landing page costs nothing for it. Data comes straight from the public
// GitHub API — no cache, no backend. One failed request degrades that one
// panel and raises a notice; the rest of the board stays live.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function dashBlank(target, message) {
  if (!target) return;
  target.replaceChildren(el("p", "live-empty", message));
}

const DASH_REFRESH_MS = 60000;

function initProjectDashboard() {
  const root = document.getElementById("dash-root");
  if (!root) return;

  const statsEl = document.getElementById("dash-stats");
  const runsEl = document.getElementById("dash-runs");
  const ciSummaryEl = document.getElementById("dash-ci-summary");
  const releasesEl = document.getElementById("dash-releases");
  const commitsEl = document.getElementById("dash-commits");
  const prsEl = document.getElementById("dash-prs");
  const contributorsEl = document.getElementById("dash-contributors");
  const languagesEl = document.getElementById("dash-languages");
  const activityEl = document.getElementById("dash-activity");
  const noticeEl = document.getElementById("dash-notice");
  const updatedEl = document.getElementById("dash-updated");
  const refreshEl = document.getElementById("dash-refresh");
  // The hero meta hard-codes the version at build time; if the board can see a
  // newer release, correct it live rather than leaving a stale number on screen.
  const versionEl = document.getElementById("dash-version");
  const repo = siteConfig.repository || DEFAULT_SITE_CONFIG.repository;
  let dashTimer = null;

  async function api(path) {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      headers: { "Accept": "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(githubErrorMessage(response));
    return response.json();
  }

  // ---- panels ----

  async function loadStats(runs) {
    if (!statsEl) return;
    const meta = await api("");
    const releases = await api("/releases?per_page=100").catch(() => []);
    const sum = summarizeReleases(releases);
    const ci = summarizeRuns(runs || []);
    statsEl.replaceChildren(
      card("Latest release", sum.latest ? sum.latest.tag : "none yet"),
      card("Releases", sum.count),
      card("Downloads", formatCount(sum.totalDownloads)),
      card("Open issues/PRs", formatCount(meta.open_issues_count)),
      card("Stars", formatCount(meta.stargazers_count)),
      card("Forks", formatCount(meta.forks_count)),
      card("Watchers", formatCount(meta.subscribers_count ?? meta.watchers_count)),
      card("CI pass rate", ci.passRate === null ? "—" : `${ci.passRate}%`),
    );
    if (ciSummaryEl) {
      ciSummaryEl.textContent = ci.total
        ? `${ci.success}/${ci.total} finished runs passed · ${ci.failure} failed`
        : "No finished runs in the recent window.";
    }
    if (versionEl && sum.latest && sum.latest.tag) versionEl.textContent = sum.latest.tag;
    renderReleases(sum);
  }

  function renderReleases(sum) {
    if (!releasesEl) return;
    if (!sum.latest) {
      dashBlank(releasesEl, "No public releases yet.");
      return;
    }
    // The latest release leads with its asset-level download counts.
    const head = el("article", "dash-release dash-release-lead");
    head.append(
      el("span", "dash-tag", sum.latest.tag),
      el("span", "dash-release-date", `published ${relativeTime(sum.latest.published_at)}`),
      el("span", "dash-release-downloads", `${formatCount(sum.latest.downloads)} downloads`),
    );
    if (sum.latest.prerelease) head.append(el("span", "dash-badge dash-badge-warn", "pre-release"));
    const assets = el("ul", "dash-assets");
    for (const asset of sum.latest.assets) {
      const li = el("li");
      const link = el("a", null, asset.name);
      link.href = asset.url || sum.latest.html_url;
      link.rel = "noopener";
      li.append(link, el("span", "dash-asset-count", formatCount(asset.downloads)));
      assets.append(li);
    }
    if (sum.latest.assets.length) head.append(assets);
    const rest = [];
    const list = el("div", "dash-release-list");
    // `sum.latest` is the newest non-prerelease; show the count line only.
    list.append(el("p", "dash-note", `${sum.count} releases · ${formatCount(sum.totalDownloads)} lifetime downloads`));
    releasesEl.replaceChildren(head, ...rest, list);
  }

  async function loadRuns() {
    if (!runsEl) return;
    const data = await api("/actions/runs?per_page=15");
    const runs = (data.workflow_runs || []).map(normalizeRun);
    if (!runs.length) {
      dashBlank(runsEl, "No workflow runs yet.");
      return;
    }
    const frag = document.createDocumentFragment();
    for (const run of runs) {
      const li = el("li", "dash-run");
      li.append(
        el("span", `dash-badge dash-badge-${run.conclusion || "unknown"}`, conclusionLabel(run.conclusion)),
        el("span", "dash-run-name", run.name),
        el("span", "dash-run-meta", `${run.branch || "?"} · ${relativeTime(run.created_at)}`),
      );
      frag.append(li);
    }
    runsEl.replaceChildren(frag);
  }

  async function loadCommits() {
    if (!commitsEl) return;
    const data = await api("/commits?per_page=10");
    commitsEl.replaceChildren(buildCommitsFragment(data.map(normalizeGithubCommit)));
  }

  async function loadPulls() {
    if (!prsEl) return;
    const [openRes, mergedRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=10`, {
        headers: { "Accept": "application/vnd.github+json" }, cache: "no-store",
      }),
      fetch(`https://api.github.com/search/issues?q=repo:${repo}+is:pr+is:merged&sort=updated&order=desc&per_page=6`, {
        headers: { "Accept": "application/vnd.github+json" }, cache: "no-store",
      }),
    ]);
    if (!openRes.ok) throw new Error(githubErrorMessage(openRes));
    const open = (await openRes.json()).map(normalizeGithubPull);
    let recentlyMerged = [];
    if (mergedRes.ok) {
      recentlyMerged = ((await mergedRes.json()).items || []).map(normalizeGithubPull);
    }
    prsEl.replaceChildren(buildPrsFragment({ available: true, open, recently_merged: recentlyMerged }));
  }

  async function loadContributors() {
    if (!contributorsEl) return;
    const data = await api("/contributors?per_page=12");
    const people = (Array.isArray(data) ? data : []).map(normalizeContributor);
    if (!people.length) {
      dashBlank(contributorsEl, "No contributor data yet.");
      return;
    }
    const frag = document.createDocumentFragment();
    for (const person of people) {
      const li = el("li", "dash-contributor");
      const link = el("a", null, person.login);
      link.href = person.url;
      link.rel = "noopener";
      li.append(link, el("span", "dash-contributions", `${formatCount(person.contributions)} commits`));
      frag.append(li);
    }
    contributorsEl.replaceChildren(frag);
  }

  async function loadLanguages() {
    if (!languagesEl) return;
    const shares = languageShares(await api("/languages"));
    if (!shares.length) {
      dashBlank(languagesEl, "No language data yet.");
      return;
    }
    const frag = document.createDocumentFragment();
    for (const share of shares) {
      const row = el("div", "dash-lang");
      const bar = el("span", "dash-lang-bar");
      bar.style.width = `${Math.max(2, share.percent)}%`;
      row.append(
        el("span", "dash-lang-name", share.name),
        bar,
        el("span", "dash-lang-pct", `${share.percent}%`),
      );
      frag.append(row);
    }
    languagesEl.replaceChildren(frag);
  }

  async function loadActivity() {
    if (!activityEl) return;
    // GitHub returns 202 with an empty body the first time anyone asks for
    // the commit-activity stats while it builds the cache. One retry after a
    // short wait usually lands; a second miss is genuinely "not ready".
    let weeks = weeklyActivity(await api("/stats/commit_activity"), 12);
    if (!weeks.length) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      weeks = weeklyActivity(await api("/stats/commit_activity"), 12);
    }
    if (!weeks.length) {
      dashBlank(activityEl, "Commit activity is being computed by GitHub — check back shortly.");
      return;
    }
    const peak = Math.max(1, ...weeks.map((w) => w.total));
    const frag = document.createDocumentFragment();
    for (const week of weeks) {
      const col = el("div", "dash-week");
      const bar = el("div", "dash-week-bar");
      bar.style.height = `${Math.round((week.total / peak) * 100)}%`;
      bar.title = `${week.total} commits · week of ${new Date(week.week * 1000).toISOString().slice(0, 10)}`;
      col.append(bar, el("span", "dash-week-num", week.total));
      frag.append(col);
    }
    activityEl.replaceChildren(frag);
  }

  async function loadBoard() {
    if (noticeEl) { noticeEl.hidden = true; noticeEl.textContent = ""; }
    if (refreshEl) refreshEl.disabled = true;
    const errors = [];
    // Runs are needed by the stats panel too, so load them first and share.
    let runs = [];
    const results = await Promise.allSettled([
      loadRuns().then(() => {}),
      loadCommits(),
      loadPulls(),
      loadContributors(),
      loadLanguages(),
      loadActivity(),
    ]);
    for (const result of results) {
      if (result.status === "rejected") errors.push(result.reason?.message || String(result.reason));
    }
    try {
      const data = await api("/actions/runs?per_page=15");
      runs = data.workflow_runs || [];
    } catch (error) {
      errors.push(error.message);
    }
    try {
      await loadStats(runs);
    } catch (error) {
      errors.push(error.message);
      if (statsEl) statsEl.replaceChildren(card("GitHub API", "unreachable"));
    }
    if (noticeEl && errors.length) {
      noticeEl.textContent = [...new Set(errors)].join(" ");
      noticeEl.hidden = false;
    }
    if (updatedEl) updatedEl.textContent = formatTimestampLabel(Date.now());
    if (refreshEl) refreshEl.disabled = false;
  }

  if (refreshEl) refreshEl.addEventListener("click", loadBoard);
  loadBoard();
  dashTimer = setInterval(() => {
    if (document.hidden) return;
    loadBoard();
  }, DASH_REFRESH_MS);
}

initProjectDashboard();

}

// Window surface for in-browser scripts that want to use the helpers.
if (typeof window !== "undefined") {
  window.beeemuuDashboard = {
    relativeTime,
    formatTimestampLabel,
    buildCommitsFragment,
    buildPrsFragment,
    normalizeGithubCommit,
    normalizeGithubPull,
    getSiteConfig,
    joinUrl,
  };
}
