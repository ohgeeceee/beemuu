# Changelog

All notable changes to BeeEmUu are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Schematics catalog (PR #N of the schematics MVP series): CC0 wiring
  diagram SVGs are now first-class catalog items with their own table
  (`schematics`), API endpoints (`GET /api/schematics`,
  `GET /api/schematics/<slug>`), and a seeded CC0 set of three diagrams
  (RCD 3302 retrofit for e89 Z4, CAS3 connector pinout for e90,
  N54 DME power tree for e60). Files are served by nginx from
  `/static/schematics/<slug>.svg`. The viewer UI and DTC cross-links
  ship in follow-up PRs.

### Changed
- N/A

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
