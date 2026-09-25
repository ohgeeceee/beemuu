/* Predictive CBS Timeline UI. Pure DOM controller: reads the prediction engine
 * (window.CbsPredict), renders input fields for each service item, and shows
 * predicted due km/date sorted by soonest. Snapshots (km + per-item values +
 * date) are kept in localStorage so the engine can learn the owner's real wear
 * rate. Driving profile is persisted too.
 *
 * Mirrors plugins_ui.js: mounts on existing DOM ids, no build step, defensive
 * about missing storage. All rendered text is set via textContent. */
"use strict";
window.mountCbsTimeline = function () {
  const byId = id => document.getElementById(id);
  const api = window.CbsPredict;
  const STORAGE_KEY = "beeemuu.cbs.v1";
  const body = byId("cbs-body");
  if (!body || !api) return;

  let snapshots = [];
  let driving = "mixed";
  let values = {};
  let savedKm = null;

  function loadStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.snapshots)) snapshots = data.snapshots;
      if (typeof data.driving === "string" && api.DRIVING_FACTORS[data.driving]) driving = data.driving;
      if (data.values && typeof data.values === "object") values = data.values;
      if (data.km != null) savedKm = data.km;
    } catch (_) { /* corrupt storage — start fresh */ }
  }
  function saveStorage() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ snapshots, driving, values, km: savedKm })); }
    catch (_) { /* storage full/unavailable — predictions still render */ }
  }
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function renderInputs() {
    const box = byId("cbs-inputs");
    box.replaceChildren();
    for (const id of Object.keys(api.CBS_ITEMS)) {
      const item = api.CBS_ITEMS[id];
      const row = el("div", undefined, "cbs-input-row");
      const label = el("label", `${item.label} (${item.unit})`);
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.min = "0";
      input.id = `cbs-val-${id}`;
      input.placeholder = item.unit === "mm" ? "e.g. 5" : item.unit === "mo" ? "e.g. 12" : "e.g. 10000";
      if (values[id] !== undefined) input.value = values[id];
      input.addEventListener("change", () => {
        const v = parseFloat(input.value);
        if (Number.isFinite(v) && v >= 0) { values[id] = v; saveStorage(); update(); }
      });
      label.htmlFor = input.id;
      row.append(label, input);
      box.append(row);
    }
  }

  function currentKm() {
    return savedKm != null && Number.isFinite(savedKm) && savedKm >= 0 ? savedKm : null;
  }

  function update() {
    const km = currentKm();
    if (km == null) {
      byId("cbs-results").replaceChildren(el("p", "Enter your current odometer reading to see the predicted timeline.", "muted"));
      return;
    }
    const history = snapshots.flatMap(s => Object.entries(s.values || {}).map(([id, v]) => ({ id, km: s.km, value: v })));
    const preds = api.predictAll(values, km, history, driving, snapshots);
    const box = byId("cbs-results");
    box.replaceChildren();
    if (!preds.length) { box.append(el("p", "Enter at least one current reading above.", "muted")); return; }
    for (const p of preds) {
      const card = el("div", undefined, `cbs-pred cbs-${p.current_status.toLowerCase()}`);
      const head = el("div", undefined, "cbs-pred-head");
      head.append(el("span", p.label, "cbs-name"), el("span", p.current_status, "cbs-status"));
      card.append(head);
      const detail = el("div", undefined, "cbs-pred-detail");
      const dueKm = p.predicted_due_km != null ? `~${Math.round(p.predicted_due_km).toLocaleString()} km` : "—";
      const dueDate = p.predicted_due_date ? ` (${p.predicted_due_date})` : "";
      detail.append(el("span", `Current: ${p.current_value} ${p.unit} → due ${dueKm}${dueDate}`));
      detail.append(el("span", `Estimate: ${p.driving_adjustment} · ${p.confidence}% confidence`));
      card.append(detail);
      box.append(card);
    }
  }

  function snapshot() {
    const km = currentKm();
    if (km == null) { update(); return; }
    const taken = Object.keys(api.CBS_ITEMS).reduce((acc, id) => {
      if (values[id] !== undefined) acc[id] = values[id];
      return acc;
    }, {});
    if (!Object.keys(taken).length) { update(); return; }
    snapshots.push({ km, values: taken, date: new Date().toISOString().slice(0, 10) });
    // keep the last 60 snapshots
    snapshots = snapshots.slice(-60);
    saveStorage();
    update();
  }

  loadStorage();
  byId("cbs-driving").value = driving;

  byId("cbs-driving").addEventListener("change", e => { driving = e.target.value; saveStorage(); update(); });
  byId("cbs-update").addEventListener("click", update);
  byId("cbs-snapshot").addEventListener("click", snapshot);

  renderInputs();

  // Odometer input lives in the info-body header; add it once, AFTER
  // renderInputs() (which replaces the inputs container's children).
  const kmRow = el("div", undefined, "cbs-input-row cbs-km-row");
  const kmLabel = el("label", "Current odometer (km)");
  const kmInput = document.createElement("input");
  kmInput.type = "number";
  kmInput.step = "any";
  kmInput.min = "0";
  kmInput.id = "cbs-km";
  kmInput.placeholder = "e.g. 120000";
  kmInput.addEventListener("change", () => {
    const v = parseFloat(kmInput.value);
    savedKm = Number.isFinite(v) && v >= 0 ? v : null;
    saveStorage();
    update();
  });
  kmLabel.htmlFor = kmInput.id;
  kmRow.append(kmLabel, kmInput);
  byId("cbs-inputs").prepend(kmRow);
  if (savedKm != null) kmInput.value = savedKm;

  update();
};
