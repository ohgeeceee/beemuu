

/* v3 IIFE wrapper — see scripts/wrap_v3_iife.py. Every classic
 * tag shares one global lexical scope, so a bare top-level `const` in
 * one file is a redeclaration error in the next. */
(function () {
"use strict";
"use strict";

/* v3 analysis panels — DOM layer.
 *
 * Ten engines shipped in the v3.0.0 cycle; this file mounts the panels that
 * surface them. It is a thin shim by design, following the cbs_ui.js and
 * plugins_ui.js pattern: no analysis happens here, every number comes from a
 * pure engine via `window.beeemuu*`.
 *
 * Three rules this file follows without exception:
 *
 *   1. **All text goes in via `textContent`.** Every engine consumes
 *      community-contributed strings and log-derived labels. `innerHTML` with
 *      any of that is an injection point, and the app has a plugin system that
 *      makes untrusted strings routine rather than exceptional.
 *   2. **A missing engine is not a crash.** Each mount checks for its engine
 *      and returns quietly. The app ships these as separate <script> tags, so
 *      a load failure must degrade to "panel absent", never to a blank window.
 *   3. **No panel claims more than its data supports.** Replay is labelled
 *      replay, an unmeasured drift series says so, and a low-confidence tuning
 *      verdict is not dressed up as a verdict.
 *
 * Every panel registers with `window.beeemuuV3.onData` rather than polling.
 */

function $(id) { return document.getElementById(id); }
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function clear(node) { if (node) node.replaceChildren(); }
function muted(node, text) {
  clear(node);
  node.append(el("p", text, "muted"));
}
function pill(kind, label) {
  return el("span", label, `v3-pill v3-pill-${kind}`);
}
function bridge() { return window.beeemuuV3 || null; }

/* ================================================================== *
 * 1. Misfire Pattern Recognition — reads the live log session
 * ================================================================== */
function mountMisfire() {
  const body = $("v3-misfire-body");
  const btn = $("v3-misfire-run");
  const api = window.beeemuuMisfirePatterns;
  if (!body || !api) return;

  function run() {
    const b = bridge();
    const series = b ? b.logSeries() : null;
    if (!series || typeof series.forEach !== "function" || series.size === 0) {
      muted(body, "No log data yet. Start a recording that includes per-cylinder misfire counters, then run this analysis.");
      return;
    }
    const events = api.collectEvents(series, { startId: "engineStart" });
    const result = api.analyze(events);
    clear(body);

    if (!result.total_events) {
      const found = api.misfireChannels(series).length;
      muted(body, found
        ? `Found ${found} misfire channel(s) in this log, but none incremented. Nothing to correlate.`
        : "This log contains no per-cylinder misfire channels. Record with misfire counters enabled.");
      return;
    }
    if (b && b.isReplay()) {
      body.append(el("p", "Viewing a loaded snapshot — these figures describe the recorded drive, not the car right now.", "muted v3-note"));
    }
    body.append(el("p", `${result.total_events} misfire event(s) across ${result.cylinders.length} cylinder(s).`, "muted v3-note"));

    for (const p of result.patterns) {
      const kind = p.confidence > 0 ? (p.single_cylinder ? "warn" : "info") : "none";
      const card = el("div", undefined, `v3-card v3-${kind === "none" ? "muted-card" : kind}`);
      const head = el("div", undefined, "v3-card-head");
      head.append(el("span", `Cylinder ${p.cylinder}`, "v3-card-title"));
      head.append(pill(kind, p.confidence > 0 ? `${p.confidence}% confidence` : "no pattern"));
      card.append(head);
      card.append(el("p", p.diagnosis, "v3-card-body"));
      const meta = el("div", undefined, "v3-card-meta");
      meta.append(el("span", `${p.total_events} event(s)`));
      meta.append(el("span", p.single_cylinder ? "single-cylinder" : `${Math.round(p.share_of_all * 100)}% of all`));
      card.append(meta);
      body.append(card);
    }
  }

  if (btn) btn.addEventListener("click", run);
  muted(body, "Run after recording a drive that includes per-cylinder misfire counters.");
  window.beeemuuV3MisfirePanel = { run };
}

/* ================================================================== *
 * 2. Adaptation Drift Tracker — user-entered values, persisted
 * ================================================================== */
const DRIFT_KEY = "beeemuu.drift.v1";

function mountDrift() {
  const body = $("v3-drift-body");
  const api = window.beeemuuAdaptationDrift;
  if (!body || !api) return;

  let history = {};
  try {
    const raw = localStorage.getItem(DRIFT_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && typeof data === "object" && data.values) history = data.values;
    }
  } catch (_) { /* corrupt storage — start empty rather than fail the panel */ }

  function persist() {
    try { localStorage.setItem(DRIFT_KEY, JSON.stringify({ values: history })); }
    catch (_) { /* full or unavailable — the panel still works this session */ }
  }

  function record(paramId, value, threshold) {
    const at = Date.now();
    const list = Array.isArray(history[paramId]) ? history[paramId] : [];
    list.push({ t: at, value });
    // Keep the last 40 readings per parameter: enough to see a trend over
    // months, small enough that localStorage cannot fill up.
    history[paramId] = list.slice(-40);
    if (threshold != null && Number.isFinite(threshold)) {
      history.__thresholds = history.__thresholds || {};
      history.__thresholds[paramId] = threshold;
    }
    persist();
  }

  function render() {
    const thresholds = history.__thresholds || {};
    const ids = Object.keys(history).filter(k => k !== "__thresholds");
    clear(body);
    if (!ids.length) {
      muted(body, "Record a reading after each service. Three readings on the same parameter is the minimum before the tracker will call a trend.");
      return;
    }
    const meta = {};
    // Build the histories object explicitly rather than passing `history`
    // wholesale. `history` also carries `__thresholds`, which is a map and not
    // a list of observations — handing it to the engine makes it analyze the
    // thresholds as if they were readings.
    const histories = {};
    for (const id of ids) {
      histories[id] = history[id];
      if (thresholds[id] != null) meta[id] = { threshold: thresholds[id] };
    }
    const { reports, summary } = api.analyzeAll(histories, meta, { now: Date.now() });
    if (summary.act) {
      body.append(el("p", `${summary.act} parameter(s) need attention now.`, "muted v3-note v3-note-warn"));
    }
    for (const r of reports) {
      const kind = r.status === "insufficient_data" ? "none"
        : r.severity === "act" ? "danger"
        : r.severity === "watch" ? "warn" : "ok";
      const card = el("div", undefined, `v3-card v3-${kind === "none" ? "muted-card" : kind}`);
      const head = el("div", undefined, "v3-card-head");
      head.append(el("span", r.label, "v3-card-title"));
      head.append(pill(kind, r.status === "insufficient_data"
        ? `${r.samples} reading(s)`
        : r.severity === "ok" ? "steady" : r.severity));
      card.append(head);
      card.append(el("p", r.message, "v3-card-body"));
      if (r.slope_per_day !== null) {
        const m = el("div", undefined, "v3-card-meta");
        m.append(el("span", `${r.slope_per_day.toFixed(3)}${r.unit ? " " + r.unit : ""}/day`));
        m.append(el("span", `r = ${r.correlation.toFixed(2)}`));
        if (r.predict_crossing) {
          m.append(el("span", `limit in ~${r.predict_crossing.days_from_now} day(s)`));
        }
        card.append(m);
      }
      body.append(card);
    }
  }

  const paramInput = $("v3-drift-param");
  const valueInput = $("v3-drift-value");
  const thresholdInput = $("v3-drift-threshold");
  const addBtn = $("v3-drift-add");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      const id = ((paramInput && paramInput.value) || "").trim();
      const value = parseFloat(valueInput && valueInput.value);
      if (!id || !Number.isFinite(value)) {
        if (paramInput) paramInput.focus();
        return;
      }
      const threshold = thresholdInput ? parseFloat(thresholdInput.value) : NaN;
      record(id, value, Number.isFinite(threshold) ? threshold : null);
      if (valueInput) valueInput.value = "";
      render();
    });
  }
  render();
  window.beeemuuV3DriftPanel = { record, render };
}

/* ================================================================== *
 * 3. Tuning Fingerprint Detector — reads the live log session
 * ================================================================== */
function mountFingerprint() {
  const body = $("v3-fingerprint-body");
  const btn = $("v3-fingerprint-run");
  const api = window.beeemuuTuningFingerprint;
  if (!body || !api) return;

  function run() {
    const b = bridge();
    const series = b ? b.logSeries() : null;
    if (!series || typeof series.forEach !== "function" || series.size === 0) {
      muted(body, "No log data. Record a drive that covers idle through full load — a short log cannot speak for a calibration.");
      return;
    }
    // No stock baselines ship with the app: they are community-contributed per
    // engine, and inventing one would produce a confident verdict from nothing.
    // Saying so is the honest answer, and it is why the panel exists at all.
    const state = window.beeemuuSignalLibraryIndex;
    const baselines = state && state.baselines ? state.baselines : null;
    if (!baselines || !Object.keys(baselines).length) {
      muted(body, "No stock baseline is installed for this engine yet. Baselines are community-contributed; until one exists there is nothing to compare against, and this panel will not guess. The Signal Library shows which signals have a baseline.");
      return;
    }
    // Join each logged sample against the rpm/load channels, which is the shape
    // divergenceFor() bins on.
    const at = (id, x, tol) => {
      const s = series.get(id);
      if (!s || !Array.isArray(s.data)) return null;
      let best = null;
      for (const p of s.data) {
        if (!p || !Number.isFinite(p.y) || !Number.isFinite(p.x)) continue;
        if (p.x <= x && (best === null || p.x > best.x)) best = p;
      }
      if (!best) return null;
      return x - best.x <= (tol || 1.0) ? best.y : null;
    };
    const logs = {};
    for (const [id, s] of series) {
      if (!baselines[id]) continue;
      const rows = [];
      for (const p of (s.data || [])) {
        if (!p || !Number.isFinite(p.y) || !Number.isFinite(p.x)) continue;
        const rpm = at("rpm", p.x);
        const load = at("load", p.x);
        if (rpm == null || load == null) continue;
        rows.push({ rpm, load, value: p.y });
      }
      if (rows.length) logs[id] = rows;
    }
    if (!Object.keys(logs).length) {
      muted(body, "This log has no samples inside a baseline's rpm/load grid. Record a wider drive.");
      return;
    }
    const report = api.analyze(baselines, logs);
    clear(body);
    body.append(el("p", report.note, "muted v3-note"));
    for (const d of report.divergences) {
      const kind = d.deverged ? "danger" : d.cells_compared ? "ok" : "none";
      const card = el("div", undefined, `v3-card v3-${kind === "none" ? "muted-card" : kind}`);
      const head = el("div", undefined, "v3-card-head");
      head.append(el("span", d.label, "v3-card-title"));
      head.append(pill(kind, d.cells_compared ? `${d.confidence}% coverage` : "no data"));
      card.append(head);
      card.append(el("p", d.note, "v3-card-body"));
      body.append(card);
    }
    // The panel never names a tuning platform; say so, so the absence does not
    // read as an oversight.
    body.append(el("p", "This panel reports what deviated from stock. It does not name a tuning platform — that is a claim about provenance this data cannot support.", "muted v3-note"));
  }

  if (btn) btn.addEventListener("click", run);
  muted(body, "Run after recording a full pull from idle to redline.");
  window.beeemuuV3FingerprintPanel = { run };
}

/* ================================================================== *
 * 4. Flash Counter & History Auditor — reads saved snapshots
 * ================================================================== */
function mountFlashAudit() {
  const body = $("v3-flash-body");
  const refresh = $("v3-flash-refresh");
  const api = window.beeemuuFlashAudit;
  const invoke = window.__TAURI__ && window.__TAURI__.core
    ? window.__TAURI__.core.invoke : null;
  if (!body || !api || !invoke) return;

  async function load() {
    let files = [];
    try {
      files = await invoke("list_exports");
    } catch (e) {
      muted(body, "Could not read the exports folder: " + String(e));
      return;
    }
    const snapshots = [];
    // Only session snapshots carry per-module programming data; CSV exports and
    // the like are skipped rather than parsed and found empty.
    for (const f of files) {
      const name = String(f);
      if (!/session.*\.json$/i.test(name)) continue;
      try {
        const text = await invoke("read_export_text", { filename: name.split(/[\\/]/).pop() });
        const data = JSON.parse(text);
        if (data && (data.modules || data.modules_by_address)) snapshots.push(data);
      } catch (_) { /* unreadable or not a snapshot — skip it */ }
    }

    clear(body);
    if (snapshots.length < 2) {
      muted(body, `Found ${snapshots.length} diagnostic snapshot(s). Programming history needs at least two, taken at least an hour apart — export a session snapshot now and again after your next drive.`);
      return;
    }
    const result = api.audit(snapshots);
    if (result.summary.note) body.append(el("p", result.summary.note, "muted v3-note"));
    body.append(el("p", `${result.summary.flashed} module(s) show programming across ${snapshots.length} snapshots.`, "muted v3-note"));
    for (const m of result.modules) {
      const flashed = m.events.some(e => e.kind === "flash");
      const reset = m.events.some(e => e.kind === "counter_reset");
      const kind = flashed ? "warn" : reset ? "info" : "none";
      const card = el("div", undefined, `v3-card v3-${kind === "none" ? "muted-card" : kind}`);
      const head = el("div", undefined, "v3-card-head");
      head.append(el("span", m.name || `0x${(m.address || 0).toString(16)}`, "v3-card-title"));
      head.append(pill(kind, m.current_count != null ? `count ${m.current_count}` : "no counter"));
      card.append(head);
      card.append(el("p", m.note, "v3-card-body"));
      const meta = el("div", undefined, "v3-card-meta");
      meta.append(el("span", `${m.readings} reading(s)`));
      if (m.gaps) meta.append(el("span", `${m.gaps} snapshot(s) missing`));
      if (m.programming_date) {
        meta.append(el("span", `programmed ${new Date(m.programming_date).toISOString().slice(0, 10)}`));
      }
      card.append(meta);
      body.append(card);
    }
  }

  if (refresh) refresh.addEventListener("click", load);
  muted(body, "Reads the snapshots already in your exports folder — no live session needed.");
  window.beeemuuV3FlashPanel = { load };
}

/* ================================================================== *
 * 5. Cold Start Auto-Logger
 * ================================================================== */
const COLD_KEY = "beeemuu.coldstart.v1";

function mountColdStart() {
  const status = $("v3-cold-status");
  const armBtn = $("v3-cold-arm");
  const disarmBtn = $("v3-cold-disarm");
  const countEl = $("v3-cold-count");
  const api = window.beeemuuColdStart;
  if (!status || !api) return;

  let monitor = null;
  function render(r) {
    clear(status);
    if (!monitor) {
      status.append(el("p", "Not armed. Arm it before you leave: the logger opens the capture window itself when it sees a cold start.", "muted"));
      if (countEl) countEl.textContent = "";
      return;
    }
    const line = el("p", undefined, "v3-cold-line");
    line.append(pill(monitor.isLogging() ? "warn" : monitor.isArmed() ? "info" : "none",
      monitor.isLogging() ? "capturing" : monitor.isArmed() ? "armed" : "idle"));
    line.append(el("span", r && r.reason ? r.reason : "waiting for observations"));
    status.append(line);
    if (countEl) countEl.textContent = `${monitor.captureCount()} capture(s) this session`;
  }

  if (armBtn) {
    armBtn.addEventListener("click", () => {
      monitor = api.createMonitor();
      try { localStorage.setItem(COLD_KEY, "armed"); } catch (_) { /* not required */ }
      render(null);
    });
  }
  if (disarmBtn) {
    disarmBtn.addEventListener("click", () => {
      monitor = null;
      try { localStorage.removeItem(COLD_KEY); } catch (_) { /* not required */ }
      render(null);
    });
  }
  render(null);
  window.beeemuuV3ColdPanel = {
    /* Exposed so the live-data poll can feed observations without this file
     * knowing anything about polling. */
    monitor: () => monitor,
    observe(sample) {
      if (!monitor) return null;
      const r = monitor.tick(sample);
      render(r);
      return r;
    },
  };
}

/* ================================================================== *
 * 6. Parameter Hunt
 * ================================================================== */
const HUNT_KEY = "beeemuu.hunt.v1";

function mountHunt() {
  const body = $("v3-hunt-body");
  const addBtn = $("v3-hunt-add");
  const note = $("v3-hunt-note");
  const api = window.beeemuuParameterHunt;
  if (!body || !api) return;

  let hunter = api.createHunter("You");
  try {
    const raw = localStorage.getItem(HUNT_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved) && saved.length) {
        hunter = api.createHunter("You");
        for (const d of saved) hunter.add(d);
      }
    }
  } catch (_) { /* corrupt storage — start fresh */ }

  function persist() {
    try {
      localStorage.setItem(HUNT_KEY, JSON.stringify(hunter.findings().map(f => ({
        kind: f.kind, engine: f.engine, module: f.module, ident: f.ident,
        label: f.label, verified: f.verified,
      }))));
    } catch (_) { /* full or unavailable — the board still renders */ }
  }

  function render() {
    clear(body);
    const findings = hunter.findings();
    const scored = findings.filter(f => f.counted);
    body.append(el("p", `${hunter.total()} points from ${scored.length} finding(s). ${hunter.pending().length} awaiting confirmation.`, "muted v3-note"));
    if (scored.length) {
      const board = el("div", undefined, "v3-board");
      const sorted = scored.slice().sort((a, b) => b.points - a.points);
      for (const f of sorted.slice(0, 10)) {
        const row = el("div", undefined, "v3-board-row");
        row.append(el("span", String(f.points), "v3-board-points"));
        row.append(el("span", `${f.engine} ${f.module}${f.ident ? " " + f.ident : ""}`));
        row.append(pill(f.verified ? "ok" : "none", f.verified ? "confirmed" : "self-reported"));
        board.append(row);
      }
      body.append(board);
    }
    const pending = hunter.pending();
    if (pending.length) {
      body.append(el("p", `Confirming these would add: ${pending.map(p => p.would_gain).join(", ")} points. Confirmation comes from a merged community record, not from anything typed here.`, "muted v3-note"));
    }
  }

  if (addBtn) {
    addBtn.addEventListener("click", () => {
      const pick = id => { const n = $(id); return n ? n.value : undefined; };
      const d = {
        kind: pick("v3-hunt-kind"),
        engine: (pick("v3-hunt-engine") || "").trim(),
        module: (pick("v3-hunt-module") || "").trim(),
      };
      const ident = (pick("v3-hunt-ident") || "").trim();
      if (ident) d.ident = ident;
      const result = hunter.add(d);
      persist();
      render();
      if (note) note.textContent = result.counted ? `+${result.points} points — ${result.reason}` : result.reason;
    });
  }
  render();
  window.beeemuuV3HuntPanel = { hunter, render };
}

/* ================================================================== *
 * 7. Symptom Index
 * ================================================================== */
function mountSymptom() {
  const input = $("v3-symptom-input");
  const body = $("v3-symptom-body");
  const btn = $("v3-symptom-run");
  const api = window.beeemuuSymptomIndex;
  if (!body || !api) return;

  function run() {
    const result = api.diagnose(input ? input.value : "");
    clear(body);
    if (!result.matched.length) {
      body.append(el("p", result.note, "muted"));
      return;
    }
    body.append(el("p", `Matched ${result.matched.length} symptom description(s). These are candidates to investigate, not a diagnosis.`, "muted v3-note"));
    for (const m of result.matched) {
      const card = el("div", undefined, "v3-card v3-info");
      const head = el("div", undefined, "v3-card-head");
      head.append(el("span", m.title, "v3-card-title"));
      head.append(pill("info", String(m.score)));
      card.append(head);
      card.append(el("p", m.description, "v3-card-body"));
      body.append(card);
    }
    if (result.codes.length) {
      const box = el("div", undefined, "v3-list");
      box.append(el("h4", "Candidate codes"));
      for (const c of result.codes) {
        const row = el("div", undefined, "v3-list-row");
        row.append(el("span", c.code, "v3-code"));
        row.append(el("span", c.note));
        row.append(pill(c.confidence === "verified" ? "ok" : "none", c.confidence));
        if (c.circuit === false) row.append(el("span", "no published circuit", "v3-tag"));
        box.append(row);
      }
      body.append(box);
    }
    if (result.components.length) {
      const box = el("div", undefined, "v3-list");
      box.append(el("h4", "Components to inspect"));
      box.append(el("p", result.components.join(", ")));
      body.append(box);
    }
    if (result.checks.length) {
      const box = el("div", undefined, "v3-list");
      box.append(el("h4", "Checks worth doing first"));
      const ul = el("ul");
      for (const c of result.checks) ul.append(el("li", c));
      box.append(ul);
      body.append(box);
    }
  }

  if (btn) btn.addEventListener("click", run);
  if (input) {
    input.addEventListener("keydown", e => { if (e.key === "Enter") run(); });
    input.addEventListener("input", () => {
      if (input.value.trim()) run();
      else muted(body, "Describe what the car is doing in your own words.");
    });
  }
  muted(body, "Describe what the car is doing in your own words.");
  window.beeemuuV3SymptomPanel = { run };
}

/* ================================================================== *
 * 8. Signal Library
 * ================================================================== */
function mountSignalLibrary() {
  const input = $("v3-signal-input");
  const body = $("v3-signal-body");
  const engineSel = $("v3-signal-engine");
  const verifiedOnly = $("v3-signal-verified");
  const api = window.beeemuuSignalLibrary;
  const state = window.beeemuuSignalLibraryIndex;
  if (!body || !api || !state || !state.index) return;

  function fillEngines() {
    if (!engineSel) return;
    engineSel.replaceChildren();
    const all = el("option", "All engines");
    all.value = "";
    engineSel.append(all);
    for (const e of state.index.engines) {
      const o = el("option", e);
      o.value = e;
      engineSel.append(o);
    }
  }

  function render() {
    const q = input ? input.value : "";
    const engine = engineSel ? engineSel.value : "";
    const rows = api.search(state.index, q, {
      engine: engine || null,
      verifiedOnly: !!(verifiedOnly && verifiedOnly.checked),
    });
    clear(body);
    const s = state.index.summary;
    body.append(el("p", `${s.total} signals: ${s.verified} verified, ${s.community} community, ${s.unverified} unverified.`, "muted v3-note"));
    if (!rows.length) {
      body.append(el("p", "Nothing matched.", "muted"));
      return;
    }
    const list = el("div", undefined, "v3-signal-list");
    for (const sig of rows.slice(0, 200)) {
      const row = el("div", undefined, "v3-signal-row");
      const name = el("div", undefined, "v3-signal-name");
      name.append(el("span", sig.label, "v3-card-title"));
      if (sig.unit) name.append(el("span", ` (${sig.unit})`, "muted"));
      row.append(name);
      row.append(el("span", sig.query || "—", "v3-signal-query"));
      row.append(pill(sig.confidence === "verified" ? "ok" : sig.confidence === "community" ? "info" : "warn", sig.confidence));
      // A split verdict must be visible, not hidden behind the best grade.
      if (sig.partially_verified && sig.unverified_on.length) {
        row.append(el("span", `unverified on ${sig.unverified_on.join(", ")}`, "v3-tag v3-tag-warn"));
      }
      row.append(el("span", `${sig.engines.length} engine(s)`, "muted"));
      list.append(row);
    }
    body.append(list);
    if (rows.length > 200) {
      body.append(el("p", `Showing the first 200 of ${rows.length}. Narrow the search to see the rest.`, "muted"));
    }
    body.append(el("p", s.note, "muted v3-note"));
  }

  fillEngines();
  if (input) input.addEventListener("input", render);
  if (engineSel) engineSel.addEventListener("change", render);
  if (verifiedOnly) verifiedOnly.addEventListener("change", render);
  render();
  window.beeemuuV3SignalPanel = { render, index: state.index };
}

/* ================================================================== *
 * 9. Vehicle Passport
 * ================================================================== */
function mountPassport() {
  const body = $("v3-passport-body");
  const btn = $("v3-passport-build");
  const saveBtn = $("v3-passport-save");
  const api = window.beeemuuVehiclePassport;
  if (!body || !api) return;
  let built = null;

  function build() {
    const b = bridge();
    const mods = b ? b.vehicleModules() : [];
    const builtPass = api.buildPassport({
      vehicle: { label: "Vehicle" },
      modules: (mods || []).map(m => ({
        address: m.address,
        name: m.name,
        ident: m.ident,
        software_version: m.software_version,
        flash_count: m.flash_count != null ? m.flash_count : undefined,
      })),
      adaptations: [],
      cbs: [],
    });
    built = builtPass;
    clear(body);
    body.append(el("p", api.summarize(builtPass) || "Passport built.", "muted v3-note"));
    const removed = builtPass.privacy.removed_fields;
    body.append(el("p", removed.length
      ? `Removed before sharing: ${removed.join(", ")}.`
      : "Nothing identifying was found in the current session.", "muted v3-note"));
    body.append(el("p", builtPass.privacy.note, "muted v3-note"));
    body.append(el("pre", JSON.stringify(builtPass, null, 2), "v3-code"));
  }

  if (btn) btn.addEventListener("click", build);
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      if (!built) { build(); }
      if (!built) return;
      const blob = new Blob([JSON.stringify(built, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "beemuu-passport.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  }
  muted(body, "Build a portable record of this car. The VIN is never included and there is no option to include it.");
  window.beeemuuV3PassportPanel = { build, passport: () => built };
}

/* ================================================================== *
 * Boot
 * ================================================================== */
/* Each mount is isolated: a panel that throws must not stop the others, and
 * must certainly not break the app shell. */
function mountAll() {
  const mounts = [
    mountMisfire, mountDrift, mountFingerprint, mountFlashAudit, mountColdStart,
    mountHunt, mountSymptom, mountSignalLibrary, mountPassport,
  ];
  for (const m of mounts) {
    try { m(); } catch (e) {
      // eslint-disable-next-line no-console
      console.error("v3 panel failed to mount:", e);
    }
  }
}
window.mountV3Panels = mountAll;

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll);
  } else {
    mountAll();
  }
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { mountAll, DRIFT_KEY, HUNT_KEY, COLD_KEY };
}
})();
