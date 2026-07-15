//! Service functions — ISTA-style guided routines.
//!
//! Each entry maps a UI action to a routineControl (0x31) call on a target
//! ECU. Routine IDs below match the simulator. Real routine IDs are
//! model-specific and some require security access — verify against your
//! chassis before running on a real car. `risk` gates a confirmation
//! dialog in the UI.
//!
//! Multi-module support (v0.4.0)
//! ----------------------------
//! A `ServiceFunction` may carry one or more `ModuleRoutine`s. The simple
//! case (one routine) keeps the existing single-target shape: a UI can
//! render one "Run" button per service. A multi-module service (e.g. a
//! CBS reset that exists for DME, EGS, and DSC) declares one
//! `ModuleRoutine` per module address and the UI renders one button
//! each. This is the path that lets a future contributor add
//! chassis-validated routine IDs for EGS/DSC without changing the
//! surrounding data shape.

use serde::Serialize;

/// One routineControl call: target address + routine ID + a short
/// human-readable label for the module ("DME", "EGS", "KOMBI").
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct ModuleRoutine {
    /// CAN/UDS target address (e.g. 0x12 DME, 0x18 EGS, 0x29 DSC,
    /// 0x60 KOMBI/instrument cluster).
    pub target: u8,
    /// UDS routineControl routine ID.
    pub routine: u16,
    /// Short label for the UI ("DME", "EGS", "KOMBI"). Defaults to
    /// the target-address name when the caller leaves it empty.
    pub module_label: &'static str,
}

#[derive(Clone, Copy, Serialize)]
pub struct ServiceFunction {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    /// Routine(s) to invoke. Single entry → single button per
    /// service. Multiple entries → one button per module.
    pub routines: &'static [ModuleRoutine],
    /// "low" = reset/registration, "high" = actuates hardware
    pub risk: &'static str,
}

/// Short name for the standard BMW module addresses. Used as a
/// default `module_label` so existing entries don't need to spell it
/// out. Private — UI code should read `routine.module_label`.
fn default_module_label(target: u8) -> &'static str {
    match target {
        0x12 => "DME",
        0x18 => "EGS",
        0x29 => "DSC",
        0x60 => "KOMBI",
        // Generic fallback; real chassis codes go here.
        _ => "ECU",
    }
}

// Per-target const slices. Each is a `const &[ModuleRoutine; 1]` so
// the compiler keeps them in static memory; no `Box::leak`, no
// `unsafe`, no allocation at startup.
const ROUTINE_DME_BATTERY: &[ModuleRoutine] = &[ModuleRoutine {
    target: 0x12, routine: 0x0F01, module_label: "DME",
}];
const ROUTINE_KOMBI_OIL: &[ModuleRoutine] = &[ModuleRoutine {
    target: 0x60, routine: 0x0F02, module_label: "KOMBI",
}];
const ROUTINE_KOMBI_BRAKE_F: &[ModuleRoutine] = &[ModuleRoutine {
    target: 0x60, routine: 0x0F03, module_label: "KOMBI",
}];
const ROUTINE_KOMBI_BRAKE_R: &[ModuleRoutine] = &[ModuleRoutine {
    target: 0x60, routine: 0x0F04, module_label: "KOMBI",
}];
const ROUTINE_DME_PUMP: &[ModuleRoutine] = &[ModuleRoutine {
    target: 0x12, routine: 0x0A01, module_label: "DME",
}];
const ROUTINE_DSC_BLEED: &[ModuleRoutine] = &[ModuleRoutine {
    target: 0x29, routine: 0x0A02, module_label: "DSC",
}];

pub const SERVICE_FUNCTIONS: &[ServiceFunction] = &[
    ServiceFunction {
        id: "battery_reg",
        label: "Register battery replacement",
        description: "Resets battery ageing counters in the power management after fitting a new battery of the same spec.",
        routines: ROUTINE_DME_BATTERY,
        risk: "low",
    },
    ServiceFunction {
        id: "oil_reset",
        label: "Reset oil service (CBS)",
        description: "Resets the engine-oil condition-based-service counter in the instrument cluster.",
        routines: ROUTINE_KOMBI_OIL,
        risk: "low",
    },
    ServiceFunction {
        id: "brake_reset_front",
        label: "Reset front brake CBS",
        description: "Resets the front brake-pad wear counter after pad replacement.",
        routines: ROUTINE_KOMBI_BRAKE_F,
        risk: "low",
    },
    ServiceFunction {
        id: "brake_reset_rear",
        label: "Reset rear brake CBS",
        description: "Resets the rear brake-pad wear counter after pad replacement.",
        routines: ROUTINE_KOMBI_BRAKE_R,
        risk: "low",
    },
    ServiceFunction {
        id: "coolant_pump_test",
        label: "Electric coolant pump test",
        description: "Commands the electric coolant pump through its test cycle. Engine must be off, ignition on.",
        routines: ROUTINE_DME_PUMP,
        risk: "high",
    },
    ServiceFunction {
        id: "dsc_bleed",
        label: "DSC bleed routine",
        description: "Cycles DSC valves and pump for brake bleeding. Only with the car secured and a pressure bleeder attached.",
        routines: ROUTINE_DSC_BLEED,
        risk: "high",
    },
];

/// Resolve the effective `module_label` for a routine, applying the
/// default if the caller left it empty. Public so the UI can use the
/// same fallback and stay consistent with the JSON the Rust side
/// serialises.
pub fn effective_module_label(r: ModuleRoutine) -> &'static str {
    if r.module_label.is_empty() {
        default_module_label(r.target)
    } else {
        r.module_label
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Existing service-function entries must remain byte-identical
    /// in count and shape — this protects the UI and any persisted
    /// snapshot files that reference service IDs.
    #[test]
    fn existing_entries_count_and_ids_unchanged() {
        assert_eq!(SERVICE_FUNCTIONS.len(), 6);
        let ids: Vec<&str> = SERVICE_FUNCTIONS.iter().map(|s| s.id).collect();
        assert_eq!(
            ids,
            vec![
                "battery_reg",
                "oil_reset",
                "brake_reset_front",
                "brake_reset_rear",
                "coolant_pump_test",
                "dsc_bleed",
            ]
        );
    }

    /// Every existing entry currently has exactly one routine. UI
    /// rendering logic relies on this for the "one Run button per
    /// service" baseline.
    #[test]
    fn every_existing_entry_has_one_routine() {
        for sf in SERVICE_FUNCTIONS {
            assert_eq!(
                sf.routines.len(),
                1,
                "service {} should have one routine",
                sf.id
            );
        }
    }

    /// Effective labels match the expected default per target
    /// address. This is what the UI will display.
    #[test]
    fn default_labels_per_target_address() {
        // battery_reg → DME (0x12)
        assert_eq!(
            effective_module_label(SERVICE_FUNCTIONS[0].routines[0]),
            "DME"
        );
        // oil_reset → KOMBI (0x60)
        assert_eq!(
            effective_module_label(SERVICE_FUNCTIONS[1].routines[0]),
            "KOMBI"
        );
        // dsc_bleed → DSC (0x29)
        assert_eq!(
            effective_module_label(SERVICE_FUNCTIONS[5].routines[0]),
            "DSC"
        );
    }

    /// routine IDs preserved exactly — this is the contract that
    /// downstream code (and any saved-session references) depends on.
    #[test]
    fn existing_routine_ids_preserved() {
        let r0 = SERVICE_FUNCTIONS[0].routines[0];
        assert_eq!(r0.target, 0x12);
        assert_eq!(r0.routine, 0x0F01);

        let r2 = SERVICE_FUNCTIONS[2].routines[0]; // brake_reset_front
        assert_eq!(r2.target, 0x60);
        assert_eq!(r2.routine, 0x0F03);

        let r5 = SERVICE_FUNCTIONS[5].routines[0]; // dsc_bleed
        assert_eq!(r5.target, 0x29);
        assert_eq!(r5.routine, 0x0A02);
    }

    /// `risk` field preserved exactly.
    #[test]
    fn existing_risk_flags_preserved() {
        assert_eq!(SERVICE_FUNCTIONS[0].risk, "low");   // battery_reg
        assert_eq!(SERVICE_FUNCTIONS[1].risk, "low");   // oil_reset
        assert_eq!(SERVICE_FUNCTIONS[4].risk, "high");  // coolant_pump_test
        assert_eq!(SERVICE_FUNCTIONS[5].risk, "high");  // dsc_bleed
    }

    /// The default-label fallback handles unknown target addresses
    /// gracefully (returns "ECU" rather than panicking on an empty
    /// string). Keeps the system robust if a contributor adds an
    /// entry with an out-of-table target.
    #[test]
    fn unknown_target_falls_back_to_generic_label() {
        let r = ModuleRoutine { target: 0x7F, routine: 0x1234, module_label: "" };
        assert_eq!(effective_module_label(r), "ECU");
    }

    /// Explicit non-empty `module_label` overrides the default.
    /// This is the path for adding chassis-specific labels that
    /// differ from the generic address name.
    #[test]
    fn explicit_label_overrides_default() {
        let r = ModuleRoutine { target: 0x12, routine: 0x0F01, module_label: "DME (N55)" };
        assert_eq!(effective_module_label(r), "DME (N55)");
    }

    /// Constructing a `ServiceFunction` with multiple routines (the
    /// future-shape path for EGS/DSC CBS resets) produces the
    /// expected number of `ModuleRoutine` entries. The current data
    /// table only has single-routine entries; this test asserts the
    /// shape works without mandating that anything actually uses it
    /// yet.
    #[test]
    fn multi_routine_construction_round_trip() {
        const ROUTINES: &[ModuleRoutine] = &[
            ModuleRoutine { target: 0x12, routine: 0x0F02, module_label: "DME" },
            ModuleRoutine { target: 0x18, routine: 0x0F02, module_label: "EGS" },
            ModuleRoutine { target: 0x29, routine: 0x0F02, module_label: "DSC" },
        ];
        let sf = ServiceFunction {
            id: "cbs_reset_all",
            label: "Reset CBS (all modules)",
            description: "Resets the condition-based-service counter on every module that supports it.",
            routines: ROUTINES,
            risk: "low",
        };
        assert_eq!(sf.routines.len(), 3);
        assert_eq!(sf.routines[0].target, 0x12);
        assert_eq!(sf.routines[1].target, 0x18);
        assert_eq!(sf.routines[2].target, 0x29);
        // Same routine ID across modules — chassis-specific; not in
        // production data table, but the data shape supports it.
        assert_eq!(sf.routines[0].routine, sf.routines[1].routine);
        assert_eq!(sf.routines[1].routine, sf.routines[2].routine);
    }
}
