# BeeEmUu Roadmap

This document tracks planned work and rough priorities. Items are not
promised in any order — contributors are welcome to grab anything marked
"help wanted".

For the **current cycle scope and PR spine**, see
[`docs/v0.5.0_plan.md`](v0.5.0_plan.md) — that's where the v0.5.0 work
actually lives. This file is the *long view*: what shipped, what's
ready to pick up, what's deferred, and what the project considers
out-of-scope.

## Legend

| Label | Meaning |
|-------|---------|
| 🔴 Blocker | Blocks a release or major feature |
| 🟡 Needs research | Not well understood yet; needs investigation |
| 🟢 Ready | Well-scoped; open a PR when you want it |
| ✅ Done | Shipped |
| ⭐ High impact | Would significantly improve user experience |

---

## v0.3.0 — "Real Car" (Shipped 2026-07-11)

### ✅ Decode Functions (shipped; section kept historical)

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
| Add `u8_enum` | ✅ Done (v0.4.0) | PR #60 + UI/tests wiring in #64–#66. Per-DID enum tables in `community/profiles/*.toml`. See [`docs/DECODE_FUNCTIONS.md`](DECODE_FUNCTIONS.md) § 8. |

### ⭐ Real-Car Validation (v0.3.0 unfinished work; some moved to v0.5.0)

| Item | Status | Notes |
|------|--------|-------|
| B58 F/G-series UDS DID test | 🟡 Needs research | Need owner with ENET adapter + F/G chassis. **First action item of v0.5.0** — see [`docs/validation/u8_enum-validation.md`](validation/u8_enum-validation.md). |
| N55 F-series UDS DID test | 🟡 Needs research | Same as above; F30/F32 owners ideal |
| N52 E-series KWP2000 local ID hunt | 🟡 Needs research | Use Parameter Explorer; document findings in issue |
| N54 E-series KWP2000 local ID hunt | 🟡 Needs research | Same as above; E92 335i owners ideal |
| E-series CAN broadcast frames | 🟡 Needs research | Validate 0x0AA (RPM), 0x1D0 (coolant), 0x545 (oil temp E46) |

### 🔴 New Engine Profiles (still waiting on real-car owners)

| Engine | Protocol | Status | Notes |
|--------|----------|--------|-------|
| N20/N26 (F-series 4-cyl) | UDS | 🟢 Ready | Similar to B58 DID set; needs real-car tester |
| S55 (F80 M3/M4) | UDS | 🟢 Ready | High-performance variant of N55; oil temp critical |
| N63/S63 (F10/F15 V8 TT) | UDS | 🟡 Needs research | Different DID set; fewer community sources |
| B48 (G-series 4-cyl) | UDS | 🟡 Needs research | Newer protocol; may need DoIP support |
| S58 (G80 M3/M4) | UDS | 🟡 Needs research | Newest; limited open-source data |

### ⭐ Protocol & Transport

| Item | Status | Notes |
|------|--------|-------|
| ENET/DoIP auto-detection | 🟡 Needs research | Detect adapter type without manual selection |
| KWP2000 slow-module timeout fix | 🟢 Ready | CIC and other modules timeout on slow responses |
| BLE adapter support | 🟡 Needs research | Vgate iCar Pro BLE, OBDLink CX, etc. |
| WiFi adapter support | 🟡 Needs research | Vgate iCar Pro WiFi, OBDLink MX+ WiFi |
| CAN bus listener mode | 🟡 Needs research | E-series alternative to KWP2000 local IDs |
| ISO-TP multi-frame (FF/CF/FC) | 🟢 Ready | Required for long UDS responses (VIN, full DTC list) |

### UI / UX

| Item | Status | Notes |
|------|--------|-------|
| Dark/light theme toggle | 🟢 Ready | Currently dark-only; CSS variables exist |
| Gauge theming | 🟢 Ready | Per-profile color schemes (e.g., M colors for S55) |
| Mobile-responsive layout | 🟡 Needs research | Tauri supports mobile; needs testing |
| Save/load workspace layout | 🟢 Ready | Remember which gauges user had open |
| Export PNG/SVG from charts | 🟢 Ready | Useful for forum posts |
| Real-time data logging to disk | 🟢 Ready | Stream CSV to file instead of in-memory only |

### 🟡 Research: E-series Data Desert

The open-source community has no published KWP2000 local identifier table for any
BMW E-series DME (MSV70, MSV80, MSD80, MSD81, ME9.2). This is a structural gap.

**Possible paths forward:**
- CAN bus broadcast frame decoding (0x0AA, 0x1D0, 0x545, 0x0CE) — bypass KWP2000 entirely
- Parameter Explorer crowdsourcing — every E-series owner who maps a local ID contributes to a community table
- BSD protocol documentation — N52 oil condition sensor uses BSD, not KWP2000

See `research/bmw_diag_dim07_local_ids.md` for the exhaustive search results.

---

## v0.4.0 — "Tuner Friendly" (Shipped 2026-07-15, PR #69)

The full release notes are in
[`RELEASE_NOTES_v0.4.0.md`](../RELEASE_NOTES_v0.4.0.md). The ROADMAP
summary below lists what landed and what didn't — the "didn't" line
items were re-evaluated for v0.5.0.

### ✅ Shipped

| Item | Status | PR |
|------|--------|-----|
| `u8_enum` decoder + enum tables (incl. UI/CI fix) | ✅ | #60, #64, #65, #66 |
| Histograms of logged channels | ✅ | #62 |
| CBS reset for EGS / DSC — *data shape only* | ✅ (partial) | #67 |
| ENET cable pinout doc | ✅ | #61 |
| README drift cleanup | ✅ | (bundled into release) |

### ⭐ Deliberately deferred (re-evaluated for v0.5.0)

These were on the v0.4.0 candidate list but didn't ship. Each has a
**current `Status` rationale**; some are still 🟢 Ready, others went
🟡 because they need hardware or research we don't have yet.

| Item | Status now | Why it didn't ship |
|------|-----------|--------------------|
| CBS reset for EGS / DSC — actual routine IDs | 🟡 Blocked on real-car validation | Wrong IDs could brick NV memory on those modules. Contributor with EGS or DSC and a willing tester needed. |
| Log file merge / comparison | 🟡 | Larger than v0.4's remaining bandwidth; pushed to a later cycle. |
| Custom math channels | 🟡 | Safe expression sandbox needs design; not a v0.4.0-sized PR. |
| Knock detection visualisation | 🟡→ 🟢 promoted to v0.5.0 PR #3 | Move to v0.5.0 plan as "real-car knock visualisation polish." |
| AFR / lambda bank readout polish | 🟡 | Decoder exists (400B); wider lambda + O2 readiness story remains. |
| Adaptation / fuel-trim readout | 🟡→ 🟢 promoted to v0.5.0 PR #2 | Move to v0.5.0 plan as "real-car fuel-trim / adaptation readout." |
| Injector duty cycle | 🟡 | Needs new decode; not in current table. |
| Real-car validation B58 F/G | 🟡→ 🟢 promoted to v0.5.0 PR #1 | Move to v0.5.0 plan; address via u8_enum validation harness. |
| Real-car validation N55 F-series | 🟡 | Same as above; not yet scoped. |
| Trigger-based logging | 🟡 | Threshold / DTC-crossed autostart; needs design. |
| OBDLink MX+ support | 🟡 | USB + BLE; popular with iOS users. |
| ENET/DoIP auto-detection | 🟡 | Detect adapter without manual selection. |
| README profile-listing fix | ✅ Done | Resolved during v0.4.0 cut cleanup. |

---

## v0.5.0 — "Ground Truth"

**Cycle plan lives in [`docs/v0.5.0_plan.md`](v0.5.0_plan.md).** Read
that for the up-to-date PR sequence; don't trust the bullet points
below for ordering.

**Premise (short form).** v0.4.0 finished the decoder + UI plumbing
for tuner work. v0.5.0 is about *validating* what shipped against real
hardware and adding the narrow features that real-car owners need
first — starting with the example enum DIDs flagged `[needs verification]`
since PR #60.

### Active PRs

See [`docs/v0.5.0_plan.md`](v0.5.0_plan.md) for the live PR spine.
Status mirrored from plan doc on every cycle checkpoint.

### ⭐ High-impact candidates (proposed; not yet committed)

These are sourced from [`UNIQUE_FEATURES.md`](../UNIQUE_FEATURES.md)
and the v0.4.0 deferred list. Open a Discussion thread before picking —
per `COMMUNITY_FRAMEWORK.md`, no feature enters the roadmap without
public input.

| Item | Why | Source |
|------|-----|--------|
| Community Oracle (opt-in DTC pattern matching) | Network-effect moat; builds on existing community trust. | UNIQUE §1 |
| Adaptation Drift Tracker | Cross-session trends; needs adaptation DIDs (v0.5.0 PR #2 lands them) then a UI. | UNIQUE §5 |
| Diagnostic Story Mode (LLM-narrative snapshot) | Pure-local narrative generation; small Phase-1 with templates before LLM. | UNIQUE §2 |
| Tuning Fingerprint Detector | "Has this car been tuned?" — high demand, zero competition. | UNIQUE §3 |
| Ghost Mode (passive CAN listener) | Track-day safe diagnostic without disturbing DSC/DME logic. | UNIQUE §4 |

---

## Ready to Claim (🟢 — open a PR when you want it)

These items have lived on the ROADMAP for multiple cycles as
🟢-Ready and have not been claimed. They're real, well-scoped, and
not in conflict with v0.5.0 scope.

> If you're new to the project, **start here.** They're the lowest-
> risk ways to land a first PR.

| Item | Where to start | Notes |
|------|----------------|-------|
| Dark/light theme toggle | `src/css/app.css` (CSS variables exist) + `src/index.html` toggle button | Small. UI only; no Rust touched. |
| Save/load workspace layout | `src/js/` + `src-tauri` settings persistence | Mid-sized. Local-storage or in-app `~/beeemuu/` JSON. |
| Export PNG/SVG from charts | Extends the existing `Chart.js` lines | Mid-sized. Good first Chart.js PR. |
| Real-time data logging to disk | Extends the existing `LogSession` | Mid-sized. Touches the logging tab only. |
| KWP2000 slow-module timeout fix | `src-tauri/src/protocol/kwp2000.rs` — **protected path**, flag the PR header | Small backend fix. |
| ISO-TP multi-frame (FF/CF/FC) | New module under `src-tauri/src/protocol/` — **protected path**, flag the PR header | Required for full VIN and full DTC list over UDS. |
| Gauge theming (M colors for S55, etc.) | `src/js/gauges.js` + per-profile `theme.css` | Small. |
| OBD-II PID auto-discovery | New tab in `src/index.html` | Small. |
| N20/N26 engine profile | New `community/profiles/n20.toml` (clone `b58.toml`, mark `[needs verification]`) | Small. Needs a tester. |
| S55 engine profile | New `community/profiles/s55.toml` | Small. High-performance N55 variant; oil temp critical. |

---

## Deferred to a later cycle (🟡 — explicit out-of-scope for now)

These were called out in earlier versions of this file as "Deferred
to v0.5.0+." Listed here as a record of decisions, not as a TODO.

- **Cloud sync (opt-in log upload)** — needs privacy + ops story first.
- **Raspberry Pi CAN bridge** — hardware project of its own.
- **Plugin system for custom decoders** — community governance work before code.
- **Bootmod3 / MHD integration** — legal risk; not appropriate scope.
- **Multi-language UI** — translation coordination problem.
- **Web-based shared-log viewer** — needs hosted backend work first.

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

1. Open a GitHub issue referencing this roadmap item (e.g., "Working on N20 engine profile")
2. Comment on the issue so others know it's taken
3. Open a PR when ready; reference the issue and this roadmap

For cycle-scoped items (v0.5.0 PRs), reference the cycle's plan doc
instead — that one is the live source of truth for ordering.

---

*Last updated: 2026-07-15. v0.4.0 section moved to Shipped with
rationale for each deferred item; 🟢 Ready items consolidated into a
"Ready to Claim" list so the project can stop carrying duplicates
between cycle docs.*
