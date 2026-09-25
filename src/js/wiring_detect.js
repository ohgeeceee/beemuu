"use strict";

/* Wiring Detective — simplified circuit lookup for DTCs.
 *
 * For a fault code tied to a sensor/actuator, show the affected circuit as a
 * readable chain: power source → fuse → ECU pin → component → ground, plus
 * common failure points. ISTA shows full schematics; this shows only the one
 * circuit the code points at.
 *
 * Pure and dependency-free (mirrors dtc_confidence.js): bundled dataset, no
 * DOM, no transport. `cardHtml(code)` returns an HTML fragment for the
 * expandable card; `circuitFor(code)` returns the raw circuit object. The
 * dataset is community-contributed and lives alongside the DTC texts.
 *
 * The canonical source of truth is `community/wiring/<code>.toml`; this JS
 * bundle is the offline snapshot the desktop ships. Keep the two in sync.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.beeemuuWiringDetective = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  // code -> circuit. Each circuit: component, ecu_pin, component_pin,
  // power_fuse, ground_point, common_failures[].
  const CIRCUITS = {
    "P0171": {
      component: "MAF sensor",
      ecu_pin: "X60002.26",
      component_pin: "3",
      power_fuse: "F07 (5A)",
      ground_point: "G105",
      common_failures: [
        "DISA valve vacuum line crack at elbow",
        "Oil filler cap gasket leaking",
        "Intake boot split after the MAF",
      ],
    },
    "2A82": {
      component: "VANOS intake solenoid",
      ecu_pin: "X60001.12",
      component_pin: "1",
      power_fuse: "F02 (30A)",
      ground_point: "G102",
      common_failures: [
        "Solenoid clogged with oil sludge (clean before replacing)",
        "Connector corrosion at the solenoid",
        "Wiring chafed near the valve cover",
      ],
    },
    "2A87": {
      component: "VANOS exhaust solenoid",
      ecu_pin: "X60001.13",
      component_pin: "1",
      power_fuse: "F02 (30A)",
      ground_point: "G102",
      common_failures: [
        "Solenoid clogged with oil sludge",
        "Connector corrosion at the solenoid",
      ],
    },
    "29E0": {
      component: "Crankcase ventilation (PCV) heater",
      ecu_pin: "X60002.31",
      component_pin: "2",
      power_fuse: "F08 (10A)",
      ground_point: "G105",
      common_failures: [
        "PCV valve diaphragm torn (oil consumption)",
        "Heater element open circuit",
      ],
    },
    "2E81": {
      component: "Electric coolant pump",
      ecu_pin: "X60003.4",
      component_pin: "1",
      power_fuse: "F04 (30A)",
      ground_point: "G103",
      common_failures: [
        "Pump bearing failure (whine before failure)",
        "Connector melted from pump overcurrent",
      ],
    },
    "2E82": {
      component: "Electric coolant pump (low speed)",
      ecu_pin: "X60003.5",
      component_pin: "2",
      power_fuse: "F04 (30A)",
      ground_point: "G103",
      common_failures: [
        "Pump controller fault",
        "Wiring short to ground in the harness",
      ],
    },
  };

  function circuitFor(code) {
    if (!code) return null;
    return CIRCUITS[String(code).toUpperCase()] || null;
  }

  function hasCircuit(code) {
    return circuitFor(code) != null;
  }

  // HTML for the expandable circuit card. Rendered with textContent-safe
  // escaping; the caller inserts it into a fault row's detail area.
  function cardHtml(code) {
    const c = circuitFor(code);
    if (!c) return "";
    const esc = s => String(s).replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[m]));
    const nodes = [
      { label: `Fuse ${c.power_fuse}`, kind: "power" },
      { label: `ECU ${c.ecu_pin}`, kind: "ecu" },
      { label: `${c.component} pin ${c.component_pin}`, kind: "component" },
      { label: `Ground ${c.ground_point}`, kind: "ground" },
    ];
    const chain = nodes.map((n, i) =>
      `<span class="wiring-node wiring-${n.kind}">${esc(n.label)}</span>` +
      (i < nodes.length - 1 ? '<span class="wiring-line">───▶</span>' : "")
    ).join("");
    const failures = c.common_failures.length
      ? `<ul class="wiring-failures">${c.common_failures.map(f => `<li>🔧 ${esc(f)}</li>`).join("")}</ul>`
      : "";
    return (
      `<div class="wiring-card">` +
      `<div class="wiring-circuit">${chain}</div>` +
      `<div class="wiring-head">${esc(c.component)} circuit</div>` +
      failures +
      `</div>`
    );
  }

  return { circuitFor, hasCircuit, cardHtml, CIRCUITS };
});
