# BeeEmUu — Diagnostic Dashboard for BMW Vehicles

An independent, open-source diagnostic tool for BMW vehicles: vehicle test
(module scan), fault memory read/clear, live-data gauges, a parameter
explorer, and service functions. Desktop app built with Tauri (Rust backend
+ web UI). Licensed GPL-3.0-or-later.

> **Independence disclaimer.** This project is not affiliated with,
> endorsed by, or connected to BMW AG in any way. "BMW" and "ISTA" are
> trademarks of BMW AG, used here only to factually describe compatibility.
> This repository contains none of BMW's proprietary data or software —
> no SGBDs, no fault-text databases, no ISTA assets. All protocol behaviour
> is based on community documentation and original work.

> **⚠ Safety warning.** This software communicates with safety-relevant
> vehicle systems. Clearing fault memory erases diagnostic evidence;
> service functions can actuate pumps, valves, and brakes. Use at your own
> risk, with the vehicle stationary and secured, and never while driving.
> The software is provided WITHOUT ANY WARRANTY — see LICENSE sections
> 15 and 16.

## Features

Vehicle test (ISTA-style module scan), fault memory read/clear with freeze
frames, live-data gauges, data logging with CSV export and charts, a
Parameter Explorer with a byte-mutation heatmap for reverse-engineering
unknown DIDs, vehicle info with VIN decode, UDS sessions and pluggable
security access, service functions, a connection self-test, and a full
traffic log you can export for bug reports or mapping work.

## Screenshots

_Add screenshots or a short GIF here — run against the Simulator so no real
VIN is shown. Suggested shots: the Vehicle Test module tree, the Live Data
gauges, and the Parameter Explorer heatmap._

## Supported interfaces

| Transport | Cars | Status |
|---|---|---|
| **Simulator** | Virtual E90 (N52) | Works out of the box — develop/demo with no hardware |
| **K+DCAN USB cable** | E-series (D-CAN ≈2007+, K-line earlier) | Implemented; needs on-car validation |
| **ENET cable** | F/G-series (UDS over HSFZ, port 6801) | Implemented; needs on-car validation |

## Tested vehicles

Community-verified compatibility. If you run it on your car, please open a PR
adding a row (and a `community/` profile if you mapped parameters).

| Chassis | Engine | Cable | Module scan | Faults | Live data | Notes |
|---|---|---|---|---|---|---|
| _Simulator_ | virtual E90 | — | ✓ | ✓ | ✓ | Reference; always works |
| E70 X5 | N62B48 (4.8i) | K+DCAN | _pending_ | _pending_ | _pending_ | Author's car; validation in progress |

## Building

Prerequisites (Windows):

1. [Rust](https://rustup.rs) (stable, MSVC toolchain)
2. Node.js 18+
3. Microsoft Edge WebView2 (preinstalled on Win 10/11)
4. For K+DCAN: the FTDI VCP driver so the cable shows up as a COM port

```
npm install
npm run dev        # development window with hot reload
npm run build      # installer in src-tauri/target/release/bundle
```

First build only: generate the icon set (any square PNG works):

```
npx tauri icon app-icon.png
```

## Try it immediately

Run `npm run dev`, leave the transport on **Simulator**, hit **Connect**,
then **Run vehicle test**. The virtual E90 answers with eight modules, a few
stored faults, and live engine data for the gauges tab.

## Architecture

```
src/                    Frontend (vanilla JS, no build step)
  index.html            Layout: header, tabs, module tree, fault table
  css/app.css           ISTA-inspired theme
  js/gauges.js          Canvas dial gauges
  js/main.js            App logic, invokes Rust commands

src-tauri/src/
  transport/            Physical interfaces (pluggable)
    kdcan.rs            KWP2000 framing over FTDI serial (K-line + D-CAN)
    enet.rs             UDS over HSFZ TCP (F/G-series)
    sim.rs              Virtual E90 for hardware-free development
    record.rs           Traffic-recording transport decorator
  protocol/
    mod.rs              Service layer: ident, DTC read/clear, DIDs, routines
    security.rs         Pluggable UDS SecurityAccess (0x27) seed/key registry
  analysis.rs           Byte-diff mutation engine (Parameter Explorer)
  community.rs          Loads community/*.toml into runtime registries
  data/
    ecus.rs             Diagnostic address table (DME 0x12, EGS 0x18, ...)
    dtc.rs              Fault-code text (built-in + community overlay)
    live.rs             Live-data profiles (built-in + community, runtime store)
    freeze.rs           Per-ECU freeze-frame schema registry
    vin.rs              VIN decoder
    service_functions.rs  CBS resets, registrations, actuator tests
  commands.rs           Tauri command bridge

community/              Drop-in TOML data — edit without recompiling
  dtc_texts.toml        Fault-code descriptions
  profiles.toml         Live-data parameter maps per engine
  freeze_schemas.toml   Freeze-frame byte layouts per ECU
```

## Contributing data without writing code

The biggest way to help is adding data — and you don't need to touch Rust.
Edit the TOML files in [`community/`](community/README.md), restart the app,
and your fault texts, parameter profiles, or freeze-frame layouts load
automatically. The **Diagnostics** tab shows exactly what loaded and flags any
file errors. Then open a pull request. Please contribute only original or
community-derived knowledge — never data extracted from ISTA.

## Mapping your car (E70 X5 4.8i workflow)

Live data has selectable **profiles** (dropdown on the Live Data tab):

1. **Generic OBD-II** — standard mode 01 PIDs. Emissions-mandated, so the
   N62B48 DME answers these out of the box. Use this first on the real car:
   RPM, coolant, IAT, speed, load, throttle, fuel level, voltage.
2. **Simulator** — the virtual E90's DIDs, for hardware-free demos.

To go beyond OBD-II (oil temp, per-bank data, transmission temps), use the
**Parameter Explorer** tab on the real car:

1. Connect via K+DCAN (E70 = D-CAN mode), run a vehicle test.
2. Pick an ECU (start with DME), ident type *Local ident (KWP 21)*,
   scan range 00–FF. Only identifiers the module answers are listed.
3. Click a result to watch it live. Rev the engine, turn on AC, etc. —
   bytes that change are highlighted with hex + decimal + offset shown.
4. Identify the value and offset (e.g. "bytes [0..1] track RPM ×1"),
   then add it to `community/profiles.toml` — no recompile needed — or, for
   built-ins, `src-tauri/src/data/live.rs`.

The Explorer's watch view is a **mutation heatmap**: each byte shows its live
value plus a volatility bar and observed min–max, so the bytes that track a
changing signal light up as you rev the engine.

## Real-car notes (read before plugging in)

- **DIDs in `data/live.rs` currently match the simulator.** Real DMEs use
  model-specific identifiers — map them per engine (community DID lists and
  INPA `.IPO` files are the usual references) and add entries per variant.
- **Routine IDs in `data/service_functions.rs` likewise match the simulator.**
  Real CBS resets and actuator tests are model-specific and some need
  security access (service 0x27). Verify before running on a real car.
- The DTC text table (`data/dtc.rs`) is a small community starter set;
  unknown codes show a generic label. Extend it as you go.
- D-CAN uses 115200 baud 8E1 with TX echo; K-line 10400 baud. If responses
  time out on a real car, reduce the FTDI latency timer to 1 ms in Device
  Manager (Port Settings → Advanced).
- **Safety:** fault clearing erases freeze frames; "high-risk" service
  functions actuate hardware. Ignition on, engine off, car secured.

## Releases

CI (GitHub Actions) builds Windows and Linux packages on every push. To cut
a release: bump the version in `package.json`, `src-tauri/tauri.conf.json`,
and `src-tauri/Cargo.toml`, then push a tag like `v0.1.0` — the workflow
creates a draft GitHub release with installers attached. Installers are
unsigned, so Windows SmartScreen will warn on first run; code signing
(e.g. Azure Trusted Signing) can be added later.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Parameter mappings from real cars
and community fault-code texts are the most valuable contributions.
Contributions containing BMW proprietary data are rejected.

## Roadmap ideas

- Per-engine live-data profiles (N52/N54/N55/B58 DID maps)
- UDS session management + security access for F/G service functions
- Freeze-frame (environmental data) display per fault
- Data logging to CSV with chart playback
- Coding/programming — deliberately out of scope for now
#   b e e m u u  
 