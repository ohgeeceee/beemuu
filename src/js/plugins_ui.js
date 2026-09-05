/* Community plugin manager. All package text is rendered with textContent. */
"use strict";
window.mountBeemuuPlugins = async function ({ importProfiles }) {
  const api = window.BeemuuPlugins;
  const byId = id => document.getElementById(id);
  const status = text => { byId("plugins-status").textContent = text; };
  let installed = [];
  let catalog = [];
  let pending = null;
  let selected = null;
  let cancelRun = () => {};
  let storage;
  let writable = false;
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
  function commit(entries) {
    if (!writable) throw new Error("Plugin storage is unavailable. Reload after fixing the storage error.");
    api.save(storage, entries);
    installed = entries;
    render();
  }
  function stage(p) {
    pending = api.validate(p);
    byId("plugins-package-source").textContent = JSON.stringify(pending, null, 2);
    const current = installed.find(e => e.package.id === p.id);
    byId("plugins-preview").textContent = `${p.name} · ${p.version}\nAuthor: ${p.author} · License: ${p.license}\n${p.description}\n${p.kind === "tool" ? "Executable JavaScript utility. Processes only the JSON you supply; no host permissions." : "Data pack. Reference articles and optional live-data profiles."}${current ? `\nReplaces installed version ${current.package.version}. Author names are self-declared; verify the source before replacing a package.` : "\nAuthor names are self-declared. Install packages from sources you trust."}`;
    byId("plugins-install").hidden = false;
    byId("plugins-install").textContent = current ? "Replace installed package" : "Install package";
  }
  function render() {
    const list = byId("plugins-installed");
    list.replaceChildren();
    if (!installed.length) list.append(el("p", "No plugins installed. Choose a catalog package or import one below.", "muted"));
    for (const entry of installed) {
      const p = entry.package;
      const card = el("article", undefined, "plugin-card");
      card.append(el("h3", p.name), el("p", `${p.version} · ${p.author} · ${entry.enabled ? "Enabled" : "Disabled"}`), el("p", p.description));
      card.append(button("Open", () => open(p.id)), button(entry.enabled ? "Disable" : "Enable", () => {
        cancelRun();
        commit(installed.map(e => e.package.id === p.id ? { ...e, enabled: !e.enabled } : e));
        if (selected === p.id) open(p.id);
      }), button("Export package", () => download(p)), button("Remove", () => {
        cancelRun();
        commit(installed.filter(e => e.package.id !== p.id));
        if (selected === p.id) { selected = null; byId("plugins-detail").replaceChildren(); }
        status("Package removed. Profiles already imported into Live Data remain until the app restarts.");
      }));
      list.append(card);
    }
  }
  function download(p) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }));
    const a = el("a");
    a.href = url;
    a.download = `${p.id}-${p.version}.beemuu-plugin.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function run(p, input, output) {
    cancelRun();
    if (new TextEncoder().encode(input).length > 32000) throw new Error("Tool input exceeds 32 KiB.");
    JSON.parse(input);
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.title = "Isolated plugin runner";
    frame.hidden = true;
    frame.src = "plugin-runner.html";
    let ready = false;
    let finished = false;
    const finish = text => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      frame.remove();
      output.textContent = text;
      cancelRun = () => {};
    };
    const receive = event => {
      if (event.source !== frame.contentWindow || event.origin !== "null") return;
      if (event.data?.type === "beemuu:ready" && !ready) {
        ready = true;
        frame.contentWindow.postMessage({ type: "beemuu:run", code: p.code, input }, "*");
      } else if (ready && event.data?.type === "beemuu:result") {
        const result = event.data.result;
        finish(typeof result === "string" && new TextEncoder().encode(result).length <= 64000 ? result : "Invalid plugin result.");
      }
    };
    const timeout = setTimeout(() => finish("Plugin runner timed out or was blocked by this webview."), 5000);
    cancelRun = () => finish("Plugin stopped.");
    window.addEventListener("message", receive);
    output.textContent = "Running…";
    document.body.append(frame);
  }
  function open(id) {
    cancelRun();
    selected = id;
    const entry = installed.find(e => e.package.id === id);
    const p = entry.package;
    const detail = byId("plugins-detail");
    detail.replaceChildren(el("h3", p.name));
    if (!entry.enabled) { detail.append(el("p", "Enable this plugin to use it.")); return; }
    if (p.kind === "data") {
      for (const article of p.content.articles) detail.append(el("h4", article.title), el("p", article.body, "plugin-text"));
      if (p.content.profilesToml) {
        detail.append(el("p", "Import profiles into Live Data for this app session. Matching profile IDs may be replaced. Disabling or removing the package does not undo imported profiles; restart to clear them."));
        detail.append(button("Import live-data profiles for this session", async () => {
          const labels = await importProfiles(p.content.profilesToml);
          status(`Imported profiles: ${labels.join(", ")}. Choose one in Live Data.`);
        }));
      }
    } else {
      const input = el("textarea");
      input.id = "plugin-tool-input";
      input.rows = 8;
      input.maxLength = 32000;
      input.value = JSON.stringify(p.exampleInput, null, 2);
      const label = el("label", "Input JSON");
      label.htmlFor = input.id;
      const output = el("pre", "Results will appear here.", "plugin-output");
      output.setAttribute("aria-live", "polite");
      const source = el("details");
      source.append(el("summary", "Inspect plugin source"), el("pre", p.code, "plugin-output"));
      detail.append(el("p", "This utility processes the JSON below. It has no vehicle connection, file access, or network access. Results are supplied by the plugin author."), label, input, button("Run tool", () => run(p, input.value, output)), button("Stop", () => cancelRun()), output, source);
    }
  }
  byId("plugins-install").addEventListener("click", () => {
    try {
      if (!pending) return;
      cancelRun();
      commit([...installed.filter(e => e.package.id !== pending.id), { package: pending, enabled: false }]);
      byId("plugins-install").hidden = true;
      byId("plugins-preview").textContent = "Package installed and disabled. Enable it when you are ready.";
      if (selected === pending.id) open(pending.id);
      pending = null;
      status("Installed. No plugin code has been run.");
    } catch (e) { status(e.message); }
  });
  byId("plugins-file").addEventListener("change", async event => {
    pending = null;
    byId("plugins-install").hidden = true;
    byId("plugins-preview").textContent = "";
    byId("plugins-package-source").textContent = "";
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > api.MAX_PACKAGE) throw new Error("Package exceeds 256 KiB.");
      stage(api.parse(await file.text()));
    } catch (e) { status(`Cannot import: ${e.message}`); }
    finally { event.target.value = ""; }
  });
  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
    if (tab.dataset.view !== "plugins") cancelRun();
  }));
  try { storage = window.localStorage; installed = api.load(storage); writable = true; }
  catch (e) { status(`Cannot load plugin storage: ${e.message}. Existing storage has been preserved.`); }
  render();
  try {
    const response = await fetch("plugins/catalog.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    if (!Array.isArray(raw) || raw.length > 100) throw new Error("Invalid catalog.");
    catalog = raw.map(api.validate);
    if (new Set(catalog.map(p => p.id)).size !== catalog.length) throw new Error("Duplicate catalog IDs.");
    const list = byId("plugins-catalog");
    list.replaceChildren();
    for (const p of catalog) {
      const card = el("article", undefined, "plugin-card");
      card.append(el("h3", p.name), el("p", `${p.kind === "tool" ? "Tool" : "Data pack"} · ${p.version} · ${p.author}`), el("p", p.description), button("Review package", () => stage(p)), button("Download authoring example", () => download(p)));
      list.append(card);
    }
  } catch (e) { byId("plugins-catalog").textContent = `Catalog unavailable: ${e.message}. You can still import a package file.`; }
};
