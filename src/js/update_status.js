/* Pure helpers for the visible auto-update status (v5.3.0).
 * DOM- and Tauri-free so node --test can pin the logic; auto_update.js keeps
 * only the webview glue. UMD: the esbuild bundle imports the CJS export. */
(function (root) {
  "use strict";

  const SEMVER_IN_TEXT = /\bv?(\d+\.\d+\.\d+)\b/;
  const SEMVER = /^\d+\.\d+\.\d+$/;

  /* Extract "5.3.0" from brand text like "Independent diagnostic tool … v5.3.0". */
  function versionFromText(text) {
    const match = SEMVER_IN_TEXT.exec(String(text || ""));
    return match ? match[1] : null;
  }

  function releaseNotesUrl(version) {
    if (!SEMVER.test(String(version || ""))) return null;
    return `https://github.com/ohgeeceee/beemuu/releases/tag/v${version}`;
  }

  /* Fold one @tauri-apps/plugin-updater download event into a progress
   * snapshot. Events look like {event: "Started"|"Progress"|"Finished", data}
   * with contentLength on Started and chunkLength on Progress. Unknown or
   * malformed events leave the snapshot unchanged rather than inventing
   * numbers. Total 0 means "unknown" (progress stays indeterminate). */
  function progressFromEvent(state, event) {
    const previous = state && typeof state === "object" ? state : {};
    const next = { downloaded: previous.downloaded || 0, total: previous.total || 0 };
    if (!event || typeof event !== "object") return next;
    if (event.event === "Started") {
      next.total = Number(event.data && event.data.contentLength) || 0;
      next.downloaded = 0;
    } else if (event.event === "Progress") {
      next.downloaded += Number(event.data && event.data.chunkLength) || 0;
    } else if (event.event === "Finished") {
      next.downloaded = next.total || next.downloaded;
    }
    return next;
  }

  /* 0–100, or null when the total is unknown (indeterminate). Capped: a
   * server mis-reporting chunks must not show 140%. */
  function percent(state) {
    if (!state || !state.total) return null;
    return Math.min(100, Math.round((state.downloaded / state.total) * 100));
  }

  const api = { versionFromText, releaseNotesUrl, progressFromEvent, percent };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BeemuuUpdateStatus = api;
})(typeof window !== "undefined" ? window : null);
