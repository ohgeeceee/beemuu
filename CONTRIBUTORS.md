# Contributors

Thanks to everyone who helped make BeeEmUu better. This list is updated with each release.

## Core Project

- **ohgeeceee** — Creator, maintainer, Rust backend, vanilla JS frontend, Tauri integration, protocol implementation (KWP2000, UDS, ENET/DoIP), Parameter Explorer, SecurityAccess registry, UI design.

## Data Contributors

### DTC Fault Texts (~150 codes, v0.2.0)

Community-sourced from open databases and forum research. See individual commit messages for per-code attribution.

- **ohgeeceee** — Research compilation, cross-verification, TOML assembly
- **OBDb** ([github.com/obdb](https://github.com/obdb/Vehicle-Parameter)) — CC-BY-SA 4.0 open database providing UDS DID labels and PID mappings
- **BimmerPost** community — Forum threads on N54/N55 misfire, fuel, VANOS, turbo codes
- **BimmerFest** community — Forum threads on DSC, cooling, sensor fault codes
- **SpoolStreet** community — Turbo-specific DTCs and tuning-related codes
- **BimmerProfs** ([bimmerprofs.com](https://bimmerprofs.com)) — Public fault-code guides
- **M5Board** community — V8-specific (N62) and body/HVAC codes
- **BabyBMW** community — E-series platform-specific codes
- **usro.net** — Public BMW fault-code reference
- **AutoExplain** ([autoexplain.net](https://autoexplain.net)) — Public fault-code descriptions
- **forumbmw.net** (public PDF, 2004) — Historical fault-code documentation

### UDS DID Mappings (v0.2.0)

- **ohgeeceee** — OBDb research, DID verification, cross-reference against OBD-II PIDs, conflict resolution, TOML assembly
- **OBDb** ([github.com/obdb/Vehicle-Parameter](https://github.com/obdb/Vehicle-Parameter)) — Primary open-source database for BMW UDS DIDs and OBD-II PIDs under CC-BY-SA 4.0

### Engine Profiles

| Profile | Contributor | Verification | Notes |
|---------|------------|-------------|-------|
| B58 (F/G-series) | ohgeeceee | OBDb cross-ref + OBD-II PID comparison | UDS DIDs 4506, 411E, 4015, DA12, DA1F |
| N55 F-series | ohgeeceee | OBDb cross-ref + protocol documentation | Same UDS DIDs as B58; E-series uses KWP2000 |
| N52 (E9x/E60) | ohgeeceee | OBD-II verified | Oil temp via BSD protocol; no open-source KWP2000 local ID found |
| N54 (E8x/E9x) | ohgeeceee | OBD-II verified | Boost + rail pressure verified; oil temp placeholder |
| N62 (E6x/E53) | ohgeeceee | OBD-II verified | Oil temp placeholder; coolant pipe failure watch |

## Research & Documentation

- **ohgeeceee** — Deep-research swarm (10 artifacts): landscape scan, dimension decomposition, DTC deep dive, UDS DID verification, KWP2000 local ID exhaustiveness proof, freeze-frame/academic survey, cross-verification, insight extraction
- **Academic sources** — See `research/bmw_diag_dim09_freeze_academic.md` for cited papers (BMW Group diagnostics, CAN bus security, UDS security analysis, OBD-II standardization)

## Infrastructure & Tooling

- **ohgeeceee** — CI pipeline (GitHub Actions), Dependabot config, TOML validation, proprietary-data heuristic scan, `CONTRIBUTING.md`, `CHANGELOG.md`, issue templates, forum post templates

## How to Get Listed

1. **Data contributions** — Open a PR or issue with verified DIDs, DTCs, or freeze-frame layouts. Your GitHub handle goes in the commit message and this file.
2. **Code contributions** — PR merged to `main`. Your handle goes in the commit and `CONTRIBUTORS.md`.
3. **Bug reports** — Detailed issue with logs and reproduction steps. Listed in release notes if it leads to a fix.
4. **Real-car testing** — Report results in a GitHub issue. Listed under the tested profile.

---

*Last updated: 2026-07-06 (v0.2.0)*
