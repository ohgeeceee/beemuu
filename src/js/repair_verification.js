/* Evidence-only comparison helpers for a before/after repair check. */
(function (root) {
  "use strict";

  function faultKey(dtc) {
    return `${String((dtc && (dtc.address ?? dtc.module_address)) ?? "unknown").toUpperCase()}:${String(dtc && dtc.code || "").toUpperCase()}`;
  }

  function flattenFaults(input) {
    if (!Array.isArray(input)) return [];
    const rows = [];
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      if (Array.isArray(item.dtcs)) {
        for (const dtc of item.dtcs) rows.push({ ...dtc, address: dtc.address ?? item.address, module: dtc.module || item.name || "Unknown module" });
      } else if (item.code) rows.push(item);
    }
    return rows.filter(d => String(d.code || "").trim());
  }

  function compareFaults(before, after) {
    const oldRows = flattenFaults(before);
    const newRows = flattenFaults(after);
    const oldMap = new Map(oldRows.map(d => [faultKey(d), d]));
    const newMap = new Map(newRows.map(d => [faultKey(d), d]));
    return {
      cleared: [...oldMap].filter(([key]) => !newMap.has(key)).map(([, dtc]) => dtc),
      remaining: [...oldMap].filter(([key]) => newMap.has(key)).map(([, dtc]) => dtc),
      newFaults: [...newMap].filter(([key]) => !oldMap.has(key)).map(([, dtc]) => dtc),
      comparable: true,
    };
  }

  function compareValues(before, after) {
    const left = new Map((Array.isArray(before) ? before : []).filter(x => x && x.id).map(x => [x.id, x]));
    const right = new Map((Array.isArray(after) ? after : []).filter(x => x && x.id).map(x => [x.id, x]));
    const ids = new Set([...left.keys(), ...right.keys()]);
    return [...ids].sort().map(id => {
      const a = left.get(id), b = right.get(id);
      const comparable = !!a && !!b && String(a.unit || "") === String(b.unit || "") && Number.isFinite(Number(a.value)) && Number.isFinite(Number(b.value));
      return { id, label: (a || b).label || id, unit: a && a.unit || b && b.unit || "", before: a && a.value, after: b && b.value, comparable, delta: comparable ? Number(b.value) - Number(a.value) : null };
    });
  }

  function buildRepairCheck({ id, vehicleId, note, createdAt, before, after }) {
    if (!before || !after) throw new Error("A repair check needs both a baseline and a follow-up scan.");
    return {
      id: String(id || `repair-${Date.now().toString(36)}`), vehicleId: vehicleId || null,
      note: String(note || "").trim().slice(0, 1000), createdAt: createdAt || new Date().toISOString(),
      before, after,
      faults: compareFaults(before.modules || before.dtcs || [], after.modules || after.dtcs || []),
      values: compareValues(before.values || [], after.values || []),
      assessment: "evidence-comparison-only",
    };
  }

  const api = { faultKey, flattenFaults, compareFaults, compareValues, buildRepairCheck };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BeemuuRepairVerification = api;
})(typeof window !== "undefined" ? window : null);
