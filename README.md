<div align="center">

# BeeEmUu

**An independent, open-source diagnostic platform for BMW vehicles.**

Vehicle scans, fault memory, live gauges, and a reverse-engineering toolkit —
in a desktop app that runs against a built-in simulator or real hardware.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey)
![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%20v2-24C8DB)
![Backend](https://img.shields.io/badge/backend-Rust-CE422B)
![Status](https://img.shields.io/badge/status-research%20preview-orange)

</div>

---

> [!IMPORTANT]
> **Not affiliated with BMW.** "BMW" and "ISTA" are trademarks of BMW AG, used
> here only to describe compatibility. This repository ships **none** of BMW's
> proprietary data or software — no SGBDs, no fault-text databases, no ISTA
> assets. All protocol behaviour is based on community documentation and
> original work.

> [!WARNING]
> **This tool talks to safety-relevant vehicle systems.** Clearing faults
> erases diagnostic evidence; service functions can actuate pumps, valves, and
> brakes. Use with the vehicle **stationary and secured, never while driving**,
> and entirely at your own risk. Provided WITHOUT ANY WARRANTY — see
> [LICENSE](LICENSE) §§15–16.

## Contents

- [What it does](#what-it-does)
- [Screenshots](#screenshots)
- [Quick start (no hardware)](#quick-start-no-hardware)
- [Supported hardware](#supported-hardware)
- [Tested vehicles](#tested-vehicles)
- [Build from source](#build-from-source)
- [Contributing](#contributing)
- [Mapping your car](#mapping-your-car)
- [Architecture](#architecture)
- [Real-car notes](#real-car-notes)
- [Releases](#releases)
- [License](#license)

## What it does

| Area | Capabilities |
|---|---|
| **Vehicle test** | ISTA-style module scan; per-ECU identification and fault-count badges |
| **Fault memory** | Read / clear DTCs with decoded status bits, community fault text, and per-fault **freeze frames** |
| **Live data** | Real-time dial gauges; selectable per-engine profiles (generic OBD-II works on any 2007+ car) |
| **Logging** | Record parameters to time-series charts; export CSV |
| **Parameter Explorer** | Scan a module's identifiers and watch one live as a **byte-mutation heatmap** — the tool for reverse-engineering unknown DIDs |
| **Vehicle info** | VIN read + decode (manufacturer, year, plant); mileage; exportable report |
| **Security** | UDS sessions and a pluggable **SecurityAccess (0x27)** seed/key registry |
| **Service functions** | CBS resets, registrations, actuator tests — with risk warnings |
| **Diagnostics** | Connection self-test, full **traffic log** (exportable), community-data status |

Everything works end-to-end against the built-in **simulator**, so you can try
the whole app with no car and no cable.

## Screenshots

> _Placeholder — add screenshots or a short GIF here. Run against the Simulator
> so no real VIN is shown. Good shots: the Vehicle Test module tree, the Live
> Data gauges, and the Parameter Explorer heatmap._

## Quick start (no hardware)

```bash
npm install
npm run dev
```

In the app: leave the transport on **Simulator** → **Connect** → **Run vehicle
test**. The virtual E90 answers with eight modules, a few stored faults, and
live engine data for the gauges.

> First build compiles the Rust backend (a few minutes). Prerequisites are in
> [Build from source](#build-from-source).

## Supported hardware

| Transport | Cars | Protocol | Status |
|---|---|---|---|
| **Simulator** | Virtual E90 (N52) | — | ✅ Works out of the box |
| **K+DCAN USB cable** | E-series | D-CAN 115200 8N1 (2007+) · K-line 10400 8N1 + fast-init (earlier) | 🔧 Implemented; on-car validation in progress |
| **ENET cable** | F/G-series | UDS over HSFZ (TCP :6801) | 🔧 Implemented; needs on-car validation |

Transports sit behind one pluggable `Transport` trait, so adding another
interface means implementing a single trait.

## Tested vehicles

Community-verified compatibility. Ran it on your car? Please
[add a row](.github/ISSUE_TEMPLATE/profile_submission.md) — even if you only
confirmed the module scan.

| Chassis | Engine | Cable | Scan | Faults | Live data | Notes |
|---|---|---|:--:|:--:|:--:|---|
| _Simulator_ | virtual E90 | — | ✅ | ✅ | ✅ | Reference; always works |
| E70 X5 | N62B48 (4.8i) | K+DCAN | 🔄 | 🔄 | 🔄 | Author's car; validation in progress |

## Build from source

**Prerequisites**

- [Rust](https://rustup.rs) (stable, MSVC toolchain on Windows)
- Node.js 18+
- WebView2 (preinstalled on Windows 10/11)
- For K+DCAN: the FTDI VCP driver, so the cable appears as a COM port

**Commands**

```bash
npm install
npm run dev      # dev window with hot reload
npm run build    # installer in src-tauri/target/release/bundle
```

First build only — generate the icon set from any square PNG:

```bash
npx tauri icon app-icon.png
```

## Contributing

The most valuable contributions are **data** — and you don't need to write code.

**Add data via TOML (no Rust).** Edit the files in
[`community/`](community/README.md) — fault texts, live-data profiles, or
freeze-frame layouts — restart, and they load automatically. The **Diagnostics**
tab shows exactly what loaded and flags file errors.

**Share a profile you mapped.** Export it in-app (Diagnostics → Share profiles),
then send the file or open a PR. Full workflow:
[docs/sharing-profiles.md](docs/sharing-profiles.md).

**Report a tested vehicle**, submit fault texts, or contribute code — see
[CONTRIBUTING.md](CONTRIBUTING.md).

> One hard rule: contribute only original or community-derived knowledge.
> **Never** data extracted from ISTA or other proprietary BMW software.

## Mapping your car

Live data uses selectable **profiles**. Start with **Generic OBD-II** (mode 01
PIDs) — emissions-mandated, so any 2007+ DME answers it out of the box.

To map model-specific values (oil temp, per-bank sensors, transmission temps),
use the **Parameter Explorer**:

1. Connect and run a vehicle test.
2. Pick an ECU (start with the DME), choose an ident type (*Local ident*, *DID*,
   or *OBD PID*), and scan a range. Only identifiers the module answers appear.
3. Click a result to **watch it live**. Rev the engine, switch on the AC — the
   byte-mutation heatmap highlights which bytes carry the changing signal, with
   volatility, mean delta, and observed min–max.
4. Add the confirmed mapping to `community/profiles.toml` (no recompile) or a
   per-car file under `community/profiles/`.

## Architecture

Tauri v2 — a synchronous Rust backend compiled to a native binary, with a
dependency-free vanilla-JS frontend in the OS webview.

<details>
<summary><strong>Project layout</strong></summary>

```
src/                      Frontend (vanilla JS, no build step)
  index.html              Layout: header, tabs, panels
  css/app.css             ISTA-inspired theme
  js/gauges.js            Canvas dial gauges
  js/main.js              App logic, invokes Rust commands

src-tauri/src/
  transport/              Physical interfaces (pluggable Transport trait)
    kdcan.rs              KWP2000 over FTDI serial (K-line fast-init + D-CAN)
    enet.rs               UDS over HSFZ TCP (F/G-series)
    sim.rs                Virtual E90 for hardware-free development
    record.rs             Traffic-recording transport decorator
  protocol/
    mod.rs                Service layer: ident, DTC read/clear, DIDs, routines
    security.rs           Pluggable UDS SecurityAccess (0x27) seed/key registry
  analysis.rs             Byte-diff mutation engine (Parameter Explorer)
  community.rs            Loads community/*.toml into runtime registries
  data/
    ecus.rs               Diagnostic address table (DME 0x12, EGS 0x18, …)
    dtc.rs                Fault-code text (built-in + community overlay)
    live.rs               Live-data profiles (runtime store)
    freeze.rs             Per-ECU freeze-frame schema registry
    vin.rs                VIN decoder
    service_functions.rs  CBS resets, registrations, actuator tests
  commands.rs             Tauri command bridge

community/                Drop-in TOML data — edit without recompiling
  dtc_texts.toml          Fault-code descriptions
  profiles.toml           Live-data parameter maps
  profiles/*.toml         One file per car (no PR merge conflicts)
  freeze_schemas.toml     Freeze-frame byte layouts per ECU
```

</details>

<details>
<summary><strong>Design notes</strong></summary>

- **Pluggable registries** for the parts that vary per car — SecurityAccess
  algorithms (`protocol/security.rs`), freeze-frame schemas (`data/freeze.rs`),
  and live-data profiles (`data/live.rs`) — so contributions drop in without
  touching core logic.
- **Runtime data loading** merges `community/*.toml` into those registries at
  startup, keeping the app extensible by non-coders.
- **Transport decorator** (`record.rs`) records every request/response for the
  traffic log without the protocol layer knowing about it.

</details>

## Real-car notes

Read before plugging into a vehicle.

- **Some DIDs and routine IDs are placeholders** matching the simulator. Real
  DMEs use model-specific identifiers (community DID lists and INPA `.IPO` files
  are the usual references); real CBS resets/actuator tests are model-specific
  and some need security access. **Verify on your car before trusting them.**
- **Fault texts** are a small community starter set; unknown codes show a
  generic label. Extend via `community/dtc_texts.toml`.
- **Cable timing:** D-CAN is 115200 8N1; K-line is 10400 8N1 with ISO 14230
  fast-init. If a real car times out, drop the FTDI latency timer to 1 ms
  (Device Manager → Port Settings → Advanced).
- **Safety:** clearing faults erases freeze frames; high-risk service functions
  actuate hardware. Ignition on, engine off, car secured.

## Releases

GitHub Actions builds Windows and Linux packages on every push. To cut a
release, bump the version in `package.json`, `src-tauri/tauri.conf.json`, and
`src-tauri/Cargo.toml`, then push a `v*` tag — the workflow drafts a GitHub
release with installers attached. Installers are unsigned, so Windows
SmartScreen warns on first run; code signing can be added later.

## Roadmap

- [ ] Per-engine live-data profiles (N52 / N54 / N55 / N62 / B58)
- [ ] UDS security access for F/G-series service functions
- [ ] Freeze-frame schemas confirmed on real cars
- [ ] Chart playback for logged sessions
- [ ] Community profile pack shipped with releases

Coding/flashing is deliberately **out of scope**.

## License

[GPL-3.0-or-later](LICENSE). You may use, study, modify, and redistribute this
software under those terms; derivative works must remain open source.

<div align="center">
<sub>Independent project · not affiliated with or endorsed by BMW AG.</sub>
</div>
