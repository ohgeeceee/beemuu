"use strict";

function normalizeFrame(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((f) => {
      if (!f) return null;
      const label = f.label != null ? String(f.label) : (f.name != null ? String(f.name) : "");
      const value = f.value != null ? String(f.value) : "";
      if (!label && !value) return null;
      return { label, value };
    })
    .filter(Boolean);
}

function fromDtcList(dtcs, code) {
  if (!Array.isArray(dtcs) || !code) return [];
  const want = String(code).toUpperCase();
  const dtc = dtcs.find((d) => d && String(d.code).toUpperCase() === want);
  return normalizeFrame(dtc && dtc.freeze_frame);
}

function fromModules(modules, address, code) {
  if (!Array.isArray(modules) || address == null || !code) return [];
  const mod = modules.find((m) => m && (m.address === address || String(m.address) === String(address)));
  return fromDtcList(mod && mod.dtcs, code);
}

function lookupFreezeFrame({ dtcs, modules, address, code } = {}) {
  const live = fromDtcList(dtcs, code);
  if (live.length) return live;
  return fromModules(modules, address, code);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { lookupFreezeFrame, fromDtcList, fromModules, normalizeFrame };
}
if (typeof window !== "undefined") {
  window.beeemuuWalkFreeze = { lookupFreezeFrame, fromDtcList, fromModules, normalizeFrame };
}
