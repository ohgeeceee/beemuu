"use strict";
(function () {
  const api = window.BeemuuRepairVerification;
  const status = document.getElementById("repair-check-status");
  const list = document.getElementById("repair-check-list");
  if (!api || !status || !list) return;
  const PENDING = "beeemuu.repair.pending.v1";
  const SAVED = "beeemuu.repair.checks.v1";
  const state = () => window.beeemuuV3;
  const vehicleId = () => window.beeemuuGarageActiveId ? window.beeemuuGarageActiveId() : null;
  const current = () => {
    const app = state();
    const modules = app?.vehicleModules?.() || [];
    if (!modules.length || !app?.faultMemoryRead?.()) return null;
    const selectedVehicleId = vehicleId();
    const selectedVehicle = window.BeemuuGarage?.read(localStorage).vehicles.find(v => v.id === selectedVehicleId);
    const currentVin = window.BeemuuGarage?.normalizeVin(app.vehicleInfo?.()?.vin);
    if (!selectedVehicle || window.BeemuuGarage.normalizeVin(selectedVehicle.vin) !== currentVin) return null;
    const selectedAddress = app.vehicleAddress?.();
    const selectedDtcs = app.dtcs?.() || [];
    return { capturedAt: new Date().toISOString(), vehicleId: selectedVehicleId, modules: modules.map(m => ({
      name: m.name || "Unknown module", address: m.address ?? m.addr ?? null,
      dtcs: (Array.isArray(m.dtcs) ? m.dtcs : (m.address === selectedAddress ? selectedDtcs : [])).map(d => ({ ...d, address: d.address ?? m.address ?? m.addr })),
    })) };
  };
  function saved() { try { const rows = JSON.parse(localStorage.getItem(SAVED) || "[]"); return Array.isArray(rows) ? rows : []; } catch (_) { return []; } }
  function render() {
    list.replaceChildren();
    for (const check of saved().slice().reverse()) {
      const card = document.createElement("article"); card.className = "repair-check-card";
      const title = document.createElement("strong"); title.textContent = check.note || "Repair check";
      const detail = document.createElement("p"); detail.className = "muted";
      const faults = check.faults || {};
      detail.textContent = `${new Date(check.createdAt).toLocaleString()} · baseline ${new Date(check.before?.capturedAt || 0).toLocaleString()} · follow-up ${new Date(check.after?.capturedAt || 0).toLocaleString()} · ${faults.cleared?.length || 0} no longer reported · ${faults.remaining?.length || 0} still reported · ${faults.newFaults?.length || 0} newly reported`;
      const disclaimer = document.createElement("p"); disclaimer.className = "muted"; disclaimer.textContent = "Comparison of saved scans only; this does not confirm a repair or clear faults.";
      card.append(title, detail);
      for (const [label, rows] of [["No longer reported", faults.cleared], ["Still reported", faults.remaining], ["Newly reported", faults.newFaults]]) {
        if (!Array.isArray(rows) || !rows.length) continue;
        const group = document.createElement("p");
        group.textContent = `${label}: ${rows.map(d => `${d.module || "Unknown module"} ${d.code || ""}${d.text ? ` — ${d.text}` : ""}`).join("; ")}`;
        card.append(group);
      }
      card.append(disclaimer); list.append(card);
    }
    if (!list.childElementCount) { const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "No repair comparisons saved."; list.append(empty); }
  }
  document.getElementById("repair-capture-baseline")?.addEventListener("click", () => {
    const scan = current();
    if (!scan) { status.textContent = "Run a vehicle test and read fault memory first."; return; }
    if (!scan.vehicleId) { status.textContent = "Select or add this vehicle in My Garage before saving a repair check."; return; }
    localStorage.setItem(PENDING, JSON.stringify(scan));
    status.textContent = `Baseline captured for the selected garage vehicle at ${new Date(scan.capturedAt).toLocaleTimeString()}. Complete the repair, run another scan, then capture the follow-up.`;
  });
  document.getElementById("repair-capture-followup")?.addEventListener("click", () => {
    const scan = current();
    if (!scan) { status.textContent = "Run a vehicle test and read fault memory first."; return; }
    const before = JSON.parse(localStorage.getItem(PENDING) || "null");
    if (!before) { status.textContent = "Capture a baseline scan first."; return; }
    if (before.vehicleId !== scan.vehicleId || !scan.vehicleId) { status.textContent = "The baseline and follow-up must use the same selected garage vehicle."; return; }
    const note = document.getElementById("repair-note")?.value || "";
    try {
      const check = api.buildRepairCheck({ vehicleId: scan.vehicleId, note, before, after: scan });
      const rows = saved(); rows.push(check); localStorage.setItem(SAVED, JSON.stringify(rows)); localStorage.removeItem(PENDING);
      status.textContent = "Follow-up comparison saved locally. Review the counts below; they describe scan evidence, not a repair verdict.";
      render();
    } catch (e) { status.textContent = e.message || String(e); }
  });
  window.addEventListener("beemuu:garage-change", () => { status.textContent = "Garage selection changed. A repair check can only compare scans linked to the same selected vehicle."; });
  const updateButtons = () => {
    const enabled = !!current();
    for (const id of ["repair-capture-baseline", "repair-capture-followup"]) { const button = document.getElementById(id); if (button) button.disabled = !enabled; }
    if (enabled) status.textContent = "Fault memory is ready. Select the matching vehicle in My Garage, then capture a baseline.";
  };
  window.addEventListener("beemuu:vehicle-info", updateButtons);
  window.addEventListener("beemuu:vehicle-scan", updateButtons);
  window.addEventListener("beemuu:fault-read", updateButtons);
  window.addEventListener("beemuu:garage-change", updateButtons);
  document.getElementById("repair-note")?.addEventListener("input", () => {});
  try { if (JSON.parse(localStorage.getItem(PENDING) || "null")) status.textContent = "A baseline is saved. Run a follow-up scan for the same garage vehicle."; render(); } catch (_) { status.textContent = "Repair-check storage is unavailable."; }
})();
