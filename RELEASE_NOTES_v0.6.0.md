# BeeEmUu v0.6.0 Release Notes

> **Real Hardware.** v0.6.0 closes the loop on the v0.3 / v0.4
> decoder + UI plumbing and the v0.5 validation harness. The
> work is no longer more plumbing or more validation — it's
> using the now-validated pipeline on real data: comparing logs
> across sessions, surfacing which OBD-II PIDs a real ECU answers,
> and shipping the `[needs verification]` discipline through to
> the older example channels.

## What's New

### 🔀 Log-merge / comparison modal
The single most common tuner workflow, now in the binary. Open
two CSV logs from the Logging tab, click "Compare logs," and
see per-channel mean / std-dev / max deltas side-by-side. Pure
client-side over CSV — no protocol change, no new dependencies,
no backend round-trip. The diff math lives in
[`src/js/log_diff.js`](src/js/log_diff.js) with 16 unit tests
covering realistic before/after-tune deltas, zero-delta identity
cases, and uneven-length series.

Use cases: "did my Stage 1 tune actually shift long-term fuel
trim, or is it just binned noise?", "is knock retard higher now
than before the HPFP replacement?", "is the AFR target curve
matching what I tuned for?". Answers in seconds.

See PR #77.

### 📋 Real-car injector-time validation harness
A self-contained checklist an F/G-series owner with an ENET
adapter can fill in to validate the `inj_time` channel
(`DID 0x4363`, target `0x12`, decode `u8_div100`, range 0–2.55 ms)
on B58 / N55 by comparing against ISTA at three steady-state
points (idle / cruise / WOT). Same shape as the v0.5.0 PR #72
u8_enum validation harness — pre-flight checklist, per-state
expected-range tables, pass / investigate thresholds, "what if a
byte doesn't match" diagnosis branches, results-PR template.

Plus the retroactive `[needs verification, UDS only]` marker
on the existing `inj_time` labels in both
[`community/profiles/b58.toml`](community/profiles/b58.toml) and
[`community/profiles/n55.toml`](community/profiles/n55.toml) —
matching the v0.5.0 PR #73 discipline for the example enum
DIDs and fuel-trim DIDs. The marker should have been set when
v0.3.0 shipped the `u8_div100` decoder; better late than never.

**Plan-vs-actual:** the v0.6.0 plan listed this as "injector
duty cycle (decoder + DIDs)." Probing the codebase showed
`inj_time` (ms per cylinder) was already shipped since v0.3.0
on both profiles, and no BMW-specific DID for "duty cycle" as
a separate reading appears in `TECH_SPECS.md` or any reliable
community source. Inventing a DID from forum threads would
break the `[needs verification]` discipline. The PR ships the
harness + the marker discipline instead — a future contributor
with F/G-series access can add a duty-cycle DID once a real
source surfaces.

New doc: [`docs/validation/injector-validation.md`](docs/validation/injector-validation.md).

See PR #80.

### 🔍 OBD-II mode 01 PID auto-discovery
A new `protocol::scan_obd2_pids(t, target) -> PResult<Vec<u8>>`
helper walks SAE J1979 PID bitmasks (`0x00 / 0x20 / 0x40 / 0x60`)
and reports which standard OBD-II PIDs a single ECU actually
responds to. Each bitmask block is probed independently so an
empty block doesn't abort the scan (a real ECU may respond to
`0x00` and `0x40` but not `0x20`). The bitmask PID itself
(`0x00`, `0x20`, `0x40`, `0x60`) is reported as supported when
its own probe succeeds.

Surfaced on the Vehicle Test tab via a "Scan OBD-II PIDs"
button that renders the supported set as a grid of monospace
hex cells. Useful diagnostic before opening Parameter Explorer
— a real BMW DME often responds to only a handful of standard
OBD-II PIDs, and a scan before manual probing tells the user
where to focus.

5 new unit tests with a `ScriptedTransport` mock: MSB-first
bitmask decode, multi-block walk, empty-bitmask case,
data-read-fails-despite-bitmask drop-on-mismatch.

**Plan-vs-actual:** the v0.6.0 plan listed this as "OBD-II
PID auto-discovery (protocol helper + command + UI)." Probing
the codebase showed `pub fn read_obd_pid(t, target, pid)`
already existed in `protocol/mod.rs` with the right response
shape check. This PR is the thin scan-loop wrapper + Tauri
command + UI panel — ~60% smaller than the plan estimated.

See PR #81.

### 🛡 Scope discipline — what does NOT ship
- **No new "injector duty cycle" decoder.** No BMW DID for
  duty cycle as a separate reading (distinct from
  injection time, `inj_time`) appears in `TECH_SPECS.md` or
  any reliable community source. The `[needs verification]`
  discipline forbids inventing one from forum threads. The
  validation harness (PR #80) is the path: an F/G-series
  owner who can compare against ISTA may surface a real
  duty-cycle DID, which then lands in v0.7.0 or later.
- **No plan-vs-actual drift correction in this release.** The
  v0.6.0 plan claimed three PRs would each be "decoder + DID
  + UI." Probing at PR-time showed two of the three were
  actually 30–60% smaller (no new decoder, only label/data
  discipline). Both shipped at the smaller scope — that's
  the cycle's actual content, even if it's not the plan's
  shape. The cycle name "Real Hardware" still fits: the
  discipline is the work.
- **No cloud sync, Raspberry Pi CAN bridge, plugin system,
  Bootmod3/MHD integration, multi-language UI, or web-based
  shared-log viewer.** All explicit `Deferred to v0.7.0+`
  on the ROADMAP. Each has a structural reason (privacy + ops
  story first, hardware project, community governance work,
  legal risk, translation coordination, hosted backend work).
- **No new README § Features list.** v0.6.0 is a close-out
  cycle; the README § "What's coming" was rewritten to flip
  v0.5.0 into "Recently shipped" and v0.6.0 into the new
  "items shipped" subsection. No new top-level feature
  descriptions were warranted.

## Known Limitations (still)

These are structural, not bugs — see [`ROADMAP.md`](ROADMAP.md) for
the path forward (now under "v0.7.0 cycle candidates"):

- **EGS / DSC CBS-reset routine IDs** intentionally not added
  in v0.4.0 (data shape shipped in PR #67; chassis-specific
  IDs need bench test). Still 🟡 Deferred.
- **`[needs verification]` markers** on the example enum DIDs
  (PR #60), the N55 fuel-trim DIDs (PR #73), and the
  pre-existing `inj_time` labels (PR #80 retroactive) — all
  retire the moment an F/G-series owner files a
  `[verified YYYY-MM-DD on chassis XYZ]` PR. The validation
  harnesses (PR #72 + PR #80) are the path.
- **Real-car evidence** for the 🟡 items on the v0.6.0 roadmap:
  custom math channels; knock visualisation (full distribution
  view); AFR / lambda bank readout polish; per-bank fuel-trim
  polish; injector duty cycle (if a real source surfaces);
  trigger-based logging; OBDLink MX+ support; **ENET/DoIP
  auto-detection** (the highest-leverage protocol work);
  real-car validation on F/G-series B58 / N55. All need
  real-car testing.
- **OBD-II PID scan is sequential, not parallel.** A scan
  across PIDs `0x00..0x7F` for an ECU with sparse bitmasks
  takes a few seconds over the simulator; on a real K+DCAN
  adapter with 1 ms VCP latency it's still under 2 seconds.
  Parallel probing is a future enhancement if any real-world
  scan becomes a UX bottleneck.

## How to Upgrade

### From v0.5.0
Restart the app — `community/` files load at runtime with no
recompile. The new OBD-II PID scan is a new Tauri command;
no config change. The new Vehicle Test panel (`obd-pid-panel`)
is hidden by default; click "Scan OBD-II PIDs" after
selecting a present control unit to populate it. All v0.5.0
features (u8_enum validation harness, N55 fuel-trim DIDs,
severity-class styling) continue to work unchanged.

### From v0.4.0
Restart the app. New in v0.5.0 and v0.6.0: u8_enum channels
in the example profiles, severity-class styling for enum
text, N55 fuel-trim DIDs, log-merge modal, injector-time
validation harness, OBD-II PID auto-discovery panel. None of
these are breaking changes.

### From v0.3.0 (full install)
Download the installer from the Assets below (built by CI on
tag push to `v0.6.0`).

### From v0.1.0 or earlier
Full install recommended. See `README.md` Quick Start for the
`npm install` + `pip install -r requirements.txt` + `npm run
dev` flow.

### VPS deployment
See `DEPLOY.md` for the full guide. The minimum diff from a
fresh Ubuntu 22.04+ VPS:

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

- **ohgeeceee** — Creator, maintainer, all v0.6.0 work in
  this release:
  - **PR #76** — `docs/v0.6.0_plan.md` cycle plan
    ("Real Hardware")
  - **PR #77** — Log-merge / comparison modal on the
    Logging tab
  - **PR #79** — `ROADMAP.md` "Ready to Claim" section
    consolidating unaddressed 🟢 items (the v0.7.0 backlog
    seed)
  - **PR #80** — `docs/validation/injector-validation.md`
    real-car injector-time validation harness + retroactive
    `[needs verification, UDS only]` marker on `inj_time`
    labels in both profile TOMLs
  - **PR #81** — `protocol::scan_obd2_pids()` helper +
    `list_supported_pids` Tauri command + Vehicle Test
    tab panel + 5 unit tests
  - **v0.6.0 release cut** — version bumps + release notes +
    ROADMAP / CHANGELOG / README close-out
- **OBDb** ([github.com/obdb/Vehicle-Parameter](https://github.com/obdb/Vehicle-Parameter))
  — CC-BY-SA 4.0 open database providing UDS DID labels and
  PID mappings (continued from v0.2.0 / v0.3.0).
- **`TECH_SPECS.md`** — the project's own specs doc
  continues to be the source for new DIDs (e.g. PR #73's
  fuel-trim mapping). Re-read before inventing new DIDs.

## Links

- Full changelog: [`CHANGELOG.md`](CHANGELOG.md)
- Roadmap: [`ROADMAP.md`](ROADMAP.md) — v0.6.0 marked
  Shipped; v0.7.0 cycle candidates are the Ready-to-Claim
  🟢 pile (PR #79) + ENET/DoIP auto-detection (the highest-
  leverage protocol work) + the 🟡 items below.
- Cycle plan: [`docs/v0.6.0_plan.md`](docs/v0.6.0_plan.md)
- Validation harnesses:
  [`docs/validation/u8_enum-validation.md`](docs/validation/u8_enum-validation.md)
  + [`docs/validation/injector-validation.md`](docs/validation/injector-validation.md)
- Contributing guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Community data: [`community/`](community/)
- Security policy: [`SECURITY.md`](SECURITY.md)
- Deployment guide: [`DEPLOY.md`](DEPLOY.md)
- Community framework: [`COMMUNITY_FRAMEWORK.md`](COMMUNITY_FRAMEWORK.md)

*Released 2026-07-16. Three Ready items from the v0.6.0
plan shipped, two of them at smaller scope than planned
after probe-before-plan surfaced that the underlying data +
decoder were already in place. Real-car validation of the
example enum DIDs, the fuel-trim DIDs, and the
injector-time labels is the remaining 🟡 blocker for
v0.7.0 release scope. ENET/DoIP auto-detection is the
highest-leverage protocol work for the next cycle.*