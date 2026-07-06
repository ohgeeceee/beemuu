# BeeEmUu v0.2.0 Release Notes

## What's New

### Community Data — The Big One
- **~150 DTC fault texts** (was 7). Covers misfire, fuel, VANOS, turbo, lambda, throttle, cooling, sensors, battery, transmission, DSC, body, CAN, HVAC, airbag, immobilizer — all sourced from OBDb (CC-BY-SA), BimmerFest, SpoolStreet, and public docs.
- **5 OBDb-verified UDS DIDs** for B58 and F-series N55: oil temp (4506), coolant (411E), IAT (4015), ATF temp (DA12), kickdown (DA1F).
- **7 commented DIDs** waiting for new decode functions (`u16_tenths`, `u16_div100`, `s16`, `u8_enum`, etc.) — unlock ~40% more OBDb data.
- **10 deep-research artifacts** in `research/` documenting the hunt for open-source BMW diagnostic data.

### Project Infrastructure
- **CI pipeline** (GitHub Actions): TOML validation, proprietary-data heuristic scan, `cargo fmt`, `cargo clippy`, `cargo test` on Ubuntu + Windows.
- **Dependabot** auto-PRs for npm, Rust, and GitHub Actions security updates.
- **CHANGELOG.md** with [Keep a Changelog](https://keepachangelog.com/) format.
- **CONTRIBUTING.md** complete rewrite — data vs. code paths, confidence labels, Parameter Explorer workflow, commit style, PR checklist.
- **docs/open_source_maintenance_guide.md** — release rhythm, contributor funnel, automation, legal hygiene.
- **docs/forum_post.md** — 4 ready-to-copy templates (BimmerPost, Reddit, Twitter, YouTube).
- **New issue template** `did_mapping.md` — standardized form for contributors who find new DIDs on their cars.

### Honest Status Updates
- E-series `local:10` oil temp placeholder now carries a prominent warning: **no open-source KWP2000 local ID table exists for BMW E-series**. This is a structural data desert, not a bug.
- `freeze_schemas.toml` now warns it is **simulator-only** — no real-world BMW freeze-frame layouts exist in open sources.
- N52 profile notes that oil temperature travels via **BSD protocol**, not KWP2000.

## Known Limitations
- E-series KWP2000 local identifiers remain unmapped in open sources. Use the Parameter Explorer or contribute your own findings.
- ~40% of OBDb DID data needs new decode functions (see commented blocks in `profiles/b58.toml` and `profiles/n55.toml`).
- Freeze-frame schema is simulator-only; real-car layouts need community contribution.

## How to Upgrade
- **Data-only:** Restart the app — `community/` files load at runtime with no recompile.
- **Full install:** Download the installer from the Assets below (built by CI).

## Contributors
- Data research and compilation by the BeeEmUu community and OBDb (CC-BY-SA).
- See commit history for individual DID mappers and DTC contributors.

## Links
- Full changelog: [CHANGELOG.md](https://github.com/ohgeeceee/beemuu/blob/main/CHANGELOG.md)
- Contributing guide: [CONTRIBUTING.md](https://github.com/ohgeeceee/beemuu/blob/main/CONTRIBUTING.md)
- Community data: [community/](https://github.com/ohgeeceee/beemuu/tree/main/community)
