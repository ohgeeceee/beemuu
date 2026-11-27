/* Marketplace boot — wires the Plugins tab's marketplace section to app state.
 *
 * The vehicle host is the read-only plugin_host.js surface fed from the
 * v3 bridge (getters only — a plugin cannot mutate app state through it).
 * Live data flows on the v3 change hook: every app data change publishes a
 * snapshot to subscribed plugins. App version is read from the header band
 * so minAppVersion checks and context.app.version never drift from the build.
 */
"use strict";
(function () {
  const v3 = window.beeemuuV3;
  if (!v3 || !window.BeemuuPluginHost || !window.mountBeemuuMarketplace) return;

  const host = window.BeemuuPluginHost.createHost({
    vin: () => {
      const info = v3.vehicleInfo();
      return info && typeof info.vin === "string" ? info.vin : null;
    },
    dtcs: () => v3.dtcs(),
    logSeries: () => v3.logSeries(),
  });
  v3.onData(() => host.publish());

  const brand = document.querySelector(".brand-sub");
  const match = brand && /v(\d+\.\d+\.\d+)/.exec(brand.textContent || "");
  const appVersion = match ? match[1] : null;

  window.mountBeemuuMarketplace({ host, appVersion }).catch(error => {
    const status = document.getElementById("plugins-status");
    if (status) status.textContent = `Marketplace failed to start: ${error.message || error}`;
  });
})();
