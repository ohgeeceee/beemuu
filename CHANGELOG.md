# Changelog

All notable changes to BeeEmUu are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
