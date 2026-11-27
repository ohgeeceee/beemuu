/* Marketplace UI — browse, install, run and manage plugins from
 * plugins.beemuu.com inside the existing Plugins tab.
 *
 * Flow: registry.json is fetched and validated; each card shows the plugin's
 * declared capabilities and (if installed) its state. Install downloads the
 * zip, verifies its sha256 against the registry entry BEFORE extraction,
 * checks the archive's plugin.json matches the registry entry, then shows a
 * consent preview — granted capabilities vs refused ones, with reasons —
 * before anything is stored. Installed plugins are enabled/disabled, run in
 * the sandboxed marketplace runner, updated when the registry is newer, and
 * removed. All package text is rendered with textContent.
 */
"use strict";
window.mountBeemuuMarketplace = async function ({ host, appVersion }) {
  const registryApi = window.BeemuuMarketplaceRegistry;
  const zipApi = window.BeemuuMarketplaceZip;
  const storeApi = window.BeemuuMarketplaceStore;
  const runnerApi = window.BeemuuMarketplaceRunner;
  if (!registryApi || !zipApi || !storeApi || !runnerApi) {
    throw new Error("Marketplace modules are not loaded.");
  }

  const byId = id => document.getElementById(id);
  const status = text => { byId("plugins-status").textContent = text; };
  const registryUrl = (window.BEEMUU_MARKETPLACE_URL || "https://plugins.beemuu.com").replace(/\/+$/, "");

  let installed = [];
  let registry = [];
  let running = null;      // { id, handle }
  let stagedInstall = null; // { entry, pkg, sha256 }
  let storageError = "";

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(text, action) {
    const b = el("button", text, "btn btn-small");
    b.type = "button";
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { await action(); } catch (e) { status(String(e.message || e)); }
      finally { b.disabled = false; }
    });
    return b;
  }

  function stopRunning() {
    if (!running) return;
    running.handle.stop();
    running = null;
  }

  function commit(entries) {
    storeApi.save(window.localStorage, entries);
    installed = entries;
    render();
  }

  /* ---- capability summary, shared by cards and the consent preview ---- */
  function capabilityNotes(manifest) {
    const { granted, refused } = runnerApi.grantsFor(manifest.capabilities);
    const notes = [];
    if (granted.length) notes.push(`Uses: ${granted.join(", ")}`);
    for (const r of refused) notes.push(`Refused: ${r.capability} (${r.reason})`);
    if (!manifest.capabilities.length) notes.push("Uses no host capabilities.");
    return { granted, refused, notes };
  }

  /* ---- install: download, verify, extract, stage for consent ---- */
  async function stageInstall(entry) {
    status(`Downloading ${entry.name}…`);
    const response = await fetch(entry.download.url);
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());

    /* Verify before parse — a tampered archive never reaches unzip. */
    const sha = await zipApi.sha256Hex(bytes);
    if (sha === null) throw new Error("This system has no WebCrypto, so the download cannot be verified. Install refused.");
    if (sha !== entry.download.sha256) {
      throw new Error(`sha256 mismatch for ${entry.id}: download does not match the registry. The package may be corrupt or tampered with; it was not installed.`);
    }

    const files = await zipApi.unzip(bytes);
    const pkg = zipApi.extractPackage(files);
    /* The archive must be the plugin the registry described — same id, same
     * version. A mismatch means the listing and the package disagree, which
     * is a refusal, not a merge. */
    if (pkg.descriptor.id !== entry.id) throw new Error(`Archive contains "${pkg.descriptor.id}" but the registry listed "${entry.id}". Install refused.`);
    if (pkg.descriptor.version !== entry.version) throw new Error(`Archive version ${pkg.descriptor.version} does not match registry version ${entry.version}. Install refused.`);

    stagedInstall = { entry, pkg, sha256: sha };
    renderConsent();
  }

  function renderConsent() {
    const detail = byId("plugins-marketplace-detail");
    detail.replaceChildren();
    if (!stagedInstall) return;
    stopRunning();
    const { entry, pkg, sha256 } = stagedInstall;
    const { notes } = capabilityNotes({ capabilities: pkg.descriptor.capabilities });
    const current = installed.find(e => e.manifest.id === entry.id);

    const box = el("section", undefined, "plugin-trust-detail");
    box.append(el("h4", `${entry.name} ${entry.version}`));
    box.append(el("p", entry.description));
    box.append(el("p", `Author: ${entry.author} (self-declared) · Category: ${entry.category}${entry.license ? ` · License: ${entry.license}` : ""}`));
    for (const note of notes) box.append(el("p", note));
    box.append(el("p", `SHA-256 verified against the registry: ${sha256.slice(0, 16)}…`));
    if (current) box.append(el("p", `Installed version: ${current.manifest.version} — this will replace it.`));
    box.append(el("p", "The plugin stays disabled until you enable it. Vehicle writes are never granted by this app."));
    detail.append(box);

    if (pkg.readme) {
      const readme = el("details");
      readme.append(el("summary", "Read the plugin's README"), el("pre", pkg.readme, "plugin-output"));
      detail.append(readme);
    }
    const source = el("details");
    source.append(el("summary", "Inspect plugin source"), el("pre", pkg.source, "plugin-output"));
    detail.append(source);

    detail.append(
      button(current ? "Confirm — replace installed plugin" : "Confirm install", () => {
        const { entry: e, pkg: p, sha256: digest } = stagedInstall;
        stagedInstall = null;
        commit([...installed.filter(x => x.manifest.id !== e.id), {
          manifest: {
            id: p.descriptor.id, name: p.descriptor.name, version: p.descriptor.version,
            capabilities: p.descriptor.capabilities, author: e.author, description: e.description,
            category: e.category, official: e.official, homepage: e.homepage, license: e.license,
          },
          source: p.source,
          readme: p.readme,
          enabled: false,
          sha256: digest,
          installedAt: new Date().toISOString(),
        }]);
        detail.replaceChildren();
        status(`${e.name} installed and disabled. Enable it when you are ready.`);
      }),
      button("Cancel", () => { stagedInstall = null; detail.replaceChildren(); status("Install cancelled. Nothing was stored."); }),
    );
  }

  /* ---- run an installed, enabled plugin ---- */
  function openPlugin(installedEntry) {
    stopRunning();
    const detail = byId("plugins-marketplace-detail");
    detail.replaceChildren();
    const header = el("div");
    header.append(el("h3", installedEntry.manifest.name));
    detail.append(header);
    const frameBox = el("div");
    detail.append(frameBox);

    const handle = runnerApi.startPlugin({
      container: frameBox,
      entry: installedEntry,
      host,
      appVersion,
      notify: text => status(`${installedEntry.manifest.name}: ${text}`),
      onError: text => { status(`${installedEntry.manifest.name}: ${text}`); },
      onReady: () => status(`${installedEntry.manifest.name} is running.`),
    });
    running = { id: installedEntry.manifest.id, handle };
    header.append(button("Stop", () => { stopRunning(); detail.replaceChildren(); status("Plugin stopped."); }));
    const { refused } = handle;
    if (refused.length) {
      detail.append(el("p", refused.map(r => `${r.capability}: ${r.reason}`).join(" · "), "muted"));
    }
  }

  /* ---- cards ---- */
  function render() {
    const grid = byId("plugins-marketplace");
    grid.replaceChildren();
    if (storageError) {
      grid.append(el("p", `Marketplace plugin storage cannot be used: ${storageError}`, "muted"));
      return;
    }
    if (!registry.length) {
      grid.append(el("p", "Marketplace is empty or unavailable. Try Refresh.", "muted"));
      return;
    }
    let updates = [];
    try { updates = registryApi.updatesAvailable(installed.map(e => e.manifest), registry); }
    catch (_) { updates = []; }
    const updateIds = new Set(updates.map(u => u.id));

    for (const entry of registry) {
      const current = installed.find(e => e.manifest.id === entry.id);
      const card = el("article", undefined, "plugin-card");
      const title = el("h3", entry.name);
      if (entry.official) title.append(el("span", "official", "plugin-badge"));
      card.append(title);
      card.append(el("p", `${entry.version} · ${entry.author} · ${entry.category}${entry.minAppVersion ? ` · requires app ≥ ${entry.minAppVersion}` : ""}`));
      card.append(el("p", entry.description));
      const { notes } = capabilityNotes(entry);
      card.append(el("p", notes.join(" · "), "muted"));

      const tooNew = entry.minAppVersion && appVersion && registryApi.compareSemver(entry.minAppVersion, appVersion) > 0;
      if (tooNew) {
        card.append(el("p", `Requires Beemuu ${entry.minAppVersion} or newer; this build is ${appVersion}.`, "muted"));
      } else if (!current) {
        card.append(button("Install", () => stageInstall(entry)));
      } else {
        if (updateIds.has(entry.id)) {
          card.append(el("p", `Update available: ${current.manifest.version} → ${entry.version}`, "plugin-update"));
          card.append(button("Update", () => stageInstall(entry)));
        }
        card.append(
          button(current.enabled ? "Disable" : "Enable", () => {
            if (running && running.id === entry.id) stopRunning();
            commit(installed.map(e => e.manifest.id === entry.id ? { ...e, enabled: !e.enabled } : e));
            status(`${entry.name} ${current.enabled ? "disabled" : "enabled"}.`);
          }),
        );
        if (current.enabled) {
          card.append(button(running && running.id === entry.id ? "Running — show" : "Open", () => openPlugin(current)));
        }
        card.append(button("Remove", () => {
          if (running && running.id === entry.id) stopRunning();
          commit(installed.filter(e => e.manifest.id !== entry.id));
          byId("plugins-marketplace-detail").replaceChildren();
          status(`${entry.name} removed.`);
        }));
      }
      grid.append(card);
    }
  }

  async function refresh() {
    const grid = byId("plugins-marketplace");
    grid.replaceChildren(el("p", "Loading marketplace…", "muted"));
    try {
      const response = await fetch(`${registryUrl}/registry.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      registry = registryApi.validateRegistry(await response.json());
    } catch (e) {
      registry = [];
      grid.replaceChildren(el("p", `Marketplace unavailable: ${e.message}. Installed plugins keep working offline.`, "muted"));
      return;
    }
    render();
  }

  byId("plugins-marketplace-refresh").addEventListener("click", refresh);
  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
    if (tab.dataset.view !== "plugins") stopRunning();
  }));

  try {
    installed = storeApi.load(window.localStorage);
  } catch (e) {
    storageError = e.message;
  }
  await refresh();
  if (storageError) render(); // surface the storage problem over the registry view
};
