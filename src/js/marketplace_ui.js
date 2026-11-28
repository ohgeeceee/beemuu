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
  let offlineNotice = "";  // set when the listing comes from cache or is unavailable
  let filterText = "";
  let stagedSideload = null; // { pkg, sha256, fileName }

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

  /* ---- install: download, verify, extract ----
   * Shared by single installs and Update all. Every package passes the same
   * checks: sha256 against the registry BEFORE unzip, then id/version match
   * between archive and listing. */
  async function downloadVerifiedPackage(entry) {
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
    return { pkg, sha256: sha };
  }

  /* Build the stored entry for a verified package. Updates keep the enabled
   * flag the user already chose; brand-new installs always start disabled. */
  function storedEntryFor(entry, pkg, sha256, current) {
    return {
      manifest: {
        id: pkg.descriptor.id, name: pkg.descriptor.name, version: pkg.descriptor.version,
        capabilities: pkg.descriptor.capabilities, author: entry.author, description: entry.description,
        category: entry.category, official: entry.official, homepage: entry.homepage, license: entry.license,
      },
      source: pkg.source,
      readme: pkg.readme,
      enabled: current ? current.enabled : false,
      sha256,
      installedAt: new Date().toISOString(),
    };
  }

  async function stageInstall(entry) {
    status(`Downloading ${entry.name}…`);
    const { pkg, sha256 } = await downloadVerifiedPackage(entry);
    stagedInstall = { entry, pkg, sha256 };
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
    if (current) box.append(el("p", `Installed version: ${current.manifest.version} — this will replace it. Your enable/disable choice is kept.`));
    box.append(el("p", current ? "A running copy is stopped before the update. Vehicle writes are never granted by this app." : "The plugin stays disabled until you enable it. Vehicle writes are never granted by this app."));
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
        if (current && running && running.id === e.id) stopRunning();
        commit([...installed.filter(x => x.manifest.id !== e.id), storedEntryFor(e, p, digest, current)]);
        detail.replaceChildren();
        status(current ? `${e.name} updated to ${p.descriptor.version}.` : `${e.name} installed and disabled. Enable it when you are ready.`);
      }),
      button("Cancel", () => { stagedInstall = null; detail.replaceChildren(); status("Install cancelled. Nothing was stored."); }),
    );
  }

  /* ---- update all: one consent, then the same verified pipeline per plugin ---- */
  function stageUpdateAll(updates) {
    stopRunning();
    const detail = byId("plugins-marketplace-detail");
    detail.replaceChildren();
    const box = el("section", undefined, "plugin-trust-detail");
    box.append(el("h4", `Update ${updates.length} plugins`));
    for (const entry of updates) {
      const current = installed.find(e => e.manifest.id === entry.id);
      box.append(el("p", `${entry.name}: ${current.manifest.version} → ${entry.version}`));
      const { notes } = capabilityNotes(entry);
      for (const note of notes) box.append(el("p", note, "muted"));
    }
    box.append(el("p", "Each package is SHA-256 verified against the registry before install. Enable/disable choices are kept; running plugins are stopped first. A plugin that fails to download is left at its current version."));
    detail.append(box);
    detail.append(
      button(`Confirm — update ${updates.length} plugins`, () => runUpdateAll(updates)),
      button("Cancel", () => { detail.replaceChildren(); status("Update all cancelled. Nothing was changed."); }),
    );
  }

  async function runUpdateAll(updates) {
    const detail = byId("plugins-marketplace-detail");
    detail.replaceChildren();
    const results = [];
    let next = [...installed];
    for (const entry of updates) {
      status(`Updating ${entry.name}…`);
      try {
        const { pkg, sha256 } = await downloadVerifiedPackage(entry);
        const current = next.find(e => e.manifest.id === entry.id);
        if (running && running.id === entry.id) stopRunning();
        next = [...next.filter(x => x.manifest.id !== entry.id), storedEntryFor(entry, pkg, sha256, current)];
        results.push({ name: entry.name, ok: true, version: pkg.descriptor.version });
      } catch (e) {
        results.push({ name: entry.name, ok: false, error: String(e.message || e) });
      }
    }
    commit(next); // one save + render after the batch, not one per plugin
    const failed = results.filter(r => !r.ok);
    for (const r of results) {
      detail.append(el("p", r.ok ? `${r.name}: updated to ${r.version}.` : `${r.name}: ${r.error}`, r.ok ? undefined : "plugin-update"));
    }
    status(failed.length
      ? `Updated ${results.length - failed.length} of ${results.length} plugins; ${failed.length} failed and kept the installed version.`
      : `All ${results.length} plugins updated.`);
  }

  /* ---- sideload: install a local .zip with NO registry digest ----
   * The archive is hashed so the user can compare the digest against wherever
   * they got the file, but there is no listing to verify against — the consent
   * dialog says that plainly instead of implying registry-level trust. */
  async function stageSideload(file) {
    status(`Reading ${file.name}…`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha = await zipApi.sha256Hex(bytes);
    if (sha === null) throw new Error("This system has no WebCrypto, so the archive cannot be hashed. Install refused.");
    const files = await zipApi.unzip(bytes);
    const pkg = zipApi.extractPackage(files);
    stagedSideload = { pkg, sha256: sha, fileName: file.name };
    renderSideloadConsent();
  }

  function renderSideloadConsent() {
    const detail = byId("plugins-marketplace-detail");
    detail.replaceChildren();
    if (!stagedSideload) return;
    stopRunning();
    const { pkg, sha256, fileName } = stagedSideload;
    const d = pkg.descriptor;
    const current = installed.find(e => e.manifest.id === d.id);
    const { notes } = capabilityNotes({ capabilities: d.capabilities });

    const box = el("section", undefined, "plugin-trust-detail");
    box.append(el("h4", `${d.name} ${d.version} — sideloaded package`));
    box.append(el("p", `Source: local file ${fileName}. Unverified source — this archive did not come from plugins.beemuu.com, so there is no registry digest to compare. Install only if you trust where you obtained it.`));
    box.append(el("p", `SHA-256 of the file you selected: ${sha256}`));
    for (const note of notes) box.append(el("p", note));
    if (current) box.append(el("p", `Installed version: ${current.manifest.version} — this will replace it. Your enable/disable choice is kept.`));
    box.append(el("p", current ? "A running copy is stopped before the replace. Vehicle writes are never granted by this app." : "The plugin stays disabled until you enable it. Vehicle writes are never granted by this app."));
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
        const { pkg: p, sha256: digest } = stagedSideload;
        stagedSideload = null;
        if (current && running && running.id === d.id) stopRunning();
        commit([...installed.filter(x => x.manifest.id !== d.id), {
          manifest: {
            id: d.id, name: d.name, version: d.version,
            capabilities: d.capabilities, author: "Sideloaded (local archive)",
            description: "Installed from a local .zip; not registry-verified.",
            category: "tools", official: false, homepage: null, license: null,
          },
          source: p.source,
          readme: p.readme,
          enabled: current ? current.enabled : false,
          sha256: digest,
          installedAt: new Date().toISOString(),
        }]);
        detail.replaceChildren();
        status(`${d.name} installed${current ? " as an update" : " and disabled. Enable it when you are ready."}`);
      }),
      button("Cancel", () => { stagedSideload = null; detail.replaceChildren(); status("Sideload cancelled. Nothing was stored."); }),
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
  function cardForInstalledOnly(current) {
    /* Installed but absent from the current listing (offline with no cache,
     * or unlisted upstream). Management must keep working regardless. */
    const m = current.manifest;
    const card = el("article", undefined, "plugin-card");
    card.append(el("h3", m.name));
    card.append(el("p", `${m.version} · ${m.author || "unknown author"} · ${m.category || "uncategorised"}`));
    card.append(el("p", m.description || "Installed plugin — not in the current registry listing."));
    const { notes } = capabilityNotes(m);
    card.append(el("p", notes.join(" · "), "muted"));
    card.append(el("p", "Not in the current registry listing; enable, open and remove still work.", "muted"));
    card.append(
      button(current.enabled ? "Disable" : "Enable", () => {
        if (running && running.id === m.id) stopRunning();
        commit(installed.map(e => e.manifest.id === m.id ? { ...e, enabled: !e.enabled } : e));
        status(`${m.name} ${current.enabled ? "disabled" : "enabled"}.`);
      }),
    );
    if (current.enabled) {
      card.append(button(running && running.id === m.id ? "Running — show" : "Open", () => openPlugin(current)));
    }
    card.append(button("Remove", () => {
      if (running && running.id === m.id) stopRunning();
      commit(installed.filter(e => e.manifest.id !== m.id));
      byId("plugins-marketplace-detail").replaceChildren();
      status(`${m.name} removed.`);
    }));
    return card;
  }

  function render() {
    const grid = byId("plugins-marketplace");
    grid.replaceChildren();
    if (storageError) {
      grid.append(el("p", `Marketplace plugin storage cannot be used: ${storageError}`, "muted"));
      return;
    }
    if (offlineNotice) grid.append(el("p", offlineNotice, "plugin-update"));
    let updates = [];
    try { updates = registryApi.updatesAvailable(installed.map(e => e.manifest), registry); }
    catch (_) { updates = []; }
    const updateIds = new Set(updates.map(u => u.id));
    if (updates.length >= 2) {
      grid.append(button(`Update all (${updates.length})`, () => stageUpdateAll(updates)));
    }

    const listed = registryApi.filterEntries(registry, filterText);
    const listedIds = new Set(registry.map(e => e.id));
    for (const entry of listed) {
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
    /* Installed plugins missing from the listing are always manageable —
     * filtered by the same query so search behaves consistently. */
    const unlisted = installed.filter(e => !listedIds.has(e.manifest.id));
    const visibleUnlisted = registryApi.filterEntries(unlisted.map(e => e.manifest), filterText).map(m => m.id);
    for (const current of unlisted) {
      if (visibleUnlisted.includes(current.manifest.id)) grid.append(cardForInstalledOnly(current));
    }
    if (!listed.length && !unlisted.length) {
      grid.append(el("p", filterText ? "No plugins match your search." : "Marketplace is empty or unavailable. Try Refresh.", "muted"));
    }
  }

  async function refresh() {
    const grid = byId("plugins-marketplace");
    grid.replaceChildren(el("p", "Loading marketplace…", "muted"));
    try {
      const response = await fetch(`${registryUrl}/registry.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      registry = registryApi.validateRegistry(await response.json());
      offlineNotice = "";
      try { storeApi.saveRegistryCache(window.localStorage, registry, new Date().toISOString()); }
      catch (_) { /* A full or blocked cache must never break browsing. */ }
    } catch (e) {
      /* Offline path: fall back to the last-good registry (re-validated —
       * cached JSON is not inherently trustworthy), else to installed-only
       * cards. Management never depends on the network. */
      const cached = storeApi.loadRegistryCache(window.localStorage);
      let restored = null;
      if (cached) {
        try { restored = registryApi.validateRegistry({ plugins: cached.entries }); }
        catch (_) { restored = null; }
      }
      if (restored) {
        registry = restored;
        offlineNotice = `Marketplace unreachable (${e.message}). Showing the listing cached ${cached.fetchedAt.slice(0, 10)}; downloads may fail, but installed plugins are fully manageable.`;
      } else {
        registry = [];
        offlineNotice = `Marketplace unavailable: ${e.message}. Showing installed plugins only — they remain fully manageable.`;
      }
    }
    render();
  }

  byId("plugins-marketplace-refresh").addEventListener("click", refresh);
  const filterInput = byId("plugins-marketplace-filter");
  if (filterInput) {
    filterInput.addEventListener("input", () => { filterText = filterInput.value; render(); });
  }
  const sideloadInput = byId("plugins-marketplace-sideload");
  if (sideloadInput) {
    sideloadInput.addEventListener("change", async () => {
      const file = sideloadInput.files && sideloadInput.files[0];
      if (!file) return;
      try { await stageSideload(file); }
      catch (e) { status(`Sideload failed: ${e.message || e}`); }
      finally { sideloadInput.value = ""; } // allow picking the same file again
    });
  }
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
