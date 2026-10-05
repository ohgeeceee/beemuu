/* Local vehicle garage. Stores labels and vehicle metadata on this device. */
(function (root) {
  "use strict";
  const STORAGE_KEY = "beeemuu.garage.v1";

  function normalizeVin(vin) {
    const value = String(vin || "").trim().toUpperCase();
    return value || null;
  }

  function id() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
    return `car-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function read(storage) {
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "{}");
      const vehicles = Array.isArray(parsed.vehicles) ? parsed.vehicles.filter(v => v && typeof v.id === "string") : [];
      const activeId = vehicles.some(v => v.id === parsed.activeId) ? parsed.activeId : null;
      return { version: 1, activeId, vehicles };
    } catch (_) { return { version: 1, activeId: null, vehicles: [] }; }
  }

  function write(storage, state) {
    if (!storage || typeof storage.setItem !== "function") throw new Error("Garage storage is unavailable.");
    const clean = {
      version: 1,
      activeId: state.vehicles.some(v => v.id === state.activeId) ? state.activeId : null,
      vehicles: state.vehicles.map(v => ({
        id: String(v.id), label: String(v.label || "Vehicle").trim().slice(0, 80) || "Vehicle",
        vin: normalizeVin(v.vin), model: String(v.model || "").slice(0, 100),
        chassis: String(v.chassis || "").slice(0, 40), updatedAt: Number(v.updatedAt) || Date.now(),
      })),
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(clean));
    return clean;
  }

  function upsert(storage, vehicle) {
    const state = read(storage);
    const vin = normalizeVin(vehicle && vehicle.vin);
    const existing = vin && state.vehicles.find(v => normalizeVin(v.vin) === vin);
    const next = {
      id: existing ? existing.id : id(),
      label: String(vehicle && (vehicle.label || vehicle.model) || "BMW").trim().slice(0, 80),
      vin,
      model: String(vehicle && vehicle.model || "").slice(0, 100),
      chassis: String(vehicle && vehicle.chassis || "").slice(0, 40),
      updatedAt: Date.now(),
    };
    state.vehicles = existing ? state.vehicles.map(v => v.id === existing.id ? next : v) : [...state.vehicles, next];
    state.activeId = next.id;
    return write(storage, state);
  }

  function addManual(storage, label, model = "") {
    const state = read(storage);
    const vehicle = { id: id(), label: String(label || "Vehicle").trim().slice(0, 80) || "Vehicle", vin: null, model: String(model || "").slice(0, 100), chassis: "", updatedAt: Date.now() };
    state.vehicles.push(vehicle);
    state.activeId = vehicle.id;
    return write(storage, state);
  }

  function select(storage, vehicleId) {
    const state = read(storage);
    if (!state.vehicles.some(v => v.id === vehicleId)) throw new Error("Choose a vehicle in your garage.");
    state.activeId = vehicleId;
    return write(storage, state);
  }

  function remove(storage, vehicleId) {
    const state = read(storage);
    state.vehicles = state.vehicles.filter(v => v.id !== vehicleId);
    if (state.activeId === vehicleId) state.activeId = null;
    return write(storage, state);
  }

  const api = { STORAGE_KEY, normalizeVin, read, write, upsert, addManual, select, remove };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BeemuuGarage = api;
})(typeof window !== "undefined" ? window : null);
