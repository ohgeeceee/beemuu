# BeeEmUu v0.5.0 Release Notes

> **Ground Truth.** v0.5.0 closes the loop on the v0.3 / v0.4
> decoder + UI plumbing. The work isn't more code — it's
> validating the abstractions we shipped against real hardware,
> surfacing the small tuner-facing features that depend on
> real-car evidence, and giving F/G-series owners a path to
> retire the remaining `[needs verification]` markers.

## What's New

### 📋 Real-car u8_enum validation harness
A self-contained checklist an F/G-series owner with an ENET
adapter can fill in without further developer help. Three
identical-shape per-DID tables — `gear` (DID `DA0A`),
`engine_state` (DID `4004`), `knock_detect` (DID `401F`) —
each with expected byte → state mappings, pass/fail checkboxes,
notes column, and a chassis-variant field. A results PR removes
the `[needs verification]` markers from the profile TOMLs and
adds `[verified YYYY-MM-DD on chassis XYZ]`. A "what if a byte
doesn't match" section covers the most-likely failure mode.

New doc: [`docs/validation/u8_enum-validation.md`](docs/validation/u8_enum-validation.md)
+ cycle-spec doc [`docs/v0.5.0_first_pr.md`](docs/v0.5.0_first_pr.md).
See PR #72.

### 📊 N55 fuel-trim / adaptation readout
Two new DIDs in
[`community/profiles/n55.toml`](community/profiles/n55.toml):

- `ltft_bank1` — long-term fuel trim, bank 1 (DID `0x1201`).
  Decoder `s16_div100`, units percent, range -25 to +25.
- `idle_adaptation` — idle adaptation (DID `0x1202`).

Both marked `[needs verification, UDS only]`. The DIDs are
sourced from the project's own
[`TECH_SPECS.md`](docs/TECH_SPECS.md) (Adaptation Drift
Tracker section), not forum threads. Existing `s16_div100`
decoder covers the percent scaling; no new decoder needed.
**B58 fuel-trim deliberately deferred** (no documented source).

See PR #73.

### 🚦 Severity-class styling for enum channels
Pure JS / CSS helper `severityClass(text)` in
[`src/js/live_format.js`](src/js/live_format.js) maps enum-style
labels to `severity-critical` / `severity-warning` / `""` CSS
classes (case-insensitive exact match). The gauge canvas picks
a different `ctx.fillStyle` per severity; the gauge cell and
the Logging-tab channel row get the class so the DOM matches.
Result: `knock_detect`'s "Moderate" or "Severe" states get
visible amber / red emphasis instead of the default light grey.

14 unit tests (8 prior for `csvCell` / `clampGaugeValue` + 6 new
for `severityClass`). No new dependencies — pure DOM/CSS classes,
reuses existing canvas layer.

See PR #74.

### 🛡 Scope discipline — what does NOT ship
- **No B58 fuel-trim DIDs.** They're not documented in
  `TECH_SPECS.md` and we don't have a reliable community source.
  Adding guesses would break the cycle's `[needs verification]`
  discipline.
- **No real-time per-tick severity updates.** The class is set at
  row-build time; refreshes when the user reopens the Logging
  tab or switches profiles. Per-tick updates (every 250 ms) would
  need a separate tick-callback path; left as a future
  enhancement.
- **No Rust change.** The Rust side already produced
  `LiveValue.text` (PR #60); v0.5.0 only consumes it.

## Known Limitations (still)

These are structural, not bugs — see [`ROADMAP.md`](ROADMAP.md) for
the path forward (now under "v0.6.0 cycle candidates"):

- **EGS / DSC CBS-reset routine IDs** intentionally not added
  in v0.4.0 (data shape shipped in PR #67; chassis-specific
  IDs need bench test). Still 🟡 Deferred.
- **`[needs verification]` markers** on the example enum DIDs
  (PR #60) and on the new fuel-trim DIDs (PR #73) — all retire
  the moment an F/G-series owner files a `[verified YYYY-MM-DD
  on chassis XYZ]` PR. The validation harness (PR #72) is the
  path.
- **B58 fuel-trim / adaptation DIDs** — no documented source.
  Defer until a contributor with F/G B58 access finds the IDs.
- **Real-car evidence** for the 🟡 items on the v0.5.0 roadmap
  (knock visualisation polish — only the severity styling is
  done; AFR / lambda bank readout polish; OBDLink MX+ support;
  ENET/DoIP auto-detection; trigger-based logging) — all need
  real-car testing.

## How to Upgrade

### From v0.4.0

Restart the app — `community/` files load at runtime with no
recompile. The new u8_enum TOML syntax is additive; older profiles
parse unchanged. The new N55 fuel-trim DIDs are additive to the
N55 profile. Severity-class styling is additive to the gauge
and Logging-tab rendering.

### From v0.3.0 (full install)

Download the installer from the Assets below (built by CI on tag
push to `v0.5.0`).

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

- **ohgeeceee** — Creator, maintainer, all v0.5.0 work in this
  release:
  - **PR #70** — `docs/v0.5.0_plan.md` cycle plan ("Ground Truth")
  - **PR #71** — ROADMAP rewrite showing v0.4.0 Done + v0.5.0 active
  - **PR #72** — `docs/validation/u8_enum-validation.md` real-car
    validation harness
  - **PR #73** — N55 fuel-trim / adaptation DIDs (`0x1201` LTFT,
    `0x1202` idle adaptation)
  - **PR #74** — `severityClass(text)` helper + gauge /
    Logging-tab severity-class styling
  - **v0.5.0 release cut** — version bumps + release notes +
    ROADMAP / CHANGELOG close-out
- **OBDb** ([github.com/obdb/Vehicle-Parameter](https://github.com/obdb/Vehicle-Parameter))
  — CC-BY-SA 4.0 open database providing UDS DID labels and PID
  mappings (continued from v0.2.0 / v0.3.0).
- **`TECH_SPECS.md`** — the project's own specs doc was the
  source for the N55 fuel-trim DIDs in PR #73. Worth
  re-reading for future cycles.

## Links

- Full changelog: [`CHANGELOG.md`](CHANGELOG.md)
- Roadmap: [`ROADMAP.md`](ROADMAP.md) — v0.5.0 marked Shipped;
  v0.6.0 cycle candidates are the 🟡 items below + the Backlog.
- Cycle plan: [`docs/v0.5.0_plan.md`](docs/v0.5.0_plan.md)
- Validation harness: [`docs/validation/u8_enum-validation.md`](docs/validation/u8_enum-validation.md)
- Contributing guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Community data: [`community/`](community/)
- Security policy: [`SECURITY.md`](SECURITY.md)
- Deployment guide: [`DEPLOY.md`](DEPLOY.md)
- Community framework: [`COMMUNITY_FRAMEWORK.md`](COMMUNITY_FRAMEWORK.md)

*Released 2026-07-15. Three Ready items from the v0.5.0 plan
shipped. Real-car validation of the example enum DIDs
(`gear` / `engine_state` / `knock_detect`) and the new
fuel-trim DIDs (`ltft_bank1` / `idle_adaptation`) is the
remaining 🟡 blocker for the next cycle's release scope.*
