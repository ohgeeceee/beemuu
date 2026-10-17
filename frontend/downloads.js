(function (root) {
  "use strict";

  const PLATFORM_ORDER = ["Windows", "Linux", "macOS"];

  function platformForAsset(name) {
    const file = String(name || "").toLowerCase();
    if (/\.(msi|exe)$/.test(file) || /setup\.exe$/.test(file)) return "Windows";
    if (/\.(appimage|deb|rpm)$/.test(file)) return "Linux";
    if (/\.(dmg|pkg)$/.test(file) || file.endsWith(".app.tar.gz")) return "macOS";
    return null;
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return "Size unavailable";
    const units = ["B", "KB", "MB", "GB"];
    const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const amount = bytes / (1024 ** unit);
    return `${amount >= 10 || unit === 0 || Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
  }

  function groupAssets(assets) {
    const groups = new Map(PLATFORM_ORDER.map((platform) => [platform, []]));
    for (const asset of Array.isArray(assets) ? assets : []) {
      const platform = platformForAsset(asset?.name);
      if (platform && asset?.browser_download_url) groups.get(platform).push({
        name: String(asset.name),
        url: String(asset.browser_download_url),
        size: Number(asset.size) || 0,
        downloads: Number(asset.download_count) || 0,
        digest: typeof asset.digest === "string" ? asset.digest : "",
      });
    }
    return PLATFORM_ORDER
      .filter((platform) => groups.get(platform).length)
      .map((platform) => ({ platform, assets: groups.get(platform) }));
  }

  function formatReleaseDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(date);
  }

  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function renderRelease(release) {
    const version = document.getElementById("release-version");
    const date = document.getElementById("release-date");
    const message = document.getElementById("release-message");
    const platformList = document.getElementById("platform-list");
    const allReleases = document.getElementById("all-releases");
    const tag = release.tag_name || release.name || "Latest stable release";
    const groups = groupAssets(release.assets);

    version.textContent = tag;
    date.textContent = formatReleaseDate(release.published_at);
    allReleases.href = release.html_url || "https://github.com/ohgeeceee/beemuu/releases";
    platformList.replaceChildren();
    if (!groups.length) {
      message.textContent = "This release has no recognized desktop installers yet. Open the release page to see all available files.";
      return;
    }

    for (const group of groups) {
      const card = el("article", "rounded-2xl border border-slate-800 bg-slate-900/70 p-6 sm:p-7");
      const heading = el("h2", "text-xl font-bold text-white", group.platform);
      const hint = el("p", "mt-1 text-sm text-slate-400", `${group.assets.length} ${group.assets.length === 1 ? "installer" : "installers"} available`);
      const list = el("ul", "mt-5 space-y-3");
      for (const asset of group.assets) {
        const row = el("li", "rounded-xl border border-slate-800 bg-slate-950/70 p-4");
        const fileName = el("div", "break-all font-mono text-xs text-slate-300", asset.name);
        const meta = el("div", "mt-1 text-xs text-slate-500", formatBytes(asset.size));
        const link = el("a", "download-link mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500");
        link.href = asset.url;
        link.rel = "noopener";
        link.textContent = "Download installer";
        row.append(fileName, meta, link);
        if (asset.digest) {
          const digest = el("details", "mt-3 text-xs text-slate-500");
          const summary = el("summary", "cursor-pointer hover:text-slate-300", "Checksum");
          const code = el("code", "mt-2 block break-all font-mono text-[10px] text-slate-400", asset.digest);
          digest.append(summary, code);
          row.append(digest);
        }
        list.append(row);
      }
      card.append(heading, hint, list);
      platformList.append(card);
    }
    message.textContent = "Showing installers attached to the latest stable GitHub release. Choose the file type supported by your distribution.";
    platformList.hidden = false;
  }

  function showError(error) {
    const message = document.getElementById("release-message");
    message.textContent = `Could not load release information (${error.message}). You can still browse all releases on GitHub.`;
  }

  async function loadRelease() {
    const response = await fetch("https://api.github.com/repos/ohgeeceee/beemuu/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(response.status === 404 ? "no public release found" : `GitHub returned ${response.status}`);
    renderRelease(await response.json());
  }

  const api = { platformForAsset, formatBytes, groupAssets, formatReleaseDate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) {
    root.addEventListener("DOMContentLoaded", () => loadRelease().catch(showError), { once: true });
  }
})(typeof window !== "undefined" ? window : globalThis);
