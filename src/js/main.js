/* BeeEmUu frontend — talks to the Rust backend via Tauri invoke. */

const invoke = window.__TAURI__.core.invoke;

const $ = (id) => document.getElementById(id);

let connected = false;
let modules = [];
let selectedAddress = null;
const gauges = new Map(); // id -> Gauge
let pollTimer = null;
let sessionReplay = false; // true when viewing a loaded snapshot
let unlockStates = new Map(); // address -> bool
let secCountdown = null; // interval id for NRC 0x37 retry countdown
let lastDtcs = []; // cached DTCs for CSV export

/* ---------------- status bar ---------------- */
function setStatus(text, isConnected = connected) {
  $("status-text").textContent = text;
  $("status-conn").className = "status-dot " + (isConnected ? "on" : "off");
}
function log(text) {
  $("status-log").textContent = text;
}

/* ---------------- theme toggle ---------------- */
function applyTheme(dark) {
  document.body.dataset.theme = dark ? "dark" : "light";
  $("btn-theme").textContent = dark ? "☀" : "🌙";
  try { localStorage.setItem("beeemuu_dark", dark ? "1" : "0"); } catch (_) {}
}
function toggleTheme() {
  applyTheme(document.body.dataset.theme !== "dark");
}
function loadTheme() {
  let dark = false;
  try { dark = localStorage.getItem("beeemuu_dark") === "1"; } catch (_) {}
  // Respect OS preference if no saved choice
  if (dark || (!localStorage.getItem("beeemuu_dark") && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    applyTheme(true);
  }
}

/* ---------------- persistent settings ---------------- */
function saveSettings() {
  try {
    const s = {
      connKind: $("conn-kind").value,
      connPort: $("conn-port").value,
      connDcan: $("conn-dcan").value,
      connAddr: $("conn-addr").value,
      connOptsOpen: !($("conn-kdcan-opts").classList.contains("hidden") || $("conn-enet-opts").classList.contains("hidden")),
      liveProfile: $("live-profile").value,
      logProfile: $("log-profile").value,
      trafficAuto: $("traffic-auto").checked,
    };
    localStorage.setItem("beeemuu_settings", JSON.stringify(s));
  } catch (_) {}
}
async function loadSettings() {
  try {
    const raw = localStorage.getItem("beeemuu_settings");
    if (raw) {
      const s = JSON.parse(raw);
      if (s.connKind) $("conn-kind").value = s.connKind;
      if (s.connDcan) $("conn-dcan").value = s.connDcan;
      if (s.connAddr) $("conn-addr").value = s.connAddr;
      if (s.liveProfile) $("live-profile").value = s.liveProfile;
      if (s.logProfile) $("log-profile").value = s.logProfile;
      if (typeof s.trafficAuto === "boolean") $("traffic-auto").checked = s.trafficAuto;
      const kind = $("conn-kind").value;
      // Restore the collapsed/expanded connection options state.
      const open = s.connOptsOpen && (kind === "kdcan" || kind === "enet");
      $("conn-kdcan-opts").classList.toggle("hidden", !(open && kind === "kdcan"));
      $("conn-enet-opts").classList.toggle("hidden", !(open && kind === "enet"));
      $("btn-conn-adv").setAttribute("aria-expanded", String(!!open));
      if (kind === "kdcan") {
        await refreshPorts();
        if (s.connPort) $("conn-port").value = s.connPort;
      }
    }
    // Restore mode selection (default Basic).
    let mode = "basic";
    try { const m = localStorage.getItem("beeemuu_mode"); if (m) mode = m; } catch (_) {}
    $("app-mode").value = mode;
  } catch (_) {}
}

/* ---------------- tabs ---------------- */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.classList.contains("hidden")) return; // disabled by current mode
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    $("view-" + tab.dataset.view).classList.add("active");
  });
});

/* ---------------- basic / advanced / developer mode ---------------- */
const MODE_RANK = { basic: 1, advanced: 2, developer: 3 };

function applyMode(mode) {
  const rank = MODE_RANK[mode] || 1;
  document.querySelectorAll(".tab[data-mode]").forEach((tab) => {
    const show = MODE_RANK[tab.dataset.mode] <= rank;
    tab.classList.toggle("hidden", !show);
  });
  // If the active tab is now hidden, fall back to the first visible tab.
  const active = document.querySelector(".tab.active");
  if (!active || active.classList.contains("hidden")) {
    const first = document.querySelector(".tab:not(.hidden)");
    if (first) first.click();
  } else {
    // keep current view in sync (in case view was hidden then shown)
    $("view-" + active.dataset.view).classList.add("active");
  }
  try { localStorage.setItem("beeemuu_mode", mode); } catch (_) {}
}

$("app-mode").addEventListener("change", () => applyMode($("app-mode").value));

/* ---------------- connection options collapse ---------------- */
$("btn-conn-adv").addEventListener("click", () => {
  const kd = $("conn-kdcan-opts");
  const en = $("conn-enet-opts");
  const anyOpen = !kd.classList.contains("hidden") || !en.classList.contains("hidden");
  // Toggle: if anything is open, collapse all; otherwise reveal the options
  // relevant to the currently selected connection kind.
  const kind = $("conn-kind").value;
  if (anyOpen) {
    kd.classList.add("hidden");
    en.classList.add("hidden");
  } else {
    kd.classList.toggle("hidden", kind !== "kdcan");
    en.classList.toggle("hidden", kind !== "enet");
    if (kind === "kdcan") refreshPorts();
  }
  $("btn-conn-adv").setAttribute("aria-expanded", String(!anyOpen));
  saveSettings();
});

/* ---------------- vehicle info share / export menu ---------------- */
$("btn-info-share").addEventListener("click", (e) => {
  e.stopPropagation();
  const menu = $("info-share-menu");
  const open = menu.classList.toggle("hidden");
  $("btn-info-share").setAttribute("aria-expanded", String(!open));
});
document.addEventListener("click", (e) => {
  const menu = $("info-share-menu");
  if (!menu.classList.contains("hidden") && !e.target.closest(".share-export")) {
    menu.classList.add("hidden");
    $("btn-info-share").setAttribute("aria-expanded", "false");
  }
});
document.querySelectorAll("#info-share-menu .share-item").forEach((item) => {
  item.addEventListener("click", () => {
    const action = item.dataset.action;
    if (item.disabled) return;
    $("info-share-menu").classList.add("hidden");
    $("btn-info-share").setAttribute("aria-expanded", "false");
    if (action === "read") doReadVehicle();
    else if (action === "report") doExportReport();
    else if (action === "snapshot") doExportSnapshot();
    else if (action === "secure") doSecureShare();
    else if (action === "story") doGenerateStory();
  });
});

/* ---------------- connection ---------------- */
$("conn-kind").addEventListener("change", async () => {
  const kind = $("conn-kind").value;
  // Only surface the cable/port options if the connection panel is expanded
  // (⚙ Connection clicked). Otherwise keep them collapsed behind the button.
  const advOpen =
    !$("conn-kdcan-opts").classList.contains("hidden") ||
    !$("conn-enet-opts").classList.contains("hidden");
  $("conn-kdcan-opts").classList.toggle("hidden", !(advOpen && kind === "kdcan"));
  $("conn-enet-opts").classList.toggle("hidden", !(advOpen && kind === "enet"));
  if (advOpen && kind === "kdcan") await refreshPorts();
  saveSettings();
});
$("conn-dcan").addEventListener("change", saveSettings);
$("conn-addr").addEventListener("input", saveSettings);

$("btn-theme").addEventListener("click", toggleTheme);

async function refreshPorts() {
  const ports = await invoke("list_ports");
  const sel = $("conn-port");
  sel.innerHTML = "";
  if (ports.length === 0) {
    sel.innerHTML = "<option value=''>No ports found</option>";
  } else {
    for (const p of ports) {
      const o = document.createElement("option");
      o.value = o.textContent = p;
      sel.appendChild(o);
    }
  }
}

function connConfig() {
  const kind = $("conn-kind").value;
  if (kind === "kdcan") {
    const dcanVal = $("conn-dcan").value;
    if (dcanVal === "auto") {
      return { kind: "kdcan_auto", port: $("conn-port").value };
    }
    return { kind: "kdcan", port: $("conn-port").value, dcan: dcanVal === "true" };
  }
  if (kind === "enet") {
    return { kind: "enet", addr: $("conn-addr").value.trim() };
  }
  return { kind: "sim" };
}

$("btn-connect").addEventListener("click", async () => {
  if (connected) {
    stopPolling();
    stopWatch();
    clearSecCountdown();
    unlockStates.clear();
    await invoke("disconnect");
    connected = false;
    sessionReplay = false;
    modules = [];
    selectedAddress = null;
    lastVehicleInfo = null;
    lastTraffic = [];
    $("btn-connect").textContent = "Connect";
    $("btn-connect").classList.add("btn-primary");
    $("vehicle-banner").innerHTML = "<span class='vehicle-label'>No vehicle connected</span>";
    setStatus("Disconnected");
    renderTree();
    return;
  }
  if (sessionReplay) {
    sessionReplay = false;
    modules = [];
    selectedAddress = null;
    lastVehicleInfo = null;
    lastTraffic = [];
    $("ecu-tree").innerHTML = "<li class='tree-empty'>Connect and run a vehicle test to identify control units.</li>";
    $("fault-rows").innerHTML = "<tr><td colspan='3' class='muted'>Select a control unit.</td></tr>";
    $("info-body").innerHTML = "<p class='muted'>Connect and click 'Read vehicle' to read VIN, decode it, and read mileage.</p>";
    $("traffic-rows").innerHTML = "<tr><td colspan='6' class='muted'>No traffic yet. Connect and interact with the car.</td></tr>";
    $("btn-connect").textContent = "Connect";
    $("btn-connect").classList.add("btn-primary");
    $("vehicle-banner").innerHTML = "<span class='vehicle-label'>No vehicle connected</span>";
    setStatus("Disconnected");
    return;
  }
  try {
    setStatus("Connecting…", false);
    const info = await invoke("connect", { config: connConfig() });
    connected = true;
    $("btn-connect").textContent = "Disconnect";
    const vin = info.vin ? `VIN ${info.vin}` : "VIN unavailable";
    $("vehicle-banner").innerHTML =
      `<span class='vehicle-label'>${info.transport_name} &nbsp;·&nbsp; ${vin}</span>`;
    setStatus("Connected via " + info.transport_name);
    log("");
    // Auto-select suggested profile if available
    if (info.suggested_profile) {
      const liveSel = $("live-profile");
      const logSel = $("log-profile");
      // Only switch if the profile exists in the dropdown
      const exists = Array.from(liveSel.options).some((o) => o.value === info.suggested_profile);
      if (exists) {
        liveSel.value = info.suggested_profile;
        logSel.value = info.suggested_profile;
        // Trigger change to rebuild gauges / log params
        liveSel.dispatchEvent(new Event("change"));
        log("Auto-selected profile: " + info.suggested_profile);
      }
    }
    saveSettings();
  } catch (e) {
    setStatus("Disconnected");
    log("Connect failed: " + e);
  }
});

/* ---------------- vehicle test / module tree ---------------- */
$("btn-scan").addEventListener("click", async () => {
  if (!connected) { log("Connect first."); return; }
  setStatus("Vehicle test running…");
  $("ecu-tree").innerHTML = "<li class='tree-empty'>Identifying control units…</li>";
  try {
    modules = await invoke("scan_modules");
    const status = await invoke("security_status");
    unlockStates = new Map(status.map((s) => [s.address, s.unlocked]));
    renderTree();
    fillExplorerEcus();
    fillSecurityEcus();
    const found = modules.filter((m) => m.present).length;
    setStatus(`Vehicle test complete — ${found} control units found`);
  } catch (e) {
    log("Scan failed: " + e);
    setStatus("Connected");
  }
});

function renderTree() {
  const ul = $("ecu-tree");
  ul.innerHTML = "";
  for (const m of modules) {
    const li = document.createElement("li");
    const div = document.createElement("div");
    div.className = "ecu-item" + (m.present ? "" : " absent") +
      (m.address === selectedAddress ? " selected" : "");
    const faults = m.fault_count ?? 0;
    const statusCls = !m.present ? "" : faults > 0 ? "faults" : "ok";
    const isUnlocked = unlockStates.get(m.address) ?? false;
    const secIcon = m.present
      ? `<span class="sec-icon ${isUnlocked ? "sec-icon-unlocked" : "sec-icon-locked"}" title="${isUnlocked ? "Unlocked" : "Locked"}">${isUnlocked ? "🔓" : "🔒"}</span>`
      : "";
    div.innerHTML =
      `<span class="ecu-status ${statusCls}"></span>` +
      `<span class="ecu-name">${m.name}</span>` +
      secIcon +
      `<span class="ecu-desc">${m.description}</span>` +
      (m.present && faults > 0 ? `<span class="ecu-badge">${faults}</span>` : "");
    if (m.present) {
      div.addEventListener("click", () => selectModule(m.address));
    }
    li.appendChild(div);
    ul.appendChild(li);
  }
}

async function selectModule(address) {
  selectedAddress = address;
  renderTree();
  const m = modules.find((x) => x.address === address);
  $("detail-title").textContent = `Fault memory — ${m.name}`;
  const identEl = $("ecu-ident");
  identEl.textContent = m.ident || "";
  identEl.classList.toggle("hidden", !m.ident);
  $("btn-read-faults").disabled = false;
  $("btn-export-faults").disabled = false;
  $("btn-clear-faults").disabled = sessionReplay;
  $("freeze-panel").classList.add("hidden");
  showObdPidPanel();
  await readFaults();
  await loadOracle(address);
}

async function readFaults() {
  if (selectedAddress == null) return;
  const tbody = $("fault-rows");
  tbody.innerHTML = "<tr><td colspan='3' class='muted'>Reading…</td></tr>";

  // In session replay, faults are already in the module data.
  if (sessionReplay) {
    const m = modules.find((x) => x.address === selectedAddress);
    const dtcs = m?.dtcs || [];
    lastDtcs = dtcs;
    if (dtcs.length === 0) {
      tbody.innerHTML = "<tr><td colspan='3' class='fault-ok'>No faults stored.</td></tr>";
      return;
    }
    tbody.innerHTML = "";
    for (const d of dtcs) {
      const tr = document.createElement("tr");
      tr.className = "fault-clickable";
      tr.innerHTML =
        `<td class="fault-code">${d.code}</td>` +
        `<td>${d.text}</td>` +
        `<td class="muted">${d.status_text}</td>`;
      tr.addEventListener("click", () => showFreezeFrame(d.code));
      tbody.appendChild(tr);
    }
    return;
  }

  try {
    const dtcs = await invoke("read_faults", { address: selectedAddress });
    lastDtcs = dtcs;
    if (dtcs.length === 0) {
      tbody.innerHTML = "<tr><td colspan='3' class='fault-ok'>No faults stored.</td></tr>";
      return;
    }
    tbody.innerHTML = "";
    for (const d of dtcs) {
      const tr = document.createElement("tr");
      tr.className = "fault-clickable";
      tr.innerHTML =
        `<td class="fault-code">${d.code}</td>` +
        `<td>${d.text}</td>` +
        `<td class="muted">${d.status_text}</td>`;
      tr.addEventListener("click", () => showFreezeFrame(d.code));
      tbody.appendChild(tr);
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan='3' class='muted'>Read failed: ${e}</td></tr>`;
  }
}

async function showFreezeFrame(code) {
  const panel = $("freeze-panel");
  const body = $("freeze-body");
  $("freeze-code").textContent = code;
  body.innerHTML = "<span class='muted'>Reading…</span>";
  panel.classList.remove("hidden");
  try {
    let items;
    if (sessionReplay) {
      const m = modules.find((x) => x.address === selectedAddress);
      const dtc = m?.dtcs?.find((d) => d.code === code);
      items = dtc?.freeze_frame || [];
    } else {
      items = await invoke("read_freeze_frame", { address: selectedAddress, code });
    }
    body.innerHTML = "";
    if (items.length === 0) {
      body.innerHTML = "<span class='muted'>No freeze frame available.</span>";
    } else {
      for (const it of items) {
        const cell = document.createElement("div");
        cell.className = "freeze-item";
        cell.innerHTML = `<div class="fi-label">${it.label}</div><div class="fi-value">${it.value}</div>`;
        body.appendChild(cell);
      }
    }
  } catch (e) {
    body.innerHTML = `<span class='muted'>No freeze frame available (${e})</span>`;
  }
  // Also load second opinion + schematics for this DTC. These are
  // async and independent of each other; we run them both and the UI
  // surfaces each panel as data arrives.
  await Promise.all([
    loadOpinion(code),
    loadSchematics(code),
  ]);
}

/* ---------- related schematics (CC0 wiring diagrams) ----------
 *
 * Renders the cross-link list for the active DTC into the
 * #schematics-panel. The panel is mounted in index.html below the
 * freeze-frame and second-opinion panels. The Tauri command
 * `fetch_dtc_schematics` calls the hosted backend over HTTPS; on
 * error (network or 4xx) the panel degrades gracefully with a
 * one-line message.
 */
async function loadSchematics(code) {
  const panel = $("schematics-panel");
  const body = $("schematics-body");
  const codeEl = $("schematics-code");
  if (!panel || !body) return;
  panel.classList.remove("hidden");
  codeEl.textContent = code || "";
  body.innerHTML = "<span class='muted'>Looking up related wiring diagrams…</span>";
  try {
    const result = await invoke("fetch_dtc_schematics", { code });
    renderSchematics(result);
  } catch (e) {
    body.innerHTML =
      `<span class='sch-error'>Schematics unavailable: ${escapeHtml(String(e))}</span>`;
  }
}

function renderSchematics(result) {
  const body = $("schematics-body");
  const code = (result?.code || "").toUpperCase();
  const items = result?.results || [];
  if (!items.length) {
    body.innerHTML =
      `<span class='sch-empty'>No CC0 schematics curated for ${escapeHtml(code)} yet.</span>`;
    return;
  }
  const cards = items.map((r) => {
    const title = r.schematic?.title || r.schematic_slug || "(unknown)";
    const meta = [
      r.schematic?.series,
      r.schematic?.system,
      yearRange(r.schematic),
    ].filter(Boolean).join(" · ");
    const license = r.schematic?.license || "CC0";
    // The relative URL the API hands back is relative to api.beemuu.com.
    // For the desktop app, we want to open it in the user's browser;
    // we don't try to render the SVG inline (out of scope for the
    // sidebar — that's the hosted schematics viewer's job).
    const rawUrl = r.schematic?.url || "";
    const absoluteUrl = rawUrl.startsWith("http")
      ? rawUrl
      : `https://api.beemuu.com${rawUrl}`;
    const note = r.note ? `<div class="sch-note">"${escapeHtml(r.note)}"</div>` : "";
    const dtcMissing = r.dtc === null;
    const linkClass = dtcMissing ? "sch-link disabled" : "sch-link";
    const linkAttrs = dtcMissing
      ? `aria-disabled="true" title="Referenced DTC not yet in catalog"`
      : `target="_blank" rel="noopener"`;
    const linkTitle = dtcMissing
      ? "Referenced DTC not yet in catalog"
      : `Open ${title} (${license})`;
    return `
      <li class="sch-card">
        <div class="sch-title">${escapeHtml(title)}</div>
        <a class="${escapeHtml(linkClass)}" ${linkAttrs} href="${escapeHtml(absoluteUrl)}" title="${escapeHtml(linkTitle)}">Open</a>
        <div class="sch-meta">${escapeHtml(meta)} · ${escapeHtml(license)}</div>
        ${note}
      </li>`;
  }).join("");
  body.innerHTML = `<ul class="sch-list">${cards}</ul>`;
}

function yearRange(s) {
  if (!s) return "";
  if (s.year_from && s.year_to) return `${s.year_from}–${s.year_to}`;
  if (s.year_from) return `${s.year_from}–`;
  if (s.year_to) return `–${s.year_to}`;
  return "";
}

async function loadOpinion(code) {
  const panel = $("opinion-panel");
  const body = $("opinion-body");
  panel.classList.remove("hidden");
  body.innerHTML = "<span class='muted'>Loading perspectives…</span>";
  try {
    const dtc = lastDtcs.find((d) => d.code === code);
    const dtcText = dtc?.text || "";
    const result = await invoke("get_opinions", { dtcCode: code, dtcText: dtcText });
    renderOpinion(result);
  } catch (e) {
    body.innerHTML = `<span class='muted'>No opinions available: ${e}</span>`;
  }
}

function renderOpinion(result) {
  const body = $("opinion-body");
  if (!result.perspectives || result.perspectives.length === 0) {
    body.innerHTML = `<span class='muted'>No community opinions yet for ${escapeHtml(result.dtc_code)}. Be the first to contribute one!</span>`;
    return;
  }
  let html = '<div class="opinion-tabs">';
  const perspectives = ["diy", "indie", "dealer"];
  for (const p of perspectives) {
    const has = result.perspectives.some((o) => o.perspective === p);
    if (has) {
      html += `<button class="opinion-tab ${p === 'diy' ? 'active' : ''}" data-pov="${p}" onclick="switchOpinionTab(this)">${p.toUpperCase()}</button>`;
    }
  }
  html += '</div>';
  html += '<div class="opinion-cards">';
  for (const o of result.perspectives) {
    const cost = o.cost_usd ? ` · ~$${o.cost_usd}` : '';
    const time = o.time_estimate ? ` · ${escapeHtml(o.time_estimate)}` : '';
    const diff = o.difficulty ? ` · ${escapeHtml(o.difficulty)}` : '';
    const source = o.source_url
      ? `<a href="${escapeHtml(o.source_url)}" target="_blank" class="op-source">${escapeHtml(o.source)}</a>`
      : `<span class="op-source">${escapeHtml(o.source)}</span>`;
    html += `<div class="opinion-card op-card-${o.perspective}">
      <div class="op-perspective op-perspective-${o.perspective}">${o.perspective.toUpperCase()}</div>
      <div class="op-action">${escapeHtml(o.action)}</div>
      <div class="op-meta">${cost}${time}${diff}</div>
      <div class="op-note">${escapeHtml(o.note)}</div>
      ${source}
    </div>`;
  }
  html += '</div>';
  body.innerHTML = html;
}

function switchOpinionTab(btn) {
  const pov = btn.dataset.pov;
  const body = $("opinion-body");
  body.querySelectorAll(".opinion-tab").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  body.querySelectorAll(".opinion-card").forEach((c) => {
    c.style.display = c.classList.contains(`op-card-${pov}`) ? "block" : "none";
  });
}

/* ---------- secure snapshot share ---------- */

async function doSecureShare() {
  if (!connected && !sessionReplay) { log("Connect first or load a session."); return; }
  try {
    setStatus("Preparing secure share…");
    const json = await invoke("export_session");
    const snapshot = JSON.parse(json);
    const anon = await invoke("anonymize_snapshot", { snapshot });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const path = await invoke("export_text", {
      filename: `beeemuu-secure-${stamp}.json`,
      content: anon
    });
    log("Secure snapshot saved: " + path);
    setStatus(sessionReplay ? "Session replay (offline)" : "Connected");
  } catch (e) {
    log("Secure share failed: " + e);
    setStatus(sessionReplay ? "Session replay (offline)" : "Connected");
  }
}

$("btn-read-faults").addEventListener("click", readFaults);

/* ---------------- OBD-II PID scan ---------------- */
// Show the OBD-II panel only when a present ECU is selected. Hidden
// alongside the rest of the detail panels when nothing is selected.
function showObdPidPanel() {
  const panel = $("obd-pid-panel");
  if (!panel) return;
  const present = modules.find((m) => m.address === selectedAddress)?.present;
  panel.classList.toggle("hidden", !present);
}

$("btn-obd-pid-scan").addEventListener("click", async () => {
  if (selectedAddress == null) { log("Select a control unit first."); return; }
  if (!connected) { log("Connect first."); return; }
  showObdPidPanel();
  const body = $("obd-pid-body");
  body.innerHTML = `<span class="muted">Scanning OBD-II PIDs on 0x${selectedAddress.toString(16).toUpperCase().padStart(2, "0")}…</span>`;
  try {
    const pids = await invoke("list_supported_pids", { address: selectedAddress });
    if (!pids || pids.length === 0) {
      body.innerHTML = `<span class="muted">No OBD-II PIDs responded. The ECU may not implement mode 01 (BMW-specific DME modules often don't), or the adapter is not in OBD-II mode.</span>`;
      return;
    }
    const cells = pids
      .map((p) => `<span class="obd-pid-cell" title="PID 0x${p.toString(16).toUpperCase().padStart(2, "0")}">0x${p.toString(16).toUpperCase().padStart(2, "0")}</span>`)
      .join("");
    body.innerHTML = `<span>${pids.length} PID${pids.length === 1 ? "" : "s"} responded:</span><div class="obd-pid-grid">${cells}</div>`;
    log(`OBD-II scan complete: ${pids.length} PID(s) supported on 0x${selectedAddress.toString(16).toUpperCase().padStart(2, "0")}`);
  } catch (e) {
    body.innerHTML = `<span class="muted">Scan failed: ${e}</span>`;
    log("OBD-II scan failed: " + e);
  }
});

$("btn-clear-faults").addEventListener("click", async () => {
  if (selectedAddress == null) return;
  if (sessionReplay) { log("Cannot clear faults in session replay."); return; }
  const m = modules.find((x) => x.address === selectedAddress);
  if (!confirm(`Clear the fault memory of ${m.name}? Stored freeze-frame data will be lost.`)) return;
  try {
    await invoke("clear_faults", { address: selectedAddress });
    log(`${m.name}: fault memory cleared`);
    m.fault_count = 0;
    renderTree();
    await readFaults();
  } catch (e) {
    log("Clear failed: " + e);
  }
});

$("btn-export-faults").addEventListener("click", async () => {
  if (selectedAddress == null || !lastDtcs.length) { log("No faults to export."); return; }
  const m = modules.find((x) => x.address === selectedAddress);
  let csv = "Code,Description,Status,StatusHex\n";
  for (const d of lastDtcs) {
    csv += `${d.code},"${d.text}","${d.status_text}",0x${d.status.toString(16).toUpperCase().padStart(2, "0")}\n`;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  try {
    const path = await invoke("export_text", { filename: `beeemuu-dtcs-${m.name}-${stamp}.csv`, content: csv });
    log("Saved: " + path);
  } catch (e) {
    log("Export failed: " + e);
  }
});

/* ---------------- community oracle ---------------- */
async function loadOracle(address) {
  const panel = $("oracle-panel");
  const body = $("oracle-body");
  const m = modules.find((x) => x.address === address);
  if (!m || !(m.fault_count > 0)) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  body.innerHTML = "<span class='muted'>Querying community knowledge base…</span>";
  try {
    const result = await invoke("query_oracle", { address });
    renderOracle(result);
  } catch (e) {
    body.innerHTML = `<span class='muted'>Oracle offline: ${e}</span>`;
  }
}

function renderOracle(result) {
  const body = $("oracle-body");
  if (result.match_count === 0) {
    body.innerHTML = `<span class='muted'>No community patterns yet for this DTC set. If you fix it, contribute your outcome!</span>`;
    return;
  }
  let html = `<div class="oracle-stats">${result.match_count} similar case${result.match_count !== 1 ? 's' : ''}`;
  if (result.exact_matches > 0) {
    html += ` · ${result.exact_matches} exact match${result.exact_matches !== 1 ? 'es' : ''}`;
  }
  html += '</div>';
  html += '<div class="oracle-outcomes">';
  for (const o of result.outcomes) {
    const cost = o.cost_estimate_usd ? ` · ~$${o.cost_estimate_usd}` : '';
    const parts = o.part_numbers && o.part_numbers.length ? `<div class="fix-parts">Parts: ${o.part_numbers.join(', ')}</div>` : '';
    html += `<div class="oracle-fix">
      <div class="fix-cat">${escapeHtml(o.fix_category)}</div>
      <div class="fix-meta">Confidence: ${o.confidence}%${cost}</div>
      ${parts}
      <div class="fix-note">${escapeHtml(o.note)}</div>
    </div>`;
  }
  html += '</div>';
  if (result.forum_threads && result.forum_threads.length) {
    html += '<div class="oracle-forums"><strong>Sources:</strong> ';
    html += result.forum_threads.map(f => `<a class="oracle-forum-link" href="${escapeHtml(f.url)}" target="_blank">${escapeHtml(f.title)}</a>`).join(' · ');
    html += '</div>';
  }
  body.innerHTML = html;
}

/* ---------------- live data ---------------- */
function ensureGauge(v) {
  if (gauges.has(v.id)) return gauges.get(v.id);
  const cell = document.createElement("div");
  cell.className = "gauge-cell";
  const canvas = document.createElement("canvas");
  const label = document.createElement("div");
  label.className = "gauge-label";
  label.textContent = v.label;
  cell.appendChild(canvas);
  cell.appendChild(label);
  $("gauge-grid").appendChild(cell);
  const g = new Gauge(canvas, v);
  gauges.set(v.id, g);
  // v0.5.0 PR #3 — set the initial severity class on the gauge
  // cell based on the current v.text. The Gauge's draw() method
  // will keep this in sync as the text changes (see gauges.js).
  const sev = window.LiveFormat.severityClass(v.text);
  if (sev) {
    cell.classList.add(sev);
    label.classList.add(sev);
  }
  return g;
}

async function loadProfiles() {
  const profiles = await invoke("list_profiles");
  const sel = $("live-profile");
  sel.innerHTML = "";
  for (const p of profiles) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.label;
    sel.appendChild(o);
  }
}

$("live-profile").addEventListener("change", () => {
  // different profile = different parameter set: rebuild gauges
  gauges.clear();
  $("gauge-grid").innerHTML = "";
  saveSettings();
});

async function pollOnce() {
  try {
    const values = await invoke("read_live_data", { profile: $("live-profile").value });
    for (const v of values) {
      // Enum params (gear, engine state, etc.) have v.text set and
      // v.value = 0.0; numeric params have v.text undefined. The
      // Gauge renders text when given a label override.
      ensureGauge(v).set(v.value, v.text);
    }
  } catch (e) {
    log("Live data: " + e);
    stopPolling();
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollOnce, 250);
  pollOnce();
}
function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
  $("live-poll").checked = false;
}

$("live-poll").addEventListener("change", (e) => {
  if (e.target.checked) {
    if (!connected) { log("Connect first."); stopPolling(); return; }
    startPolling();
  } else {
    stopPolling();
  }
});

/* needle easing loop */
(function animate() {
  for (const g of gauges.values()) g.tick();
  requestAnimationFrame(animate);
})();

/* ---------------- service functions ---------------- */
async function loadServiceFunctions() {
  const list = await invoke("list_service_functions");
  const el = $("service-list");
  el.innerHTML = "";
  // v0.4.0: each ServiceFunction carries a list of routines
  // (one per module address). Render one row per (service,
  // routine) pair so a single service that exists on multiple
  // modules shows one button per module. moduleIndex goes to
  // the backend so it can pick the right target + routine.
  for (const sf of list) {
    for (let i = 0; i < sf.routines.length; i++) {
      const r = sf.routines[i];
      const item = document.createElement("div");
      item.className = "service-item";
      const labelWithModule = sf.routines.length > 1
        ? `${sf.label} (${r.moduleLabel})`
        : sf.label;
      item.innerHTML =
        `<div class="service-info">` +
        `<div class="service-label">${labelWithModule}</div>` +
        `<div class="service-desc">${sf.description}</div>` +
        `</div>` +
        `<span class="risk-tag risk-${sf.risk}">${sf.risk === "high" ? "ACTUATES HARDWARE" : "RESET"}</span>`;
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Run";
      btn.addEventListener("click", async () => {
        if (!connected) { log("Connect first."); return; }
        const warning = sf.risk === "high"
          ? `"${labelWithModule}" actuates vehicle hardware.\n\n${sf.description}\n\nProceed?`
          : `Run "${labelWithModule}"?`;
        if (!confirm(warning)) return;
        btn.disabled = true;
        try {
          const msg = await invoke("run_service_function", {
            id: sf.id,
            moduleIndex: i,
          });
          log(msg);
        } catch (e) {
          log("Service function failed: " + e);
        } finally {
          btn.disabled = false;
        }
      });
      item.appendChild(btn);
      el.appendChild(item);
    }
  }
}

/* ---------------- parameter explorer ---------------- */
let watchTimer = null;
let watchTarget = null; // { address, mode, id }

function fillExplorerEcus() {
  const sel = $("exp-address");
  sel.innerHTML = "";
  const list = modules.filter((m) => m.present);
  const src = list.length
    ? list
    : [{ address: 0x12, name: "DME", description: "Engine control" }];
  for (const m of src) {
    const o = document.createElement("option");
    o.value = m.address;
    o.textContent = `${m.name} (0x${m.address.toString(16).toUpperCase().padStart(2, "0")})`;
    sel.appendChild(o);
  }
}

$("btn-probe").addEventListener("click", async () => {
  if (!connected) { log("Connect first."); return; }
  const start = parseInt($("exp-start").value, 16);
  const end = parseInt($("exp-end").value, 16);
  if (isNaN(start) || isNaN(end)) { log("Enter a hex range, e.g. 00 to FF."); return; }
  const mode = $("exp-mode").value;
  const address = parseInt($("exp-address").value, 10);
  const ul = $("exp-results");
  ul.innerHTML = "<li class='tree-empty'>Scanning… (each dead ident waits for a timeout, be patient)</li>";
  setStatus("Probing identifiers…");
  try {
    const results = await invoke("probe_range", { address, mode, start, end });
    ul.innerHTML = results.length ? "" : "<li class='tree-empty'>Nothing answered in this range.</li>";
    for (const r of results) {
      const li = document.createElement("li");
      const div = document.createElement("div");
      div.className = "exp-result-item";
      const idHex = r.id.toString(16).toUpperCase().padStart(mode === "did" ? 4 : 2, "0");
      div.innerHTML =
        `<span class="exp-result-id">${idHex}</span>` +
        `<span class="exp-result-hex">${r.hex}</span>`;
      div.addEventListener("click", () => startWatch(address, mode, r.id, div));
      li.appendChild(div);
      ul.appendChild(li);
    }
    setStatus(`Probe complete — ${results.length} identifiers answered`);
  } catch (e) {
    ul.innerHTML = `<li class='tree-empty'>Probe failed: ${e}</li>`;
    setStatus("Connected");
  }
});

async function startWatch(address, mode, id, itemEl) {
  document.querySelectorAll(".exp-result-item").forEach((el) => el.classList.remove("selected"));
  itemEl.classList.add("selected");
  watchTarget = { address, mode, id };
  const idHex = id.toString(16).toUpperCase().padStart(mode === "did" ? 4 : 2, "0");
  $("exp-watch-title").textContent = `Watch — ${mode} ${idHex}`;
  $("exp-watch-poll").checked = true;
  $("exp-add-panel").classList.remove("hidden");
  $("exp-add-status").textContent = "";
  await fillAddProfileDropdown();
  $("exp-add-label").value = "";
  $("exp-add-unit").value = "";
  $("exp-add-min").value = 0;
  $("exp-add-max").value = 255;
  try {
    await invoke("watch_start", { address, mode, id });
  } catch (e) {
    log("Watch start: " + e);
    $("exp-add-panel").classList.add("hidden");
    return;
  }
  if (!watchTimer) watchTimer = setInterval(watchOnce, 300);
  watchOnce();
}

async function fillAddProfileDropdown() {
  const profiles = await invoke("list_profiles");
  const sel = $("exp-add-profile");
  sel.innerHTML = "";
  for (const p of profiles) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.label;
    sel.appendChild(o);
  }
}

$("btn-add-to-profile").addEventListener("click", async () => {
  if (!watchTarget) return;
  const spec = {
    label: $("exp-add-label").value.trim(),
    unit: $("exp-add-unit").value.trim(),
    address: watchTarget.address,
    mode: watchTarget.mode,
    id: watchTarget.id,
    decode: $("exp-add-decode").value,
    min: parseFloat($("exp-add-min").value) || 0,
    max: parseFloat($("exp-add-max").value) || 255,
  };
  if (!spec.label) { $("exp-add-status").textContent = "Enter a label."; return; }
  try {
    await invoke("add_to_profile", { profileId: $("exp-add-profile").value, spec });
    $("exp-add-status").textContent = "Added.";
    // Refresh profile selectors so the new param is available.
    await Promise.all([loadProfiles(), loadLogProfiles(), fillShareProfiles()]);
  } catch (e) {
    $("exp-add-status").textContent = "Error: " + e;
  }
});

async function watchOnce() {
  if (!watchTarget) return;
  try {
    const snap = await invoke("watch_tick");
    renderWatch(snap);
  } catch (e) {
    log("Watch: " + e);
    stopWatch();
  }
}

// Render the byte-diff heatmap. Volatility drives the accent bar + color:
// bytes that change often (live signals) glow; static bytes stay grey.
function renderWatch(snap) {
  const el = $("exp-watch-bytes");
  el.innerHTML = "";
  $("exp-watch-title").dataset.samples = snap.samples;
  const head = document.createElement("div");
  head.className = "watch-summary";
  head.textContent = `${snap.samples} samples · ${snap.bytes.length} bytes · sorted by position`;
  el.appendChild(head);
  const grid = document.createElement("div");
  grid.className = "watch-grid";
  for (const b of snap.bytes) {
    const pct = Math.round(b.volatility * 100);
    const hot = b.volatility > 0.02;
    const cell = document.createElement("div");
    cell.className = "watch-byte" + (hot ? " hot" : "");
    // accent bar height reflects volatility; hue shifts grey→orange
    const barColor = hot ? `hsl(${28 - b.volatility * 10}, 90%, 55%)` : "#c3ccd6";
    cell.innerHTML =
      `<div class="wb-hex">${b.last.toString(16).toUpperCase().padStart(2, "0")}</div>` +
      `<div class="wb-dec">${b.last}</div>` +
      `<div class="wb-bar"><span style="height:${Math.max(3, pct)}%;background:${barColor}"></span></div>` +
      `<div class="wb-meta">${pct}% · Δ${b.mean_delta.toFixed(1)}</div>` +
      `<div class="wb-meta">${b.min}–${b.max}</div>` +
      `<div class="wb-idx">[${b.offset}]</div>`;
    grid.appendChild(cell);
  }
  el.appendChild(grid);
}

function stopWatch() {
  clearInterval(watchTimer);
  watchTimer = null;
  $("exp-watch-poll").checked = false;
  $("exp-add-panel").classList.add("hidden");
  invoke("watch_stop").catch(() => {});
}

$("exp-watch-poll").addEventListener("change", (e) => {
  if (e.target.checked) {
    if (!watchTarget) { e.target.checked = false; return; }
    if (!watchTimer) watchTimer = setInterval(watchOnce, 300);
  } else {
    stopWatch();
  }
});

/* ---------------- freeze-frame schema builder ---------------- */
let schemaFields = [];
let schemaAddress = 0x12;
let lastSchemaHex = null;

function openSchemaBuilder() {
  $("schema-builder").classList.remove("hidden");
  const addr = watchTarget ? watchTarget.address : parseInt($("exp-address").value, 10);
  schemaAddress = addr;
  $("schema-address").value = addr.toString(16).toUpperCase().padStart(2, "0");
  loadSchemaFromBackend();
}

function closeSchemaBuilder() {
  $("schema-builder").classList.add("hidden");
}

async function loadSchemaFromBackend() {
  try {
    const defs = await invoke("get_freeze_schema", { address: schemaAddress });
    if (defs && defs.length) {
      schemaFields = defs;
    } else {
      schemaFields = [];
    }
    renderSchemaFields();
  } catch (e) {
    log("Schema load: " + e);
  }
}

function renderSchemaFields() {
  const container = $("schema-fields");
  container.innerHTML = "";
  for (let i = 0; i < schemaFields.length; i++) {
    const f = schemaFields[i];
    const row = document.createElement("div");
    row.className = "schema-field-row";
    row.innerHTML =
      `<input class="sf-label" type="text" value="${escapeHtml(f.label)}" placeholder="label" />` +
      `<input class="sf-unit" type="text" value="${escapeHtml(f.unit)}" placeholder="unit" />` +
      `<input class="sf-offset" type="number" value="${f.offset}" min="0" placeholder="offset" />` +
      `<select class="sf-width">` +
      `<option value="u8" ${f.width === "u8" ? "selected" : ""}>u8</option>` +
      `<option value="i8" ${f.width === "i8" ? "selected" : ""}>i8</option>` +
      `<option value="u16" ${f.width === "u16" ? "selected" : ""}>u16</option>` +
      `<option value="i16" ${f.width === "i16" ? "selected" : ""}>i16</option>` +
      `<option value="u24" ${f.width === "u24" ? "selected" : ""}>u24</option>` +
      `</select>` +
      `<input type="number" step="any" value="${f.scale}" placeholder="scale" />` +
      `<input type="number" step="any" value="${f.bias}" placeholder="bias" />` +
      `<input class="sf-decimals" type="number" value="${f.decimals}" min="0" max="6" placeholder="dec" />` +
      `<button class="btn btn-small btn-danger" data-idx="${i}">×</button>`;
    row.querySelector("button").addEventListener("click", () => {
      schemaFields.splice(i, 1);
      renderSchemaFields();
    });
    container.appendChild(row);
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function addSchemaField() {
  schemaFields.push({
    label: "New field",
    unit: "",
    offset: 0,
    width: "u8",
    scale: 1.0,
    bias: 0.0,
    decimals: 0,
  });
  renderSchemaFields();
}

function collectSchemaFields() {
  const rows = document.querySelectorAll(".schema-field-row");
  const fields = [];
  for (const row of rows) {
    const inputs = row.querySelectorAll("input, select");
    fields.push({
      label: inputs[0].value,
      unit: inputs[1].value,
      offset: parseInt(inputs[2].value, 10) || 0,
      width: inputs[3].value,
      scale: parseFloat(inputs[4].value) || 0,
      bias: parseFloat(inputs[5].value) || 0,
      decimals: parseInt(inputs[6].value, 10) || 0,
    });
  }
  return fields;
}

async function readSchemaFreeze() {
  if (!connected) { log("Connect first."); return; }
  const addr = parseInt($("schema-address").value, 16);
  const code = $("schema-dtc").value.trim().toUpperCase();
  schemaAddress = addr;
  try {
    const items = await invoke("read_freeze_frame", { address: addr, code });
    const raw = items.find((it) => it.label === "Raw");
    if (raw) {
      $("schema-hex").textContent = raw.value;
      lastSchemaHex = raw.value.split(" ").map((h) => parseInt(h, 16));
    } else {
      $("schema-hex").textContent = "No raw data";
      lastSchemaHex = null;
    }
  } catch (e) {
    $("schema-hex").textContent = "Read failed: " + e;
    lastSchemaHex = null;
  }
}

async function previewSchema() {
  if (!connected) { log("Connect first."); return; }
  const addr = parseInt($("schema-address").value, 16);
  const code = $("schema-dtc").value.trim().toUpperCase();
  const fields = collectSchemaFields();
  try {
    const items = await invoke("preview_freeze_frame", { address: addr, code, fields });
    const container = $("schema-preview");
    container.innerHTML = "";
    for (const it of items) {
      const cell = document.createElement("div");
      cell.className = "freeze-item";
      cell.innerHTML = `<div class="fi-label">${escapeHtml(it.label)}</div><div class="fi-value">${escapeHtml(it.value)}</div>`;
      container.appendChild(cell);
    }
  } catch (e) {
    $("schema-preview").innerHTML = `<span class="muted">Preview failed: ${e}</span>`;
  }
}

async function saveSchema() {
  const addr = parseInt($("schema-address").value, 16);
  const fields = collectSchemaFields();
  try {
    await invoke("save_freeze_schema", { address: addr, fields });
    log(`Schema saved for 0x${addr.toString(16).toUpperCase().padStart(2, "0")}`);
  } catch (e) {
    log("Save schema failed: " + e);
  }
}

async function reloadSchemas() {
  try {
    const count = await invoke("load_freeze_schemas");
    log(`Reloaded ${count} freeze schema(s)`);
    await loadSchemaFromBackend();
    await previewSchema();
  } catch (e) {
    log("Reload schemas failed: " + e);
  }
}

$("btn-map-freeze").addEventListener("click", openSchemaBuilder);
$("btn-schema-close").addEventListener("click", closeSchemaBuilder);
$("btn-schema-add").addEventListener("click", addSchemaField);
$("btn-schema-read").addEventListener("click", readSchemaFreeze);
$("btn-schema-preview").addEventListener("click", previewSchema);
$("btn-schema-save").addEventListener("click", saveSchema);
$("btn-schema-load").addEventListener("click", reloadSchemas);

/* ---------------- logging + charts ---------------- */
const LOG_COLORS = ["#4da3ff", "#ff7d33", "#3ddc84", "#e05545", "#c084fc",
                    "#f4b400", "#26c6da", "#ec407a", "#9ccc65", "#8d6e63"];
let logChart = null;
let logTimer = null;
let logStart = 0;
const MAX_LOG_POINTS = 10000;

class LogSeries {
  constructor(label, unit, color, enabled = true, maxPoints = MAX_LOG_POINTS) {
    this.label = label;
    this.unit = unit;
    this.color = color;
    this.enabled = enabled;
    this.maxPoints = maxPoints;
    this.data = [];
    this.buffer = [];
  }
  push(point) {
    if (this.data.length >= this.maxPoints) this.data.shift();
    this.data.push(point);
  }
  bufferPush(point) {
    this.buffer.push(point);
  }
  flushBuffer() {
    for (const p of this.buffer) this.push(p);
    this.buffer = [];
  }
  clear() {
    this.data.length = 0;
    this.buffer.length = 0;
  }
  getData(upToTime = null) {
    if (upToTime === null || this.data.length === 0) return this.data;
    let lo = 0, hi = this.data.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.data[mid].x <= upToTime) lo = mid + 1;
      else hi = mid;
    }
    return this.data.slice(0, lo);
  }
  getAllData() {
    return [...this.data, ...this.buffer];
  }
}

class LogSession extends Map {
  constructor() {
    super();
    this.markers = [];
    this.startTime = 0;
    this.paused = false;
    this.scrubTime = 0;
    this.wasPlaying = false;
  }
  get totalDuration() {
    let maxT = 0;
    for (const s of this.values()) {
      const all = s.getAllData();
      if (all.length) maxT = Math.max(maxT, all[all.length - 1].x);
    }
    return maxT;
  }
  clear() {
    super.clear();
    this.markers = [];
    this.startTime = 0;
    this.paused = false;
    this.scrubTime = 0;
    this.wasPlaying = false;
  }
}

const logSeries = new LogSession();

const markerPlugin = {
  id: "markerLines",
  afterDatasetsDraw(chart, args, options) {
    const { ctx, chartArea, scales: { x, y } } = chart;
    if (!x || !y || !chartArea) return;
    ctx.save();
    for (const marker of options.markers || []) {
      const px = x.getPixelForValue(marker.time);
      if (px == null || px < chartArea.left || px > chartArea.right) continue;
      ctx.beginPath();
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.strokeStyle = "#f4b400";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#f4b400";
      ctx.font = "11px Segoe UI";
      ctx.textAlign = "center";
      ctx.fillText(marker.label, px, chartArea.top + 12);
    }
    ctx.restore();
  }
};
if (typeof Chart !== "undefined") Chart.register(markerPlugin);

function isLoggingViewActive() {
  return document.querySelector(".tab.active")?.dataset.view === "logging";
}

function formatTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
}

function updateTimeDisplay() {
  const total = logSeries.totalDuration;
  const cur = logSeries.paused ? logSeries.scrubTime : total;
  $("log-time").textContent = `${formatTime(cur)} / ${formatTime(total)}`;
}

function updateScrubber() {
  const total = logSeries.totalDuration;
  const scrubber = $("log-scrubber");
  scrubber.max = total.toFixed(1);
  if (!logSeries.paused) {
    scrubber.value = total.toFixed(1);
  }
  updateTimeDisplay();
}

async function buildLogParams() {
  const profile = $("log-profile").value;
  let values = [];
  try {
    values = connected ? await invoke("read_live_data", { profile }) : [];
  } catch (_) { values = []; }
  const el = $("log-params");
  el.innerHTML = "";
  values.forEach((v, i) => {
    const color = LOG_COLORS[i % LOG_COLORS.length];
    if (!logSeries.has(v.id)) {
      logSeries.set(v.id, new LogSeries(v.label, v.unit, color, i < 3));
    } else {
      const s = logSeries.get(v.id);
      s.label = v.label;
      s.unit = v.unit;
    }
    const s = logSeries.get(v.id);
    const row = document.createElement("label");
    row.className = "log-param";
    // v0.5.0 PR #3 — flag severity-bearing enum channels in the
    // Logging tab channel list. The class is sourced from the
    // current v.text at row-build time (real-time updates would
    // require per-tick row updates — left as a follow-up).
    const sev = window.LiveFormat.severityClass(v.text);
    if (sev) row.classList.add(sev);
    row.innerHTML =
      `<input type="checkbox" ${s.enabled ? "checked" : ""} data-id="${v.id}" />` +
      `<span class="swatch" style="background:${s.color}"></span>` +
      `<span>${s.label}</span>`;
    row.querySelector("input").addEventListener("change", (e) => {
      s.enabled = e.target.checked;
      rebuildChart();
    });
    el.appendChild(row);
  });
  if (logSeries.size === 0) {
    el.innerHTML = "<p class='muted' style='padding:8px;font-size:12px'>Connect first, then reopen this tab to load parameters.</p>";
  }
  rebuildChart();
  checkSavedSession();
}

function rebuildChart() {
  if (typeof Chart === "undefined") return;
  const datasets = [];
  const t = logSeries.paused ? logSeries.scrubTime : null;
  for (const [, s] of logSeries) {
    if (!s.enabled) continue;
    datasets.push({
      label: `${s.label} (${s.unit})`,
      data: s.getData(t),
      borderColor: s.color,
      backgroundColor: s.color,
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.25,
    });
  }
  if (logChart) {
    logChart.data.datasets = datasets;
    logChart.options.plugins.markerLines.markers = logSeries.markers;
    logChart.update("none");
    return;
  }
  logChart = new Chart($("log-chart").getContext("2d"), {
    type: "line",
    data: { datasets },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      scales: {
        x: { type: "linear", title: { display: true, text: "seconds" } },
        y: { beginAtZero: false },
      },
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        markerLines: { markers: logSeries.markers },
      },
    },
  });
}

async function logTick() {
  if (!connected) return;
  try {
    const values = await invoke("read_live_data", { profile: $("log-profile").value });
    const t = (Date.now() - logStart) / 1000;
    for (const v of values) {
      const s = logSeries.get(v.id);
      if (!s) continue;
      // Numeric params: y carries the number. Enum params: y stays 0.0
      // for the chart and the label rides on `text`, which the CSV
      // honours below. The chart line remains numeric for both kinds
      // because categories over time are a separate UX problem.
      const point = { x: t, y: v.value, text: v.text };
      if (logSeries.paused) {
        s.bufferPush(point);
      } else {
        s.push(point);
      }
    }
    if (!logSeries.paused && logChart) {
      logChart.update("none");
      updateScrubber();
    }
  } catch (e) {
    log("Logging: " + e);
    stopLogging();
  }
}

function startLogging() {
  if (!connected) { log("Connect first."); return; }
  if (logTimer) return;
  logStart = Date.now();
  logSeries.clear();
  logSeries.paused = false;
  logSeries.scrubTime = 0;
  logSeries.wasPlaying = false;
  logTimer = setInterval(logTick, 250);
  updatePlayButton();
  $("btn-log-start").textContent = "Stop recording";
  $("btn-log-start").classList.remove("btn-primary");
  $("btn-log-export").disabled = false;
  $("btn-log-histogram").disabled = false;
  $("btn-log-diff").disabled = false;
  $("btn-log-clear").disabled = false;
  $("log-scrubber").disabled = false;
  $("log-status").textContent = "Recording…";
  rebuildChart();
}

function stopLogging() {
  clearInterval(logTimer);
  logTimer = null;
  logSeries.paused = true;
  logSeries.scrubTime = logSeries.totalDuration;
  updatePlayButton();
  $("btn-log-start").textContent = "Start recording";
  $("btn-log-start").classList.add("btn-primary");
  $("log-status").textContent = "Stopped.";
  updateScrubber();
  autoSaveSession();
}

function togglePlay() {
  if (logSeries.totalDuration === 0) return;
  logSeries.paused = !logSeries.paused;
  if (!logSeries.paused) {
    for (const s of logSeries.values()) s.flushBuffer();
    logSeries.scrubTime = logSeries.totalDuration;
  }
  updatePlayButton();
  rebuildChart();
  updateScrubber();
}

function updatePlayButton() {
  const btn = $("btn-log-play");
  const isPlaying = !logSeries.paused;
  btn.textContent = isPlaying ? "⏸" : "▶";
  btn.title = isPlaying ? "Pause (Space)" : "Play (Space)";
}

function stepTime(delta) {
  if (logSeries.totalDuration === 0) return;
  logSeries.paused = true;
  logSeries.scrubTime = Math.max(0, Math.min(logSeries.totalDuration, logSeries.scrubTime + delta));
  updatePlayButton();
  rebuildChart();
  updateScrubber();
}

function addMarker(time) {
  const label = `Marker ${logSeries.markers.length + 1}`;
  logSeries.markers.push({ time, label });
  logSeries.markers.sort((a, b) => a.time - b.time);
  rebuildChart();
  renderMarkerList();
  $("btn-log-clear-markers").disabled = false;
}

function renderMarkerList() {
  const list = $("log-marker-list");
  list.innerHTML = "";
  logSeries.markers.forEach((m, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="log-marker-time">${formatTime(m.time)}</span> <span class="log-marker-label" contenteditable="true">${escapeHtml(m.label)}</span> <button class="btn btn-small log-marker-del" data-idx="${i}">×</button>`;
    li.querySelector(".log-marker-label").addEventListener("blur", (e) => {
      logSeries.markers[i].label = e.target.textContent.trim() || `Marker ${i + 1}`;
      rebuildChart();
    });
    li.querySelector(".log-marker-del").addEventListener("click", () => {
      logSeries.markers.splice(i, 1);
      renderMarkerList();
      rebuildChart();
      $("btn-log-clear-markers").disabled = logSeries.markers.length === 0;
    });
    list.appendChild(li);
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function clearMarkers() {
  logSeries.markers = [];
  renderMarkerList();
  rebuildChart();
  $("btn-log-clear-markers").disabled = true;
}

/* localStorage */
function autoSaveSession() {
  const payload = {
    startTime: logStart,
    timestamp: Date.now(),
    markers: logSeries.markers,
    series: [...logSeries.entries()].map(([id, s]) => ({
      id, label: s.label, unit: s.unit, color: s.color, enabled: s.enabled,
      data: s.getAllData()
    }))
  };
  try {
    const key = `beeemuu-log-session-${payload.timestamp}`;
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (e) {
    console.warn("Session save failed", e);
  }
}

function checkSavedSession() {
  if (logSeries.totalDuration > 0) return;
  const keys = listSessionKeys();
  if (!keys.length) return;
  const latest = keys.sort().pop();
  const data = loadSession(latest);
  if (!data) return;
  const banner = $("log-restore-banner");
  $("log-restore-time").textContent = new Date(data.timestamp).toLocaleString();
  banner.classList.remove("hidden");
}

function listSessionKeys() {
  try {
    return Object.keys(localStorage).filter(k => k.startsWith("beeemuu-log-session-"));
  } catch (e) { return []; }
}

function loadSession(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch (e) { return null; }
}

function restoreSession() {
  const keys = listSessionKeys().sort();
  if (!keys.length) return;
  const data = loadSession(keys.pop());
  if (!data) return;
  logSeries.clear();
  logStart = data.startTime || 0;
  logSeries.markers = data.markers || [];
  for (const s of data.series) {
    const series = new LogSeries(s.label, s.unit, s.color, s.enabled);
    for (const p of s.data) series.push(p);
    logSeries.set(s.id, series);
  }
  logSeries.paused = true;
  logSeries.scrubTime = logSeries.totalDuration;
  const el = $("log-params");
  el.innerHTML = "";
  for (const [id, s] of logSeries) {
    const row = document.createElement("label");
    row.className = "log-param";
    row.innerHTML =
      `<input type="checkbox" ${s.enabled ? "checked" : ""} data-id="${id}" />` +
      `<span class="swatch" style="background:${s.color}"></span>` +
      `<span>${s.label}</span>`;
    row.querySelector("input").addEventListener("change", (e) => {
      s.enabled = e.target.checked;
      rebuildChart();
    });
    el.appendChild(row);
  }
  rebuildChart();
  renderMarkerList();
  updateScrubber();
  updatePlayButton();
  $("log-status").textContent = "Restored saved session.";
  $("btn-log-export").disabled = false;
  $("btn-log-histogram").disabled = false;
  $("btn-log-diff").disabled = false;
  $("btn-log-clear").disabled = false;
  $("btn-log-clear-markers").disabled = logSeries.markers.length === 0;
  $("log-scrubber").disabled = logSeries.totalDuration === 0;
  dismissRestoreBanner();
}

function dismissRestoreBanner() {
  $("log-restore-banner").classList.add("hidden");
}

function clearSavedSessions() {
  for (const k of listSessionKeys()) localStorage.removeItem(k);
  dismissRestoreBanner();
}

/* Events */
$("btn-log-start").addEventListener("click", () => {
  if (logTimer) stopLogging(); else startLogging();
});
$("btn-log-clear").addEventListener("click", () => {
  for (const s of logSeries.values()) s.clear();
  logSeries.paused = true;
  logSeries.scrubTime = 0;
  if (logChart) logChart.update("none");
  $("log-status").textContent = "Cleared.";
  updateScrubber();
  updatePlayButton();
  renderMarkerList();
});
/* Build the CSV string from the current log series data. */
function buildLogCsv() {
  const enabled = [...logSeries.entries()].filter(([, s]) => s.enabled && s.getAllData().length);
  if (!enabled.length) return null;
  const allData = enabled[0][1].getAllData();
  const rows = allData.length;
  let csv = "time_s," + enabled.map(([, s]) => `${s.label} (${s.unit})`).join(",") + "\n";
  for (let i = 0; i < rows; i++) {
    const t = allData[i]?.x ?? "";
    let row = t.toFixed ? t.toFixed(2) : t;
    for (const [, s] of enabled) {
      const p = s.getAllData()[i];
      // Enum labels (when point.text is set) are emitted as quoted CSV
      // strings; numerics keep the existing two-decimal format.
      row += "," + (p
        ? (p.text !== undefined && p.text !== null
            ? JSON.stringify(p.text)
            : (p.y ?? "").toFixed(2))
        : "");
      // Shared with the test harness (`src/js/test/live_format.test.cjs`)
      // and Gauge.set in gauges.js. Keep the rule in one place.
      row += "," + window.LiveFormat.csvCell(s.getAllData()[i]);
    }
    csv += row + "\n";
  }
  return csv;
}

$("btn-log-export").addEventListener("click", async () => {
  const csv = buildLogCsv();
  if (!csv) { log("Nothing recorded yet."); return; }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  try {
    const path = await invoke("export_text", { filename: `beeemuu-log-${stamp}.csv`, content: csv });
    log("Saved: " + path);
  } catch (e) {
    log("Export failed: " + e);
  }
});
$("btn-log-play").addEventListener("click", togglePlay);
$("btn-log-step-back").addEventListener("click", () => stepTime(-1));
$("btn-log-step-forward").addEventListener("click", () => stepTime(1));

/* ---------------- histogram modal ----------------
 *
 * Histograms work off the same `LogSession` that powers the line
 * chart. For each channel that has numeric y-values we expose a
 * dropdown choice; channels that returned a string `text` (the
 * u8_enum decoder from PR #60) are skipped — there's no
 * distribution to plot over a small enum set anyway. The chart
 * itself uses Chart.js bar mode, so it reuses the library that's
 * already loaded for the line chart.
 */
let histChart = null;
function showHistogramModal() {
  // Populate channel dropdown with channels that have any data.
  // Enum-style channels (text !== null) are filtered out — they
  // don't have a meaningful numeric distribution.
  const sel = $("histogram-channel");
  const prev = sel.value;
  sel.innerHTML = "";
  const channels = [];
  for (const [id, s] of logSeries.entries()) {
    const all = s.getAllData();
    if (!all.length) continue;
    channels.push({ id, label: s.label, unit: s.unit, n: all.length });
  }
  if (channels.length === 0) {
    log("No logged channels with data.");
    return;
  }
  for (const c of channels) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.label}${c.unit ? " (" + c.unit + ")" : ""} — ${c.n} samples`;
    sel.appendChild(opt);
  }
  if (prev && channels.some(c => c.id === prev)) sel.value = prev;
  $("histogram-overlay").classList.remove("hidden");
  renderHistogram();
}
function renderHistogram() {
  const sel = $("histogram-channel");
  const id = sel.value;
  if (!id) return;
  const series = logSeries.get(id);
  if (!series) return;
  const ys = series.getAllData().map(p => p.y).filter(v => typeof v === "number" && Number.isFinite(v));
  const binCount = parseInt($("histogram-bins").value, 10) || 20;
  const result = window.beeemuuHistogram.histogram(ys, binCount);
  // Bar chart: one bar per bin, label at the bin midpoint.
  const labels = [];
  for (let i = 0; i < result.counts.length; i++) {
    const mid = (result.binEdges[i] + result.binEdges[i + 1]) / 2;
    labels.push(formatBinLabel(mid, result.binEdges[i], result.binEdges[i + 1], series.unit));
  }
  const ctx = $("histogram-chart").getContext("2d");
  if (histChart) histChart.destroy();
  histChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: series.label, data: result.counts, backgroundColor: "#4da3ff" }] },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: series.label + (series.unit ? " (" + series.unit + ")" : "") } },
        y: { title: { display: true, text: "samples" }, beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
  // Stats readout
  const s = result.stats;
  const fmt = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
  $("histogram-stats").innerHTML = [
    `<span><b>n</b> ${s.n}</span>`,
    `<span><b>min</b> ${fmt(s.min)}${series.unit ? " " + series.unit : ""}</span>`,
    `<span><b>max</b> ${fmt(s.max)}${series.unit ? " " + series.unit : ""}</span>`,
    `<span><b>mean</b> ${fmt(s.mean)}${series.unit ? " " + series.unit : ""}</span>`,
    `<span><b>median</b> ${fmt(s.median)}${series.unit ? " " + series.unit : ""}</span>`,
    `<span><b>std dev</b> ${fmt(s.stdDev)}${series.unit ? " " + series.unit : ""}</span>`,
  ].join("");
  $("histogram-dropped").textContent = result.dropped > 0
    ? `${result.dropped} non-finite sample(s) dropped (NaN / undefined / failed read).`
    : "";
}
function formatBinLabel(mid, lo, hi, unit) {
  // Short labels for narrow ranges, more precision when the bin
  // is wide. Aim for 3 significant digits in the mid value.
  const range = hi - lo;
  let digits;
  if (range === 0) digits = 0;
  else if (range >= 100) digits = 0;
  else if (range >= 10) digits = 1;
  else if (range >= 1) digits = 2;
  else digits = 3;
  const s = mid.toFixed(digits);
  return unit ? `${s} ${unit}` : s;
}
$("btn-log-histogram").addEventListener("click", showHistogramModal);
$("histogram-channel").addEventListener("change", renderHistogram);
$("histogram-bins").addEventListener("change", renderHistogram);
$("histogram-close").addEventListener("click", () => {
  $("histogram-overlay").classList.add("hidden");
  if (histChart) { histChart.destroy(); histChart = null; }
});

// v0.6.0 PR #1 — Compare logs modal: button + select + recompute + close.
$("btn-log-diff").addEventListener("click", showLogDiffModal);
$("log-diff-source-a").addEventListener("change", renderLogDiffTable);
$("log-diff-source-b").addEventListener("change", renderLogDiffTable);
$("log-diff-recompute").addEventListener("click", renderLogDiffTable);
$("log-diff-close").addEventListener("click", () => {
  $("log-diff-overlay").classList.add("hidden");
});

/* ---------------- log-diff modal (v0.6.0 PR #1) ---------------------
 *
 * Compares two saved log sessions (from localStorage) channel by
 * channel. Source A and Source B selects list every saved session
 * the user has; we compute per-channel stats (n / mean / σ / max)
 * for each side and render the deltas in a sticky-header table.
 * The current in-memory live session is also a valid pick (we
 * auto-include "Current session" as the first option on each
 * side so a record-then-replay workflow just works).
 */
function getDiffableSessions() {
  // The currently-in-memory live session is one option.
  // Plus every saved snapshot from localStorage.
  const live = {
    key: "__live__",
    label: "Current session",
    timestamp: 0,
    seriesMap: new Map(),
  };
  for (const [id, s] of logSeries) {
    live.seriesMap.set(id, s.getAllData());
  }
  const liveNonEmpty = live.seriesMap.size > 0;
  const sessions = [];
  if (liveNonEmpty) sessions.push(live);
  try {
    for (const k of Object.keys(localStorage).sort()) {
      if (!k.startsWith("beeemuu-log-session-")) continue;
      const data = JSON.parse(localStorage.getItem(k));
      if (!data || !data.series) continue;
      const map = new Map();
      for (const s of data.series) {
        if (s.data && s.data.length) map.set(s.id, s.data);
      }
      if (map.size === 0) continue;
      sessions.push({
        key: k,
        label: new Date(data.timestamp || 0).toLocaleString(),
        timestamp: data.timestamp || 0,
        seriesMap: map,
      });
    }
  } catch (e) { /* localStorage fail-soft */ }
  return sessions;
}

function renderLogDiffTable() {
  const selA = $("log-diff-source-a");
  const selB = $("log-diff-source-b");
  const keyA = selA.value;
  const keyB = selB.value;
  const tbody = $("log-diff-tbody");
  const summary = $("log-diff-summary");
  tbody.innerHTML = "";
  if (!keyA || !keyB) {
    summary.textContent = "Select two sources to compare.";
    return;
  }
  const sessions = getDiffableSessions();
  const a = sessions.find((s) => s.key === keyA);
  const b = sessions.find((s) => s.key === keyB);
  if (!a || !b) {
    summary.textContent = "Selected source not available.";
    return;
  }
  // Union of channel IDs across A and B.
  const channels = new Set();
  for (const id of a.seriesMap.keys()) channels.add(id);
  for (const id of b.seriesMap.keys()) channels.add(id);
  if (channels.size === 0) {
    summary.textContent = "Neither source has channel data.";
    return;
  }
  let counted = 0;
  for (const id of channels) {
    const dataA = a.seriesMap.get(id) || [];
    const dataB = b.seriesMap.get(id) || [];
    const r = window.LogDiff.diffSeries(dataA, dataB);
    const d = window.LogDiff.statsDelta(r.statsA, r.statsB);
    // Pull a friendly label / unit from whichever side has it.
    // The label lives on the LogSeries, not the saved payload,
    // so we lose it for saved sessions. Fall back to the channel id.
    const labelA = (() => {
      const s = logSeries.get(id);
      return s ? s.label : id;
    })();
    const fmtN = (v) => Number.isFinite(v) ? Math.round(v).toString() : "—";
    const fmt = (v) => Number.isFinite(v) ? v.toFixed(2) : "—";
    const sev = (() => {
      if (!d) return "";
      // Use the larger of the two stdDevs as the noise floor.
      const noise = Math.max(r.statsA.stdDev, r.statsB.stdDev);
      if (!Number.isFinite(noise) || noise <= 0) return "";
      const ratio = Math.abs(d.meanΔ) / noise;
      if (ratio >= 2) return "cell-critical";
      if (ratio >= 0.5) return "cell-warning";
      return "";
    })();
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${escapeHtml(labelA)}</td>` +
      `<td>${fmtN(r.statsA.n)}</td>` +
      `<td>${fmt(r.statsA.mean)}</td>` +
      `<td>${fmt(r.statsA.stdDev)}</td>` +
      `<td>${fmt(r.statsA.max)}</td>` +
      `<td>${fmtN(r.statsB.n)}</td>` +
      `<td>${fmt(r.statsB.mean)}</td>` +
      `<td>${fmt(r.statsB.stdDev)}</td>` +
      `<td>${fmt(r.statsB.max)}</td>` +
      `<td class="${sev}">${d ? fmt(d.meanΔ) : "—"}</td>` +
      `<td>${d ? fmt(d.stdDevΔ) : "—"}</td>` +
      `<td>${d ? fmt(d.maxΔ) : "—"}</td>`;
    tbody.appendChild(tr);
    counted++;
  }
  summary.textContent = `Compared ${counted} channel(s) between "${a.label}" and "${b.label}".`;
}

function showLogDiffModal() {
  const sessions = getDiffableSessions();
  if (sessions.length < 2) {
    log("Compare logs needs at least two saved sessions (or one saved + a live recording).");
    return;
  }
  const selA = $("log-diff-source-a");
  const selB = $("log-diff-source-b");
  const prevA = selA.value;
  const prevB = selB.value;
  function fill(sel) {
    sel.innerHTML = "";
    for (const s of sessions) {
      const opt = document.createElement("option");
      opt.value = s.key;
      opt.textContent = `${s.label}${s.seriesMap.size ? ` (${s.seriesMap.size} ch)` : ""}`;
      sel.appendChild(opt);
    }
  }
  fill(selA);
  fill(selB);
  if (prevA && sessions.some((s) => s.key === prevA)) selA.value = prevA;
  if (prevB && sessions.some((s) => s.key === prevB)) selB.value = prevB;
  // Defaults: A = live (index 0), B = most recent saved (index 1).
  if (selA.selectedIndex < 0) selA.selectedIndex = 0;
  if (selB.selectedIndex < 0) selB.selectedIndex = Math.min(1, sessions.length - 1);
  // Pick two distinct sources so the diff is meaningful.
  if (selA.value === selB.value && sessions.length >= 2) {
    selB.selectedIndex = sessions.length - 1 === selA.selectedIndex ? 0 : sessions.length - 1;
  }
  $("log-diff-overlay").classList.remove("hidden");
  renderLogDiffTable();
}
$("log-scrubber").addEventListener("input", (e) => {
  logSeries.paused = true;
  logSeries.scrubTime = parseFloat(e.target.value);
  updatePlayButton();
  rebuildChart();
  updateTimeDisplay();
});
$("btn-log-clear-markers").addEventListener("click", clearMarkers);
$("btn-log-restore").addEventListener("click", restoreSession);
$("btn-log-restore-dismiss").addEventListener("click", dismissRestoreBanner);
$("btn-log-clear-session").addEventListener("click", clearSavedSessions);

$("log-chart").addEventListener("dblclick", (e) => {
  if (!logChart || !logChart.scales.x) return;
  const xVal = logChart.scales.x.getValueForPixel(e.offsetX);
  if (xVal == null || !isFinite(xVal)) return;
  addMarker(Math.max(0, xVal));
});

document.addEventListener("keydown", (e) => {
  if (!isLoggingViewActive()) return;
  if (e.target.matches("input, textarea, [contenteditable]")) return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
  } else if (e.code === "ArrowLeft") {
    e.preventDefault();
    stepTime(e.shiftKey ? -5 : -1);
  } else if (e.code === "ArrowRight") {
    e.preventDefault();
    stepTime(e.shiftKey ? 5 : 1);
  }
});

/* Tab visibility: pause on leave, resume on return if previously playing */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.dataset.view === "logging") {
      if (logSeries.wasPlaying) {
        logSeries.wasPlaying = false;
        logSeries.paused = false;
        for (const s of logSeries.values()) s.flushBuffer();
        updatePlayButton();
        rebuildChart();
      }
    } else {
      if (logTimer && !logSeries.paused) {
        logSeries.wasPlaying = true;
        logSeries.paused = true;
        updatePlayButton();
      }
    }
  });
});

$("log-profile").addEventListener("change", buildLogParams);

/* ---------------- vehicle info ---------------- */
let lastVehicleInfo = null;

async function doReadVehicle() {
  if (!connected) { log("Connect first."); return; }
  const body = $("info-body");
  body.innerHTML = "<p class='muted'>Reading…</p>";
  try {
    const info = await invoke("read_vehicle_info");
    lastVehicleInfo = info;
    renderVehicleInfo(info);
    setInfoActionsEnabled(true);
  } catch (e) {
    body.innerHTML = `<p class='muted'>Read failed: ${e}</p>`;
  }
}

async function doExportSnapshot() {
  if (!connected && !sessionReplay) { log("Connect first or load a session."); return; }
  try {
    setStatus("Exporting session snapshot…");
    const json = await invoke("export_session");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const path = await invoke("export_text", { filename: `beeemuu-session-${stamp}.json`, content: json });
    log("Snapshot saved: " + path);
    setStatus(sessionReplay ? "Session replay (offline)" : "Connected");
  } catch (e) {
    log("Snapshot export failed: " + e);
    setStatus(sessionReplay ? "Session replay (offline)" : "Connected");
  }
}

/* ---------------- diagnostic story mode ---------------- */

let lastSnapshotForStory = null;

async function doGenerateStory() {
  await generateStoryFromCurrent();
}

$("btn-story-from-snapshot").addEventListener("click", async () => {
  if (!lastSnapshotForStory) { log("Load a snapshot first."); return; }
  await generateStory(lastSnapshotForStory);
});

async function generateStoryFromCurrent() {
  if (!connected && !sessionReplay) { log("Connect first or load a session."); return; }
  try {
    setStatus("Generating diagnostic story…");
    const json = await invoke("export_session");
    const snapshot = JSON.parse(json);
    await generateStory(snapshot);
    setStatus(sessionReplay ? "Session replay (offline)" : "Connected");
  } catch (e) {
    log("Story generation failed: " + e);
    setStatus(sessionReplay ? "Session replay (offline)" : "Connected");
  }
}

async function generateStory(snapshot) {
  try {
    const story = await invoke("generate_story", { snapshot });
    renderStory(story);
  } catch (e) {
    log("Story generation failed: " + e);
  }
}

function renderStory(story) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.id = "story-modal";
  const sevClass = story.severity === "Critical" ? "story-sev-critical" : story.severity === "Warning" ? "story-sev-warning" : "story-sev-info";
  const sevLabel = story.severity === "Critical" ? "🔴 Critical" : story.severity === "Warning" ? "🟡 Warning" : "🔵 Info";
  modal.innerHTML = `
    <div class="modal story-modal">
      <div class="modal-head">${escapeHtml(story.title)}</div>
      <div class="modal-body">
        <div class="story-severity ${sevClass}">${sevLabel}</div>
        <p class="story-vehicle">${escapeHtml(story.vehicle_summary)}</p>
        <p class="story-summary">${escapeHtml(story.summary)}</p>
        <h4 class="story-section">Findings</h4>
        <div class="story-findings">
          ${story.findings.map(f => `
            <div class="story-finding">
              <div class="finding-header">
                <code class="finding-code">${escapeHtml(f.dtc_code)}</code>
                <span class="finding-text">${escapeHtml(f.dtc_text)}</span>
              </div>
              <div class="finding-context">${escapeHtml(f.context)}</div>
              ${f.engine_note ? `<div class="finding-note">${escapeHtml(f.engine_note)}</div>` : ''}
            </div>
          `).join('')}
        </div>
        <h4 class="story-section">Recommendations</h4>
        <ol class="story-recommendations">
          ${story.recommendations.map(r => `
            <li>
              <div class="rec-action">${escapeHtml(r.action)}</div>
              <div class="rec-meta">Difficulty: ${escapeHtml(r.diy_difficulty)}${r.estimated_cost ? ' · Estimated: ' + escapeHtml(r.estimated_cost) : ''}</div>
              <div class="rec-rationale">${escapeHtml(r.rationale)}</div>
            </li>
          `).join('')}
        </ol>
      </div>
      <div class="modal-actions">
        <button class="btn" onclick="copyStoryText()">Copy text</button>
        <button class="btn btn-primary" onclick="document.getElementById('story-modal').remove()">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  // Store raw text for copy
  modal.dataset.rawText = formatStoryPlain(story);
}

function formatStoryPlain(story) {
  let text = `${story.title}\n${story.vehicle_summary}\n\n${story.summary}\n\nFindings:\n`;
  for (const f of story.findings) {
    text += `  ${f.dtc_code} — ${f.dtc_text}\n`;
    text += `  ${f.context}\n`;
    if (f.engine_note) text += `  Note: ${f.engine_note}\n`;
    text += '\n';
  }
  text += '\nRecommendations:\n';
  for (const r of story.recommendations) {
    text += `  ${r.priority}. ${r.action} (${r.diy_difficulty})\n`;
    text += `     ${r.rationale}\n`;
    if (r.estimated_cost) text += `     Est: ${r.estimated_cost}\n`;
  }
  return text;
}

function copyStoryText() {
  const modal = document.getElementById('story-modal');
  if (!modal) return;
  const text = modal.dataset.rawText || '';
  navigator.clipboard.writeText(text).then(() => {
    log("Story copied to clipboard");
  }).catch(() => {
    log("Copy failed");
  });
}

/* ---------------- session snapshot export / import ---------------- */

// The Vehicle Info share menu drives these; no standalone buttons remain,
// so we toggle the menu items' disabled state instead of button.disabled.
function setInfoActionsEnabled(on) {
  document.querySelectorAll("#info-share-menu .share-item").forEach((el) => {
    if (el.dataset.action === "read") return; // Read is always available when connected
    el.disabled = !on;
  });
}

async function doExportReport() {
  if (!lastVehicleInfo) return;
  const i = lastVehicleInfo;
  let txt = "BeeEmUu Vehicle Report\n" + "=".repeat(40) + "\n";
  txt += `Generated: ${new Date().toString()}\n\n`;
  txt += `VIN: ${i.vin || "unavailable"}\n`;
  if (i.decode) {
    txt += `WMI: ${i.decode.wmi}\nManufacturer: ${i.decode.manufacturer}\n`;
    txt += `Model year: ${i.decode.model_year || "unknown"}\nPlant: ${i.decode.plant}\nSerial: ${i.decode.serial}\n`;
  }
  txt += `Mileage: ${i.mileage_km != null ? i.mileage_km + " km" : "unavailable"}\n\n`;
  txt += "Modules:\n";
  for (const m of modules) {
    txt += `  [${m.present ? "x" : " "}] ${m.name} (0x${m.address.toString(16).toUpperCase().padStart(2, "0")}) - ${m.description}`;
    txt += m.present ? ` | faults: ${m.fault_count ?? 0}${m.ident ? " | " + m.ident : "\n"}` : "\n";
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  try {
    const path = await invoke("export_text", { filename: `beeemuu-vehicle-${stamp}.txt`, content: txt });
    log("Saved: " + path);
  } catch (e) {
    log("Export failed: " + e);
  }
}

function loadSnapshot(data) {
  sessionReplay = true;
  connected = false;
  setStatus("Session replay (offline)");
  $("status-conn").className = "status-dot on";
  $("vehicle-banner").innerHTML =
    `<span class="vehicle-label">${data.transport_name} &nbsp;·&nbsp; Session replay</span>`;
  $("btn-connect").textContent = "Disconnect";

  modules = data.modules.map((m) => ({
    address: m.address,
    name: m.name,
    description: m.description,
    ident: m.ident,
    present: m.present,
    fault_count: m.fault_count,
    dtcs: m.dtcs || [],
  }));
  renderTree();
  fillExplorerEcus();
  fillSecurityEcus();

  if (data.vehicle_info) {
    lastVehicleInfo = {
      vin: data.vehicle_info.vin,
      decode: data.vehicle_info.decode,
      mileage_km: data.vehicle_info.mileage_km,
      suggested_profile: data.vehicle_info.suggested_profile,
    };
    renderVehicleInfo(lastVehicleInfo);
    // Snapshot loaded from file: re-export allowed, but not overwrite the source.
    setInfoActionsEnabled(true);
    const snapItem = document.querySelector('#info-share-menu .share-item[data-action="snapshot"]');
    if (snapItem) snapItem.disabled = true;
  }

  if (data.traffic) {
    lastTraffic = data.traffic;
    refreshTraffic();
  }

  if (data.vehicle_info?.suggested_profile) {
    const liveSel = $("live-profile");
    const logSel = $("log-profile");
    const exists = Array.from(liveSel.options).some((o) => o.value === data.vehicle_info.suggested_profile);
    if (exists) {
      liveSel.value = data.vehicle_info.suggested_profile;
      logSel.value = data.vehicle_info.suggested_profile;
      liveSel.dispatchEvent(new Event("change"));
    }
  }

  log("Loaded session snapshot.");
}

$("session-load-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = await invoke("import_session", { content: reader.result });
      lastSnapshotForStory = data;
      $("btn-story-from-snapshot").disabled = false;
      loadSnapshot(data);
    } catch (err) {
      log("Failed to load session: " + err);
    }
    e.target.value = "";
  };
  reader.readAsText(file);
});

$("btn-session-load").addEventListener("click", () => {
  $("session-load-file").click();
});

function renderVehicleInfo(info) {
  const rows = [];
  rows.push(["VIN", info.vin || "unavailable"]);
  if (info.decode) {
    rows.push(["__section", "Decoded"]);
    rows.push(["WMI", info.decode.wmi]);
    rows.push(["Manufacturer", info.decode.manufacturer]);
    rows.push(["Model year", info.decode.model_year || "unknown"]);
    rows.push(["Assembly plant", info.decode.plant]);
    rows.push(["Serial", info.decode.serial]);
  }
  rows.push(["__section", "Readouts"]);
  rows.push(["Mileage", info.mileage_km != null ? `${info.mileage_km.toLocaleString()} km` : "unavailable"]);
  rows.push(["Suggested profile", info.suggested_profile || "none ( Generic OBD-II works on any 2007+)"]);
  const modCount = modules.filter((m) => m.present).length;
  rows.push(["Modules found", modCount ? String(modCount) : "run a vehicle test"]);

  let html = "<div class='info-grid'>";
  for (const [k, v] of rows) {
    if (k === "__section") { html += `</div><div class='info-section'>${v}</div><div class='info-grid'>`; continue; }
    html += `<div class='info-key'>${k}</div><div class='info-val'>${v}</div>`;
  }
  html += "</div>";
  $("info-body").innerHTML = html;
}

/* ---------------- session + security ---------------- */
function fillSecurityEcus() {
  const sel = $("sec-address");
  sel.innerHTML = "";
  const list = modules.filter((m) => m.present);
  const src = list.length ? list : [{ address: 0x12, name: "DME" }];
  for (const m of src) {
    const o = document.createElement("option");
    o.value = m.address;
    o.textContent = `${m.name} (0x${m.address.toString(16).toUpperCase().padStart(2, "0")})`;
    sel.appendChild(o);
  }
}

function clearSecCountdown() {
  if (secCountdown) {
    clearInterval(secCountdown);
    secCountdown = null;
  }
}

function startSecCountdown(seconds) {
  clearSecCountdown();
  const btn = $("btn-unlock");
  const msg = $("sec-message");
  btn.disabled = true;
  let remaining = seconds;
  msg.textContent = `Retry in ${remaining}s…`;
  msg.className = "sec-message nrc-countdown";
  secCountdown = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearSecCountdown();
      btn.disabled = false;
      msg.textContent = "";
      msg.className = "sec-message";
    } else {
      msg.textContent = `Retry in ${remaining}s…`;
    }
  }, 1000);
}

$("btn-set-session").addEventListener("click", async () => {
  if (!connected) { log("Connect first."); return; }
  const address = parseInt($("sec-address").value, 10);
  const session = parseInt($("sec-session").value, 10);
  clearSecCountdown();
  setSecStatus(false, address);
  try {
    await invoke("set_session", { address, session });
    log(`Session 0x${session.toString(16).padStart(2, "0")} set`);
  } catch (e) {
    log("Session failed: " + e);
  }
});

$("btn-unlock").addEventListener("click", async () => {
  if (!connected) { log("Connect first."); return; }
  const address = parseInt($("sec-address").value, 10);
  clearSecCountdown();
  const msg = $("sec-message");
  msg.textContent = "";
  msg.className = "sec-message";
  try {
    const res = await invoke("security_access", { address, level: 1 });
    if (res.granted) {
      setSecStatus(true, address);
      log("Security access granted");
    } else if (res.already_unlocked) {
      setSecStatus(true, address);
      log("Already unlocked");
    } else if (res.nrc === 0x37) {
      setSecStatus(false, address);
      startSecCountdown(10);
      log("Unlock failed: " + res.message);
    } else if (res.nrc === 0x36) {
      setSecStatus(false, address);
      msg.textContent = "Exceeded attempts — module locked. Wait before retrying.";
      msg.className = "sec-message nrc-error";
      $("btn-unlock").disabled = true;
      log("Unlock failed: " + res.message);
    } else if (res.nrc === 0x35) {
      setSecStatus(false, address);
      msg.textContent = "Invalid key — check your algorithm registration.";
      msg.className = "sec-message nrc-error";
      log("Unlock failed: " + res.message);
    } else {
      setSecStatus(false, address);
      msg.textContent = res.message;
      msg.className = "sec-message nrc-error";
      log("Unlock failed: " + res.message);
    }
  } catch (e) {
    setSecStatus(false, address);
    msg.textContent = String(e);
    msg.className = "sec-message nrc-error";
    log("Unlock failed: " + e);
  }
});

function setSecStatus(unlocked, address) {
  const el = $("sec-status");
  el.textContent = unlocked ? "Unlocked" : "Locked";
  el.className = "sec-status" + (unlocked ? " unlocked" : "");
  if (address != null) {
    unlockStates.set(address, unlocked);
    renderTree();
  }
}

$("sec-address").addEventListener("change", () => {
  clearSecCountdown();
  const msg = $("sec-message");
  msg.textContent = "";
  msg.className = "sec-message";
  $("btn-unlock").disabled = false;
  const address = parseInt($("sec-address").value, 10);
  const unlocked = unlockStates.get(address) ?? false;
  setSecStatus(unlocked, address);
});

/* ---------------- diagnostics: self-test ---------------- */
$("btn-selftest").addEventListener("click", async () => {
  if (!connected) { log("Connect first."); return; }
  const body = $("selftest-body");
  body.innerHTML = "<p class='muted'>Running…</p>";
  try {
    const steps = await invoke("connection_test");
    body.innerHTML = "";
    for (const s of steps) {
      const row = document.createElement("div");
      row.className = "selftest-step " + (s.ok ? "ok" : "fail");
      row.innerHTML =
        `<span class="st-icon">${s.ok ? "✓" : "✗"}</span>` +
        `<span class="st-name">${s.name}</span>` +
        `<span class="st-detail">${s.detail}</span>` +
        `<span class="st-ms">${s.ms} ms</span>`;
      body.appendChild(row);
    }
  } catch (e) {
    body.innerHTML = `<p class='muted'>Test failed: ${e}</p>`;
  }
});

/* ---------------- diagnostics: community data ---------------- */
async function loadCommunityReport() {
  try {
    const r = await invoke("community_report");
    const el = $("community-body");
    const dir = r.dir ? `<code>${r.dir}</code>` : "not found (built-ins only)";
    let html =
      `<div class="cd-row"><span>Source folder</span><span>${dir}</span></div>` +
      `<div class="cd-row"><span>Fault texts</span><span>${r.dtc_texts}</span></div>` +
      `<div class="cd-row"><span>Profiles</span><span>${r.profiles}</span></div>` +
      `<div class="cd-row"><span>Freeze schemas</span><span>${r.freeze_schemas}</span></div>`;
    for (const w of r.warnings) html += `<div class="cd-warn">⚠ ${w}</div>`;
    el.innerHTML = html;
  } catch (e) {
    $("community-body").innerHTML = `<p class='muted'>${e}</p>`;
  }
}

/* ---------------- diagnostics: share profiles ---------------- */
async function fillShareProfiles() {
  const profiles = await invoke("list_profiles");
  const sel = $("share-profile");
  sel.innerHTML = "";
  for (const p of profiles) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.label;
    sel.appendChild(o);
  }
}

$("btn-export-profile").addEventListener("click", async () => {
  const id = $("share-profile").value;
  if (!id) return;
  try {
    const toml = await invoke("export_profile", { id });
    const path = await invoke("export_text", { filename: `${id}.toml`, content: toml });
    log("Exported profile to: " + path);
  } catch (e) {
    log("Export failed: " + e);
  }
});

$("import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { $("import-text").value = reader.result; };
  reader.readAsText(file);
});

$("btn-import-profile").addEventListener("click", async () => {
  const content = $("import-text").value.trim();
  if (!content) { log("Paste or choose a profile TOML first."); return; }
  try {
    const labels = await invoke("import_profiles", { content });
    log(`Imported: ${labels.join(", ")}`);
    // refresh every profile dropdown so the new profile is selectable
    await Promise.all([loadProfiles(), loadLogProfiles(), fillShareProfiles()]);
    $("import-text").value = "";
    $("import-file").value = "";
  } catch (e) {
    log("Import failed: " + e);
  }
});

/* ---------------- diagnostics: traffic log ---------------- */
let trafficAuto = null;
let lastTraffic = [];

async function refreshTraffic() {
  try {
    const rows = await invoke("get_traffic");
    lastTraffic = rows;
    const tbody = $("traffic-rows");
    if (!rows.length) {
      tbody.innerHTML = "<tr><td colspan='6' class='muted'>No traffic yet.</td></tr>";
      return;
    }
    // newest last; show most recent 300 to keep the DOM light
    const recent = rows.slice(-300);
    tbody.innerHTML = "";
    for (const e of recent) {
      const tr = document.createElement("tr");
      if (!e.ok) tr.className = "err";
      const resp = e.ok ? e.response : `NRC/err: ${e.detail}`;
      tr.innerHTML =
        `<td>${e.seq}</td><td>${e.t_ms}</td>` +
        `<td>0x${e.target.toString(16).toUpperCase().padStart(2, "0")}</td>` +
        `<td>${e.request}</td><td class="tr-resp">${resp}</td><td>${e.dur_ms}</td>`;
      tbody.appendChild(tr);
    }
    $("traffic-rows").parentElement.parentElement.scrollTop = 1e9;
  } catch (e) {
    log("Traffic: " + e);
  }
}

$("btn-traffic-refresh").addEventListener("click", refreshTraffic);
$("traffic-auto").addEventListener("change", (e) => {
  if (e.target.checked) {
    if (!trafficAuto) trafficAuto = setInterval(refreshTraffic, 1000);
  } else {
    clearInterval(trafficAuto);
    trafficAuto = null;
  }
  saveSettings();
});
$("btn-traffic-clear").addEventListener("click", async () => {
  await invoke("clear_traffic");
  refreshTraffic();
});
$("btn-traffic-export").addEventListener("click", async () => {
  if (!lastTraffic.length) { log("Nothing to export."); return; }
  let txt = "seq\tt_ms\tECU\trequest\tresponse\tok\tdur_ms\tdetail\n";
  for (const e of lastTraffic) {
    const ecu = "0x" + e.target.toString(16).toUpperCase().padStart(2, "0");
    txt += `${e.seq}\t${e.t_ms}\t${ecu}\t${e.request}\t${e.response}\t${e.ok}\t${e.dur_ms}\t${e.detail}\n`;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  try {
    const path = await invoke("export_text", { filename: `beeemuu-traffic-${stamp}.tsv`, content: txt });
    log("Saved: " + path);
  } catch (e) {
    log("Export failed: " + e);
  }
});

/* ---------------- about / first-run modal ---------------- */
function showModal() { $("modal-overlay").classList.remove("hidden"); }
function hideModal() { $("modal-overlay").classList.add("hidden"); }
$("btn-about").addEventListener("click", showModal);
$("modal-accept").addEventListener("click", () => {
  try { localStorage.setItem("beeemuu_accepted", "1"); } catch (_) {}
  hideModal();
});
(function firstRunCheck() {
  let accepted = false;
  try { accepted = localStorage.getItem("beeemuu_accepted") === "1"; } catch (_) {}
  if (!accepted) showModal();
})();

/* ---------------- tab activation hooks ---------------- */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.dataset.view === "logging") buildLogParams();
    if (tab.dataset.view === "diagnostics") { loadCommunityReport(); refreshTraffic(); fillShareProfiles(); }
    if (tab.dataset.view === "snapshots") refreshSnapshots();
    if (tab.dataset.view === "backend") refreshBackendDashboard();
  });
});

/* ---------------- init ---------------- */
(async function init() {
  loadTheme();
  loadServiceFunctions();
  await loadProfiles();
  await loadLogProfiles();
  fillExplorerEcus();
  fillSecurityEcus();
  setStatus("Disconnected");
  await loadSettings();
  applyMode($("app-mode").value);
  setInfoActionsEnabled(false); // nothing read yet
})();

async function loadLogProfiles() {
  const profiles = await invoke("list_profiles");
  const sel = $("log-profile");
  sel.innerHTML = "";
  for (const p of profiles) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.label;
    sel.appendChild(o);
  }
}

/* ---------------- snapshot library ---------------- */

async function refreshSnapshots() {
  const list = $("snapshot-list");
  list.innerHTML = "<div class='snapshot-card'><div class='snapshot-meta'>Scanning exports folder…</div></div>";
  try {
    const files = await invoke("list_exports");
    renderSnapshots(files);
  } catch (e) {
    list.innerHTML = `<div class='snapshot-card'><div class='snapshot-meta'>Failed to read exports: ${e}</div></div>`;
  }
}

function renderSnapshots(files) {
  const list = $("snapshot-list");
  if (!files.length) {
    list.innerHTML = `<div class='snapshot-card'><div class='snapshot-meta'>No snapshots yet. Connect to a vehicle and click "Export full snapshot" in Vehicle Info to create one.</div></div>`;
    return;
  }
  list.innerHTML = "";
  for (const f of files) {
    const dt = new Date(f.modified_secs * 1000);
    const dateStr = dt.toLocaleString();
    const sizeStr = f.size_bytes < 1024 ? `${f.size_bytes} B` : f.size_bytes < 1048576 ? `${(f.size_bytes / 1024).toFixed(1)} KB` : `${(f.size_bytes / 1048576).toFixed(1)} MB`;
    const card = document.createElement("div");
    card.className = "snapshot-card";
    card.innerHTML =
      `<div class="snapshot-title">${escapeHtml(f.name)}</div>` +
      `<div class="snapshot-meta">${dateStr} · ${sizeStr}</div>` +
      `<div class="snapshot-actions">` +
        `<button class="btn btn-small" data-name="${escapeHtml(f.name)}">Open</button>` +
      `</div>`;
    card.querySelector("button").addEventListener("click", () => loadSnapshotFromFile(f.name));
    list.appendChild(card);
  }
}

async function loadSnapshotFromFile(name) {
  try {
    setStatus("Loading snapshot…");
    const data = await invoke("import_session_file", { name });
    lastSnapshotForStory = data;
    $("btn-story-from-snapshot").disabled = false;
    loadSnapshot(data);
    log("Loaded snapshot: " + name);
    setStatus("Session replay (offline)");
    // Switch to the vehicle-info tab so the user sees the loaded data
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    const infoTab = document.querySelector('.tab[data-view="info"]');
    if (infoTab) {
      infoTab.classList.add("active");
      $("view-info").classList.add("active");
    }
  } catch (e) {
    log("Failed to load snapshot: " + e);
    setStatus("Disconnected");
  }
}

$("btn-snapshot-refresh").addEventListener("click", refreshSnapshots);

$("btn-snapshot-load-file").addEventListener("click", () => {
  $("snapshot-load-file").click();
});

$("snapshot-load-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = await invoke("import_session", { content: reader.result });
      loadSnapshot(data);
      log("Loaded snapshot from file: " + file.name);
    } catch (err) {
      log("Failed to load session: " + err);
    }
    e.target.value = "";
  };
  reader.readAsText(file);
});
