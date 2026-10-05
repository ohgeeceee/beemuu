"use strict";
(function () {
  const api = window.BeemuuGarage;
  const list = document.getElementById("garage-list");
  if (!api || !list) return;
  const status = text => { const s = document.getElementById("garage-status"); if (s) s.textContent = text; };

  function render() {
    const state = api.read(localStorage);
    window.beeemuuGarageActiveId = () => api.read(localStorage).activeId;
    list.replaceChildren();
    if (!state.vehicles.length) {
      const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "No vehicles saved yet. Add the current vehicle after reading its VIN, or create a manual record."; list.append(empty); return;
    }
    for (const vehicle of state.vehicles) {
      const card = document.createElement("article"); card.className = `garage-card${state.activeId === vehicle.id ? " is-active" : ""}`; card.setAttribute("role", "listitem");
      const heading = document.createElement("strong"); heading.textContent = vehicle.label;
      const meta = document.createElement("p"); meta.className = "muted";
      meta.textContent = [vehicle.model, vehicle.chassis, vehicle.vin ? `VIN ${vehicle.vin}` : "Manual vehicle · no VIN stored"].filter(Boolean).join(" · ");
      card.append(heading, meta);
      if (state.activeId !== vehicle.id) {
        const use = document.createElement("button"); use.className = "btn btn-small"; use.type = "button"; use.textContent = "Select";
        use.addEventListener("click", () => { api.select(localStorage, vehicle.id); render(); window.dispatchEvent(new CustomEvent("beemuu:garage-change", { detail: vehicle })); }); card.append(use);
      } else {
        const active = document.createElement("span"); active.className = "garage-active-label"; active.textContent = "Selected"; card.append(active);
      }
      const rename = document.createElement("button"); rename.className = "btn btn-small"; rename.type = "button"; rename.textContent = "Rename";
      rename.addEventListener("click", () => {
        const label = window.prompt("Vehicle name", vehicle.label);
        if (label == null || !label.trim()) return;
        const latest = api.read(localStorage); latest.vehicles = latest.vehicles.map(v => v.id === vehicle.id ? { ...v, label: label.trim(), updatedAt: Date.now() } : v); api.write(localStorage, latest); render();
      }); card.append(rename);
      const remove = document.createElement("button"); remove.className = "btn btn-small btn-danger"; remove.type = "button"; remove.textContent = "Remove";
      remove.addEventListener("click", () => { api.remove(localStorage, vehicle.id); render(); window.dispatchEvent(new CustomEvent("beemuu:garage-change", { detail: null })); }); card.append(remove);
      list.append(card);
    }
  }

  document.getElementById("garage-add-current")?.addEventListener("click", () => {
    const info = window.beeemuuV3?.vehicleInfo?.();
    if (!info?.vin) { status("Read a VIN before adding the current car. You can create a manual record below."); return; }
    const model = info.decode?.model || info.decode?.model_name || "BMW";
    const chassis = info.decode?.chassis || "";
    api.upsert(localStorage, { vin: info.vin, model, chassis, label: [model, chassis].filter(Boolean).join(" ") || "BMW" });
    render();
    window.dispatchEvent(new CustomEvent("beemuu:garage-change", { detail: api.read(localStorage).vehicles.find(v => v.vin === api.normalizeVin(info.vin)) }));
    status("Vehicle saved locally. The VIN is used only to match this car on this device.");
  });
  document.getElementById("garage-add-manual")?.addEventListener("click", () => {
    const input = document.getElementById("garage-manual-label");
    const label = input.value.trim();
    if (!label) { input.focus(); status("Enter a name for this vehicle."); return; }
    const state = api.addManual(localStorage, label);
    input.value = ""; render();
    window.dispatchEvent(new CustomEvent("beemuu:garage-change", { detail: state.vehicles.find(v => v.id === state.activeId) }));
    status("Manual vehicle saved locally; no VIN is required.");
  });
  window.addEventListener("beemuu:vehicle-info", event => {
    const button = document.getElementById("garage-add-current");
    if (button) button.disabled = !event.detail?.vin;
  });
  try { render(); } catch (_) { list.textContent = "Garage storage is unavailable."; }
})();
