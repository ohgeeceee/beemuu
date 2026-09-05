"use strict";

// Beginner-facing progress model for the read-only first-scan workflow.
// Kept free of DOM and transport calls so copy and safety states are testable.
function buildFirstScanGuide(state) {
  const input = state || {};
  const kind = input.connectionKind || "sim";
  const adapterDetail = kind === "kdcan"
    ? "K+DCAN selected. In Connection settings, choose the cable port and confirm the FTDI latency timer is 1 ms."
    : kind === "enet"
      ? "ENET selected. Use Discover to find the vehicle; do not guess or reuse an old IP address."
      : "Simulator selected. This is a safe place to learn the scan flow without changing a vehicle.";
  const moduleCount = Number.isFinite(input.moduleCount) ? input.moduleCount : 0;
  const selectedModule = String(input.selectedModuleName || "").trim();
  const faultDetail = input.faultMemoryRead
    ? input.faultCount > 0
      ? `${input.faultCount} fault${input.faultCount === 1 ? "" : "s"} read. Select one to see its plain-language detail and any guided checks.`
      : "Fault memory read. No faults were reported by the selected control unit."
    : selectedModule
      ? `Selected ${selectedModule}. Read its fault memory; this is read-only.`
      : "Select a control unit after the vehicle test, then read its fault memory. This is read-only.";

  return {
    intro: "This guide only reads information. It does not clear faults, code modules, or program the vehicle.",
    steps: [
      { title: "Choose an adapter", detail: adapterDetail, complete: true },
      { title: "Connect", detail: input.connected ? "Connected. You can now identify the vehicle and its control units." : "Connect before starting a vehicle test.", complete: !!input.connected },
      { title: "Run a vehicle test", detail: moduleCount > 0 ? `${moduleCount} control unit${moduleCount === 1 ? "" : "s"} found.` : "The vehicle test identifies control units; it does not change them.", complete: moduleCount > 0 },
      { title: "Read fault memory", detail: faultDetail, complete: !!input.faultMemoryRead },
    ],
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { buildFirstScanGuide };
if (typeof window !== "undefined") window.beeemuuFirstScanGuide = { buildFirstScanGuide };
