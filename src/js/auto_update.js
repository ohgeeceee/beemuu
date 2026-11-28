/* Automatically install signed desktop releases when the vehicle is offline.
 * Tauri's updater verifies every artifact against the public key in config.
 *
 * v5.3.0: the same pipeline also powers the About → Updates panel — current
 * version, manual "Check for updates", download progress and release notes.
 * One busy flag shared by the automatic loop and the manual button so the two
 * can never race a download. The vehicle-connected rule is unchanged: no
 * downloads and no relaunch while a session is active. */
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import updateStatus from "./update_status.js";

(function () {
  const RETRY_MS = 30 * 60 * 1000;
  const IDLE_POLL_MS = 10 * 1000;
  let busy = false;

  const byId = id => document.getElementById(id);

  function setMessage(message) {
    const log = byId("status-log");
    if (log) log.textContent = message;
    const target = byId("app-update-status");
    if (target) target.textContent = message;
  }

  function setProgress(state) {
    const bar = byId("app-update-progress");
    if (!bar) return;
    const pct = updateStatus.percent(state);
    if (pct === null) { bar.style.display = "none"; return; }
    bar.style.display = "";
    bar.value = pct;
  }

  function showNotes(version) {
    const link = byId("app-update-notes");
    const url = updateStatus.releaseNotesUrl(version);
    if (!link || !url) return;
    link.href = url;
    link.style.display = "";
  }

  function currentVersion() {
    for (const node of document.querySelectorAll(".brand-sub")) {
      const version = updateStatus.versionFromText(node.textContent);
      if (version) return version;
    }
    return null;
  }

  function setCurrentVersion() {
    const target = byId("app-update-current");
    if (!target) return;
    const version = currentVersion();
    target.textContent = version ? `Current version: v${version}` : "Current version: unknown";
  }

  function isConnected() {
    return typeof window.beeemuuIsConnected === "function" && window.beeemuuIsConnected();
  }

  async function downloadAndRelaunch(update) {
    showNotes(update.version);
    let state = { downloaded: 0, total: 0 };
    setMessage(`Downloading update ${update.version}…`);
    setProgress(state);
    await update.downloadAndInstall(event => {
      state = updateStatus.progressFromEvent(state, event);
      setProgress(state);
      if (event && event.event === "Finished") setMessage(`Update ${update.version} downloaded. Installing…`);
    });

    // The cable may have been connected while the update downloaded. Keep
    // the verified package staged, then relaunch only after disconnect.
    const relaunchWhenIdle = () => {
      if (isConnected()) {
        window.setTimeout(relaunchWhenIdle, IDLE_POLL_MS);
        return;
      }
      setMessage("Update installed. Restarting…");
      relaunch().catch((error) => {
        console.error("BeeEmUu update restart failed", error);
        setMessage("Update ready. Restart Beemuu to finish installing.");
      });
    };
    relaunchWhenIdle();
  }

  /* One update check. manual=true surfaces every state in the About panel;
   * the automatic loop (manual=false) stays quiet unless something happens. */
  async function runCheck(manual) {
    if (!window.__TAURI__) {
      if (manual) setMessage("Update checks are available in the desktop app.");
      return;
    }
    if (busy) {
      if (manual) setMessage("An update check is already in progress.");
      return;
    }
    if (isConnected()) {
      if (manual) setMessage("Disconnect from the vehicle before checking for updates.");
      return;
    }
    busy = true;
    try {
      if (manual) setMessage("Checking for updates…");
      const update = await check();
      if (!update) {
        if (manual) {
          const version = currentVersion();
          setMessage(version ? `BeeEmUu v${version} is up to date.` : "No update available.");
        }
        return;
      }
      setMessage(`Installing update ${update.version}…`);
      await downloadAndRelaunch(update);
    } catch (error) {
      // A network outage or a temporarily unavailable release must not affect
      // diagnostics. The automatic loop retries later; manual checks can be
      // retried from the button.
      console.warn("BeeEmUu update check failed", error);
      setMessage(manual ? `Update check failed: ${error.message || error}. You can retry.` : "Update check unavailable");
      if (!manual) window.setTimeout(() => runCheck(false), RETRY_MS);
    } finally {
      busy = false;
    }
  }

  function autoLoop() {
    if (!window.__TAURI__) return;
    if (isConnected()) {
      window.setTimeout(autoLoop, IDLE_POLL_MS);
      return;
    }
    // No reschedule on success — matches the pre-v5.3.0 behavior: one check
    // per launch unless an error schedules a retry.
    runCheck(false).catch(() => {});
  }

  const manualButton = byId("app-update-check");
  if (manualButton) {
    manualButton.addEventListener("click", () => { runCheck(true).catch(() => {}); });
  }
  setCurrentVersion();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => window.setTimeout(autoLoop, 2500), { once: true });
  } else {
    window.setTimeout(autoLoop, 2500);
  }
})();
