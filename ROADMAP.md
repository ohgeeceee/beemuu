# BeeEmUu Roadmap

This document tracks planned work and rough priorities. Items are not
promised in any order — contributors are welcome to grab anything marked
"help wanted".

## Legend

| Label | Meaning |
|-------|---------|
| 🔴 Blocker | Blocks a release or major feature |
| 🟡 Needs research | Not well understood yet; needs investigation |
| 🟢 Ready | Well-scoped; open a PR when you want it |
| ⭐ High impact | Would significantly improve user experience |
| ✅ Done | Shipped in the named release |

---

## v0.3.0 — "Real Car" (Shipped 2026-07-11)

### ✅ Decode Functions (done in v0.3.0 — keep this section historical)

The six new decoders landed before v0.3.0 cut. They are live in
`src-tauri/src/data/live.rs` (see `enum Decode` + unit tests at the bottom
of that file), and the corresponding DIDs are already uncommented in
`community/profiles/b58.toml` and `community/profiles/n55.toml`.

| Item | Status | Notes |
|------|--------|-------|
| Add `u16_tenths` | ✅ Done | Battery voltage (4002), HPFP rail (44F0), boost command (4367) |
| Add `u16_div100` | ✅ Done | Mass-air flow (4077), ambient pressure (4003) |
| Add `s16_div4` | ✅ Done | DME temperature (4001) — signed |
| Add `s16_div100` | ✅ Done | Engine torque (4500), ambient air temp (4016) |
| Add `u8_div100` | ✅ Done | Lambda (400B), injection time (4363) |
| Add `u8_enum` | ✅ Done (v0.4.0) | Spec'd in `docs/DECODE_FUNCTIONS.md` § 8; shipped in PR #60 (+ frontend wiring in #64–#66). |

### ⭐ Real-Car Validation

| Item | Status | Notes |
|------|--------|-------|
| B58 F/G-series UDS DID test | 🟡 | Need owner with ENET adapter + F/G chassis |
| N55 F-series UDS DID test | 🟡 | Same as above; F30/F32 owners ideal |
| N52 E-series KWP2000 local ID hunt | 🟡 | Use Parameter Explorer; document findings in issue |
| N54 E-series KWP2000 local ID hunt | 🟡 | Same as above; E92 335i owners ideal |
| E-series CAN broadcast frames | 🟡 | Validate 0x0AA (RPM), 0x1D0 (coolant), 0x545 (oil temp E46) |

### ⭐ Protocol & Transport

| Item | Status | Notes |
|------|--------|-------|
| ENET/DoIP auto-detection | 🟡 | Detect adapter without manual selection |
| KWP2000 slow-module timeout fix | 🟢 Ready | CIC and other modules timeout on slow responses |
| BLE adapter support | 🟡 | Vgate iCar Pro BLE, OBDLink CX, etc. |
| WiFi adapter support | 🟡 | Vgate iCar Pro WiFi, OBDLink MX+ WiFi |
| CAN bus listener mode | 🟡 | E-series alternative to KWP2000 local IDs |
| ISO-TP multi-frame (FF/CF/FC) | 🟢 Ready | Required for long UDS responses (VIN, full DTC list) |

### UI / UX

| Item | Status | Notes |
|------|--------|-------|
| Dark/light theme toggle | 🟢 Ready | Currently dark-only; CSS variables exist |
| Gauge theming | 🟢 Ready | Per-profile color schemes (e.g., M colors for S55) |
| Mobile-responsive layout | 🟡 | Tauri supports mobile; needs testing |
| Save/load workspace layout | 🟢 Ready | Remember which gauges user had open |
| Export PNG/SVG from charts | 🟢 Ready | Useful for forum posts |
| Real-time data logging to disk | ✅ Done (v0.4.0) | Stream CSV to file instead of in-memory only |

### 🟡 Research: E-series Data Desert

The open-source community has no published KWP2000 local identifier table for any
BMW E-series DME (MSV70, MSV80, MSD80, MSD81, ME9.2). This is a structural gap.

**Possible paths forward:**

- CAN bus broadcast frame decoding (0x0AA, 0x1D0, 0x545, 0x0CE) — bypass KWP2000 entirely
- Parameter Explorer crowdsourcing — every E-series owner who maps a local ID contributes to a community table
- BSD protocol documentation — N52 oil condition sensor uses BSD, not KWP2000

See `research/bmw_diag_dim07_local_ids.md` for the exhaustive search results.

---

## v0.4.0 — "Tuner Friendly" (Shipped 2026-07-15)

**Premise.** v0.3.0 shipped the decoder foundation (six new numeric decoders
+ uncommented B58/N55 DIDs). v0.4.0 built *tuner-facing* features on top
of that foundation — features that only make sense once real numbers like
HPFP rail, boost command, lambda bank, and engine torque are actually
readable.

### ✅ Ready — all five shipped

| Item | Status | Notes |
|------|--------|-------|
| README profile-listing fix | ✅ Done | Doc-only; README + ROADMAP + CHANGELOG drift fix. Shipped in PR #59. |
| Histograms of logged channels | ✅ Done | Pure client-side; 13 unit tests. Shipped in PR #62. |
| `u8_enum` decoder + enum tables | ✅ Done | Per-parameter enum-map TOML parsing + frontend wiring (PRs #64–#66) + 9 unit tests. Shipped in PR #60. |
| CBS reset for EGS / DSC | 🟡 Deferred | Data shape (`ModuleRoutine[]`) shipped in PR #67. Routine IDs need real-car validation, not forum-sourced invention. |
| `$5 AliExpress ENET cable pinout doc` | ✅ Done | `docs/hardware/enet-cable-pinout.md` + README link. Shipped in PR #61. |

**Release.** [`RELEASE_NOTES_v0.4.0.md`](RELEASE_NOTES_v0.4.0.md)
covers the cycle in detail: what's new, known limitations, upgrade
instructions, contributors.

---

## v0.5.0 — "Ground Truth" (Shipped 2026-07-15)

**Premise.** v0.4.0 finished the decoder + UI plumbing for tuner-style
work. What's missing isn't more plumbing — it's **real-car evidence**
and the small features that depend on it. v0.5.0 picks the cycle name
"Ground Truth" because the work is about validating the abstractions
we shipped in v0.3 / v0.4 against real hardware, and adding the narrow
features that real-car owners actually need first.

See [`docs/v0.5.0_plan.md`](docs/v0.5.0_plan.md) for the full cycle
plan. Summary below.

### ✅ Ready — all three shipped

| Item | Status | Notes |
|------|--------|-------|
| Real-car u8_enum validation harness | ✅ Done | Doc-only. Checklist for an F/G owner with ENET adapter to validate the `[needs verification]` enum DIDs from PR #60. Shipped in PR #72. |
| Real-car fuel-trim / adaptation readout | ✅ Done | Adds N55 DIDs (`0x1201` LTFT, `0x1202` idle adaptation). Sourced from the project's own `TECH_SPECS.md`, not forum. Shipped in PR #73. |
| Real-car knock-detection visualisation polish | ✅ Done | Pure JS; flag severity-bearing `LiveValue.text` values (Moderate / Severe) with amber / red emphasis. Shipped in PR #74. |

### 🟡 Needs research — not in v0.6.0 cycle

These stay on the v0.5.0 list as 🟡 items; some may move to 🟢 once the
spine lands and real-car evidence accumulates:

| Item | Status | Notes |
|------|--------|-------|
| Log file merge / comparison | 🟡 | Before/after diffing; client-side over CSV. |
| Custom math channels | 🟡 | `map - baro`, `rail / load` etc.; needs safe expression sandbox. |
| Knock detection visualisation (more) | 🟡 | Spine PR covers severity indicators; full distribution view is later. |
| AFR / lambda bank readout polish | 🟡 | Decoder exists (400B); needs the wider lambda + O2 readiness story. |
| Adaptation / fuel trim readout (full) | 🟡 | Spine PR adds DIDs; per-bank polish is later. |
| Injector duty cycle | 🟡 | Needs new decode; not in current table. |
| Trigger-based logging | 🟡 | Threshold / DTC-crossed autostart. |
| OBDLink MX+ support | 🟡 | USB + BLE; popular with iOS users. |
| ENET/DoIP auto-detection | 🟡 | Detect adapter without manual selection. |
| Real-car validation B58 F/G | 🟡 | Owner with ENET + F/G chassis. **Hardest blocker for next cycles.** |
| Real-car validation N55 F-series | 🟡 | Same as above. |

### Deferred to v0.6.0+

These are explicitly **not** v0.5.0 or v0.6.0 work:

- Cloud sync (opt-in log upload) — needs privacy + ops story first.
- Raspberry Pi CAN bridge — hardware project of its own.
- Plugin system for custom decoders — community governance work before code.
- Bootmod3 / MHD integration — legal risk; not appropriate scope.
- Multi-language UI — translation coordination problem.
- Web-based shared-log viewer — needs hosted backend work first.

---

## Ready to Claim (🟢 — open a PR when you want it)

These items have lived on the ROADMAP for multiple cycles as 🟢-
Ready and have not been claimed. They're real, well-scoped, and not
in conflict with the active v0.6.0 cycle.

> **If you're new to the project, start here.** These are the lowest-
> risk ways to land a first PR.

| Item | Where to start | Notes |
|------|----------------|-------|
| Dark/light theme toggle | `src/css/app.css` (CSS variables exist) + toggle button in `src/index.html` | Small. UI only; no Rust touched. |
| Save/load workspace layout | `src/js/` + Tauri settings persistence, or `~/beeemuu/` JSON | Mid-sized. Remembers which gauges the user had open. |
| Export PNG/SVG from charts | Extends the existing `Chart.js` lines | Mid-sized. Good first Chart.js PR. |
| Real-time data logging to disk | Extends the existing `LogSession` | Mid-sized. Touches the Logging tab only. |
| KWP2000 slow-module timeout fix | `src-tauri/src/protocol/kwp2000.rs` — **protected path**, flag the PR header | Small backend fix; CIC and slow modules time out today. |
| ISO-TP multi-frame (FF/CF/FC) | New module under `src-tauri/src/protocol/` — **protected path**, flag the PR header | Required for full VIN and full DTC list over UDS. |
| Gauge theming (M colors for S55, etc.) | `src/js/gauges.js` + per-profile `theme.css` | Small. Pure UI. |
| OBD-II PID auto-discovery | New tab in `src/index.html` | Small. |
| N20/N26 engine profile | New `community/profiles/n20.toml` (clone `b58.toml`, mark DIDs `[needs verification]`) | Small. Needs a tester. |
| S55 engine profile | New `community/profiles/s55.toml` | Small. High-performance N55 variant; oil temp critical. |

---

## Backlog — Nice to Have

| Item | Why it would be cool | Complexity |
|------|---------------------|------------|
| Multi-language support (DE, EN, FR, CN) | Broader audience | Medium |
| Plugin system for custom decode functions | Community extensibility | High |
| Web-based viewer for shared logs | No app needed to view a friend's log | Medium |
| Integration with tuning platforms (MHD, Bootmod3) | Read/write flash logs | High (legal risk) |
| Automatic BMW service manual lookup | Contextual repair info per DTC | Medium |
| OBD-II PID auto-discovery | Scan all standard PIDs, report which respond | Low |
| Vehicle database (VIN → options, build sheet) | VIN decode enrichment | Medium |

---

## How to Claim an Item

1. Open a GitHub issue referencing this roadmap item (e.g., "Working on
   real-car u8_enum validation for v0.5.0")
2. Comment on the issue so others know it's taken
3. Open a PR when ready; reference the issue and this roadmap

---

*Last updated: 2026-07-15. v0.5.0 "Ground Truth" marked Shipped; the three Ready items now show ✅ Done. v0.5.0 release notes at [`RELEASE_NOTES_v0.5.0.md`](RELEASE_NOTES_v0.5.0.md). The next cycle (v0.6.0) candidates are the 🟡 items below + the Backlog; open a Discussion thread per the no-Discussion-no-roadmap rule.*
