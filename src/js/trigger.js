"use strict";

// Trigger engine for v0.15.2 — threshold and DTC-crossed auto-start.
// Pure helpers, no DOM, dual export (CommonJS + window).

/**
 * Evaluate one threshold trigger against current LiveValue array.
 * @param {Object} trigger { channelId, op, threshold, enabled }
 * @param {Array<{id:string,value:number}>} liveValues
 * @returns {boolean} true if trigger fires
 */
function evaluateThreshold(trigger, liveValues) {
  if (!trigger || !trigger.enabled) return false;
  if (!trigger.channelId) return false;
  const v = liveValues.find((x) => x.id === trigger.channelId);
  if (!v || typeof v.value !== "number" || Number.isNaN(v.value)) return false;
  const t = Number(trigger.threshold);
  if (Number.isNaN(t)) return false;
  switch (trigger.op) {
    case ">": return v.value > t;
    case ">=": return v.value >= t;
    case "<": return v.value < t;
    case "<=": return v.value <= t;
    case "==": return v.value === t;
    case "!=": return v.value !== t;
    default: return false;
  }
}

/**
 * DTC-crossed trigger — fires if any DTC in list matches code (or any if code=="*").
 * @param {Object} trigger { code, enabled }
 * @param {Array<{code:string}>} dtcs
 * @returns {boolean}
 */
function evaluateDtcTrigger(trigger, dtcs) {
  if (!trigger || !trigger.enabled) return false;
  if (!Array.isArray(dtcs) || dtcs.length === 0) return false;
  if (!trigger.code || trigger.code === "*") return dtcs.length > 0;
  const want = String(trigger.code).toUpperCase();
  return dtcs.some((d) => String(d.code).toUpperCase() === want);
}

/**
 * Combined — any threshold or DTC trigger firing starts logging.
 * @param {Array} triggers
 * @param {Array} liveValues
 * @param {Array} dtcs
 */
function shouldAutoStart(triggers, liveValues, dtcs) {
  if (!Array.isArray(triggers) || triggers.length === 0) return false;
  for (const tr of triggers) {
    if (tr.type === "dtc") {
      if (evaluateDtcTrigger(tr, dtcs)) return true;
    } else {
      if (evaluateThreshold(tr, liveValues)) return true;
    }
  }
  return false;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { evaluateThreshold, evaluateDtcTrigger, shouldAutoStart };
}
if (typeof window !== "undefined") {
  window.beeemuuTrigger = { evaluateThreshold, evaluateDtcTrigger, shouldAutoStart };
}
