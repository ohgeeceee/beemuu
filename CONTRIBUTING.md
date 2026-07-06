# Contributing to BeeEmUu

Thanks for your interest! This project lives or dies by community knowledge of
BMW diagnostic protocols, so contributions of **data** are as valuable as
contributions of code.

## Quick paths

| I want to... | Read this | Skill needed |
|-------------|-----------|-------------|
| Add fault-code text for my engine | [Data contributions](#data-contributions) | None — edit TOML |
| Map a new DID / local identifier on my car | [Data contributions](#data-contributions) + [Parameter Explorer](#reverse-engineering-with-parameter-explorer) | None — edit TOML |
| Add a whole engine profile | [Data contributions](#data-contributions) | None — edit TOML |
| Fix a bug or add a feature | [Code contributions](#code-contributions) | Rust + basic JS |
| Report a real-car bug | [Issue template](../.github/ISSUE_TEMPLATE) | None — just details |
| Build and test locally | [Development setup](#development-setup) | Rust + Node 20+ |

---

## Data contributions (no Rust required)

The most valuable contributions are **data** — DTC fault texts, UDS DIDs, KWP2000
local IDs, freeze-frame layouts, and engine profiles. You can add all of this by
editing the files in [`community/`](../community/README.md) — no compiler needed.
Restart the app and the **Diagnostics** tab shows what loaded.

### What to add where

| File | What goes here | Example |
|------|---------------|---------|
| `community/dtc_texts.toml` | Hex fault-code → human description | `"29CD" = "Misfire cylinder 1"` |
| `community/profiles/<engine>.toml` | Per-engine live-data parameters | Oil temp via `did:4506` on B58 |
| `community/freeze_schemas.toml` | Freeze-frame byte layouts per ECU | DME 9-byte layout with scale/bias |
| `community/profiles.toml` | Minimal examples for the built-in list | E70 N62 reference profile |

### Confidence labels

Every data contribution must carry a confidence label so users know what to trust:

| Label | Meaning | Example source |
|-------|---------|--------------|
| `[community]` | Verified by contributor on their car | Your own Parameter Explorer log |
| `[OBDb]` | Verified from OBDb open database | `github.com/obdb/Vehicle-Parameter` |
| `[forum]` | Cross-referenced on 2+ forum threads | BimmerPost + SpoolStreet posts |
| `[unverified]` | Placeholder or single source | Needs more testing before promotion |

### The data contribution workflow

1. **Find something on your car** — scan a module with the Parameter Explorer,
   log raw bytes + expected value (e.g., oil temp from your gauge cluster).
2. **Open a GitHub Issue** with:
   - Chassis + engine + year (e.g., "F30 N55 2014")
   - ECU address (e.g., `0x12` DME, `0x18` EGS)
   - Identifier (e.g., `did:4506`, `local:10`, `obd:05`)
   - Raw bytes returned
   - Expected real-world value and how you know it
   - Source (your own car, OBDb URL, forum thread, etc.)
3. **Wait for cross-verification** — a maintainer or trusted contributor will
   check against a second source before merging.
4. **Get credit** — your name goes in the commit message and `CONTRIBUTORS.md`.

### Hard rule: No BMW proprietary data

This is not negotiable. The following are **prohibited**:

- SGBD files or extracts
- ISTA fault-text databases or screenshots
- INPA `.prg` files or their contents
- Any data labeled "BMW internal" or "confidential"
- Exact strings copied from BMW diagnostic software

**What IS allowed:**
- Your own Parameter Explorer logs from your own car
- Forum posts where enthusiasts describe what they found
- OBDb (CC-BY-SA) and other open databases
- Public academic papers and technical standards (ISO 14229, etc.)

If you are unsure whether something is proprietary, **ask in the issue first.**

---

## Reverse-engineering with Parameter Explorer

The Parameter Explorer is the tool for finding unknown identifiers on your car.

### How to contribute a newly mapped DID

1. Open BeeEmUu → **Parameter Explorer** tab
2. Select the ECU (e.g., `0x12` DME)
3. Enter a scan range (e.g., `0x4000` to `0x4100`) or single DID
4. Watch the byte-mutation heatmap while the engine runs or you change conditions
5. Note which DID changes when RPM changes, coolant warms up, etc.
6. Open an issue with:
   - DID hex + ECU address
   - Raw bytes at idle vs. at condition
   - Your best guess at the meaning
   - How you verified it (comparing to OBD-II PID, gauge cluster, etc.)

---

## Code contributions

### What to work on

- Rust backend (`src-tauri/src/`): protocol handlers, transport layers, decode
  functions, security access algorithms
- Frontend (`src/`): gauges, charts, UI panels — deliberately **vanilla JS**, no
  frameworks or build steps beyond what Tauri provides
- Documentation (`docs/`, `README.md`): architecture, hardware guides, how-tos

### Before you open a PR

| Check | Command | Why |
|-------|---------|-----|
| Formatting | `cd src-tauri && cargo fmt` | Consistent style |
| Linting | `cd src-tauri && cargo clippy` | Catches bugs and idioms |
| Tests | `cd src-tauri && cargo test` | Doesn't break existing logic |
| Simulator test | Run app with `Transport: Simulator` | UI still works |
| Real-car test (if possible) | Say which car in PR description | Validates protocol changes |

### Commit message style

```
<area>: imperative description under 72 chars

Body: what changed and why. Reference issues: fixes #123.

Footer: co-authored-by, breaking-change notes, etc.
```

**Areas:** `app`, `backend`, `community`, `docs`, `ui`, `transport`, `release`

Examples:
```
community: add N55 F-series UDS DIDs for oil and coolant temp

Verified on F30 N55 2014 via Parameter Explorer. DIDs sourced from
OBDb (CC-BY-SA). Adds did:4506, did:411E, did:4015.

co-authored-by: Jane Doe <jane@example.com>
```

```
backend: add u16_tenths decode function

Unlocks DID 4002 (battery voltage) and 44F0 (HPFP rail pressure)
from OBDb. Raw u16 BE × 0.1 → display value.

fixes #42
```

---

## Development setup

### Prerequisites

- **Rust** stable (via [rustup](https://rustup.rs/))
- **Node.js** 20+ (via [nvm](https://github.com/nvm-sh/nvm) or installer)
- **OS:** Windows 10+ or Linux (Ubuntu 22.04+ tested)

### Linux dependencies

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf libudev-dev
```

### Build and run

```bash
git clone https://github.com/ohgeeceee/beemuu.git
cd beemuu
npm install
npm run dev        # Launches the Tauri app in dev mode
```

Choose **Transport: Simulator** to explore the UI without hardware.

### Test against a real car

1. Connect your K+DCAN or ENET adapter
2. Select the correct transport in the app
3. Run a module scan or read fault memory
4. If you change code, test the simulator first, then the real car

---

## PR checklist

Copy this into your PR description and check what applies:

```markdown
## What this adds
<!-- e.g., "Live-data profile for E70 X5 N62B48" or "Fix KWP2000 timeout on slow modules" -->

## Data contributions (community/*.toml)
- [ ] Vehicle: chassis + engine + year
- [ ] How verified: Parameter Explorer / OBDb / forum cross-ref / own log
- [ ] Loads cleanly (checked Diagnostics tab — no warnings)
- [ ] Not from ISTA or proprietary BMW software

## Code contributions
- [ ] `cargo fmt` and `cargo clippy` clean
- [ ] `cargo test` passes
- [ ] Tested against Simulator
- [ ] Tested on real car (if applicable): [chassis + engine]
- [ ] No proprietary data or trademarks added

## Breaking changes
<!-- None / describe -->
```

---

## Getting help

- **Quick question:** GitHub Discussions (search first)
- **Bug report:** GitHub Issue with the bug template
- **Feature request:** GitHub Issue with the feature template
- **Real-time chat:** [Discord/Forum link if you have one]
- **Security vulnerability:** Email `security@yourdomain.com` (or open a private security advisory on GitHub)

---

## Contributor recognition

Contributors are credited in:
- Commit messages (co-authored-by)
- `CONTRIBUTORS.md` (top-level file, updated monthly)
- Release notes for significant data or code contributions

Data contributors who map previously unknown DIDs get their name on the
parameter entry in the TOML file as a comment:

```toml
# Mapped by @username on F30 N55 2014
[[profile.param]]
id = "oil_did"
```

---

## License

By contributing, you agree that your contributions will be licensed under the
GNU General Public License v3.0. See [LICENSE](../LICENSE) for details.

Data in `community/` and `research/` derived from OBDb is under CC-BY-SA 4.0
(compatible with GPL-3.0 for adaptation). Attribution is maintained in file
headers and `community/SOURCES.md`.

---

*This is a living document. If something is unclear, open an issue and we'll fix it.*
