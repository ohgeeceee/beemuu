"use strict";

// Plain-language framing for first-time diagnostic users. This deliberately
// interprets workflow state, not fault codes or repair procedures.
function buildBeginnerFaultSummary(state) {
  const input = state || {};
  if (!input.faultMemoryRead) return null;
  const count = Number.isFinite(input.faultCount) ? input.faultCount : 0;
  const moduleName = String(input.moduleName || "selected control unit").trim();
  if (count === 0) {
    return {
      tone: "ok",
      title: "No faults reported",
      detail: `${moduleName} reported no stored faults. This is a useful baseline, but it does not rule out an intermittent problem.`,
    };
  }
  return {
    tone: "attention",
    title: `${count} fault${count === 1 ? "" : "s"} reported`,
    detail: "A fault code is a clue, not a parts-replacement instruction. Click a code to review its freeze frame and use Guided fault finding when a plan is available.",
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { buildBeginnerFaultSummary };
if (typeof window !== "undefined") window.beeemuuBeginnerFaultSummary = { buildBeginnerFaultSummary };
