/* BeeEmUu frontend — talks to the Rust backend via Tauri invoke. */

const invoke = window.__TAURI__.core.invoke;

const $ = (id) => document.getElementById(id);

let connected = false;
let modules = [];
let selectedAddress = null;
const gauges = new Map(); // id -> Gauge
let pollTimer = null;

/* ---------------- status bar ---------------- */
function setStatus(text, isConnected = connected) {
  $("status-text").textContent = text;
  $("status-conn").className = "status-dot " + (isConnected ? "on" : "off");
}
function log(text) {
  $("status-log").textContent = text;
}

/* ---------------- tabs ---------------- */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    $("view-" + tab.dataset.view).classList.add("active");
  });
});

/* ---------------- connection ---------------- */
$("conn-kind").addEventListener("change", async () => {
  const kind = $("conn-kind").value;
  $("conn-kdcan-opts").classList.toggle("hidden", kind !== "kdcan");
  $("conn-enet-opts").classList.toggle("hidden", kind !== "enet");
  if (kind === "kdcan") await refreshPorts();
});

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
    return { kind: "kdcan", port: $("conn-port").value, dcan: $("conn-dcan").checked };
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
    await invoke("disconnect");
    connected = false;
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
    div.innerHTML =
      `<span class="ecu-status ${statusCls}"></span>` +
      `<span class="ecu-name">${m.name}</span>` +
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
  $("btn-clear-faults").disabled = false;
  $("freeze-panel").classList.add("hidden");
  await readFaults();
}

async function readFaults() {
  if (selectedAddress == null) return;
  const tbody = $("fault-rows");
  tbody.innerHTML = "<tr><td colspan='3' class='muted'>Reading…</td></tr>";
  try {
    const dtcs = await invoke("read_faults", { address: selectedAddress });
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
    const items = await invoke("read_freeze_frame", { address: selectedAddress, code });
    body.innerHTML = "";
    for (const it of items) {
      const cell = document.createElement("div");
      cell.className = "freeze-item";
      cell.innerHTML = `<div class="fi-label">${it.label}</div><div class="fi-value">${it.value}</div>`;
      body.appendChild(cell);
    }
  } catch (e) {
    body.innerHTML = `<span class='muted'>No freeze frame available (${e})</span>`;
  }
}

$("btn-read-faults").addEventListener("click", readFaults);

$("btn-clear-faults").addEventListener("click", async () => {
  if (selectedAddress == null) return;
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
});

async function pollOnce() {
  try {
    const values = await invoke("read_live_data", { profile: $("live-profile").value });
    for (const v of values) ensureGauge(v).set(v.value);
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
  for (const sf of list) {
    const item = document.createElement("div");
    item.className = "service-item";
    item.innerHTML =
      `<div class="service-info">` +
      `<div class="service-label">${sf.label}</div>` +
      `<div class="service-desc">${sf.description}</div>` +
      `</div>` +
      `<span class="risk-tag risk-${sf.risk}">${sf.risk === "high" ? "ACTUATES HARDWARE" : "RESET"}</span>`;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Run";
    btn.addEventListener("click", async () => {
      if (!connected) { log("Connect first."); return; }
      const warning = sf.risk === "high"
        ? `"${sf.label}" actuates vehicle hardware.\n\n${sf.description}\n\nProceed?`
        : `Run "${sf.label}"?`;
      if (!confirm(warning)) return;
      btn.disabled = true;
      try {
        const msg = await invoke("run_service_function", { id: sf.id });
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

/* ---------------- parameter explorer ---------------- */
let watchTimer = null;
let watchTarget = null; // { address, mode, id }
let lastBytes = null;

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

function startWatch(address, mode, id, itemEl) {
  document.querySelectorAll(".exp-result-item").forEach((el) => el.classList.remove("selected"));
  itemEl.classList.add("selected");
  watchTarget = { address, mode, id };
  lastBytes = null;
  const idHex = id.toString(16).toUpperCase().padStart(mode === "did" ? 4 : 2, "0");
  $("exp-watch-title").textContent = `Watch — ${mode} ${idHex}`;
  $("exp-watch-poll").checked = true;
  if (!watchTimer) watchTimer = setInterval(watchOnce, 300);
  watchOnce();
}

async function watchOnce() {
  if (!watchTarget) return;
  try {
    const bytes = await invoke("read_raw", watchTarget);
    const el = $("exp-watch-bytes");
    el.innerHTML = "";
    bytes.forEach((b, i) => {
      const changed = lastBytes && lastBytes[i] !== b;
      const cell = document.createElement("div");
      cell.className = "watch-byte" + (changed ? " changed" : "");
      cell.innerHTML =
        `<div class="wb-hex">${b.toString(16).toUpperCase().padStart(2, "0")}</div>` +
        `<div class="wb-dec">${b}</div>` +
        `<div class="wb-idx">[${i}]</div>`;
      el.appendChild(cell);
    });
    lastBytes = bytes;
  } catch (e) {
    log("Watch: " + e);
    stopWatch();
  }
}

function stopWatch() {
  clearInterval(watchTimer);
  watchTimer = null;
  $("exp-watch-poll").checked = false;
}

$("exp-watch-poll").addEventListener("change", (e) => {
  if (e.target.checked) {
    if (!watchTarget) { e.target.checked = false; return; }
    if (!watchTimer) watchTimer = setInterval(watchOnce, 300);
  } else {
    stopWatch();
  }
});

/* ---------------- logging + charts ---------------- */
const LOG_COLORS = ["#4da3ff", "#ff7d33", "#3ddc84", "#e05545", "#c084fc",
                    "#f4b400", "#26c6da", "#ec407a", "#9ccc65", "#8d6e63"];
let logChart = null;
let logTimer = null;
let logStart = 0;
const logSeries = new Map(); // id -> { label, unit, data: [{x,y}], enabled, color }

async function buildLogParams() {
  // use the selected profile's parameters as the available series
  const profile = $("log-profile").value;
  let values = [];
  try {
    // one probe read to learn the parameter set (works while connected)
    values = connected ? await invoke("read_live_data", { profile }) : [];
  } catch (_) { values = []; }
  const el = $("log-params");
  el.innerHTML = "";
  logSeries.clear();
  values.forEach((v, i) => {
    const color = LOG_COLORS[i % LOG_COLORS.length];
    logSeries.set(v.id, { label: v.label, unit: v.unit, data: [], enabled: i < 3, color });
    const row = document.createElement("label");
    row.className = "log-param";
    row.innerHTML =
      `<input type="checkbox" ${i < 3 ? "checked" : ""} data-id="${v.id}" />` +
      `<span class="swatch" style="background:${color}"></span>` +
      `<span>${v.label}</span>`;
    row.querySelector("input").addEventListener("change", (e) => {
      const s = logSeries.get(v.id);
      if (s) s.enabled = e.target.checked;
      rebuildChart();
    });
    el.appendChild(row);
  });
  if (values.length === 0) {
    el.innerHTML = "<p class='muted' style='padding:8px;font-size:12px'>Connect first, then reopen this tab to load parameters.</p>";
  }
  rebuildChart();
}

function rebuildChart() {
  if (typeof Chart === "undefined") return;
  const datasets = [];
  for (const [, s] of logSeries) {
    if (!s.enabled) continue;
    datasets.push({
      label: `${s.label} (${s.unit})`,
      data: s.data,
      borderColor: s.color,
      backgroundColor: s.color,
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.25,
    });
  }
  if (logChart) {
    logChart.data.datasets = datasets;
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
      plugins: { legend: { labels: { boxWidth: 12 } } },
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
      if (s) s.data.push({ x: t, y: v.value });
    }
    if (logChart) logChart.update("none");
  } catch (e) {
    log("Logging: " + e);
    stopLogging();
  }
}

function startLogging() {
  if (!connected) { log("Connect first."); return; }
  if (logTimer) return;
  logStart = Date.now();
  for (const [, s] of logSeries) s.data.length = 0;
  logTimer = setInterval(logTick, 250);
  $("btn-log-start").textContent = "Stop recording";
  $("btn-log-start").classList.remove("btn-primary");
  $("btn-log-export").disabled = false;
  $("btn-log-clear").disabled = false;
  $("log-status").textContent = "Recording…";
}
function stopLogging() {
  clearInterval(logTimer);
  logTimer = null;
  $("btn-log-start").textContent = "Start recording";
  $("btn-log-start").classList.add("btn-primary");
  $("log-status").textContent = "Stopped.";
}

$("btn-log-start").addEventListener("click", () => {
  if (logTimer) stopLogging(); else startLogging();
});
$("btn-log-clear").addEventListener("click", () => {
  for (const [, s] of logSeries) s.data.length = 0;
  if (logChart) logChart.update("none");
  $("log-status").textContent = "Cleared.";
});
$("btn-log-export").addEventListener("click", async () => {
  // build CSV: time + each enabled series (sampled rows aligned by index)
  const enabled = [...logSeries.entries()].filter(([, s]) => s.enabled && s.data.length);
  if (!enabled.length) { log("Nothing recorded yet."); return; }
  const rows = enabled[0][1].data.length;
  let csv = "time_s," + enabled.map(([, s]) => `${s.label} (${s.unit})`).join(",") + "\n";
  for (let i = 0; i < rows; i++) {
    const t = enabled[0][1].data[i]?.x ?? "";
    csv += [t.toFixed ? t.toFixed(2) : t, ...enabled.map(([, s]) => s.data[i]?.y ?? "")].join(",") + "\n";
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  try {
    const path = await invoke("export_text", { filename: `beeemuu-log-${stamp}.csv`, content: csv });
    log("Saved: " + path);
  } catch (e) {
    log("Export failed: " + e);
  }
});
$("log-profile").addEventListener("change", buildLogParams);

/* ---------------- vehicle info ---------------- */
let lastVehicleInfo = null;

$("btn-info-read").addEventListener("click", async () => {
  if (!connected) { log("Connect first."); return; }
  const body = $("info-body");
  body.innerHTML = "<p class='muted'>Reading…</p>";
  try {
    const info = await invoke("read_vehicle_info");
    lastVehicleInfo = info;
    renderVehicleInfo(info);
    $("btn-info-export").disabled = false;
  } catch (e) {
    body.innerHTML = `<p class='muted'>Read failed: ${e}</p>`;
  }
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

$("btn-info-export").addEventListener("click", async () => {
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
    txt += m.present ? ` | faults: ${m.fault_count ?? 0}${m.ident ? " | " + m.ident : ""}\n` : "\n";
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  try {
    const path = await invoke("export_text", { filename: `beeemuu-vehicle-${stamp}.txt`, content: txt });
    log("Saved: " + path);
  } catch (e) {
    log("Export failed: " + e);
  }
});

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

$("btn-set-session").addEventListener("click", async () => {
  if (!connected) { log("Connect first."); return; }
  const address = parseInt($("sec-address").value, 10);
  const session = parseInt($("sec-session").value, 10);
  setSecStatus(false);
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
  try {
    const ok = await invoke("security_access", { address, level: 1 });
    setSecStatus(true);
    log(ok ? "Security access granted" : "Already unlocked");
  } catch (e) {
    setSecStatus(false);
    log("Unlock failed: " + e);
  }
});

function setSecStatus(unlocked) {
  const el = $("sec-status");
  el.textContent = unlocked ? "Unlocked" : "Locked";
  el.className = "sec-status" + (unlocked ? " unlocked" : "");
}

/* ---------------- tab activation hooks ---------------- */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.dataset.view === "logging") buildLogParams();
  });
});

/* ---------------- init ---------------- */
loadServiceFunctions();
loadProfiles();
loadLogProfiles();
fillExplorerEcus();
fillSecurityEcus();
setStatus("Disconnected");

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
