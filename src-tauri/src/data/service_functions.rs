//! Service functions — ISTA-style guided routines.
//!
//! Each entry maps a UI action to a routineControl (0x31) call on a target
//! ECU. Routine IDs below match the simulator. Real routine IDs are
//! model-specific and some require security access — verify against your
//! chassis before running on a real car. `risk` gates a confirmation
//! dialog in the UI.

use serde::Serialize;

#[derive(Serialize, Clone, Copy)]
pub struct ServiceFunction {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub target: u8,
    pub routine: u16,
    /// "low" = reset/registration, "high" = actuates hardware
    pub risk: &'static str,
}

pub const SERVICE_FUNCTIONS: &[ServiceFunction] = &[
    ServiceFunction {
        id: "battery_reg",
        label: "Register battery replacement",
        description: "Resets battery ageing counters in the power management after fitting a new battery of the same spec.",
        target: 0x12, routine: 0x0F01, risk: "low",
    },
    ServiceFunction {
        id: "oil_reset",
        label: "Reset oil service (CBS)",
        description: "Resets the engine-oil condition-based-service counter in the instrument cluster.",
        target: 0x60, routine: 0x0F02, risk: "low",
    },
    ServiceFunction {
        id: "brake_reset_front",
        label: "Reset front brake CBS",
        description: "Resets the front brake-pad wear counter after pad replacement.",
        target: 0x60, routine: 0x0F03, risk: "low",
    },
    ServiceFunction {
        id: "brake_reset_rear",
        label: "Reset rear brake CBS",
        description: "Resets the rear brake-pad wear counter after pad replacement.",
        target: 0x60, routine: 0x0F04, risk: "low",
    },
    ServiceFunction {
        id: "coolant_pump_test",
        label: "Electric coolant pump test",
        description: "Commands the electric coolant pump through its test cycle. Engine must be off, ignition on.",
        target: 0x12, routine: 0x0A01, risk: "high",
    },
    ServiceFunction {
        id: "dsc_bleed",
        label: "DSC bleed routine",
        description: "Cycles DSC valves and pump for brake bleeding. Only with the car secured and a pressure bleeder attached.",
        target: 0x29, routine: 0x0A02, risk: "high",
    },
];
