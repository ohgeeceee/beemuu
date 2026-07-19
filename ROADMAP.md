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

## v0.6.0 — "Real Hardware" (Shipped 2026-07-16)

**Premise.** v0.5.0 finished the validation harness and added the
first real-car-evidence-driven tuner DIDs. v0.6.0 turns those
validated abstractions into actual workflows: comparing logs
across sessions, surfacing which OBD-II PIDs a real ECU answers,
and shipping the `[needs verification]` discipline through to
the older example channels. Cycle name "Real Hardware" because
the work is no longer about plumbing — it's about using the
now-validated pipeline on real data.

See [`docs/v0.6.0_plan.md`](docs/v0.6.0_plan.md) for the full cycle
plan. Summary below.

### ✅ Ready — all three shipped

| Item | Status | Notes |
|------|--------|-------|
| Log-merge / comparison modal | ✅ Done | Pure client-side over CSV; per-channel mean / std-dev / max deltas; side-by-side rendering. Shipped in PR #77. |
| Real-car injector-time validation harness | ✅ Done | Doc-only + retroactive `[needs verification, UDS only]` marker on the pre-existing `inj_time` channel (DID `0x4363`, `u8_div100`). Plan-vs-actual: no new decoder needed — `inj_time` was already shipped since v0.3.0; the marker discipline was the actual work. Shipped in PR #80. |
| OBD-II mode 01 PID auto-discovery | ✅ Done | New `protocol::scan_obd2_pids()` helper + `list_supported_pids` Tauri command + Vehicle Test tab panel. 5 new unit tests. Plan-vs-actual: `read_obd_pid` was already shipped; this PR is the thin scan-loop wrapper + UI. Shipped in PR #81. |

### 🟡 Needs research — deferred to v0.7.0+

These stay on the v0.6.0 list as 🟡 items; some may move to 🟢
once the v0.7.0 spine lands and real-car evidence accumulates:

| Item | Status | Notes |
|------|--------|-------|
| Custom math channels | 🟡 | `map - baro`, `rail / load` etc.; needs safe expression sandbox. |
| Knock detection visualisation (more) | 🟡 | Spine PR covers severity indicators; full distribution view is later. |
| AFR / lambda bank readout polish | 🟡 | Decoder exists (400B); needs the wider lambda + O2 readiness story. |
| Adaptation / fuel trim readout (full) | 🟡 | Spine PR adds DIDs; per-bank polish is later. |
| Injector duty cycle | 🟡 | Plan-vs-actual surfaced: no separate DID exists; the `inj_time` channel (DID `0x4363`, ms) is what the codebase ships. A future contributor with F/G-series access can add a duty-cycle DID once a real source surfaces. |
| Trigger-based logging | 🟡 | Threshold / DTC-crossed autostart. |
| OBDLink MX+ support | 🟡 | USB + BLE; popular with iOS users. |
| ENET/DoIP auto-detection | 🟡 | Detect adapter without manual selection. |
| Real-car validation B58 F/G | 🟡 | Owner with ENET + F/G chassis. **Hardest blocker for next cycles.** |
| Real-car validation N55 F-series | 🟡 | Same as above. |

### Deferred to v0.7.0+

These are explicitly **not** v0.7.0 work; they stay deferred until
a dedicated cycle scope opens:

- Cloud sync (opt-in log upload) — needs privacy + ops story first.
- Raspberry Pi CAN bridge — hardware project of its own.
- Plugin system for custom decoders — community governance work before code.
- Bootmod3 / MHD integration — legal risk; not appropriate scope.
- Multi-language UI — translation coordination problem.
- Web-based shared-log viewer — needs hosted backend work first.

---

## v0.7.0 — "Unblockers" (Merged 2026-07-16)

**Premise.** Not a new user-facing capability — remove the friction
that contributors and F/G users hit daily: hardcoded car IPs, the
stale Ready-to-Claim pile, and the two missing mainstream engine
profiles.

See [`docs/v0.7.0_plan.md`](docs/v0.7.0_plan.md) for the full cycle
plan. Summary below.

### ✅ Ready — all three merged

| Item | Status | Notes |
|------|--------|-------|
| ENET/DoIP auto-detection | ✅ Done | UDP broadcast discovery on port 13400; **Discover** button; manual IP entry kept as fallback. Merged in PR #108. |
| Theme toggle + workspace persistence + per-profile gauge themes | ✅ Done | Dark/light via CSS variables; layout persists in `~/beeemuu-exports/workspace.json`; `[profile.theme]` TOML blocks recolour gauges. Merged in PR #109. |
| N20/N26 + S55 engine profiles | ✅ Done | `community/profiles/n20.toml` (22 params) + `s55.toml` (25 params, BMW M tricolor `[profile.theme]`); conservative sourcing, every UDS entry `[needs verification]`. Merged in PR #110. |

**Release.** The release cut (version bump + notes) is Tier C and
tracked separately; the cycle's code is all on `main`.

### 🟡 Needs research — carried into v0.8.0+ consideration

Custom math channels, knock-distribution view, full AFR/lambda story,
full per-bank adaptation readout, trigger-based logging, OBDLink MX+
(BLE), and real-car validation of the B58/N55/N20/S55 DID sets all
remain 🟡 — see the v0.7.0 plan's deferred list. Real-car validation
is still the hardest cross-cycle blocker.

---

## v0.8.0 — "Service Bay" (Merged except PR #2 — pending human merge)

**Premise.** Turn the diagnostic reader into the service workstation:
service-function breadth with honest verification status, coverage
breadth (fault texts, ECU scan table, engine profiles), and the
data-integrity floor under all of it. See
[`docs/v0.8.0_plan.md`](docs/v0.8.0_plan.md) for the full cycle plan,
including the ISTA+ gap analysis and the explicit "what we will NOT
do" list (flashing, FSC/AOS, coding writes, ISTA corpus, immobiliser).

### Slice status

| Item | Status | Tier | Notes |
|------|--------|------|-------|
| Data integrity: DTC text rescue + corpus + TOML parse gate | ✅ Merged (#114) | A | Corpus rebuilt to 208 overlay entries; every shipped community TOML now parse-gated in CI. |
| Service-function breadth + verification status | 🟡 PR #117 open — pending human merge | B | `[UNVERIFIED]` markers + write gating; harness doc `docs/validation/service-functions.md`. Tier B — human merges after review. |
| Engine profiles: B48, S58, N57 | ✅ Merged (#115) | A | First diesel profile; conservative-sourcing pattern repeated. |
| ECU scan-table breadth + addressing-model doc | ✅ Merged (#116) | A | Table 12 → 17 with OBDb-grounded F/G addresses; `docs/hardware/addressing-model.md`. |

---

## v0.9.0 — "Guided Fault Finding" (Released)

**Premise.** Close the biggest remaining ISTA+ gap: guided diagnostics.
Today three flat knowledge bases (3 Opinions files, 2 Oracle JSON files,
2 Story files) answer "what could this code mean?"; none can walk the
tech through a branching test plan (check wiring → measure sensor →
interpret result → branch → conclusion). See
[`docs/v0.9.0_plan.md`](docs/v0.9.0_plan.md) for the full cycle plan,
including the surface survey, the conservative-sourcing rules, and the
"what we will NOT do" list (emissions-monitor tampering, VIN/odometer
fraud, imported ISTA plans, auto-executing writes, unreviewed
LLM-generated procedures).

### Planned slices

| Item | Status | Tier | Notes |
|------|--------|------|-------|
| Test-plan schema + parse-gate extension | ✅ Done (PR #1, #120) | A | New `community/testplans/*.toml` `[[step]]` branching format; branch-integrity gate; oracle JSON gate (was ungated). |
| Author grounded first-corpus plans | ✅ Done (PR #2, #121) | A | 11 DTCs grounded in-repo (2A82, 29E0–29E2, 30FF, 29CC, 2E81/2E82, P0171, P0300, P0420); known-missing list shipped. |
| Plan loader + query command | ✅ Done (PR #3, #122) | B | Read-only `get_test_plan` command; protected paths (`commands.rs`/`lib.rs`) — human-merged. |
| Guided-diagnosis walkthrough UI | ✅ Done (PR #4, #123) | A | Step-by-step panel in fault detail; live-data measurement deep-links; freeze-frame seeding; pure traversal reducer unit-tested (12 tests). |
| Validation harness + contribution path | ✅ Done (PR #5, #125) | A | `docs/validation/testplans.md` harness; `community/testplans/README.md` + `CONTRIBUTING.md` label axis; all 11 plans tagged `verified = "needs verification"`. Completes v0.9.0. |

Slices dispatch as PRs when the work completes — no Discussion gate
(`COMMUNITY_FRAMEWORK.md` Rule 2).

---

## Ready to Claim (🟢 — open a PR when you want it)

These items have lived on the ROADMAP for multiple cycles as 🟢-
Ready and have not been claimed. They're real, well-scoped, and not
in conflict with the active v0.8.0 cycle.

> **If you're new to the project, start here.** These are the lowest-
> risk ways to land a first PR.

| Item | Where to start | Notes |
|------|----------------|-------|
| Export PNG/SVG from charts | Extends the existing `Chart.js` lines | Mid-sized. Good first Chart.js PR. Useful for forum posts. |
| KWP2000 slow-module timeout fix | `src-tauri/src/protocol/kwp2000.rs` — **protected path**, flag the PR header | Small backend fix; CIC and slow modules time out today. |
| Freeze-frame schema coverage | `community/freeze_schemas.toml` (32 lines today) | Pure data; mirror an existing schema block per ECU you can verify. |

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

*Last updated: 2026-07-19. v0.9.0 "Guided Fault Finding" complete — all 5 slices merged (PR #1 #120 schema/gate, PR #2 #121 corpus, PR #3 #122 loader+`get_test_plan` command [Tier B, human-merged], PR #4 #123 walkthrough UI [Tier A], PR #5 #125 validation harness + contribution path [Tier A]). v0.8.0 "Service Bay" shipped (#114/#115/#116/#117). Plan: [`docs/v0.9.0_plan.md`](docs/v0.9.0_plan.md); slices dispatched as PRs per `COMMUNITY_FRAMEWORK.md` Rule 2.*
