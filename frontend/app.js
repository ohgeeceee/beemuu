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

// ---- Node-test export (no DOM required) ----
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    relativeTime,
    formatTimestampLabel,
    buildCommitsFragment,
    buildPrsFragment,
  };
}

// ---- Browser-only wiring (skipped under Node --test) ----
// The Node test harness stubs `document` with a minimal shim that has
// only `createElement` and `createDocumentFragment`. We detect that
// case by checking for `getElementById` — the real browser always has
// it, the test shim doesn't.
if (typeof document === "undefined" || typeof document.getElementById !== "function") return;

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

async function loadDashboard() {
  refreshBtn.disabled = true;
  try {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
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
    const response = await fetch("/api/live", { cache: "no-store" });
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
      versionEl.textContent = "no release yet";
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

refreshBtn.addEventListener("click", () => { loadDashboard(); loadLive(); });
loadDashboard();
loadLive();
loadReleaseInfo();
startLiveTimer();

// Window surface for in-browser scripts that want to use the helpers.
if (typeof window !== "undefined") {
  window.beeemuuDashboard = { relativeTime, formatTimestampLabel, buildCommitsFragment, buildPrsFragment };
}