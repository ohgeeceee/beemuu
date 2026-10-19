/* Automatically install signed desktop releases when the vehicle is offline.
 * Tauri's updater verifies every artifact against the public key in config. */
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

(function () {
  const RETRY_MS = 30 * 60 * 1000;
  const IDLE_POLL_MS = 10 * 1000;

  function setMessage(message) {
    const target = document.getElementById("status-log");
    if (target) target.textContent = message;
  }

  function isConnected() {
    return typeof window.beeemuuIsConnected === "function" && window.beeemuuIsConnected();
  }

  async function checkAndInstall() {
    if (!window.__TAURI__) return;
    if (isConnected()) {
      window.setTimeout(checkAndInstall, IDLE_POLL_MS);
      return;
    }

    try {
      const update = await check();
      if (!update) return;
      setMessage(`Installing update ${update.version}…`);
      await update.downloadAndInstall();

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
    } catch (error) {
      // A network outage or a temporarily unavailable release must not affect
      // diagnostics. Retry later without interrupting the current session.
      console.warn("BeeEmUu automatic update check failed", error);
      setMessage("Update check unavailable");
      window.setTimeout(checkAndInstall, RETRY_MS);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => window.setTimeout(checkAndInstall, 2500), { once: true });
  } else {
    window.setTimeout(checkAndInstall, 2500);
  }
})();
