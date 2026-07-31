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

### ⭐ Protocol & Transport (shipped items moved to historical — see table below)

| Item | Status | Notes |
|------|--------|-------|
| ENET/DoIP auto-detection | 🟡 | Detect adapter without manual selection |
| BLE adapter support | 🟡 | Vgate iCar Pro BLE, OBDLink CX, etc. |
| WiFi adapter support | 🟡 | Vgate iCar Pro WiFi, OBDLink MX+ WiFi |
| CAN bus listener mode | 🟡 | E-series alternative to KWP2000 local IDs |

### UI / UX (shipped items moved to historical — see table below)

| Item | Status | Notes |
|------|--------|-------|
| Mobile-responsive layout | 🟡 | Tauri supports mobile; needs testing |

### ✅ Protocol, Transport, UI/UX — historical (shipped)

The items below landed after v0.3.0 cut but were never re-tagged
on the v0.3.0 historical section. Pinning them here so the
ROADMAP accurately reflects what shipped, with the PR that
landed the work:

| Item | Status | Notes |
|------|--------|-------|
| KWP2000 slow-module timeout fix | ✅ Done (v0.13.0) | `transport::kdcan::default_slow_modules()` + per-target deadline (1s default, 3s for slow modules). PR #153 (commit `fd9efc2`). |
| ISO-TP multi-frame (FF/CF/FC) | ✅ Done (v0.14.x) | `src-tauri/src/transport/isotp.rs` (430 LOC, ~25 unit tests). Enforced by CLAUDE.md "Hardware & timing invariants" §ISO-TP multi-frame. |
| Dark/light theme toggle | ✅ Done (v0.7.0) | `#btn-theme` in `src/index.html:49` + handler in `src/js/main.js:283`. localStorage persistence via `beeemuu_dark` key (migrated to `beeemuu_settings` per the v0.7.0 settings-schema). PR #109 (commit `afefc32`). |
| Gauge theming | ✅ Done (v0.7.0) | `profileThemes` object in `src/js/main.js:21`; per-profile `[profile.theme]` block in the TOML community profile. PR #109. |
| Save/load workspace layout | ✅ Done (v0.7.0) | `src/js/workspace.js` (pure helpers for the persisted layout). PR #109. |
| Export PNG/SVG from charts | ✅ Done (v0.11.0) | `src/js/svg_export.js` (pure-JS SVG renderer; avoids the `canvas2svg` / `chartjs-plugin-svg-export` deps); PNG export via `canvas.toDataURL` upstream. Logging chart + histogram both supported. PR #136 (commit `7f92ccb`). |
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

## v0.10.0 — "Honest Plans" (Released)

**Premise.** Close the trust gap on the v0.9.0 plans: the data contract
for "verified" was installed in PR #5 (the marker on every
`community/testplans/*.toml`), but nothing in the UI surfaced it — a
tech could walk a plan and have no way to know whether anyone had
actually driven the steps on a real car. v0.10.0 makes the marker
visible end-to-end and fixes the one wrong-repo-URL string that had
been confusing new contributors.

### Planned slices

| Item | Status | Tier | Notes |
|------|--------|------|-------|
| Plan verification badge in walkthrough header | ✅ Done (PR #127) | A | Reads `meta.verified` per plan; renders **NEEDS VERIFICATION** (amber) / **✓ Verified** (green) in the walkthrough panel header. Rust change additive (`verified: Option<String>` on `PlanMeta` + `TestPlan`); legacy plans with no marker render no badge. |
| Clickable NEEDS VERIFICATION badge + fix repo URL | ✅ Done (PR #130) | A | Badge now links to `docs/validation/testplans.md` so a tech lands on the contribution path with one click. About modal `ohjoncurrie/beeemuu` → `ohgeeceee/beeemuu`. |
| Bump version to 0.10.0 (matches released state) | ✅ Done (PR #128) | C-executed | `Cargo.toml` + `package.json` synced to `0.10.0`. |
| Sync `Cargo.lock` to 0.10.0 | ✅ Done (PR #129) | A | `Cargo.lock` version bump to match. |

---

## v0.11.0 — "Share the Trace" (Started)

**Premise.** An owner finishes a logging session and wants to ask
someone who knows — a forum thread, a friend, a subreddit. The first
thing they need is a picture they can paste straight in, and a CSV
that doesn't read as a wall of hex. v0.9.0 / v0.10.0 closed the
diagnostic-workflow gaps (guided plans + honest verification). v0.11.0
closes the **share-the-trace** gap — the cycle an owner actually
finishes a session with. See
[`docs/v0.11.0_plan.md`](docs/v0.11.0_plan.md) for the full cycle plan,
including the trace-surface survey and the explicit "what we will NOT
do" list (cloud upload, ISTA+ export shapes, PDF reports, multi-lang
headers, auto-share).

### Planned slices

| Item | Status | Tier | Notes |
|------|--------|------|-------|
| PNG export of logging + histogram charts | ✅ Done (PR #131, d2d1d07) | A | Chart.js `toBase64Image()` → browser-native anchor download. Buttons enable only once a chart exists. |
| SVG export of logging + histogram charts | ✅ Done (PR #136, 7f92ccb) | A | Mirrors #131; hand-rolled `src/js/svg_export.js` (no `chartjs-plugin-svg-export` dep). Pure frontend. |
| CSV-with-units export option | ✅ Done (PR #138, b2ed806) | A | Checkbox on the Save panel → row 2 of CSV is the per-series unit. Loader parses both shapes. |
| Static HTML walkthrough bundle | ✅ Done (PR #142, fd381a9) | A | "Share walkthrough" → `walkthrough-XXXX.html` (single file, inline CSS + JS). Stateless static render of plan + answers + freeze frame + chart. Pure frontend. |
| ROADMAP v0.10.0 closure + cycle header for v0.11.0 | ✅ Done (PR #135) | A | v0.10.0 cycle table landed retroactively; v0.11.0 cycle header landed. Docs-only. |

**Cycle closed 2026-07-21.** All 5 v0.11.0 slices shipped. "Share the Trace" — the cycle of getting a session off the device and into someone else's hands — is done.

---

## v0.12.0 — "Fault Memory" (Released)

**Premise.** Closing the DTC panel is closing the diagnosis. Today `lastDtcs` is a per-session cache; once the user quits the app, the DTCs are gone. v0.12.0 persists every DTC read to a local JSONL log and surfaces a **Fault Memory** panel: "this DTC has appeared N times over the past K days on this car". Local-only, opt-in, no cloud, no privacy surprise. See
[`docs/v0.12.0_plan.md`](docs/v0.12.0_plan.md) for the full cycle plan, including the explicit "what we will NOT do" list (cloud sync, ML prediction, per-entry editing, CSV export).

### Planned slices

| Item | Status | Tier | Notes |
|------|--------|------|-------|
| Cycle plan + ROADMAP v0.12.0 header | ✅ Done (PR #143) | A | `docs/v0.12.0_plan.md` + this ROADMAP entry. Docs-only. |
| `record_dtc_read` / `query_dtc_history` / `clear_dtc_history` Tauri commands | ✅ Done (PR #144) | **B** | Three additive commands in `commands.rs` only (no `transport/` / `protocol/` changes). Local JSONL appender at `~/beeemuu-exports/dtc-history.jsonl`. 60 s dedup window. Flagged `commands.rs` at the top of the PR body. |
| `src/js/dtc_history.js` pure module + tests | ✅ Done (PR #145) | A | Wraps the three Tauri commands. In-memory mock store for tests under `node --test`. Dual export (CommonJS + `window.beeemuuDtcHistory`). |
| Recording wired into `readFaults()` + opt-in toggle in Settings | ✅ Done (PR #146) | A | Hooks the existing `read_faults` invocation; toggles recording on/off; surfaces file path in the panel header; persists the toggle via the v0.7.0 `workspace.json`. |
| "Recurring DTC" callout in the DTC panel | ✅ Done (PR #147) | A | Headline UI moment of the cycle. When `lastDtcs.length > 0`, queries history for the current VIN and renders a banner under the DTC table. Pure read, frontend only. 14-day lookback; collapses occurrences across modules for the same code. |
| `docs/validation/dtc-history.md` harness doc | ✅ Done (PR #148) | A | Same shape as `docs/validation/testplans.md` and `docs/validation/service-functions.md`: file location, line format, clear procedure, dedup window, "no VIN" caveat, storage growth, privacy note. |
| Async conversion follow-up (PR #147 fixup) | ✅ Done | **B** | The slice-2 commands shipped sync. PR #147's CI run caught this against the `tests/async_commands.rs` allowlist guard; follow-up commit converted the three commands to `async fn` + `spawn_blocking`, matching the project's stated direction for new commands touching disk. |

Slices dispatch as PRs when the work completes — no Discussion gate
(`COMMUNITY_FRAMEWORK.md` Rule 2).

**Cycle closed 2026-07-23.** All 6 v0.12.0 slices shipped across 6 PRs (#143, #144, #145, #146, #147, #148). "Fault Memory" — the cycle of making the app remember your car between sessions — is done. Local JSONL at `~/beeemuu-exports/dtc-history.jsonl`; opt-in toggle on the Fault memory panel; "seen before" callout under the DTC table. Zero new cloud deps, zero new crate deps, zero changes to `transport/` or `protocol/`.
## v0.13.0 — "Real Reads, Real Long" (Planned)

**Premise.** Two genuine, user-visible wins have been on the ROADMAP since v0.3.0 without shipping:

- **KWP2000 slow-module timeout fix** (🟢 Ready, line 52): the hardcoded 1000ms deadline in `kdcan.rs::request` times out on real E-series CIC/CAS modules. Small, well-scoped, real bug. Every E-series owner's first fault read hits this.
- **E-series CAN broadcast frame decoder** (🟡, line 45): the bytes are already on the bus from the transport; the renderer just doesn't decode them. Pure frontend. For E46 owners, gives them a working tachometer + coolant gauge that the current app doesn't show.

Plus the `docs/validation/multi-frame.md` doc, which earns its keep by explaining what `isotp.rs` is for (the integration point for future raw-CAN transports), why the production stack doesn't need it (the FTDI cable + ZGW gateway terminate ISO-TP upstream), and how to validate against the simulator's multi-frame personality today.

> **Note (revised 2026-07-23).** The first plan draft (PR #150) claimed that ISO-TP multi-frame was implemented but not wired into the production `connect()` paths, and proposed v0.13.0 slice 2 as the wire-up PR. **That premise was wrong.** The existing `isotp.rs` module doc-comment is explicit: `KdcanTransport` and `EnetTransport` already deliver complete payloads because the gateways terminate ISO-TP upstream. There is no production wire-up to do — the wire-up is the integration point for future raw-CAN transports (SocketCAN, OBDLink STN, future DoIP socket) that don't exist yet. The corrected cycle (this revision) drops the wire-up and rescopes around the two real wins.

See [`docs/v0.13.0_plan.md`](docs/v0.13.0_plan.md) for the full cycle plan, including the explicit "what we will NOT do" list (wire ISO-TP into production, re-implement ISO-TP, touch `enet.rs`, cross-cutting connect() refactors).

### Planned slices

| Item | Status | Tier | Notes |
|------|--------|------|-------|
| Revised cycle plan + ROADMAP v0.13.0 header (this entry) | 🔲 Open | A | Corrects the flawed first draft (PR #150). Docs-only. |
| KWP2000 slow-module timeout fix | 🔲 Open | A + **B** | Configurable deadline + per-target override table. Touches `src-tauri/src/transport/kdcan.rs::request`. The actual change is small but the protected-path exposure is real. Single Tier B PR. |
| E-series CAN broadcast frame decoder (0x0AA / 0x1D0 / 0x545) | 🔲 Open | A | Pure frontend — the bytes are already on the bus. Renders as a Live Gauges panel using the existing `src/js/gauges.js` widget. |
| `docs/validation/multi-frame.md` harness doc | 🔲 Open | A | Same shape as `testplans.md` / `service-functions.md` / `dtc-history.md`: what `isotp.rs` is for, why the production stack doesn't need it, how to verify against the simulator's multi-frame personality today. |

Slices dispatch as PRs when the work completes — no Discussion gate
(`COMMUNITY_FRAMEWORK.md` Rule 2). Slice 2 is the only Tier B and
lands first; slices 3 and 4 can land any time after.

---

## Ready to Claim (🟢 — open a PR when you want it)

These items have lived on the ROADMAP for multiple cycles as 🟢-
Ready and have not been claimed. They're real, well-scoped, and not
in conflict with the active v0.13.0 cycle (or whatever the next
cycle lands on). (PNG/SVG export landed in v0.11.0 #131 / #136; CSV
units + walkthrough bundle in #138 / #142; DTC history in v0.12.0
#143–#148; the row below covers anything else in this category.)

> **If you're new to the project, start here.** These are the lowest-
> risk ways to land a first PR.

| Item | Where to start | Notes |
|------|----------------|-------|
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

*Last updated: 2026-07-30. v0.14.3 closed — slices 1, 2, 3a, 3b, 4 all merged (#185, #186, #187, #190, plus #188 for the docs-only slice 4). Tier split: 3 Tier A (slice 1 decoders, slice 2 profile entries, slice 4 harness extension) + 2 Tier B (slice 3a backend — `protocol::nrc_from_error`, `LiveSweepResult { values, errors }`, async `remove_profile_pid` Tauri command — in PR #187; slice 3b frontend rewire — `main.js::pollOnce` consumer of the new return shape + `classifyNrc` helper + per-PID dim UI + `remove_profile_pid` button — in PR #190) + 0 Tier C in the slice list. Three new decoders (`u16_fiftieths`, `u32_be`, `u16_half`) in `src-tauri/src/data/live.rs`; three new N62 profile entries (`0x5E` fuel rate L/h, `0x5F` engine runtime s, `0x62` fuel rate g/s) in `community/profiles/n62.toml`; per-PID NRC + remove-from-profile surface on both ends in PR #187 + #190; `docs/validation/n62-real-car.md` extended with Step 2 / Step 3 / Step 4 / Step 5 tables covering all four v0.14.2/v0.14.3 PIDs. The v0.14.3 release cut itself (Cargo.toml + tauri.conf.json version bumps, git tag, release notes publish, installer build) is a separate Tier C step and is the maintainer's call — the slices are all merged but the version-surface bump requires an explicit release-cut PR.*
---

## v0.14.0 — "Live CAN" (In Progress — Tier A done, Tier B open)

**Premise.** E-series owners can't read their live data today — KWP2000 local IDs are unmapped in open sources (`docs/ROADMAP_ISSUES.md` issue 6, "CAN bus listener mode for E-series"). But BMW ECUs **broadcast** the data anyway on the raw CAN bus at 500 kbit/s. The bytes are free, we just don't listen. v0.14.0 adds a new `Live CAN` transport mode that filters and decodes the 6 known broadcast IDs (`0x0AA` RPM/torque/throttle, `0x1D0` coolant/ambient, `0x545` oil temp, `0x0CE` wheel speeds, `0x130` vehicle speed, `0x316` battery voltage) and surfaces them as a new "Live Gauges" panel using the existing `src/js/gauges.js` widget.

**Hardware scope (v0.14.0):** OBDLink SX on E46. The SX is a USB-CDC ACM serial device, so the existing `serialport = "4"` crate covers it (no new dep). STN1110 protocol commands go over the standard serial handle — the same `SerialPort` trait the K+DCAN transport already uses. The new `transport/can_listener.rs` is additive; K+DCAN KWP diagnostic sessions keep using `kdcan.rs` in parallel. See [`docs/v0.14.0_plan.md`](docs/v0.14.0_plan.md) for the full cycle plan, including the explicit "what we will NOT do" list (touch the K+DCAN transport, touch `protocol/`, add a new crate, run the listener by default).

### Status: Tier A complete (6 of 8 slices shipped), Tier B gated behind real-car testing

The Tier A surface — frontend decoder module, JS-side simulator, panel, harness doc — is fully shipped. The Tier B surface — new `transport/can_listener.rs` + three Tauri commands — is **open** and gated behind OBDLink SX testing on a real E46. The "more live features" extension (per-gauge peak tracking + frame-rate counter) landed in PR #164 as a bonus slice.

### Slices shipped

| Item | Status | Tier | Notes |
|------|--------|------|-------|
| Cycle plan + ROADMAP v0.14.0 header | ✅ Done (PR #156) | A | `docs/v0.14.0_plan.md` + this ROADMAP entry. Docs-only. |
| `src/js/can_decoders.js` pure decoder module + tests | ✅ Done (PR #157) | A | 8 decoders + scale constants; dual export (CommonJS + `window.beeemuuCanDecoders`). 32 tests. |
| `src/js/live_gauges.js` panel (6 gauges) | ✅ Done (PR #162) | A | Reuses existing `src/js/gauges.js` `Gauge` widget. 2×3 grid. Off by default. Mounts synchronously at module load (DOMContentLoaded trap noted inline). |
| `src-tauri/src/transport/sim.rs` broadcast personality | ✅ Done (PR #158) | A | Pushes the 6 known IDs at the documented rates into an `mpsc::Sender<CanFrame>`. Test source for slices 2-3-5. |
| `src/js/live_can_source.js` — JS-side simulator mirror + source wiring | ✅ Done (PR #164) | A | Pure JS mirror of `broadcast_frames_at()`; byte-for-byte parity pinned by tests. The frontend has a working demo path even before the Tier B transport ships. |
| Extended `live_gauges.js` controller — peak tracking + framesPerSecond + per-gauge peak labels | ✅ Done (PR #164) | A | "More live features" beyond the cycle spec. Peak per gauge + frame-rate counter in the panel header. |
| `docs/validation/can-broadcast.md` harness doc | ✅ Done (PR #164) | A | Same shape as `testplans.md` / `service-functions.md` / `dtc-history.md`. Includes E9x/E6x verification path for 0x545 oil-temp frame. |
| **Bonus: Live Gauges panel on `beemuu.com`** | ✅ Done (PR #167) | A | Public-site mirror of the desktop panel. Visitors to beemuu.com see the 6 gauges ticking in real time, driven by the same JS-side simulator. Byte parity with desktop module pinned by `frontend/live_gauges.test.js`. |

### Slices still open (Tier B, gated behind real-car testing)

| Item | Status | Tier | Notes |
|------|--------|------|-------|
| `src-tauri/src/transport/can_listener.rs` (new transport) | 🔲 Open | **B** | `ListenerMode::{Simulator, OBDLinkSx { port_name }}` + `Arc<Mutex<HashMap<u16, CanFrame>>>` for latest frames. Touches `transport/`. Flag in PR body. |
| `src-tauri/src/commands.rs` — `start_can_listen` / `stop_can_listen` / `get_latest_can_frames` | 🔲 Open | **B** | Three async commands, flag `commands.rs` at the top of the PR body, wait for human merge. |

Slices dispatch as PRs when the work completes — no Discussion gate (`COMMUNITY_FRAMEWORK.md` Rule 2). The Tier B pair (slices 5 + 6) is the gating pair; they ship together because the hardware source in `live_can_source.js` is the *consumer* of those commands and goes from "no frames" to "real frames" with no frontend change.

### What the bonus slice on `beemuu.com` adds

The desktop panel lives behind the install barrier — only people who run the Tauri app see it. The public-site mirror at `frontend/live_gauges.js` (with its own CSS at `frontend/live_gauges.css` and DOM in `frontend/index.html`) puts the same gauges on `beemuu.com`'s landing page. Visitors see live values driven by the JS-side simulator in their browser, with a clear "Demo" label so nobody mistakes it for real-car data. Parity with the desktop simulator is pinned by 5 byte-for-byte tests at `frontend/live_gauges.test.js`. CI is wired to run those tests via `.github/workflows/test.yml` (the glob now includes `frontend/**/*.test.js`).

## v0.14.1 — fix(issue #161) (Shipped 2026-07-27 via PR #169)

**Premise.** Issue [#161](https://github.com/ohgeeceee/beemuu/issues/161) —
"Clear fault memory not Working in Simulation." Two deliverables:

1. **Tauri 2 `window.confirm()` flakiness** — the click handler at
   `src/js/main.js:1125` (`btn-clear-faults`) and `src/js/main.js:1353`
   (security-access confirm) used `window.confirm(...)`, which the
   Tauri 2 webview auto-dismisses (resolves `false` without showing
   the dialog) on some builds, short-circuiting the click. Both
   gates now route through `tauri-plugin-dialog`'s `ask()` via the
   new `src/js/dialog.js` helper.
2. **Simulator regenerate-on-identify** — the sim's DTC list is
   seeded from `default_dtcs` + `default_freeze` captured at
   construction; on the next KWP `[0x1A, 0x80]` identify (called per
   ECU by `scan_modules` on "Run vehicle test"), the identify
   handler restores the seed when the current DTC list is empty.
   Models a real car re-detecting faults on a fresh ignition cycle.

| Item | Status | Tier | Notes |
|------|--------|------|-------|
| `src/js/dialog.js` helper + `dialog.test.js` (6 tests) | ✅ Done (PR #169) | A | Plugin-preferred → `window.confirm` → `true` fallback. Dual export. |
| `tauri-plugin-dialog` crate wiring | ✅ Done (PR #169) | B | Tier B by virtue of `Cargo.toml` + `lib.rs` plugin registration. Flagged in PR body. |
| Sim `default_dtcs`/`default_freeze` + identify refill | ✅ Done (PR #169) | B | Tier B by virtue of `transport/sim.rs` file path. |
| Per-ECU freeze-schema split | ✅ Done (PR #170) | A | `community/freeze/<hex>.toml` + `community::load_freeze_per_ecu()` helper; shrinks `commands.rs::load_freeze_schemas` body. |

PR #169 merged at `653c1547`. PR #170 (the freeze-schema split that
was unstaged in the worktree when #169 opened) merged after at
`ec12aa54`. Combined: 138/138 Rust, 206/206 JS, 166/166 Python.

## v0.14.2 — "Live Data on the Bench" (Shipped 2026-07-29)

**Premise.** The user is going real-car with a K+DCAN cable on a 2007
E70 X5 4.8L (N62/BTU, MSV80-family DME, D-CAN @ 500 kbps).
v0.14.0's Tier B was explicitly gated behind an OBDLink SX cable;
the K+DCAN cable cannot passively listen to raw broadcast frames
(`src-tauri/src/transport/kdcan.rs` doc-comment lines 1-15 — the
FTDI firmware terminates ISO-TP upstream). v0.14.1 was an unrelated
bug fix (issue #161).

**v0.14.2 ships "live data today, on the bench, with the cable you
have."** Three Tier A slices — no `transport/**` changes, no new
crate, no new Tauri command. `read_live_data` and `watch_*` already
work over K+DCAN today; this cycle fills the per-param data, the
panel UX, and the chassis-specific verification doc. See
[`docs/v0.14.2_plan.md`](docs/v0.14.2_plan.md) for the full plan
+ explicit "what we will NOT do" list (touch `transport/`, touch
`protocol/`, add a new crate, modify the v0.14.0 Live Gauges panel,
cut a release tag).

### Slices planned

| Item | Status | Tier | Notes |
|------|--------|------|-------|
| Cycle plan + ROADMAP v0.14.2 header | ✅ Done (PR #171) | A | `docs/v0.14.2_plan.md` + this ROADMAP entry. Docs-only. |
| `community/profiles/n62.toml` enrichment — `0x5C` (oil temp) only; `0x5E` / `0x5F` / `0x62` deferred to v0.14.3 (each needs a new decoder first) | ✅ Done (PR #175) | A | Replaces the unverified `local:10` placeholder with the standard OBD-II PID. Removes the `[UNVERIFIED placeholder]` tag and the "oil temp unverified" mark from the profile label. Adds an N62 instrumentation-context header block (valley-pan slow-coolant monitoring, oil-temp cruise band, Valvetronic load/throttle inverse, idle-voltage target). Bench verification on the E70 is the gating step (slice 3 harness doc). The three deferred PIDs ship in v0.14.3 — see PRs #185 (decoders), #186 (profile entries), and slice 4 (PR #188, harness extension). |
| Live Data panel UX polish — polling-rate selector, per-gauge peak tracking, range bar, snapshot-CSV button, NRC error surface | ✅ Done (PR #177) | A | `src/index.html` + `src/css/app.css` + `src/js/main.js` + `src/js/live_data_panel.js` (new pure-helper module + 15 tests). 221/221 JS tests green. The per-PID dim + "remove from profile" UI lands in v0.14.3 (PR #187) with the new async `remove_profile_pid` Tauri command. |
| `docs/validation/n62-real-car.md` harness doc | ✅ Done (PR #178) | A | Chassis-specific verification path. Cross-links v0.14.0 `docs/validation/can-broadcast.md` for users who eventually get an OBDLink SX on the same chassis. |

---

## v0.14.3 — "Finish the Bench" (Shipped 2026-07-30)

Completes the v0.14.2 premise: every PID the slice 3 harness doc
asks the user to verify is in the profile, with the decoders it
needs, and the per-PID NRC error surface the slice 2 UI deferred
is in place. 3 Tier A + 2 Tier B slice (slice 3 split into 3a
backend + 3b frontend, both shipped) + 1 docs-only slice. No
`transport/**` changes. See
[`docs/v0.14.3_plan.md`](docs/v0.14.3_plan.md).

### Slices shipped

| Item | Status | Tier | Notes |
|------|--------|------|-------|
| Cycle plan + ROADMAP v0.14.3 header | ✅ Done (PR #188, slice 4) | A | `docs/v0.14.3_plan.md` + this ROADMAP entry. Docs-only. |
| `u16_fiftieths` + `u32_be` + `u16_half` decoders | ✅ Done (PR #185) | A | Three new `Decode` variants in `src-tauri/src/data/live.rs`. Decoder spec sections in `docs/DECODE_FUNCTIONS.md` §10–12. |
| `community/profiles/n62.toml` enrichment — add the three deferred PIDs (`0x5E` fuel rate L/h, `0x5F` engine runtime, `0x62` fuel rate g/s) | ✅ Done (PR #186) | A | Required the slice 1 decoders. Each entry carries the `[needs verification, N62/E70 bench]` marker per the harness doc. |
| **Slice 3a** — `protocol::nrc_from_error` + `LiveSweepResult { values, errors }` + `remove_profile_pid` async Tauri command + `tokio` `fs` feature | ✅ Done (PR #187) | B | The backend half of the slice 3 surface. New async command at `src-tauri/src/commands.rs:746` (gated behind the `tauri-plugin-dialog` confirmation per `docs/CONTRIBUTING.md`'s write-path discipline). |
| **Slice 3b** — frontend rewire: `main.js::pollOnce` consumes the new `LiveSweepResult`; `classifyNrc` helper buckets each `LiveError` into unsupported / transient / unknown; per-PID dim + one-click-remove UI | ✅ Done (PR #190) | B | The consumer half of the slice 3 contract. New `classifyNrc` exported from `live_data_panel.js` (5 new tests). New `#live-unsupported-count` badge in the Live Data panel head. New `.gauge-cell.dimmed` + `.pid-remove` CSS. One-click remove gated behind `tauri-plugin-dialog` confirmation per the issue-#161 fix pattern. |
| `docs/validation/n62-real-car.md` extension + ROADMAP cycle closeout | ✅ Done (PR #188, slice 4) | A | Adds the three new PIDs to the Step 2 / Step 3 / Step 4 / Step 5 tables. Closes the docs-only slice. |

The v0.14.3 release cut itself (Cargo.toml + tauri.conf.json
version bumps, git tag, release notes publish, installer build)
is a separate Tier C step — all five cycle slices are merged but
the version-surface bump requires an explicit release-cut PR.

---