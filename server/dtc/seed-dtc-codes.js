"use strict";

const seedDtcCodes = [
  {
    code: "2A82",
    type: "bmw_hex",
    ecu_module: "DME",
    short_desc: "VANOS intake mechanism fault",
    symptoms: [
      "Rough idle, especially during cold start or after extended idling",
      "Reduced power or limp mode with half-engine warning",
      "Hesitation or flat torque delivery below midrange RPM",
      "Longer crank time or unstable idle after startup",
      "Rattling or irregular valvetrain behavior may be noticed on neglected oil-service vehicles"
    ],
    causes: [
      "Dirty, sticking, or failing intake VANOS solenoid",
      "Contaminated oil, extended oil interval, or incorrect oil viscosity affecting VANOS oil control",
      "Collapsed or missing oil filter cap cage causing low oil pressure to VANOS circuit",
      "Restricted VANOS oil passages or debris in solenoid screens",
      "Camshaft bearing ledge wear or camshaft timing control issue on affected BMW engines",
      "Faulty camshaft position sensor or damaged wiring to VANOS/camshaft control circuit"
    ],
    fixes: [
      "1. Verify engine oil level, oil condition, and correct BMW-approved oil viscosity before replacing parts.",
      "2. Inspect the oil filter cap and confirm the internal cage/spool is present and the filter is seated correctly.",
      "3. Remove the intake and exhaust VANOS solenoids, inspect for sludge or metallic debris, and clean with appropriate electrical-safe cleaner.",
      "4. Swap intake and exhaust VANOS solenoids, clear faults, and road test. If the fault changes from intake to exhaust, replace the affected solenoid.",
      "5. Inspect VANOS solenoid connectors and wiring for oil intrusion, broken locking tabs, corrosion, or intermittent contact.",
      "6. If the fault returns after solenoid service, perform camshaft position correlation checks and inspect camshaft bearing ledge/VANOS oil supply depending on engine family.",
      "7. After repair, clear DME faults and adaptations if appropriate, then perform a warm road test with live VANOS target vs. actual angle data."
    ],
    compatibility: [
      "N52",
      "N54",
      "N55",
      "E82",
      "E88",
      "E90",
      "E91",
      "E92",
      "E93",
      "E60",
      "E61",
      "E89"
    ]
  },
  {
    code: "P0301",
    type: "obd2",
    ecu_module: "DME",
    short_desc: "Cylinder 1 misfire detected",
    symptoms: [
      "Check engine light or flashing check engine light under load",
      "Rough idle, shaking, or vibration from engine bay",
      "Loss of power during acceleration",
      "Fuel smell from exhaust if misfire is severe",
      "Cold-start stumble that may improve as the engine warms",
      "Catalyst-damaging misfire warning if driven aggressively"
    ],
    causes: [
      "Worn or fouled cylinder 1 spark plug",
      "Failing cylinder 1 ignition coil",
      "Faulty or restricted cylinder 1 fuel injector",
      "Vacuum leak or intake leak affecting one bank or runner",
      "Low compression from valve, piston ring, or head gasket issue",
      "Carbon buildup on intake valves on direct-injected BMW engines",
      "Oil intrusion, coolant intrusion, or incorrect spark plug gap/heat range"
    ],
    fixes: [
      "1. Do not continue hard driving if the check engine light is flashing; catalyst damage can occur.",
      "2. Scan for freeze-frame data and companion faults such as fuel trim, injector, or oxygen sensor faults.",
      "3. Move the cylinder 1 ignition coil to another cylinder, clear codes, and retest. If the misfire follows the coil, replace the coil.",
      "4. Inspect the cylinder 1 spark plug for fouling, oil, coolant, cracked porcelain, incorrect gap, or excessive wear; replace plugs as a matched set if overdue.",
      "5. If coil and plug test good, perform an injector balance test or move the injector where practical and safe.",
      "6. Smoke test the intake system and inspect vacuum lines, PCV components, valve cover, and intake boots for leaks.",
      "7. If the misfire remains on cylinder 1, perform compression and leakdown testing before replacing additional parts.",
      "8. After repair, clear faults and verify misfire counters remain stable during cold idle, warm idle, and loaded road test."
    ],
    compatibility: [
      "OBD-II",
      "BMW_GASOLINE",
      "N52",
      "N54",
      "N55",
      "B48",
      "B58",
      "E90",
      "E92",
      "F30",
      "F32",
      "G20"
    ]
  },
  {
    code: "30FF",
    type: "bmw_hex",
    ecu_module: "DME",
    short_desc: "Turbocharger charge-air pressure too low",
    symptoms: [
      "Half-engine light or reduced-power mode during acceleration",
      "Sluggish acceleration and low boost pressure",
      "Wastegate rattle, especially on cold start or light throttle",
      "Hissing, whooshing, or air leak sound under boost",
      "Boost target not reached in live DME data",
      "Fault may appear during highway pulls, uphill load, or wide-open throttle"
    ],
    causes: [
      "Cracked charge pipe or loose charge pipe connection",
      "Boost leak at intercooler couplers, throttle body connection, or diverter valve plumbing",
      "Cracked, disconnected, or oil-softened vacuum lines controlling turbo wastegates",
      "Failing boost pressure control solenoids",
      "Leaking diverter valves or aftermarket blow-off valve issue",
      "Wastegate actuator wear or turbocharger wastegate flapper wear",
      "Faulty pressure sensor, TMAP/MAP sensor contamination, or related wiring issue"
    ],
    fixes: [
      "1. Inspect charge pipe, throttle body connection, intercooler couplers, and all boost-side clamps for cracks, loose clamps, or oil tracks.",
      "2. Perform a regulated smoke test or boost-leak pressure test of the intake and charge-air system.",
      "3. Inspect all turbo vacuum lines from vacuum pump/reservoir to boost solenoids and wastegate actuators; replace brittle or oil-soaked lines.",
      "4. Test boost control solenoids and verify vacuum supply to the wastegate actuators.",
      "5. Inspect diverter valves or blow-off valve setup for torn diaphragms, weak springs, stuck pistons, or incorrect installation.",
      "6. Check wastegate actuator movement and listen for excessive wastegate rattle that may indicate actuator or turbo wastegate wear.",
      "7. Compare requested boost vs. actual boost in live data during a controlled road test after repairs.",
      "8. Clear DME faults and verify the car reaches boost target without reduced-power mode."
    ],
    compatibility: [
      "N54",
      "N55",
      "E82",
      "E88",
      "E90",
      "E91",
      "E92",
      "E93",
      "E60",
      "E61",
      "F10",
      "F30",
      "F32"
    ]
  }
];

module.exports = { seedDtcCodes };
