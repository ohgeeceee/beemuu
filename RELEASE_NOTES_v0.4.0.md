# BeeEmUu v0.4.0 Release Notes

> **Tuner Friendly.** v0.4.0 closes the loop on the v0.3.0 decoder
> foundation — the one decoder that genuinely didn't ship (`u8_enum`)
> is now in, the user-facing docs stop contradicting the shipped
> state, and a histogram viewer gives the first client-side "tuner"
> affordance on top of the existing logging tab.

## What's New

### 🔣 `u8_enum` decoder + enum-map pipeline
The one decoder from the v0.3.0 list that didn't ship. Maps raw bytes
to human-readable labels (gear position, engine state, knock detection,
…) via a per-parameter map loaded from TOML.

- New `Decode::U8Enum` variant + `decode_enum_string(...)` helper in
  `src-tauri/src/data/live.rs`.
- TOML profiles carry an inline `enum = { "0" = "P/N", "1" = "1", ... }`
  map per parameter; keys are quoted decimal strings (the `toml` crate
  types inline-table keys as strings). See
  [`docs/DECODE_FUNCTIONS.md`](docs/DECODE_FUNCTIONS.md) § 8.
- `LiveValue.text: Option<String>` carries the resolved label across
  the IPC boundary; the UI renders it for enum-style parameters
  (gauges and CSV export in PRs #64 and #65).
- Unknown bytes get a `"0xNN ?"` sentinel rather than silently
  dropping the sample (PR #66 — addresses CI review feedback on
  #64/#65).
- Example enum DIDs in `community/profiles/b58.toml` and
  `community/profiles/n55.toml`: `gear` (DA0A), `engine_state`
  (4004), `knock_detect` (401F). Marked `[needs verification]`
  pending real-car validation.

New module: `src-tauri/src/data/live.rs` (extension),
`src-tauri/src/community.rs` (TOML loader), `src-tauri/src/commands.rs`
(IPC integration). 9 new unit tests covering the decoder, the TOML
parser, the unknown-byte sentinel, and the legacy-compat fallback
for older community profiles without the `enum` key.

### 📊 Histogram viewer for the Logging tab
Pure client-side work over the existing `LogSession` data — no
protocol change, no new dependencies (reuses Chart.js, already
loaded for the line chart).

- New `Histogram` button next to `Export CSV` on the Logging tab.
- Modal with a channel dropdown + bin-count dropdown (10/20/30/50/100)
  + Chart.js bar chart + a stats readout (n / min / max / mean /
  median / std dev).
- Channels whose `LiveValue.text` is set (the `u8_enum` decoder from
  PR #60) are filtered out — no numeric distribution to plot.
- Close button tears down the chart to avoid memory leaks across
  opens.

New module: `src/js/histogram.js` (pure data layer, 13 unit tests).
Modal in `src/index.html` + styling in `src/css/app.css`.

### 🔧 Multi-module data shape for service functions
`ServiceFunction` now carries one or more `(target, routine)` pairs
instead of a single one. Existing six entries stay byte-identical in
shape; the new `ModuleRoutine[]` field is the prerequisite for
adding chassis-validated EGS / DSC CBS resets.

- New `ModuleRoutine` struct (target, routine, module_label) +
  `effective_module_label()` helper in
  `src-tauri/src/data/service_functions.rs`.
- `run_service_function` Tauri command takes
  `module_index: Option<usize>` (defaults to 0 for back-compat).
- UI renders one row per (service × routine) pair and sends the
  index on invocation.
- 8 new unit tests covering the new shape, default labels per
  target address, routine-ID preservation, and the multi-routine
  construction round-trip.

> **EGS / DSC routine IDs deliberately not invented.** Wrong IDs
> can brick NV memory on those modules; this release ships the
> data shape and defers the actual routine IDs to a contributor
> with real-car validation. The shape is in place; adding EGS /
> DSC entries is a one-liner per chassis once the IDs are
> validated.

### 🛠 DIY ENET cable pinout (F/G-series)
For hobbyists who'd rather solder than pay $60 for the official
BMW cable. Covers the OBD-II → RJ45 wiring (pins 3/11/12/13 ↔ 1/2/3/6),
the 100 Ω termination resistor, the Rx/Tx-crossed failure mode,
and a verification checklist (link light, `ip neigh`, BeeEmUu
discovery).

New doc: [`docs/hardware/enet-cable-pinout.md`](docs/hardware/enet-cable-pinout.md)
+ [`docs/hardware/README.md`](docs/hardware/README.md) index.

### 📚 Documentation overhaul
- `README.md` "What's coming" section rewritten so shipped features
  are labelled ✅ shipped and aspirational items are clearly
  labelled as "Ideas being explored, not on the roadmap."
- `ROADMAP.md` rewritten with explicit Ready / Needs-research /
  Deferred-to-v0.5.0+ splits per cycle.
- `docs/v0.4.0_first_pr.md` — written record of why PR #59 was the
  v0.4.0 cycle starter (the README/roadmap drift cleanup).
- `docs/DECODE_FUNCTIONS.md` § 8 — the canonical u8_enum TOML
  syntax and parse_enum_map rationale.

## Known Limitations (still)

These are structural, not bugs — see [`ROADMAP.md`](ROADMAP.md) for
the path forward.

- **EGS / DSC CBS-reset routine IDs** intentionally not added
  in this release (see above). The data shape is ready; the
  chassis-specific IDs need a bench test.
- **Real-car validation** of `u8_enum` example DIDs (`gear`,
  `engine_state`, `knock_detect`) needs an F/G-series owner with
  an ENET adapter to confirm. The byte-to-state mappings are
  best-effort from OBDb (CC-BY-SA 4.0) and carry `[needs
  verification]` markers in the profile TOMLs.
- **E-series KWP2000 local identifiers** remain unmapped in
  open sources. Use the Parameter Explorer and contribute findings
  via PR.
- **Real-car data** for the 🟡 items on the v0.4.0 roadmap
  (knock visualisation polish, AFR / lambda readout polish,
  adaptation / fuel trim readout, injector duty cycle,
  trigger-based logging, OBDLink MX+ support, ENET/DoIP
  auto-detection) — all need real-car evidence.

## How to Upgrade

### From v0.3.0

Restart the app — `community/` files load at runtime with no
recompile. The new u8_enum TOML syntax is additive; older profiles
parse unchanged.

### From v0.2.0 (full install)

Download the installer from the Assets below (built by CI on tag
push to `v0.4.0`).

### From v0.1.0 or earlier

Full install recommended. See `README.md` Quick Start for the
`npm install` + `pip install -r requirements.txt` + `npm run dev`
flow.

### VPS deployment

See `DEPLOY.md` for the full guide. The minimum diff from a fresh
Ubuntu 22.04+ VPS:

```bash
git clone https://github.com/ohgeeceee/beemuu /root/beemuu
cd /root/beemuu
sudo python3 -c 'import secrets; print("BEEMUU_ADMIN_PASSWORD=" + secrets.token_urlsafe(32))' \
  | sudo tee /etc/beemuu/beemuu.env
sudo chmod 600 /etc/beemuu/beemuu.env
sudo cp ops/beemuu-api.service /etc/systemd/system/
sudo cp ops/beemuu.com.conf /etc/nginx/sites-available/
sudo systemctl daemon-reload
sudo systemctl enable --now beemuu-api
sudo systemctl reload nginx
python -m backend.bootstrap_dtc   # seed DTCs
```

## Contributors

- **ohgeeceee** — Creator, maintainer, all v0.4.0 work in this
  release:
  - **PR #59** — README + ROADMAP + CHANGELOG drift cleanup
  - **PR #60** — `u8_enum` decoder + per-parameter enum-map pipeline
  - **PR #61** — $5 AliExpress ENET cable DIY pinout doc
  - **PR #62** — Histogram viewer for the Logging tab
  - **PR #63** — Unknown U8Enum byte sentinel ("0xNN ?") — folded into #66
  - **PR #64** — `LiveValue.text` enum labels in gauge + CSV
  - **PR #65** — `node --test` harness for `live_format` helpers
  - **PR #66** — `LiveValue.text` unknown bytes as "0xNN ?" sentinel
  - **PR #67** — `ServiceFunction` multi-module data shape
- **OBDb** ([github.com/obdb/Vehicle-Parameter](https://github.com/obdb/Vehicle-Parameter))
  — CC-BY-SA 4.0 open database providing UDS DID labels and PID
  mappings (continued from v0.2.0).

## Links

- Full changelog: [`CHANGELOG.md`](CHANGELOG.md)
- Roadmap: [`ROADMAP.md`](ROADMAP.md) — v0.4.0 marked shipped.
  v0.5.0 plan forthcoming in a follow-up PR (see
  [`ROADMAP.md`](ROADMAP.md) § "Deferred to v0.5.0+" for the seed
  list).
- Contributing guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Community data: [`community/`](community/)
- Security policy: [`SECURITY.md`](SECURITY.md)
- Deployment guide: [`DEPLOY.md`](DEPLOY.md)
- Community framework: [`COMMUNITY_FRAMEWORK.md`](COMMUNITY_FRAMEWORK.md)

*Released 2026-07-15. Five Ready items from the v0.4.0 plan shipped;
u8_enum real-car validation remains the only 🟡 blocker for full
v0.5.0 release scope.*
