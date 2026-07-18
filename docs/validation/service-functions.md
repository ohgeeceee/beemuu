# Real-car Service-Function Validation Harness

> **Purpose.** Every service function in
> [`src-tauri/src/data/service_functions.rs`](../../src-tauri/src/data/service_functions.rs)
> ships `verified: false` — rendered in the UI as **UNVERIFIED** with an
> extra confirmation line. The routine IDs (`0x0F01`–`0x0F04`, `0x0A01`,
> `0x0A02`) are v0.4.0 simulator placeholders: the simulator answers any
> `0x31` routine ID, so none of them has ever been confirmed against a
> real chassis. BMW's real service-function identifiers are
> security-sensitive and unpublished
> (`research/bmw_diag_landscape.md`). **This harness is the path that
> retires an `UNVERIFIED` marker — per CONTRIBUTING.md, labels come off
> only via a `docs/validation/` harness report, never silently.**
>
> **Time required.** 30–60 minutes with a working rig. Some routines
> (DSC bleed) need a helper and a pressure bleeder.
>
> **Risk honesty.** These are *write-path* calls (UDS
> `routineControl 0x31`). An unverified routine ID on a real car can
> invoke a different function than the label claims, change ECU state,
> or do nothing. Do not run this harness on a car you cannot afford to
> have at a dealer for a module reset.

## 1. Pre-flight checklist

- [ ] **Battery maintainer connected.** Routines can run pumps/valves
      for minutes; a voltage sag mid-routine can leave a module in a
      fault state. Non-negotiable for `dsc_bleed` and
      `coolant_pump_test`.
- [ ] **Cable + transport working.** K+DCAN (E-series) or ENET
      (F/G-series, see
      [`docs/hardware/enet-cable-pinout.md`](../hardware/enet-cable-pinout.md)).
      Status bar shows your VIN.
- [ ] **Simulator NOT connected.** The sim answers *every* routine ID
      with success — a "pass" against the sim proves nothing. This is
      exactly the trap this harness exists to close.
- [ ] **Extended session + security access where required.** Some
      modules reject `0x31` with NRC `0x22` (conditionsNotCorrect) or
      `0x33` (securityAccessDenied) until unlocked. BeeEmUu only ships
      the simulator's seed/key algorithm; on a real car, record the
      NRC and stop — do not brute-force security.
- [ ] **Traffic recording on.** Open the Traffic view and keep it
      recording for the whole session — the request/response bytes are
      the evidence you will file.

## 2. Per-routine procedure

For each routine below: run it from the Service Functions tab, then
record (a) the exact request bytes sent, (b) the exact response bytes,
(c) the observable vehicle behavior, (d) chassis/engine/gearbox and
date. A routine **passes** only if the response is a positive
`71 01 <rid> ..` *and* the labeled effect is observable on the car.

### 2a. `battery_reg` — DME `0x12`, routine `0x0F01`

- **Claim:** resets battery ageing counters after a same-spec battery
  swap.
- **Observe:** power-management / battery-registration state before vs
  after (cluster or ISTA-level menus if available). No audible behavior.
- **Engine state:** ignition on, engine off.

### 2b. `oil_reset` — KOMBI `0x60`, routine `0x0F02`

- **Claim:** resets the engine-oil CBS counter.
- **Observe:** the cluster's oil-service interval display resets to
  full. Check the service-menu readout before and after.
- **Engine state:** ignition on, engine off.

### 2c/2d. `brake_reset_front` / `brake_reset_rear` — KOMBI `0x60`, routines `0x0F03` / `0x0F04`

- **Claim:** resets the front/rear brake-pad wear CBS counters.
- **Observe:** wear-interval display for the respective axle resets.
  Note: real cars typically gate this on the wear-sensor state — a
  worn sensor may cause a legitimate refusal.
- **Engine state:** ignition on, engine off.

### 2e. `coolant_pump_test` — DME `0x12`, routine `0x0A01`

- **Claim:** runs the electric coolant pump through its test cycle.
- **Observe:** pump audibly runs / changes speed during the routine.
- **Engine state:** engine OFF, ignition on. This entry is
  `risk: high` — it actuates hardware.

### 2f. `dsc_bleed` — DSC `0x29`, routine `0x0A02`

- **Claim:** cycles DSC valves and pump for brake bleeding.
- **Observe:** valve clicking and pump running at the DSC unit; pedal
  feel changes. Only with the car secured and a pressure bleeder
  attached, per the UI description.
- **Engine state:** engine off; follow standard pressure-bleed
  procedure. `risk: high`.

## 3. What a negative result looks like

All of these are *findings*, not failures of the harness:

- **NRC `0x31` (requestOutOfRange)** — the routine ID does not exist on
  this chassis. The placeholder ID is wrong for your car; record the
  bytes and file per § 4.
- **NRC `0x22` / `0x33`** — preconditions or security access missing.
  Record and stop; do not attempt seed/key brute force.
- **Positive `71` but no observable effect** — the ID means something
  else on this chassis. Record carefully: this is the dangerous case,
  because the car accepted an unknown write. Note anything the car did
  (fan, pump, dash messages, new DTCs) and read the fault memory
  afterwards.
- **Timeout** — module not present / not answering (see
  `docs/hardware/addressing-model.md` for chassis-variant addresses).

## 4. Filing the report (label removal)

1. **All observed routines pass:** open a PR titled
   `[v0.8.0] service-function validation: <ids> pass on chassis XYZ`.
   Include chassis/engine/gearbox, date, transport used, the recorded
   request/response bytes per routine, and the observed behavior. The
   PR flips `verified: false` → `true` for exactly those entries in
   `service_functions.rs`, adds a comment citing the report, and
   updates the `all_shipped_entries_marked_unverified` contract test
   to exempt the validated IDs.
2. **Any routine misbehaves or returns an NRC:** open an issue titled
   `[v0.8.0] service-function mismatch: <id> on chassis XYZ` with the
   bytes and behavior from § 3. Do **not** open a label-removal PR.
3. **You found a *real* routine ID from an in-repo-citable source**
   (your own Parameter Explorer / traffic capture counts once
   documented): propose it in a PR with the capture as evidence. Forum
   paste-ins without captures get rejected — see CONTRIBUTING.md
   rule 1 ("in-repo source or it doesn't ship").

## 5. Known-missing service functions

Frequently requested routines with **no in-repo grounded routine ID**
today. They are deliberately absent from the table rather than shipped
with invented IDs (v0.8.0 plan, PR #2):

| Function | Why it is missing |
|---|---|
| DPF regeneration | No in-repo routine ID; diesel profiles (N57) shipped v0.8.0 PR #3 but regen IDs are unpublished |
| Throttle / Valvetronic adaptation | No in-repo routine ID |
| Steering-angle calibration | No in-repo routine ID |
| EGS adaptation reset | No in-repo routine ID |
| EMF (parking brake) service mode | No in-repo routine ID |

If you can ground one via a capture (§ 4 step 3), it ships as a new
`verified: false` entry first and upgrades through this same harness.

## 6. Reference

- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — verification-label
  conventions; labels come off only via a harness report.
- [`docs/validation/u8_enum-validation.md`](u8_enum-validation.md) —
  the read-path harness this doc mirrors.
- [`docs/hardware/addressing-model.md`](../hardware/addressing-model.md)
  — why one-byte routine targets work on both K+DCAN and ENET, and
  chassis-variant module addresses.
- [`docs/hardware/enet-cable-pinout.md`](../hardware/enet-cable-pinout.md)
  — DIY ENET cable for F/G-series.
- `research/bmw_diag_landscape.md` — why BMW routine IDs are
  unpublished (security-sensitive).
