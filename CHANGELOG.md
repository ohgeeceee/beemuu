# Changelog

All notable changes to BeeEmUu are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Dark/light theme toggle completed: the whole app chrome now re-skins
  through CSS variables (`src/css/app.css`) instead of the previous
  per-panel dark overrides, and the choice persists across restarts via
  the new workspace file. (v0.7.0 PR #2)
- Workspace layout persistence: theme, app mode, active tab, connection
  panel choices, live/log profile selectors, traffic auto-refresh, and
  the per-profile log channel enabled map save to
  `~/beeemuu-exports/workspace.json` (debounced writes via the new
  `read_export_text` command); the pre-v0.7.0 `localStorage` settings
  migrate automatically on first boot. (v0.7.0 PR #2)
- Per-profile gauge colour schemes: an optional `[profile.theme]` TOML
  table recolours the live-data gauges (nine keys, per-key fallback to
  the cockpit palette, colours CSS-validated in the UI). Reference block
  in `community/profiles/b58.toml`; syntax documented in
  `docs/DECODE_FUNCTIONS.md` § 9. (v0.7.0 PR #2)

## [0.6.0] - 2026-07-16

### Added
- OBD-II mode 01 PID auto-discovery
  ([`src-tauri/src/protocol/mod.rs`](src-tauri/src/protocol/mod.rs))
  — new `scan_obd2_pids()` helper walks SAE J1979 PID bitmasks
  (`0x00 / 0x20 / 0x40 / 0x60`) to report which standard OBD-II
  PIDs a single ECU actually responds to. Stop-at-first-zero
  bitmask byte keeps the scan bounded; bitmask PIDs that fail
  their own probe are skipped per-block. Wrapped in a new
  Tauri command `list_supported_pids(address)` and surfaced
  on the Vehicle Test tab via a "Scan OBD-II PIDs" button
  that renders the supported set as a grid of monospace
  hex cells. Five new unit tests in `protocol/mod.rs` cover
  the bitmask decoder (MSB-first), the multi-block walk, the
  empty bitmask case, and the "bitmask says yes but data read
  fails" drop-on-mismatch case. See PR #81.
- Real-car injector-time validation harness
  ([`docs/validation/injector-validation.md`](docs/validation/injector-validation.md))
  — checklist for an F/G-series owner to validate the
  `inj_time` channel (DID `0x4363`, target `0x12`) on B58 /
  N55 by comparing against ISTA at three steady-state points
  (idle / cruise / WOT). Mirrors the v0.5.0 PR #72 u8_enum
  harness shape. Doc-only.
- The `inj_time` labels in
  [`community/profiles/b58.toml`](community/profiles/b58.toml)
  and [`community/profiles/n55.toml`](community/profiles/n55.toml)
  now carry the `[needs verification, UDS only]` marker,
  matching the v0.5.0 PR #73 discipline for the example
  enum / fuel-trim DIDs. The DID, decode, and range are
  unchanged — only the label is updated.
- Unknown U8Enum bytes now render as `0xNN ?` in the gauge instead of
  silently disappearing. `live::decode_enum_string_or_unknown` is the
  wider-stance sibling of `decode_enum_string` — `commands::read_live_data`
  uses it so every sample produces a `LiveValue`. Five new unit tests.
  See PR #66.
- `npm run test:js` runs the new `node --test` harness covering
  `src/js/live_format.js` (the pure helpers shared between
  `Gauge.set` and `buildLogCsv`). Eight tests lock down CSV cell
  formatting (enum labels as quoted JSON strings, numeric `toFixed(2)`,
  missing-point handling) and gauge numeric-clamp semantics. Add
  a new helper in `live_format.js`? Add a test alongside it.
  See PR #65.
- Frontend wiring for `LiveValue.text` enum labels (backend in PR #60).
  `Gauge.set(value, label?)` enters text mode when a label is present:
  dial, ticks, and needle are hidden and the label is drawn centred with
  the unit underneath. `pollOnce` and `logTick` pass `v.text` through,
  and `buildLogCsv` emits the label in a quoted CSV cell so a gear-change
  log exports `0.00,"P/N",0.00,"1",...` rather than `0.00,0,0.00,1,...`.
  Numeric gauges and the chart are unchanged for non-enum params.
- Schematics deploy: `ops/beemuu.com.conf` now serves `/static/schematics/`
  from disk (CC0 wiring-diagram SVGs), and `docs/deploy-schematics.md`
  carries the end-to-end rollout runbook. See PR #51.
- v0.4.0 roadmap scope published in `ROADMAP.md` ("Tuner Friendly"
  cycle) with explicit Ready / Needs-research / Deferred split.
- `docs/v0.4.0_first_pr.md` — spec for the v0.4.0 first PR (README
  drift cleanup).
- `u8_enum` decoder + per-parameter enum-map pipeline
  (`src-tauri/src/data/live.rs`, `src-tauri/src/community.rs`,
  `src-tauri/src/commands.rs`). Resolves raw bytes against a
  `HashMap<u8, String>` loaded from TOML and emits the label as
  `LiveValue.text`. Six new unit tests + three TOML-loader tests.
- Example enum DIDs in `community/profiles/b58.toml` and
  `community/profiles/n55.toml`: `gear` (DA0A), `engine_state`
  (4004), `knock_detect` (401F). Marked `[needs verification]`
  pending real-car validation.
- `docs/hardware/enet-cable-pinout.md` — DIY OBD-II → RJ45 wiring
  for the $5 AliExpress BMW ENET cable (F/G-series). Covers the
  pinout (3, 11, 12, 13 ↔ 1, 2, 3, 6), the 100 Ω termination
  resistor, verification steps, and the Rx/Tx-crossed failure mode
  that bites the unwary.
- `docs/hardware/README.md` — index page for the new hardware-docs
  directory.
- Histogram viewer for the Logging tab (`src/js/histogram.js` +
  13 unit tests + modal UI). Operates over the existing
  `LogSession` data; reuses Chart.js bar mode (no new deps).
  Channels whose `LiveValue.text` is set (u8_enum from PR #60)
  are filtered out — no numeric distribution to plot.
- `ServiceFunction` extended to carry `routines: &[ModuleRoutine]`
  instead of a single `(target, routine)` pair
  (`src-tauri/src/data/service_functions.rs`, 8 new unit tests).
  The existing six entries stay byte-identical in shape; the new
  `ModuleRoutine[]` field is the path forward for adding
  chassis-validated EGS / DSC CBS resets without inventing
  routine IDs. The Rust `run_service_function` command takes a
  `module_index: Option<usize>` (defaults to 0 for back-compat);
  the UI now renders one row per (service × module) and sends
  the index on invocation.

### Changed
- README § "What's coming" rewritten so shipped features (Diagnostic
  Story, Community Oracle, DTC Opinions, VPS backend) are labelled
  ✅ shipped and removed from the "coming" list; aspirational items
  (Adaptive Drift Tracker, Tuning Fingerprint Detector) are moved to
  a clearly-labelled "ideas being explored, not on the roadmap"
  subsection. No code change.
- `docs/DECODE_FUNCTIONS.md` § 8 updated with the actual user-facing
  TOML syntax (`enum = { "0" = "P/N", ... }`, quoted decimal byte
  keys) and the `parse_enum_map` rationale.

### Fixed
- N/A

### Security
- N/A

## [0.5.0] — 2026-07-15

The "Ground Truth" release. v0.5.0 closes the loop on the v0.3/v0.4
decoder + UI plumbing by validating the abstractions against real
hardware, surfacing the small tuner-facing features that depend
on real-car evidence, and providing the harness for F/G-series
owners to fill in the remaining `[needs verification]` markers.

### Added

- **Real-car u8_enum validation harness**
  ([`docs/validation/u8_enum-validation.md`](docs/validation/u8_enum-validation.md))
  — checklist for an F/G-series owner with an ENET adapter to
  validate the example enum DIDs (`gear` / `engine_state` /
  `knock_detect`) shipped in v0.4 (PR #60). Three identical-shape
  per-DID tables with pass/fail checkboxes, expected-state
  mappings, and results-submission instructions. Doc-only.
  See PR #72.
- **N55 fuel-trim / adaptation DIDs** in
  [`community/profiles/n55.toml`](community/profiles/n55.toml) —
  long-term fuel trim (`DID 0x1201`) and idle adaptation
  (`DID 0x1202`) on N55 F/G-series DME. Both marked
  `[needs verification]` until an F/G-series owner validates
  them via the same harness pattern as the u8_enum DIDs. The
  DIDs are sourced from the project's own
  [`TECH_SPECS.md`](TECH_SPECS.md) (Adaptation Drift
  Tracker section), not forum threads. Existing `s16_div100`
  decoder covers the percent scaling; no new decoder needed.
  B58 fuel-trim deliberately deferred (no documented source).
  See PR #73.
- **Severity-class styling for enum channels** — pure JS / CSS
  helper `severityClass(text)` in
  [`src/js/live_format.js`](src/js/live_format.js) maps enum-style
  labels to `severity-critical` / `severity-warning` / `""` CSS
  classes. Case-insensitive exact match. The gauge grid and
  the Logging-tab channel list both apply the class so
  `knock_detect`'s "Moderate" or "Severe" states get visible
  amber / red emphasis. 14 unit tests (8 prior + 6 new).
  See PR #74.
- **`v0.5.0_first_pr.md`** — spec doc for the v0.5.0 cycle's
  first PR (the validation harness). Mirrors
  `v0.4.0_first_pr.md`'s shape.

## [0.4.0] — 2026-07-15

The "Tuner Friendly" release. v0.4.0 closes the loop on the v0.3.0
decoder foundation — the one decoder that genuinely didn't ship
(`u8_enum`) is now in, the user-facing docs stop contradicting the
shipped state, and a histogram viewer gives the first client-side
"tuner" affordance on top of the existing Logging tab.

### Added

- **`u8_enum` decoder + per-parameter enum-map pipeline**
  ([`src-tauri/src/data/live.rs`](src-tauri/src/data/live.rs),
  [`src-tauri/src/community.rs`](src-tauri/src/community.rs)) — new
  `Decode::U8Enum` variant + `decode_enum_string(...)` helper maps
  raw bytes to human-readable labels via an inline
  `enum = { "0" = "P/N", ... }` TOML map per parameter (quoted
  decimal byte keys). `LiveValue.text` carries the resolved label
  across the IPC boundary; gauges and CSV export render it
  (PRs #60, #64, #65). Unknown bytes get a `"0xNN ?"` sentinel
  rather than silently dropping the sample (PR #66).
- **Example enum DIDs** in
  [`community/profiles/b58.toml`](community/profiles/b58.toml) and
  [`community/profiles/n55.toml`](community/profiles/n55.toml):
  `gear` (DA0A), `engine_state` (4004), `knock_detect` (401F).
  Marked `[needs verification]` pending real-car validation.
- **Histogram viewer for the Logging tab** (PR #62) — pure
  client-side over the existing `LogSession` data; modal with
  channel + bin-count dropdowns, Chart.js bar mode (no new deps),
  and a stats readout (n / min / max / mean / median / std dev).
  Enum channels are filtered out. 13 unit tests in
  [`src/js/histogram.js`](src/js/histogram.js).
- **`ServiceFunction` multi-module data shape** (PR #67) —
  `ServiceFunction` now carries `routines: &[ModuleRoutine]`
  instead of a single `(target, routine)` pair. The existing six
  entries stay byte-identical in shape; `run_service_function`
  takes `module_index: Option<usize>` (defaults to 0). EGS / DSC
  routine IDs deliberately not invented — wrong IDs can brick NV
  memory; the shape defers to real-car validation. 8 new unit
  tests.
- **DIY ENET cable pinout doc** (PR #61) —
  [`docs/hardware/enet-cable-pinout.md`](docs/hardware/enet-cable-pinout.md)
  covers OBD-II → RJ45 wiring (pins 3/11/12/13 ↔ 1/2/3/6), the
  100 Ω termination resistor, and the Rx/Tx-crossed failure mode
  for the $5 AliExpress F/G-series cable. Plus
  [`docs/hardware/README.md`](docs/hardware/README.md) index.
- **`docs/v0.4.0_first_pr.md`** — written record of why PR #59
  was the v0.4.0 cycle starter (the README / roadmap drift
  cleanup).

### Changed

- README "What's coming" rewritten so shipped features are
  labelled ✅ shipped and aspirational items are clearly labelled
  "ideas being explored, not on the roadmap" (PR #59).
- [`ROADMAP.md`](ROADMAP.md) rewritten with explicit Ready /
  Needs-research / Deferred-to-v0.5.0+ splits per cycle (PR #59).
- [`docs/DECODE_FUNCTIONS.md`](docs/DECODE_FUNCTIONS.md) § 8
  documents the canonical `u8_enum` TOML syntax and the
  `parse_enum_map` rationale.

### Fixed
- N/A

### Security
- N/A

## [0.3.0] — 2026-07-11

The "Community Intelligence" release. v0.3.0 turns the v0.2.0 data layer into
something you can play with: a gamified Hunt game on top of the Parameter
Explorer, an Oracle that surfaces patterns across anonymized community data,
opinionated DTC explainers, and a Story generator that turns a session into a
mechanic's narrative. It also ships the full VPS-hosted backend (admin panel,
DTC bootstrap, hosted dashboard panel) so anyone can stand up their own
read-only deployment.

### Added

**Community Intelligence features**
- **Parameter Hunt** (gamified reverse engineering) — new Hunt tab turns the
  Parameter Explorer into a game. +10 per new responding identifier
  discovered, +50 per unknown byte mapped to a physical value, +100 per
  confirmed freeze-frame schema saved, +500 per contribution merged into a
  release (via the leaderboard file). 11 badges, monthly challenges, a
  global leaderboard, a recent-activity feed, and award toasts. Simulator
  runs log as practice and score 0 points. Offline-first: ledger persists to
  `<home>/beeemuu-exports/hunt_state.json`; leaderboard and challenges ship
  as static community files updated via PR (same pattern as Oracle/Story).
  New files: `src-tauri/src/hunt.rs`, `src/js/hunt.js`, `src/css/hunt.css`,
  `community/hunt/leaderboard.json`, `community/hunt/challenges.json`.
- **Community Oracle** — opt-in pattern matching across anonymized community
  data. "42 other N55 owners saw this exact DTC set — 80% fixed it by
  replacing the HPFP." New module: `src-tauri/src/oracle.rs`,
  `community/oracle/generic.json`, `community/oracle/n55.json`.
- **DTC Opinions** — opinionated explainers attached to specific fault codes
  (when to fix immediately vs. monitor vs. ignore). New module:
  `src-tauri/src/opinions.rs`, `community/opinions/{29E0,2A82,P0171}.toml`.
- **Diagnostic Story** — turns a session snapshot into a mechanic's narrative
  report. New module: `src-tauri/src/story.rs`,
  `community/stories/{generic,n55}.toml`.

**VPS-hosted backend (`backend/`, stdlib-only Python)**
- **Read-only hosted API** — `/api/health`, `/api/landing-content`,
  `/api/stats` for hosted dashboard panels and external landing pages.
- **Admin panel (Phase 1)** — sqlite-backed auth (`backend/db.py`,
  `backend/auth.py`) using `hashlib.scrypt` from the Python standard
  library (zero new pip dependencies, OWASP 2024 parameters with
  `maxmem=128MB` to bypass OpenSSL's 32MB default). Cookie sessions.
- **DTC bootstrap (Phase 2)** — idempotent CLI and ops wrapper
  (`backend/bootstrap.py`, `backend/bootstrap_dtc.py`, `backend/seed.py`,
  `backend/seed_dtcs.py`, `backend/seed_bmw.py`) that seeds generic
  OBD-II SAE J2012 codes + BMW-specific codes from the `community/` TOMLs
  into the backend database. Source registry tracks which DTC came from
  which community file.
- **44-test backend suite** — integration tests for app, auth, bootstrap,
  db, and all three seeders (Python 3.11+, runs on Windows + Linux).
- **Static web fallback server** on `localhost:8765` for local-only preview.
- **Frontend hosted-dashboard panel** (`frontend/`) — admin-facing UI
  served by the backend on the VPS.

**VPS deployment (`ops/`)**
- `ops/beemuu-api.service` — systemd unit (module mode, env-file admin
  password).
- `ops/beemuu.montanablotter.com.conf` — nginx config that serves the
  frontend on `/` and proxies `/api/*` to `beemuu-api`.
- `ops/bootstrap.sh` — first-boot installer.
- `DEPLOY.md` — full deployment guide including the env-file password
  pattern (no secrets in unit files).

**Protocol & data layer**
- **`bmw_diag/` Python core** — extracted as a standalone library so it
  can be used from any Python 3.11+ project without Tauri. New files:
  `bmw_diag/core/constants.py`, `bmw_diag/core/dtc/parser.py`,
  `bmw_diag/core/interfaces/ftdi.py`, `bmw_diag/core/protocols/kwp2000.py`,
  `bmw_diag/core/protocols/uds.py`, `bmw_diag/utils/logger.py`.
- **Per-ECU security unlock state** — `src-tauri/src/protocol/security.rs`
  rewritten to track unlock state per ECU, with NRC-aware UI and retry
  countdown.
- **Chart playback refinements** — session replay now shows fault display
  alongside the scrubber.
- **Freeze-frame schema builder** with TOML persistence
  (`src-tauri/src/data/freeze.rs`, `community/freeze_schemas.toml`).
- **Anonymization helper** (`src-tauri/src/anonymize.rs`) for sharing
  log snippets and DTC sets without leaking VIN.

**Documentation & project infrastructure**
- `README.md` rewrite — leads with what BeeEmUu actually does (independent
  BMW diagnostics), corrects the license badge (GPL-3.0-or-later), and
  links to CONTRIBUTING/COMMUNITY_FRAMEWORK/ROADMAP/CHANGELOG/SECURITY.
- `CONTRIBUTING.md` complete rewrite — data vs. code paths, confidence
  labels, Parameter Explorer workflow, commit style, PR checklist.
- `CONTRIBUTORS.md` updated for v0.2.0 credits.
- `SECURITY.md` policy — how to disclose, what's in scope, threat model.
- `CODE_OF_CONDUCT.md` — Contributor Covenant-style community standards.
- `COMMUNITY_FRAMEWORK.md` — governance commitments (response times, public
  roadmap, no-feature-without-Discussion).
- `TECH_SPECS.md` — byte-level protocol reference.
- `UNIQUE_FEATURES.md` — positioning vs. other BMW diagnostic tools.
- `ROADMAP.md` — v0.3.0 ("Real Car") and v0.4.0 ("Tuner Friendly")
  plans, item-by-item status.
- `docs/DECODE_FUNCTIONS.md` — spec for the v0.3.0 decode-function work.
- `docs/ROADMAP_ISSUES.md` — pre-written roadmap issues for tracking.
- `docs/feature-hosted-dashboard-panel.md` — feature spec.
- `docs/AGENTS_SETUP.md` — guide for setting up Claude Code / Codex /
  OpenCode agents on the repo.

**CI / agents**
- `.github/workflows/build.yml` — split into CI (lint/test) + release
  (tag-triggered) jobs.
- `.github/workflows/release.yml` — Windows release workflow.
- `.github/workflows/codeql.yml` — CodeQL security analysis.
- `.github/workflows/claude*.yml` + `claude-auto-merge.yml` — Claude Code
  GitHub Actions integration (opt-in, doc-only auto-merge per CLAUDE.md
  rule #2).
- `.github/FUNDING.yml` — community funding links.
- `.github/ISSUE_TEMPLATE/did_mapping.md` — standardized form for DID
  contributors.

### Changed
- `package.json` + `src-tauri/Cargo.toml` version bumped to `0.3.0`.
- README version badge updated, link to `RELEASE_NOTES_v0.3.0.md`.
- Engine profile warnings sharpened (`profiles/n52.toml`, `n54.toml`,
  `n55.toml`, `n62.toml`, `b58.toml`): the E-series `local:10` oil-temp
  placeholder is now annotated as part of a structural data desert, with
  a clear pointer to the Parameter Explorer and the BSD-protocol
  alternative on N52.
- `community/dtc_texts.toml` reformatted with consistent source labels and
  confidence tiers.
- `freeze_schemas.toml` annotated as simulator-only.
- `community/profiles.toml` removed redundant entries inlined into
  per-engine files.

### Deprecated
- E-series `local:10` oil-temp placeholder across `profiles/{n52,n54,n55,n62}.toml`.
  No open-source verification exists for any BMW E-series DME KWP2000 local
  identifier table. Use the Parameter Explorer or contribute your own findings.

### Removed
- N/A

### Fixed
- **KWP2000 slow-module timeout** — CIC and other slow modules no longer
  time out on sequential block reads (latency-timer detection in
  `transport/kdcan.rs` per the hardware-not-software rule).
- **ENET/DoIP adapter detection on Windows 11** — broadcast discovery now
  enumerates all active interfaces.
- **README conflict markers** from a prior merge resolved.
- **CI TOML lint truncated** (PR #17) — repair + bump actions + profile
  style fix.
- **`beemuu-api` service post-merge regression** (PR #20) — service now
  runs in module mode with env-file admin password.
- **Hosted dashboard panel** (PRs #23, #26) — frontend now talks to
  production endpoints `/api/stats` + `/api/landing-content` instead of
  the broken `/api/dashboard`.

### Security
- `SECURITY.md` published — coordinated disclosure policy, threat model,
  what's in scope.
- `hashlib.scrypt` for admin password hashing (no bcrypt dependency,
  OWASP 2024 parameters with `maxmem=128MB` to bypass OpenSSL's 32MB
  default).
- Admin password stored only in `EnvironmentFile` referenced by the
  systemd unit, never inlined.

---

## [0.2.0] — 2026-07-06

### Added
- Community DTC fault texts expanded from 7 to ~150 codes (misfire, fuel, VANOS, turbo, lambda, throttle, cooling, sensors, battery, transmission, DSC, body, CAN, HVAC, airbag, immobilizer)
- UDS DID parameters for B58 (F/G-series): oil temp (4506), coolant (411E), IAT (4015), ATF temp (DA12), kickdown (DA1F) — all OBDb-verified
- UDS DID parameters for F-series N55: same 5 verified DIDs + 7 commented DIDs needing new decode functions (`u16_tenths`, `u16_div100`, `s16`, `u8_enum`, etc.)
- Research artifacts: 10 deep-research documents covering DTCs, UDS DIDs, KWP2000 local IDs, freeze frames, cross-verification, and insights
- `docs/open_source_maintenance_guide.md` — playbook for project health
- `docs/forum_post.md` — 4 platform-specific forum post templates
- CI workflow: TOML validation, proprietary data heuristic scan, `cargo fmt`, `cargo clippy`, `cargo test` on Ubuntu + Windows
- Dependabot config for npm, cargo, and GitHub Actions security updates

### Changed
- `CONTRIBUTING.md` complete rewrite with data/code paths, confidence labels, Parameter Explorer workflow, commit style, PR checklist
- `profiles/n52.toml`, `n54.toml`, `n62.toml`: prominent warnings that `local:10` oil temp is unverified and no open-source KWP2000 local ID table exists for E-series
- `profiles/n55.toml`: clarified E-series (KWP2000) vs F-series (UDS) protocol split
- `freeze_schemas.toml`: added warning that schema is simulator-only; no real-world BMW freeze-frame layouts found in open sources
- `.github/workflows/build.yml`: split into CI (lint/test) + release (tag-triggered) jobs

### Deprecated
- `local:10` oil temp placeholder on all E-series profiles (N52, N54, N55, N62) — no open-source verification exists; confirm with Parameter Explorer or use OBD-II PID 0x5C where available

### Fixed
- N/A

### Security
- N/A

---

## Template for next release

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Added
- New features

### Changed
- Behavior changes that are not bug fixes

### Deprecated
- Features marked for removal in a future version

### Removed
- Features removed in this version

### Fixed
- Bug fixes

### Security
- Security vulnerability fixes
```

---

## Release History

<!-- Copy the template above and fill it for each release. -->
<!-- Example: -->

<!--
## [0.2.0] — 2025-01-15

### Added
- Parameter Explorer: byte-mutation heatmap for reverse-engineering unknown DIDs
- SecurityAccess (0x27) seed/key registry with pluggable algorithms
- EGS (0x18) support: read fault memory, live data, and CBS counters
- CSV export with chart playback
- Vehicle info panel: VIN decode, mileage, exportable report

### Changed
- Transport layer refactored for KWP2000, UDS, and ENET/DoIP
- UI theme updated for dark mode consistency

### Fixed
- KWP2000 timeout on slow modules (e.g., CIC)
- ENET adapter detection on Windows 11

## [0.1.0] — 2024-11-01

### Added
- Initial release: module scan, fault memory, live gauges (OBD-II), simulator
- N52, N54, N55, N62, B58 engine profiles
- K+DCAN USB cable support
-->
