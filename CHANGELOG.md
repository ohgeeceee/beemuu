# Changelog

All notable changes to BeeEmUu are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed — Tier B (K+DCAN transport)

- **BMW-FAST FMT on K+DCAN** (Tier B): `build_frame` was sending a raw
  length byte (`0x05` for `1A 80`) instead of BMW-FAST
  `FMT = 0x80 | payload_len` (`0x82`). Real E90 D-CAN modules ignored
  those frames; the FTDI still echoed TX, so Traffic showed
  `Malformed frame: short` after the full 1 s / 3 s deadline. The
  same adapter worked in an Android K+DCAN app. Read-path length
  decode now accepts BMW-FAST, extended, and the legacy Beemuu
  prefix. Unit tests pin the on-wire shape. Verified 2026-08-28 on a
  2006 E90 330i (DME answered in ~15 ms; vehicle test found 9
  control units).
### Planned — Tier A (read-only research, not a v0.15.1 slice)

- **E90 FRM coding dump** (Tier A): a read-only card on the Service
  Functions tab that identifies FRM (`0x72`, KWP `1A 80`) and
  exports a local-ID + DID probe to `~/beeemuu-exports/`. Mirror-fold
  state is always **Unknown** — no bit map and no ECU write
  (`write_did` / `0x3B` / `set_coding_parameter` are not added).
  Reuses existing `scan_modules`, `probe_range`, `read_vehicle_info`,
  and `export_text`. Harness:
  [`docs/validation/coding-mirror-fold.md`](docs/validation/coding-mirror-fold.md).
  To change automatic mirror folding on the car, use NCS Expert.
  Community overlay texts for FRM `9CC1` / `9CCD` / `9CCE` /
  `9CD0` (observed on that E90; `9CCC` and `E58B` stay unknown).

## [0.14.0] — 2026-07-25

### Added — Tier A surface (live features on the desktop + beemuu.com)

- **Live Gauges panel in the desktop app** (PR #162, Tier A): a new
  6-gauge panel under the Live Data tab. RPM, coolant, oil temp,
  vehicle speed, battery voltage, throttle. Off by default; the
  user clicks "Start CAN listener" to enable. Reuses the existing
  `src/js/gauges.js::Gauge` widget. No new crate, no transport
  changes — the panel is fed by the JS-side simulator mirror until
  the Tier B transport lands.
- **Pure JS CAN broadcast decoders** (PR #157, Tier A):
  `src/js/can_decoders.js` — 8 byte-level decoders for the 6 known
  E-series broadcast IDs (0x0AA, 0x1D0, 0x545, 0x0CE, 0x130, 0x316).
  Dual export (CommonJS + `window.beeemuuCanDecoders`). 32 unit tests.
  Scale constants are pinned and exported for v0.14.1 real-car
  verification per `docs/validation/can-broadcast.md`.
- **JS-side simulator broadcast personality** (PR #158, Tier A):
  `src-tauri/src/transport/sim.rs::broadcast_frames_at` extended with
  a 10-thread `std::thread::spawn` worker that produces the 6 known
  frames at the documented rates (10/20/100/100/1000/1000 ms).
  The desktop panel + the JS-side mirror both consume this.
- **JS-side simulator mirror + frontend wiring** (PR #164, Tier A):
  `src/js/live_can_source.js` is a byte-for-byte mirror of the Rust
  generator; `live_gauges.js` controller extended with a
  `peakFor(key)` per-gauge peak tracker and a `framesPerSecond()`
  mirror of the source. The panel header now shows `<X> fps`.
- **Real-car verification harness doc** (PR #164, Tier A):
  `docs/validation/can-broadcast.md` — the 5-step report-back loop
  for E9x/E6x owners. Includes a copy-pasteable Node driver script
  that replays a captured CSV through the decoder.
- **Live Gauges panel on `beemuu.com`** (PR #167, Tier A): the same
  6 gauges are now on the public site. `frontend/live_gauges.js` is
  a self-contained public-site mirror (no Tauri / no desktop deps);
  `frontend/live_gauges.css` provides the dark-cockpit panel
  styling; `frontend/index.html` hosts the DOM. Visitors see the
  gauges ticking in real time, driven by the JS-side simulator in
  their browser. Byte-for-byte parity with the desktop module pinned
  by `frontend/live_gauges.test.js` (5 tests). CI updated to include
  `frontend/**/*.test.js` in the JS test glob.

### Planned — Tier B surface (gated behind real-car testing)

- **Live CAN transport + Tauri commands** (PRs #168+): Tier B because
  every slice touches `src-tauri/src/transport/**` and
  `src-tauri/src/commands.rs`. Adds `transport/can_listener.rs`
  with `ListenerMode::{Simulator, OBDLinkSx { port_name }}` plus
  three async commands (`start_can_listen` / `stop_can_listen` /
  `get_latest_can_frames`). When this lands, the desktop panel's
  hardware source flips from "no frames" to "real frames" with no
  frontend change. Requires an OBDLink SX on a real E46 to merge.

### Note on the partial release

This CHANGELOG entry covers the **Tier A surface** of the v0.14.0
cycle (frontend + public site + simulator + harness doc). The Tier B
surface (real-car transport + commands) is **still open** and gated
behind OBDLink SX testing. The README release badge stays at v0.14.0
(this entry); the v0.14.0 git tag will be cut when Tier B lands.
Until then, `beemuu.com` already shows the Tier A surface in
production, and the desktop app picks up the new code on the next
release build.

## [0.14.1] — 2026-07-27

### Fixed — Tier B surface (issue #161 — Tauri 2 webview flakiness)

- **Tauri 2 `window.confirm()` auto-dismiss fix** (PR #169, Tier B):
  the click handler at `src/js/main.js:1125` (`btn-clear-faults`) and
  `src/js/main.js:1353` (security-access confirm) used
  `window.confirm(...)`, which the Tauri 2 webview auto-dismisses
  (resolves `false` without showing the dialog) on some builds,
  short-circuiting the click. Both gates now route through
  `tauri-plugin-dialog`'s `ask()` via the new `src/js/dialog.js`
  helper. New crate: `tauri-plugin-dialog = "2"` in
  `src-tauri/Cargo.toml`. Touches `transport/sim.rs` file path
  (simulator regenerate-on-identify) and `commands.rs` plugin
  registration — Tier B by virtue of those protected paths.

- **Simulator regenerate-on-identify** (PR #169, Tier B): the sim's
  DTC list is seeded from `default_dtcs` + `default_freeze`
  captured at construction; on the next KWP `[0x1A, 0x80]`
  identify (called per ECU by `scan_modules` on "Run vehicle
  test"), the identify handler restores the seed when the current
  DTC list is empty. Models a real car re-detecting faults on a
  fresh ignition cycle. Tier B because `transport/sim.rs` is on
  the protected path.

- **Per-ECU freeze-schema split** (PR #170, Tier A): new
  `community/freeze/<hex>.toml` files plus
  `community::load_freeze_per_ecu()` helper. Shrinks
  `commands.rs::load_freeze_schemas` body — bulk auto-loads the
  registry on startup so the freeze-frame panel renders decoded
  values without the user clicking "Reload" in the schema-builder.
  Tier A: data + frontend + bulk-loader wiring, no protected-path
  changes.

## [0.14.2] — 2026-07-29

### Added — Tier A surface (Live Data on the Bench)

v0.14.2 ships "live data today, on the bench, with the cable you
have." Four Tier A slices, 1 Tier B slice. No `transport/**` changes
(K+DCAN KWP diagnostic sessions keep using `kdcan.rs` unchanged;
v0.14.0's Tier B raw-CAN listener remains gated behind OBDLink SX
acquisition). `read_live_data` and `watch_*` already work over
K+DCAN today; this cycle fills the per-param data, the panel UX,
and the chassis-specific verification doc.

- **Cycle plan + ROADMAP v0.14.2 header** (PR #171, Tier A):
  `docs/v0.14.2_plan.md` + the ROADMAP cycle entry. Docs-only.
  Retroactively closes v0.14.1 in the ROADMAP (PRs #169 / #170).

- **`community/profiles/n62.toml` enrichment — `0x5C` oil temp**
  (PR #175, Tier A): replaces the unverified `local:10`
  placeholder with the standard OBD-II PID `0x5C` (engine oil
  temperature, `byte - 40 °C`). Removes the `[UNVERIFIED
  placeholder]` tag and the "oil temp unverified" mark from the
  profile label. Adds an N62 instrumentation-context header block
  (valley-pan slow-coolant monitoring, oil-temp cruise band,
  Valvetronic load/throttle inverse, idle-voltage target). Bench
  verification on the E70 X5 4.8i is the gating step for the
  deferred `0x5E` / `0x5F` / `0x62` PIDs each of which needed its
  own decoder first — those ship in v0.14.3.

- **Live Data panel UX polish** (PR #177, Tier A): polling-rate
  selector (`<select id="live-poll-rate">` 100/250/500/1000 ms),
  per-gauge peak tracking (`peakFor(key)` in `live_gauges.js`),
  range bar, snapshot-CSV button (`buildSnapshotCsv` +
  `snapshotCsvFilename` in `live_data_panel.js`), and the NRC-aware
  error surface (`parseNrcError` + `isUnsupportedNrc` helpers in
  `live_data_panel.js`, friendlier `log()` line for the four
  canonical "unsupported" NRCs — 0x11, 0x12, 0x31, 0x14). 221/221
  JS tests green. **Note:** the per-PID dim + "remove from profile"
  UI was deferred to v0.14.3 (PR #187 + PR #190) because the
  protocol layer didn't surface the DID in the error string at
  this point — slice 3a (PR #187) added `protocol::nrc_from_error`
  for that.

- **`docs/validation/n62-real-car.md` harness doc** (PR #178,
  Tier A): chassis-specific step-by-step bench-verification harness
  for the N62 / E70 X5 4.8L profile. Mirrors the shape of the
  existing `docs/validation/can-broadcast.md` (PR #164),
  `dtc-history.md` (PR #148), and `injector-validation.md` (PR #80).
  Five sections (wire-up, cold readings, running readings, report
  template, what we will do with the report) with copy-pasteable
  report-back shape. Cross-links v0.14.0
  `docs/validation/can-broadcast.md` for users who eventually get
  an OBDLink SX on the same chassis.

### Fixed — Tier B surface (CI workflow)

- **Claude review workflow repair** (PR #176, Tier B): removed
  `Bash(gh pr review:*)` from the `--allowedTools` list in
  `.github/workflows/claude-review.yml`. The `claude-code-action@v1`
  workflow was failing at startup with `is_error:true` on every
  run because the unsupported tool was outside the known working
  review configuration. Tier B because `src-tauri/Cargo.toml` is
  on the protected list — though the change is workflow-only.

## [0.14.6] — 2026-08-02

> **Cycle status:** single slice merged — #226 (the
> "Forward Roadmap Audit" PR; this Tier C release cut
> is the post-merge tag step). The v0.14.6 cycle is the
> doc-rotation close-of-cycle that the v0.14.5 release
> cut (PR #225) should have caught but didn't, mirroring
> the v0.14.4 "Story Coverage" docs-rotation pattern
> (PRs #198 + #200). Per `CLAUDE.md` golden rule #5
> ("don't let the badge lie"), the README release badge
> moves from `v0.14.5` to `v0.14.6` because the
> v0.14.6 cycle did ship real work (the forward-roadmap
> doc audit + ROADMAP v0.14.5 closeout + the public
> landing-page cycle detail updates). The v0.14.6
> release cut itself (version bumps + git tag +
> installer publish + landing-page deploy) is a
> separate Tier C step that follows the merge of the
> release cut PR.

### Added — Tier A surface (docs-only cycle)

v0.14.6 is the **"Forward Roadmap Audit"** cycle. It
generalises the v0.14.4 / v0.14.5 close-of-cycle pattern
into a dedicated docs-rotation cycle. Cycle plan in
[`docs/v0.14.6_plan.md`](docs/v0.14.6_plan.md). See
[`ROADMAP.md`](ROADMAP.md)'s v0.14.6 cycle block for the
per-PR detail. The cycle name matches the public
`frontend/roadmap/v0.14.6.html` page published in
PR #226; the in-repo plan doc is the source of truth.

- **`ROADMAP.md` v0.14.5 cycle block closeout** (PR #226,
  Tier A, docs only): "In Progress — slice 0" →
  "Shipped 2026-08-02" with `✅ Done` rows for the three
  Tier A PRs (#222, #223, #224) + the Tier C release cut
  #225. Adds a "Test count delta" table, a "Verification
  (close-of-cycle)" section, and a "Next cycle" pointer
  to v0.14.6. The "What this cycle does NOT ship"
  claims are retroactively confirmed (✅ on every line).
- **`docs/forward_roadmap_14.4_to_16.9.md` full audit**
  (PR #226, Tier A, docs only): audited against
  `origin/main` @ `6993475` (the post-#226 v0.14.6
  audit tip). Updated the "Status (revised)" blockquote
  to add the 4 cycles (v0.14.2 / v0.14.3 / v0.14.4 /
  v0.14.5) that have closed since the 2026-07-29
  revision. Closed out the v0.14.4 entry (renamed
  "N62 Bench Verification" → "Story Coverage") and the
  v0.14.5 entry (renamed "Bench Round 2" → "Open &
  Committed"). Added the v0.14.6 entry at the top of
  the cycle list. Updated the v0.15.0 entry's status
  blockquote. Preserved the v0.15.1 / v0.15.2 / v0.15.3
  / v0.15.4 / v0.16.0 – v0.16.9 cycle list as
  forward-looking candidates. Added a 4th badge
  state (`✅ Shipped`) to the legend. Added the v0.14.5
  N5x harness doc to the cross-cutting list. Updated
  the "Open questions" section with a v0.14.6 question
  about the `release.yml` landing-page step. Added a
  "2026-08-02 (v0.14.6 audit)" entry to the Revision
  history.
- **`docs/v0.14.6_plan.md`** (PR #226, Tier A, docs
  only, new ~270 LOC): the v0.14.6 cycle plan doc per
  the established `docs/v0.14.x_plan.md` convention.
  Includes premise, slice list, tier split, execution
  order, "what this cycle does NOT ship" claim, open
  questions for the maintainer, cross-references.
- **`frontend/roadmap/v0.14.5.html` closeout** (PR
  #226, Tier A, landing-page content): Title
  `(planned)` → `(shipped)`, eyebrow → "Cycle detail
  (shipped)", lede rewritten, `<div class="guide-meta">`
  updated, candidate-slice list replaced with a "What
  shipped" `<h2>` section listing the 4 PRs that merged,
  an "Install v0.14.5" `<h2>` section with direct
  download links to the Windows installers + the
  SHA-256 verify link + the safety warning, and FAQ
  answers updated.
- **`frontend/roadmap/index.html` + `v0.14.6.html`**
  (PR #226, Tier A, landing-page content): v0.14.5
  moved from "Planned cycles" to "Shipped cycles";
  v0.14.6 added to "Planned cycles"; the new
  `v0.14.6.html` page is the public cycle detail.

### What this cycle does NOT ship

- ❌ No `transport/**` code changes. K+DCAN / ENET /
  DoIP paths are preserved. The forward-roadmap doc's
  Tier B candidate for the next-feature cycle
  (ENET/DoIP UDP broadcast discovery, the highest-
  leverage Tier B item) is preserved as a 🟡 item
  deferred to v0.15.0+ per the forward-roadmap's
  `v0.16.0` cycle spine (BLE / WiFi / ENET land rush).
- ❌ No `protocol/**` code changes.
- ❌ No `commands.rs` changes.
- ❌ No new crates in `src-tauri/Cargo.toml`.
- ❌ No frontend changes (no `src/js/**`, no
  `src/css/**`, no `src/index.html`). The
  `frontend/roadmap/v0.14.5.html` + `v0.14.6.html`
  updates are landing-page content changes (not
  app-shell JS / CSS changes).
- ❌ No community data changes (`community/profiles/*.toml`,
  `community/stories/*.toml`, `community/testplans/*.toml`,
  `community/freeze/*.toml`).
- ❌ No new BMW hex descriptions.
- ❌ No `BEEMUU_VPS_SSH_KEY` / `BEEMUU_VPS_HOST`
  secret configuration. The v0.14.5 release run
  (#30738207436) failed at the "Update beemuu.com
  landing page" step because these secrets aren't
  configured in the repo. The v0.14.6 release run
  will have the same failure mode until the
  maintainer configures the secrets. The v0.14.6
  cycle doesn't claim to fix this — it's a
  separate ops task that the maintainer owns. Per
  the v0.14.6 plan doc's "Open questions" section:
  the docs change to make the landing-page step
  best-effort + document the secret-requirements
  is a follow-on PR in the v0.14.6 cycle, not
  this audit PR.

### Verification (close-of-cycle)

- [x] `node --test src/js/test/*.test.cjs` — **58/58
      pass** (212ms, fresh re-run on the v0.14.6
      audit commit)
- [x] `node --test src/js/*.test.js` — **192/192
      pass** (1.5s, fresh re-run)
- [x] `cargo test --test async_commands --offline` —
      **1/1 pass** (the CLAUDE.md invariant guard)
- [x] `python -m pytest backend/tests/ -q` —
      **218/219 pass** (the 1 failure is
      `test_bootstrap_cli.py::test_script_exists_and_is_executable`
      which asserts the executable bit on
      `ops/bootstrap-admin.sh`; on Windows the
      executable bit is meaningless, so this test
      always fails on Windows by design. Pre-existing
      on `origin/main`, not caused by v0.14.6.)
- [x] All 5 version surfaces on `origin/main` =
      `0.14.6`: `package.json`,
      `src-tauri/Cargo.toml`,
      `src-tauri/tauri.conf.json`, `README.md`
      release badge, `src-tauri/Cargo.lock`
      (beeemuu package version)
- [x] `release.yml` run for the v0.14.6 tag: build
      step **success** (produces the v0.14.6
      Windows installers); landing-page step
      **failure** (VPS deploy secrets
      `BEEMUU_VPS_SSH_KEY` / `BEEMUU_VPS_HOST`
      not configured in repo secrets; pre-existing,
      same pattern as the v0.14.4 + v0.14.5
      release runs)
- [x] Tag `v0.14.6` on `origin`

**Next cycle:** v0.15.0 — "Live Gauges from the Bench"
(DID-projection bridge, real data on K+DCAN). The
forward-roadmap doc has the full scope; the cycle
plan doc opens with the v0.15.0 Discussion thread
per `COMMUNITY_FRAMEWORK.md`'s "no feature without a
Discussion" rule.

## [0.15.6] - 2026-08-30

### Added - Workspace wiring (theme + gauge layout persist)

- **Workspace wiring** (`src/js/main.js`): `saveWorkspaceGauges`/`loadWorkspaceGauges` via `beeemuuWorkspace`, `ensureGauge` monkey-patch auto-save, `beforeunload` save, `DOMContentLoaded` restore (profile-filtered), theme `data-theme` persist. Completes `v0.7.0` PR #2 pile.

## [0.15.5] - 2026-08-30

### Added - Workspace save/load helpers

- **Workspace** (`src/js/workspace.js` + `src/js/test/workspace.test.cjs`, 3 tests): `save(gauges,theme)`/`load()`/`clear()` via `localStorage.beeemuu.workspace` `{gauges:[{profile_id,param_id,min,max}], theme, savedAt}`. Pure helpers, dual export. UI wiring deferred per 3-PR discipline (next slice will call `save` on gauge add/remove + `load` on startup).

## [0.15.4] - 2026-08-30

### Added - Custom math channels (deferred from v0.6.0/v0.7.0)

- **Math channels** (`src/js/math_channels.js` + `src/js/test/math_channels.test.cjs`, 7 tests): safe sandbox `tokenize`/`validate`/`evaluate`/`createChannel` — only `a-z0-9_` ids + `+ - * / ( )` + numbers, `Function` eval with no globals, unknown-id and unbalanced-parens rejection. Expressions e.g. `map - baro`, `(map - baro) * 10`, `rail / load`.
- **Math panel** (`src/index.html` `#math-panel` + `src/js/main.js` wiring): label + expr inputs, Add, list with delete, `localStorage.beeemuu.mathChannels`, evaluation in `logTick` override (appends virtual `LiveValue` `math_*` to values).
- Version surface `0.15.3` -> `0.15.4`.

## [0.15.3] - 2026-08-30

### Added - Trigger-based logging UI wiring

- **Logging tab trigger panel** (`src/index.html` `#trigger-panel` + `src/js/main.js` trigger poll): threshold (`channel + op + value`) and DTC (`code or *`) toggles, `localStorage` persist, 1s poll via `read_live_data` + `read_faults`, auto `startLogging()` on `shouldAutoStart`. Script tag `js/trigger.js` loaded before `main.js`.
- Version surface `0.15.2` -> `0.15.3`.

## [0.15.2] - 2026-08-30

### Added - Trigger-based logging engine (deferred from v0.6.0/v0.7.0)

- **Trigger engine** (src/js/trigger.js + src/js/test/trigger.test.cjs, 6 tests): pure helpers evaluateThreshold, evaluateDtcTrigger, shouldAutoStart. Threshold ops > >= < <= == != + DTC */specific code. Dual export (CommonJS + window.beeemuuTrigger). No DOM, no Chart.js.
- Logging tab wiring deferred to next slice (poll-loop integration + UI panel) per 3-PR spine discipline.

## [0.15.1] — 2026-08-30

### Added — Injector duty cycle (v0.6.0 PR #2)

- **Injector duty cycle DIDs** (`community/profiles/n55.toml` `did:4401`, `community/profiles/b58.toml` `did:4402`): new `inj_duty` param `unit="%"` `decode="u16_fiftieths"` (raw*0.02, 0-100% -> raw 0-5000). Marked `[needs verification, UDS only]` per v0.5-v0.6 discipline; KWP2000 (E-series) will NOT respond. Uses existing `Decode::U16Fiftieths` (no Rust change, TOML-only).
- Version surface bump `0.15.0` -> `0.15.1` (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`).

## [0.15.0] — 2026-08-05

> **Cycle status:** shipped 2026-08-05 via PRs #228,
> #229, #234, #235 (all Tier A — frontend-only). The cycle’s
> 4-slice shape (1 + 2a + 2b + 2c) diverged from the original
> plan’s "1 + 2 + 3" shape: the planned Tier B
> `update_can_listen` async Tauri command was dropped because
> the frontend converged on main.js driving `read_live_data`
> polling directly (the existing async Tauri command added
> in v0.14.2 / PR #175). No new `transport/**`,
> `protocol/**`, or `commands.rs` surface was needed.
> Release cut (version bumps + tag + `release.yml` +
> landing-page deploy) lands via this PR.

### Added — Tier A surface (feature cycle)

v0.15.0 is the **"Live Gauges from the Bench"** cycle.
It connects the existing `read_live_data` UDS path to
the v0.14.0 Live Gauges panel so it shows **real data
on the K+DCAN cable**, without the OBDLink SX
acquisition the v0.14.0 Tier B was waiting for. The
"**DID-projection bridge**" the v0.14.2 plan deferred
to "v0.14.3+" lands here. See
[`docs/v0.15.0_plan.md`](docs/v0.15.0_plan.md) for
the full cycle plan.

This is the load-bearing user-facing win of v0.15.0:
an E90 / E60 / E70 owner with the $15 K+DCAN cable can
now see the same 6-gauge Live Gauges panel (RPM,
coolant, oil temp, vehicle speed, battery voltage,
throttle) that v0.14.0's sim-only panel showed. No
new hardware required.

- **`src/js/live_data_bridge.js` — DID-projection
  bridge** (slice 1, PR #229, Tier A, frontend):
  maps each `[[profile.param]]` to the corresponding
  `data-live-can-gauge` slot. Pure mapping logic.
  Reuses the v0.14.0 `can_decoders.js` for byte-level
  decoding when the live-data value comes through the
  broadcast path. 192 LOC + 20 unit tests.
- **`src/js/live_kdcan_source.js` — K+DCAN source
  adapter** (slice 2a, PR #229, Tier A, frontend):
  wraps the bridge in the source shape
  `live_gauges.js` expects. 128 LOC + 6 unit tests.
- **`src/js/live_data_source_wiring.js` — K+DCAN data
  source wiring module** (slice 2b, PR #234, Tier A,
  frontend): `initKdcanDataSource({invoke, log})` factory
  that creates the bridge + K+DCAN source adapter.
  94 LOC. (No internal setInterval — main.js drives polling.)
- **`src/js/main.js` + `src/js/live_gauges.js` —
  caller integration** (slice 2c, PR #235, Tier A,
  frontend): main.js polls `read_live_data`, feeds the
  bridge cache, swaps the Live Gauges source from sim
  to K+DCAN. Adds `controller.setSource()` +
  `window.beeemuuLiveGauges.controller` surface + 10
  wiring tests + 4 `setSource` tests.
- **Cycle plan + ROADMAP v0.15.0 header** (slice 0,
  PR #228, Tier A, docs only):
  `docs/v0.15.0_plan.md` (new, ~270 LOC) + the
  v0.15.0 cycle block in `ROADMAP.md` + this CHANGELOG
  section + the v0.14.6 ROADMAP-block closeout.
- **This slice 0.5 doc-amend PR** (Tier A, docs only):
  amends `docs/v0.15.0_plan.md` + `ROADMAP.md` to reflect
  the actual 4-slice shape (1 + 2a + 2b + 2c) instead of
  the original plan’s "1 + 2 + 3" shape; documents that
  slice 3 (`update_can_listen`) was dropped because the
  architecture converged on the existing `read_live_data`
  async Tauri command.
## [0.15.1] — Unreleased

> **Cycle status:** slice 0 in flight (this PR — cycle plan +
> ROADMAP header + this CHANGELOG section). Slices 1 (test-
> plan walk on real freeze-frames, Tier A), 2
> (`record_walk_result` async Tauri command, Tier B), and 3
> (walk export to HTML with real freeze-frame snippets,
> Tier A) are open. The v0.15.1 release cut (version
> bump in `Cargo.toml` + `tauri.conf.json`, git tag,
> release notes publish, installer build) is a separate
> Tier C step. Until that PR lands, this entry stays
> `## [0.15.1] — Unreleased` per Keep-a-Changelog
> convention.

### Planned — Tier A surface (feature cycle)
- **Cycle plan + ROADMAP v0.15.0 header** (this
  PR, slice 0, Tier A, docs only):
  `docs/v0.15.0_plan.md` (new, ~270 LOC) + the
  v0.15.0 cycle block in `ROADMAP.md` + this
  CHANGELOG section + the v0.14.6 ROADMAP-block
  closeout (PR #226 shipped the audit but the
  ROADMAP v0.14.6 block was missed; this PR
  closes that gap as a fix-up).

### What this cycle does NOT ship

- ❌ No new transport support (BLE / WiFi / ENET
  auto-detect). The forward-roadmap doc's `v0.16.0`
  cycle spine ("Tier B Land Rush — BLE / WiFi /
  ENET") is the next cycle's work.
- ❌ No `protocol/**` code changes. The
  `read_live_data` UDS path is already shipped
  (it's what the v0.14.0 Tier B uses internally).
  v0.15.0 only adds the bridge + the data-source-
  flip in the frontend + the new
  `ListenerMode::KwpDids` variant on top of the
  existing `watch_tick` loop.
- ❌ No `commands.rs` changes (v0.15.0 is fully
  frontend — main.js drives the existing `read_live_data`
  async Tauri command added in v0.14.2; no new
  command surface was needed).
- ❌ No new crates in `src-tauri/Cargo.toml`.
- ❌ No community data changes (the DID-projection
  bridge works against the existing
  `community/profiles/*.toml` data shape).
- ❌ No new BMW hex descriptions.
- ❌ No `git tag v0.15.0` (Tier C release cut,
  separate step after all 3 slices land).

## [0.14.5] — 2026-08-02

> **Cycle status:** all three slices merged — #222 (cycle
> plan + ROADMAP header + this CHANGELOG section), #223
> (N52 + N54 profile enrichment), #224 (N5x harness
> doc). The v0.14.5 release cut itself (version bumps
> in `package.json` + `Cargo.toml` + `tauri.conf.json`,
> README release badge bump, CHANGELOG date stamp) is
> the Tier C step this PR is; the `git tag v0.14.5 &&
> git push --tags` step that triggers `release.yml`
> runs after the maintainer merges this PR.

### Added — Tier A surface (community data + harness doc)

v0.14.5 is the "**Open & Committed**" cycle. It generalises
the v0.14.2 / v0.14.3 N62 / E70 work to the **N52 / N54**
E-series family that the existing community profiles
(`community/profiles/n52.toml` + `community/profiles/n54.toml`)
already cover but that v0.14.2 explicitly deferred to "the
next cycle after N62 wraps up." Cycle name matches the
public `frontend/roadmap/v0.14.5.html` page published in
PR #221. See [`docs/v0.14.5_plan.md`](docs/v0.14.5_plan.md)
for the full cycle plan.

- **`community/profiles/n52.toml` + `n54.toml` enrichment**
  (slice 1, Tier A, data only): replace the `local:10` oil-temp
  placeholder (labelled `[UNVERIFIED placeholder]`) with the
  standard OBD-II PID `0x5C` (engine oil temperature,
  `byte - 40 °C`, decoder `temp_u8`), then add the three
  v0.14.3 N62 PIDs (`0x5E` fuel rate L/h with `u16_fiftieths`,
  `0x5F` engine runtime s with `u32_be`, `0x62` fuel rate g/s
  with `u16_half`). Each new entry carries the
  `[needs verification, N5x/E9x bench]` marker, matching the
  v0.14.3 N62 discipline. The N52 instrumentation-context
  header block grows with the BSD oil-condition sensor note
  (N52's known oil-temp quirk: the DME reads oil condition
  via BSD, not KWP2000). Removes the
  `[community, oil temp unverified]` mark from the profile
  `label` field once `0x5C` is in.
- **`docs/validation/n5x-real-car.md` harness doc**
  (slice 2, Tier A, docs only): mirrors
  `docs/validation/n62-real-car.md` (PR #178 + PR #188).
  Five-section shape: wire-up, cold readings, running
  readings, report template, what-we-do-with-the-report.
  Covers the E9x N52 (325i / 328i / 330i, MSV70 / MSV80)
  and N54 (335i / E60 535i / E89 Z4 35i, MSD80 / MSD81)
  chassis. The N52 BSD oil-condition sensor note is the
  load-bearing difference from the N62 harness doc — the
  OBD-II `0x5C` swap may surface an NRC on N52 if the DME
  doesn't respond over OBD-II, and the harness report path
  reverts to the `local:10` placeholder in that case.
- **Cycle plan + ROADMAP v0.14.5 header** (this PR, slice 0,
  Tier A, docs only): `docs/v0.14.5_plan.md` (new, ~270 LOC) +
  the v0.14.5 cycle block in `ROADMAP.md` (the block inserted
  after the v0.14.4 cycle block) + this CHANGELOG section.

### What this cycle does NOT ship

- ❌ No `transport/**` code changes (K+DCAN / ENET / DoIP
  paths preserved). The forward-roadmap doc's Tier B
  candidate for v0.14.5 (ENET/DoIP UDP broadcast discovery)
  is preserved as a 🟡 item deferred to v0.15.0+ per the
  forward-roadmap's `v0.16.0` cycle spine (BLE / WiFi / ENET
  land rush).
- ❌ No `protocol/**` code changes.
- ❌ No `commands.rs` changes.
- ❌ No new crates in `src-tauri/Cargo.toml` (the four
  decoders the slice 1 PIDs use are already shipped).
- ❌ No frontend changes (no `src/js/**`, no `src/css/**`,
  no `src/index.html`).
- ❌ No new BMW hex descriptions (per the v0.14.3 PR #186
  source-policy precedent: the four v0.14.5 PIDs are SAE
  J1979 emissions-mandated and sourced from the published
  standard, not from forum threads).
- ❌ No `git tag v0.14.5` (Tier C release cut, the next step
  after slice 2 lands).
- ❌ No CHANGELOG content changes for v0.14.0 / v0.14.1 /
  v0.14.2 / v0.14.3 / v0.14.4 (already in the file via
  the v0.14.x backfill PRs and PR #208's release cut).

## [0.14.4] — 2026-07-31

> **Cycle status:** all four slices merged — #198 (CLAUDE.md
> invariants refresh), #199 (ci.yml Tauri Linux sysdeps fix),
> #200 (ROADMAP v0.3.0 historical audit), #201 (story +
> anonymize test coverage). The v0.14.4 release cut itself
> (version bumps in `Cargo.toml` + `tauri.conf.json`, git tag
> `v0.14.4`, release notes publish, installer build, landing-
> page deploy) shipped via PR #208 on 2026-07-31 (commit
> `4de03ee`). The README release badge moved to `v0.14.4`
> at that point and is at `v0.14.5` after the v0.14.5 release
> cut.

### Added — Tier A surface (test coverage + doc-rot cleanup)

- **52 unit tests for `src-tauri/src/story.rs` + `anonymize.rs`**
  (PR #201, Tier A, **cycle headline slice**):
  - 32 tests in `story.rs` (was 0): severity bucketing +
    ordering, `priority_for`, `parse_cost_range` (single /
    tilde / hyphen / **en-dash** / whitespace / empty /
    garbage), `format_vehicle` (empty / VIN-only /
    mileage-only / decoded), `build_context` freeze-frame
    string assembly, and the full `generate()` pipeline
    integration against the live community knowledge base
    (empty snapshot → Info story, n55-specific DTC lookup,
    generic fallback, severity = max of all findings,
    recommendation sort, cost range sum, cost-max
    invariant, DTC code case-insensitive lookup, summary
    text counts, title format).
  - 20 tests in `anonymize.rs` (was 0): `hash_vin`
    properties (16 hex chars, stable, distinct,
    case-sensitive — pinned as an invariant test), full
    `anonymize()` pipeline (VIN never leaks, fingerprint
    substitution, missing VIN → "unknown" fingerprint,
    engine_family preserved, modules / DTCs / freeze
    frames preserved, mileage stripped, empty modules,
    fault_count None → 0, live_data always empty), and
    `export_json` (no VIN / mileage leak, pretty-printed,
    serde round-trip).
  - Tier A because the slice is pure additions to existing
    Rust modules; no `transport/**` / `protocol/**` /
    `commands.rs` / frontend JS touches.
  - Test count went from `149 → 201` pass in
    `cargo test --lib --offline` (52 new, all green).

- **CLAUDE.md "Hardware & timing invariants" refresh**
  (PR #198, Tier A): four stale "NOT YET IMPLEMENTED" /
  "migration in progress" claims were wrong against
  `main`. Refreshed to "INVARIANT — enforced" with
  citations:
  - Async commands: migration complete (all transport
    commands are `async fn`); the 24 sync `#[tauri::command]`
    are in-memory / local-fs helpers gated by
    `tests/async_commands.rs::SYNC_ALLOWLIST`.
  - Tester Present keep-alive: shipped in
    `src-tauri/src/keepalive.rs` (210 LOC, `INTERVAL = 3000 ms`,
    `FRAME = [0x3E, 0x00]`).
  - ISO-TP multi-frame: shipped in
    `src-tauri/src/transport/isotp.rs` (430 LOC, FF/CF/FC
    state machine).
  - VIN reads: `protocol::read_vin` shipped at
    `src-tauri/src/protocol/mod.rs:296`; all callers in
    `commands.rs` route through it (lines 70, 533, 677, 930).
  - ENET/DoIP UDP discovery is honestly preserved as
    still-not-implemented.

- **ROADMAP.md v0.3.0 historical audit** (PR #200, Tier A):
  six items in the v0.3.0 "Real Car" historical section
  were marked "🟢 Ready" but had actually shipped. Moved
  to a new "✅ Done — historical (shipped)" table with PR
  references + code locations:
  - KWP2000 slow-module timeout → ✅ Done (v0.13.0) — PR #153.
  - ISO-TP multi-frame → ✅ Done (v0.14.x).
  - Dark/light theme toggle → ✅ Done (v0.7.0) — PR #109.
  - Gauge theming → ✅ Done (v0.7.0) — PR #109.
  - Save/load workspace layout → ✅ Done (v0.7.0) — PR #109.
  - Export PNG/SVG from charts → ✅ Done (v0.11.0) — PR #136.
  - Honest 🟡 items (ENET/DoIP, BLE, WiFi, CAN bus
    listener, Mobile-responsive, real-car validation) left
    alone — they're still genuinely pending.

### Added — Tier A surface (landing-site deltas, 2026-08-02)

Landing-site-only changes for `beemuu.com` (the public website, not
the desktop app or hosted API). 27 new static files in `frontend/`:
15 new HTML pages, 8 per-category OG images, the Atom feed, the
visual sitemap, the press kit, and the 404 page. All Tier A
per `CLAUDE.md`; no protected paths touched.

- **Glossary** (`glossary.html`): ~30 BMW diagnostic terms with
  project-local definitions (KWP2000, UDS, DoIP, D-CAN, IBS, BDC,
  ZGW, ISO-TP, RoutineControl, SecurityAccess, CBS, DME, EGS, KOMBI,
  DPF, EGR, VANOS, Valvetronic).
- **Protocols deep-dive** (`protocols.html`): KWP2000 vs UDS over
  DoIP. Why E-series uses KWP2000 and F/G-series use UDS, the ISO-TP
  segmentation layer, the timing and deadline story, the
  Tester-Present keep-alive invariants.
- **Hardware deep-dive** (`hardware.html`): FTDI latency timer (the
  single most common cause of a working K+DCAN cable looking broken),
  the $5 AliExpress ENET cable pinout, OBDLink vs clones, the DIY
  ENET cable construction.
- **Community knowledge base** (`community.html`): highlights the
  3 community opinions, 12 guided testplans, 4 freeze-frame schemas,
  10 engine profiles in the project's TOML knowledge base.
- **Tools**:
  - `tools/dtc-decoder.html` — SAE J2012 P/U/B/C code structure.
  - `tools/known-codes.html` — the 220 BMW-specific codes organized
    by subsystem family (27xx throttle, 29xx fuel rail, 2Axx VANOS,
    30xx boost, etc.).
  - `verify.html` — how to verify the SHA-256 of a downloaded
    Beemuu installer; the published v0.14.4 hashes.
- **Comparisons**:
  - `compare/cbs-vs-battery.html` — when to do CBS reset vs battery
    registration.
  - `engines/n54-vs-n55.html` — N54 vs N55 3.0L inline-6; which is
    more reliable.
- **Master FAQ** (`faq.html`): 30+ Q&A across basics, cables, codes,
  service functions, contributing, troubleshooting.
- **Per-cycle roadmap**:
  - `roadmap/index.html` — index of every per-cycle page.
  - `roadmap/v0.14.4.html` — shipped cycle detail (4 slices, per-PR
    breakdown).
  - `roadmap/v0.14.5.html` — next planned cycle (candidates + open
    questions).
- **Press + OEM**:
  - `press.html` — brand assets, project story, contact, GPL
    disclaimer, "not affiliated with BMW AG".
  - `oem.html` — honest Beemuu vs ISTA comparison.
- **Per-category OG images**: 8 new 1200×630 PNGs (protocol,
  glossary, hardware, community, download, service, compare,
  verify). Wired to the relevant pages so social previews match the
  page category.
- **Atom feed** (`feed.xml`): 5 most recent releases, autodiscovered
  from the homepage.
- **404 page** (`404.html`): the custom page that nginx now serves
  for unknown paths (see PR for the Tier C nginx config change).

### Fixed — Tier A surface (CI workflow)

- **`ci.yml::test-rust` missing Tauri Linux system
  dependencies** (PR #199, Tier A, CI workflow): the
  `CI & Autonomous Merge` workflow's `test-rust` job ran
  `cargo test` on a bare `ubuntu-latest` runner that lacked
  Tauri's Linux system libraries (glib, gtk, webkit2gtk-4.1).
  The build failed in 20s with
  `Package glib-2.0 was not found in the pkg-config search
  path`. This blocked every PR because branch protection
  treats the duplicate `Rust Core Tests (src-tauri)` job
  names from `test.yml` and `ci.yml` as the same required
  status check. Mirrored the `apt-get install` step from
  `test.yml::rust` (lines 36-37) into `ci.yml::test-rust`.

### What this cycle does NOT ship

- ❌ No `transport/**` code changes. The K+DCAN / ENET/DoIP
  paths were not touched.
- ❌ No `protocol/**` code changes.
- ❌ No frontend changes (JS / HTML / CSS). The Diagnostic
  Story modal and the Secure Snapshot Share button wire
  into pre-existing `src/js/main.js` functions
  (`renderStory`, `doSecureShare`).
- ❌ No community data changes. The story knowledge base in
  `community/stories/{generic,n55}.toml` was loaded but not
  modified.
- ❌ No `git tag v0.14.4`. That's the Tier C release cut —
  the next step after the version-bump PR lands.

## [0.14.3] — 2026-07-30

> **Cycle status:** all five slices merged — #185 (decoders),
> #186 (profile entries), #187 (slice 3a backend),
> #188 (slice 4 harness extension + cycle closeout),
> #190 (slice 3b frontend rewire). Version surface bumped
> in the release-cut PR (this PR) to `0.14.3` across
> `package.json`, `src-tauri/Cargo.toml`,
> `src-tauri/tauri.conf.json`, and the README badge. The
> git tag + release publish + installer build are the next
> step (run locally via `git tag v0.14.3 && git push --tags`
> to trigger `.github/workflows/release.yml`).

### Added — Tier A surface (decoder catalog + community data + docs)

- **Three new decoders** (PR #185, Tier A): `u16_fiftieths`
  (`raw × 0.02`, for SAE J1979 fuel-rate L/h), `u32_be`
  (4-byte BE unsigned, for SAE J1979 engine-runtime seconds),
  and `u16_half` (`raw × 0.5`, for SAE J1979 fuel-rate g/s).
  All three follow the existing `src-tauri/src/data/live.rs`
  pattern: new `Decode` variant + `decode()` / `decode_from_str` /
  `decode_to_str` arms + 3–4 unit tests. Spec sections in
  `docs/DECODE_FUNCTIONS.md` §10–12. No new crate, no
  `byteorder` / `num-traits` / `binrw` — all three are 2-byte /
  4-byte BE shifts and divides.
- **N62 profile enrichment** (PR #186, Tier A): three new
  `[[profile.param]]` entries in `community/profiles/n62.toml`
  wired to the new decoders — `0x5E` engine fuel rate L/h,
  `0x5F` engine runtime s, `0x62` engine fuel rate g/s. Each
  carries the same `[needs verification, N62/E70 bench]` mark
  the v0.14.2 slice 1 entry uses; bench verification on the
  E70 X5 4.8i is the gating step per the slice 3 harness doc.
- **N62 / E70 harness-doc extension** (PR #188, slice 4, Tier A):
  `docs/validation/n62-real-car.md` Step 2 (cold readings),
  Step 3 (running readings), Step 4 (report template), and
  Step 5 (consequences) all extended for the three new PIDs.
  Critical-row paragraph covers the fuel-rate failure modes
  (~0 L/h = DME unsupported, > 100 L/h = wrong decoder scale).
  Cross-references updated to point at PRs #185 / #186 / #187
  and `docs/DECODE_FUNCTIONS.md` §10–12.

### Added — Tier B surface (protocol + Tauri command)

- **Per-PID NRC backend + frontend + remove-from-profile UI**
  (PRs #187 + #190, Tier B):
  - PR #187 (slice 3a, backend):
    - New `protocol::nrc_from_error` helper at
      `src-tauri/src/protocol/mod.rs` parses the canonical
      `service()` error string into a structured `(sid, nrc)`
      pair (case-insensitive hex, whitespace-tolerant).
      4 unit tests.
    - `read_live_data` return type splits into `LiveSweepResult {
      values, errors }` so a per-PID failure no longer short-circuits
      the whole sweep. `values` carries successful reads;
      `errors` carries per-PID `{ id, label, sid, nrc, error }`
      entries. The whole sweep still returns `Err(_)` for systemic
      problems (no transport, unknown profile, poisoned state lock).
    - New async Tauri command `remove_profile_pid` at
      `src-tauri/src/commands.rs:746` — removes the matching
      `LiveParam` from the in-memory profile registry, re-serialises
      via `live::profile_to_toml`, writes the updated TOML to
      `<community>/profiles/<id>.toml` via `tokio::fs::write`. Returns
      the written path. Async because of the file I/O; gated behind
      the `tauri-plugin-dialog` confirmation per
      `docs/CONTRIBUTING.md`'s write-path discipline.
    - `Cargo.toml`: `tokio = { ..., features = ["time", "fs"] }`
      (adds the `fs` feature to the existing tokio dep; no new
      crate enters the graph).
    - `lib.rs`: registers `commands::remove_profile_pid` in the
      `invoke_handler`.
  - PR #190 (slice 3b, frontend):
    - New `classifyNrc(err)` exported from `live_data_panel.js`
      buckets each `LiveError` into `unsupported` / `transient` /
      `unknown` using the structured `(sid, nrc)` fast path with
      a fallback to parsing `err.error` (the verbatim protocol
      error string) for legacy callers. 5 new tests in
      `live_data_panel.test.js` (20 tests total in that file).
    - `main.js::pollOnce` rewired to consume the new
      `LiveSweepResult { values, errors }` return shape. All three
      `read_live_data` call sites (Live Data tab `pollOnce`, Logging
      tab `buildLogParams`, Logging tab `logTick`) updated.
    - Per-PID dim UI: `.gauge-cell.dimmed` (opacity 0.45 + " (unsupported)"
      `::after` pseudo-element). One-click "Remove from profile"
      button calls `remove_profile_pid` via `invoke()`. New
      `#live-unsupported-count` panel-head badge shows the count
      of unsupported PIDs.
    - CSS additions: `.gauge-cell.dimmed`, `.pid-remove`,
      `.live-unsupported-count` in `src/css/app.css`.
    - `src/index.html`: `#live-unsupported-count` slot in the Live
      Data panel head, populated by pollOnce, hidden when zero.

  Tier B because the slice touches `src-tauri/src/protocol/**` and
  adds a new entry to `src-tauri/src/commands.rs`. The backend +
  frontend shipped together so the backend's new return shape and
  the frontend's consumer are consistent at the same tagged release.

### Notes on the version surface

This is the first entry to land in CHANGELOG since v0.14.0
(2026-07-25). **v0.14.1** (issue #161 — `window.confirm`
auto-dismiss + sim regenerate-on-identify, PRs #169 / #170)
and **v0.14.2** ("Live Data on the Bench", PRs #171 / #175 /
#176 / #177 / #178) closed via merges on 2026-07-27 and
2026-07-29 respectively but shipped without CHANGELOG entries
when they merged. **The gap has since been filled by the
v0.14.1 + v0.14.2 backfill PR** — see the entries above this
one. PR #188 (this v0.14.3 cycle's slice 4) deferred the
backfill to a separate housekeeping PR to keep the slice 4
scope tight.

**The README release badge stays at `v0.14.0`** until the
release-cut PR (Tier C) lands. CLAUDE.md golden rule #5 (the
"don't let the badge lie" rule) requires the badge to reflect
the most recent **fully shipped** release. v0.14.3's five
slices are all merged (`#185`, `#186`, `#187`, `#188`,
`#190`), but the release-cut PR — version bumps in
`Cargo.toml` + `tauri.conf.json`, git tag, release notes
publish, installer build — hasn't run. The badge bump + the
corresponding version-string bumps land in the release-cut PR.

The v0.14.3 release cut itself (git tag, release notes
publish, installer build) runs locally via
`git tag v0.14.3 && git push --tags`, which triggers
`.github/workflows/release.yml` and publishes a draft
release on GitHub.

## [0.13.0] — 2026-07-22

### Added
- Per-target KWP response deadline (v0.13.0, Tier B PR #153): every
  `kwp2000::send_receive` call now accepts a per-target deadline —
  **1 s default** (typical readFaults / readLiveData round-trips) and
  **3 s "slow"** for targets known to stall on the first frame (DME
  cold-boot, IKE long-form reads). Eliminates the 10 s hang the v0.12.0
  DTC-history work inherited from the legacy K+DCAN timer. The deadline
  is *hardware-aware*: it scales with the FTDI VCP latency-timer setting
  the operator chose at connect time, so a 1 ms latency timer doesn't
  pay a 3 s penalty on a 1 s target. Tier B because it touches
  `src-tauri/src/transport/**` and `src-tauri/src/protocol/**`.

### Changed
- Plan correction (v0.13.0 PR #151): the original "Real Reads, Real
  Long" cycle plan assumed a clean ISO-TP wire-up was a precondition.
  Re-scoped after PR #151 dropped that premise — the v0.13.0 deadline
  change ships without ISO-TP, and the multi-frame reassembly work
  moved to v0.14.0. Plan: `docs/v0.13.0_plan.md`. Docs only; no code
  change.

## [0.12.0] — 2026-07-21

### Added
- DTC history user-facing guide (v0.12.0 slice 6 PR #148): new
  `docs/user/dtc-history.md` walks the operator through *when* to
  enable DTC history recording, what the recurring-DTC callout means
  in practice, and how to read / query / clear the persisted log.
  Tier A docs; no Rust change.
- Recurring-DTC callout (v0.12.0 slice 5 PR #147): when a fault appears
  in the same module twice across two sessions, the fault table shows a
  small "recurring" badge with a tooltip pointing at the prior
  occurrence in the persisted history. Tier A frontend (`src/js/` +
  `src/css/`); reads the `dtc_history` table the Tier B commands below
  write into.
- DTC history commands — record / query / clear (v0.12.0 Tier B
  PR #144): three new Tauri commands (`record_dtc_read`,
  `query_dtc_history`, `clear_dtc_history`) backed by a SQLite table
  in the app data dir. Async (offload via `spawn_blocking` per the
  INVARIANT in CLAUDE.md). Tier B because they live in `commands.rs`
  (the Tauri command surface / threading boundary).
- DTC-history wire-through (v0.12.0 slice 4 PR #146): `read_faults`
  now optionally records each fault read into the history table behind
  a **Settings** toggle (default OFF — recording is opt-in so the
  history table doesn't silently grow on every read). Tier A frontend
  + Tier B backend glue (`commands.rs`).
- DTC history pure wrapper module + tests (v0.12.0 slice 3 PR #145):
  `src/js/dtc_history.js` exposes `recordRead`, `query`, `clear` as
  pure functions; 14 unit tests cover the row-shape contract, the
  recurrence detector, and the clear-after-archive flow. Tier A
  frontend.

### Fixed
- DTC history commands must be async (v0.12.0 follow-up): the v0.12.0
  Tier B PR #144 first shipped with sync command handlers, which would
  have blocked the webview on every history write. Converted to
  `async fn` + `spawn_blocking` before merge. Tier B fix in
  `commands.rs`.

### Changed
- Fault Memory cycle marked Released in ROADMAP (v0.12.0 PR #149):
  ROADMAP.md updates the v0.12.0 cycle row from "In progress" to
  "Released" now that all six slices and the follow-up async fix have
  shipped. Docs only.

## [0.11.0]

### Added
- Export charts as PNG (v0.11.0, Tier A frontend): new **Export PNG** button
  on the logging chart header and in the histogram modal. Both use Chart.js
  `toBase64Image()` → a browser-native anchor download (no Rust round-trip),
  so a logged trace or a channel distribution can be dropped straight into a
  forum post. Buttons enable only once a chart exists. ROADMAP "Ready to
  Claim" item.

## [0.10.0]

### Added
- Plan verification badge (v0.10.0): the walkthrough panel now reads each
  plan's `meta.verified` marker and shows a badge in the panel header —
  **NEEDS VERIFICATION** (amber) for the default `"needs verification"`
  state, **✓ Verified** (green) once a real-car harness walk upgrades it
  (`docs/validation/testplans.md`). Completes the data contract PR #5
  installed (the TOML marker now flows end-to-end: `community/testplans/*.toml`
  → `testplans.rs` loader → `get_test_plan` → `main.js`). Rust change is
  additive (`verified: Option<String>` on `PlanMeta` + `TestPlan`, threaded
  through `to_plan`; legacy plans with no marker render no badge). Tier A
  frontend + data-loader; no protected-path change.

## [0.9.0]

### Added
- Guided fault-finding validation harness + contribution path (v0.9.0
  PR #5): new `docs/validation/testplans.md` — a real-car harness that
  upgrades a plan from `verified = "needs verification"` (the default on
  every plan in `community/testplans/`) to `"verified"`, mirroring
  `service-functions.md` (pre-flight, walk-the-plan, what a negative
  result looks like, report-filing). `community/testplans/README.md`
  gains the plan-level verification-label contract and CONTRIBUTING.md
  gains the plan axis (rule 4) alongside the existing read/write label
  axes. All 11 PR #2 corpus plans now ship `verified =
  "needs verification"` — the TOML marker the walkthrough UI will read
  to surface a NEEDS VERIFICATION badge (UI rendering is a small
  follow-up; the marker is the data contract). The marker lives in TOML
  (not a comment) and is ignored by the loader (no
  `deny_unknown_fields`), so the branch-integrity gate stays green. Tier
  A docs; no Rust/Python change beyond the data marker. Completes the
  v0.9.0 "Guided Fault Finding" cycle.
- Guided fault-finding walkthrough UI (v0.9.0 PR #4): new `src/js/main.js`
  mounts a branching test-plan walkthrough panel (`#walkthrough-panel`)
  beside the opinion / schematics panels in the DTC-detail composition, and
  `src/css/app.css` adds the panel styles. Clicking a DTC loads its plan via
  the read-only `get_test_plan` command (v0.9.0 PR #3) and renders step
  cards with Pass / Fail / Continue branch buttons, freeze-frame context
  seeding on the entry step, a breadcrumb of the path taken, and a
  conclusion card. Branch traversal is a pure, unit-tested reducer
  (`src/js/testplan_walk.js`, `src/js/test/testplan_walk.test.cjs` — 12
  tests). Tier A frontend; no Rust/Python change.
- Guided fault-finding plan loader + query command (v0.9.0 PR #3): new
  `src-tauri/src/testplans.rs` loads `community/testplans/*.toml` into an
  in-memory KB at startup and exposes a read-only `get_test_plan(dtc_code)`
  Tauri command returning the plan graph (`Option<TestPlan>`). Branch
  traversal is intentionally left to the frontend — the command is a
  stateless lookup, same class as `get_opinions`, and is added to the
  `async_commands` sync allowlist with justification. Loader handles a
  missing dir, skips malformed/suppressed files, and is case-insensitive.
  **Tier B** (touches `commands.rs` / `lib.rs`) — hand-merged after review.
- Guided fault-finding first corpus (v0.9.0 PR #2): 11 grounded test
  plans under `community/testplans/` — 2A82 (VANOS solenoid), 29E0 / 29E1
  / 29E2 (fuel rail pressure family), 30FF (boost leak), 29CC (misfire),
  2E81 / 2E82 (electric coolant pump), P0171 (lean, with N55/S55 fuel-trim
  DIDs 0x1201/0x1202), P0300 (misfire), and P0420 (catalyst — diagnose
  only; readiness-monitor masking is a permanent exclusion). Every step
  cites an in-repo source (opinions / oracle / stories / dim01 / dim04 /
  TECH_SPECS). `docs/testplans.md` gains the corpus table and a
  known-missing list (2A99, wastegate-branch 30FF, P0011/P0014, P0087,
  P0128, VANOS timing family) rather than faking ungrounded plans. All 11
  pass the branch-integrity gate; data-only, no code change.
- Guided fault-finding test-plan schema (v0.9.0 PR #1): new
  `community/testplans/<dtc>.toml` `[[step]]` format for branching
  diagnostic walkthroughs (measurement verbs, `on_pass`/`on_fail`/`next`
  branches, conclusion nodes, mandatory per-step in-repo `source`
  citation). Contract documented in `docs/testplans.md` with an
  author-facing quick reference in `community/testplans/README.md`. The
  schema is enforced by a new CI gate
  (`community::tests::shipped_testplans_branch_integrity`): branch
  targets must resolve, a conclusion must be reachable from `s1`, every
  step must be sourced, `dtc` must match the filename, and the reachable
  graph must be acyclic. A `[meta.suppressed]` placeholder is allowed for
  known-missing DTCs. No production code changed — the loader lands in a
  later slice.
- Oracle JSON parse gate (v0.9.0 PR #1): every `community/oracle/*.json`
  is now CI-gated (`community::tests::shipped_oracle_json_parses`). Before
  this, a broken Oracle file failed only as a startup `eprintln!` that CI
  never saw — the JSON analogue of the v0.8.0 TOML parse gate.

- Dark/light theme toggle completed: the whole app chrome now re-skins
  through CSS variables (`src/css/app.css`) instead of the previous
  per-panel dark overrides, and the choice persists across restarts via
  the new workspace file. (v0.7.0 PR #2)
- Workspace layout persistence: theme, app mode, active tab, connection
  panel choices, live/log profile selectors, traffic auto-refresh, and
  the per-profile log channel enabled map save to
  `~/beeemuu-exports/workspace.json` (debounced writes via the new
  `read_export_text` command); the pre-v0.7.0 `localStorage` settings
  migrate automatically on first boot. (v0.7.0 PR #2)
- Per-profile gauge colour schemes: an optional `[profile.theme]` TOML
  table recolours the live-data gauges (nine keys, per-key fallback to
  the cockpit palette, colours CSS-validated in the UI). Reference block
  in `community/profiles/b58.toml`; syntax documented in
  `docs/DECODE_FUNCTIONS.md` § 9. (v0.7.0 PR #2)
- N20/N26 engine profile (`community/profiles/n20.toml`): F-series 2.0
  turbo I4 (MEVD17.2) coverage — 10 emissions-mandated OBD-II PIDs plus
  the F-series OBDb-sourced UDS DID set mirrored from `b58.toml`, every
  UDS entry marked `[needs verification]` pending real-car validation.
  (v0.7.0 PR #3)
- S55 engine profile (`community/profiles/s55.toml`): F80/F82/F87 M
  twin-turbo I6 — N55-derived DID set with raised rpm/HPFP display
  ranges, N55-family fuel-trim DIDs, an unverified oil-temp placeholder
  (track-use criticality noted), and a BMW M tricolor `[profile.theme]`
  block — the first shipping consumer of per-profile gauge themes.
  (v0.7.0 PR #3)
- Community data rescue: five shipped data files were truncated and
  silently dead — `community/dtc_texts.toml` (cut mid-string; 0 overlay
  entries loaded), `community/freeze_schemas.toml` (cut at `bias =`),
  and the `n52`/`n54`/`n62` profiles (cut mid-parameter). The DTC
  corpus is rebuilt from in-repo sources (`backend/seed_bmw_dim01.py`,
  `backend/seed_bmw.py`, `community/opinions/`) to 208 overlay entries;
  the profiles' tails are restored to the canonical emissions-mandated
  OBD-II block; freeze-frame values restored from `community/README.md`'s
  own example. (v0.8.0 PR #1)
- Community TOML parse gate: new cargo unit tests parse every shipped
  `community/**/*.toml` (syntax) plus the `dtc_texts.toml` corpus shape,
  so a broken data file now fails CI's `cargo test` job instead of
  loading silently. (v0.8.0 PR #1)
- `CONTRIBUTING.md` completed: the file ended mid-table; the promised
  Parameter Explorer, code-contribution, and development-setup sections
  now exist, and the verification-label conventions
  (`[needs verification]`, `[UNVERIFIED placeholder]`, how labels come
  off via `docs/validation/` harness reports) are documented.
  (v0.8.0 PR #1)
- B48/B46 engine profile (`community/profiles/b48.toml`): F/G-series
  2.0 turbo modular I4 (G20 330i, G01 X3 30i era) — 10 emissions-
  mandated OBD-II PIDs plus the mirrored OBDb-sourced F-series UDS DID
  set, G-series DID applicability uncertainty documented, every UDS
  entry marked `[needs verification]`. (v0.8.0 PR #3)
- S58 engine profile (`community/profiles/s58.toml`): G80/G82/F97/F98
  M twin-turbo I6 (M-tuned B58 architecture) — mirrored DID set with
  7500 rpm and 30.0 MPa display ranges, unverified oil-temp placeholder
  (track criticality), fuel trims deliberately omitted per the
  TECH_SPECS-documents-N55-only precedent, and the BMW M tricolor
  `[profile.theme]` block. (v0.8.0 PR #3)
- N57 engine profile (`community/profiles/n57.toml`): first diesel
  profile — F-series 3.0 turbo diesel I6 (DDE). Petrol-mirrored UDS
  DIDs minus knock detection (no knock sensors on compression
  ignition), no fuel trims (petrol-only concept), 250 MPa rail display
  range, plus eight diesel enum DIDs (DPF state/regen/ash/soot, glow
  plugs, NOx, exhaust temp, EGR cooler) sourced from the
  `docs/DECODE_FUNCTIONS.md` § 8 DDE candidate catalog; everything UDS
  marked `[needs verification]`. (v0.8.0 PR #3)
- ECU scan table broadened 12 → 17 (`src-tauri/src/data/ecus.rs`): five
  F/G-series addresses grounded in the OBDb-verified DIDs of
  `research/bmw_diag_dim04_uds_dids.md` — `0x19` (DSC chassis variant on
  5-Series/X5, did:DBE4/DB32/DFE7), `0x56` (body domain, did:DCDD),
  `0x63` (current gear, did:D031; exact module unconfirmed), `0x0D`
  (secondary cluster target, did:D240), `0x07` (HV battery, PHEV/BEV
  only). The existing 12 entries gained honest provenance comments (OBDb
  + sim / sim + DTC corpus / standard E-series assignment with no
  in-repo confirmation yet). The simulator answers the new addresses,
  and `docs/hardware/addressing-model.md` documents why the one-byte
  scan-table model holds on both K+DCAN and ENET (HSFZ one-byte src/tgt
  routed by the ZGW; DoIP u16 logical addresses appear only in vehicle
  discovery). (v0.8.0 PR #4)
- Service-function verification status + `[UNVERIFIED]` write gating
  (`src-tauri/src/data/service_functions.rs`): `ServiceFunction` gains a
  `verified` flag; all six existing routines are marked
  `verified: false` after an audit found their routine IDs
  (`0x0F01`–`0x0F04`, `0x0A01`/`0x0A02`) are v0.4.0 simulator
  placeholders with no in-repo chassis grounding (BMW routine IDs are
  security-sensitive/unpublished per `research/bmw_diag_landscape.md`).
  No new routine IDs ship — none are grounded in-repo; DPF regen,
  throttle/Valvetronic adaptation, steering-angle calibration, EGS
  adaptation reset, and EMF service mode are documented as
  known-missing instead. The Service Functions UI renders an
  `UNVERIFIED` tag and prepends a "routine ID not chassis-validated"
  preamble to the run confirmation; new harness doc
  `docs/validation/service-functions.md` (referenced from
  `CONTRIBUTING.md`) is the label-removal path. A new contract test
  locks every shipped entry to `verified == false` until a harness
  report lands. (v0.8.0 PR #2)

## [0.6.0] - 2026-07-16

### Added
- OBD-II mode 01 PID auto-discovery
  ([`src-tauri/src/protocol/mod.rs`](src-tauri/src/protocol/mod.rs))
  — new `scan_obd2_pids()` helper walks SAE J1979 PID bitmasks
  (`0x00 / 0x20 / 0x40 / 0x60`) to report which standard OBD-II
  PIDs a single ECU actually responds to. Stop-at-first-zero
  bitmask byte keeps the scan bounded; bitmask PIDs that fail
  their own probe are skipped per-block. Wrapped in a new
  Tauri command `list_supported_pids(address)` and surfaced
  on the Vehicle Test tab via a "Scan OBD-II PIDs" button
  that renders the supported set as a grid of monospace
  hex cells. Five new unit tests in `protocol/mod.rs` cover
  the bitmask decoder (MSB-first), the multi-block walk, the
  empty bitmask case, and the "bitmask says yes but data read
  fails" drop-on-mismatch case. See PR #81.
- Real-car injector-time validation harness
  ([`docs/validation/injector-validation.md`](docs/validation/injector-validation.md))
  — checklist for an F/G-series owner to validate the
  `inj_time` channel (DID `0x4363`, target `0x12`) on B58 /
  N55 by comparing against ISTA at three steady-state points
  (idle / cruise / WOT). Mirrors the v0.5.0 PR #72 u8_enum
  harness shape. Doc-only.
- The `inj_time` labels in
  [`community/profiles/b58.toml`](community/profiles/b58.toml)
  and [`community/profiles/n55.toml`](community/profiles/n55.toml)
  now carry the `[needs verification, UDS only]` marker,
  matching the v0.5.0 PR #73 discipline for the example
  enum / fuel-trim DIDs. The DID, decode, and range are
  unchanged — only the label is updated.
- Unknown U8Enum bytes now render as `0xNN ?` in the gauge instead of
  silently disappearing. `live::decode_enum_string_or_unknown` is the
  wider-stance sibling of `decode_enum_string` — `commands::read_live_data`
  uses it so every sample produces a `LiveValue`. Five new unit tests.
  See PR #66.
- `npm run test:js` runs the new `node --test` harness covering
  `src/js/live_format.js` (the pure helpers shared between
  `Gauge.set` and `buildLogCsv`). Eight tests lock down CSV cell
  formatting (enum labels as quoted JSON strings, numeric `toFixed(2)`,
  missing-point handling) and gauge numeric-clamp semantics. Add
  a new helper in `live_format.js`? Add a test alongside it.
  See PR #65.
- Frontend wiring for `LiveValue.text` enum labels (backend in PR #60).
  `Gauge.set(value, label?)` enters text mode when a label is present:
  dial, ticks, and needle are hidden and the label is drawn centred with
  the unit underneath. `pollOnce` and `logTick` pass `v.text` through,
  and `buildLogCsv` emits the label in a quoted CSV cell so a gear-change
  log exports `0.00,"P/N",0.00,"1",...` rather than `0.00,0,0.00,1,...`.
  Numeric gauges and the chart are unchanged for non-enum params.
- Schematics deploy: `ops/beemuu.com.conf` now serves `/static/schematics/`
  from disk (CC0 wiring-diagram SVGs), and `docs/deploy-schematics.md`
  carries the end-to-end rollout runbook. See PR #51.
- v0.4.0 roadmap scope published in `ROADMAP.md` ("Tuner Friendly"
  cycle) with explicit Ready / Needs-research / Deferred split.
- `docs/v0.4.0_first_pr.md` — spec for the v0.4.0 first PR (README
  drift cleanup).
- `u8_enum` decoder + per-parameter enum-map pipeline
  (`src-tauri/src/data/live.rs`, `src-tauri/src/community.rs`,
  `src-tauri/src/commands.rs`). Resolves raw bytes against a
  `HashMap<u8, String>` loaded from TOML and emits the label as
  `LiveValue.text`. Six new unit tests + three TOML-loader tests.
- Example enum DIDs in `community/profiles/b58.toml` and
  `community/profiles/n55.toml`: `gear` (DA0A), `engine_state`
  (4004), `knock_detect` (401F). Marked `[needs verification]`
  pending real-car validation.
- `docs/hardware/enet-cable-pinout.md` — DIY OBD-II → RJ45 wiring
  for the $5 AliExpress BMW ENET cable (F/G-series). Covers the
  pinout (3, 11, 12, 13 ↔ 1, 2, 3, 6), the 100 Ω termination
  resistor, verification steps, and the Rx/Tx-crossed failure mode
  that bites the unwary.
- `docs/hardware/README.md` — index page for the new hardware-docs
  directory.
- Histogram viewer for the Logging tab (`src/js/histogram.js` +
  13 unit tests + modal UI). Operates over the existing
  `LogSession` data; reuses Chart.js bar mode (no new deps).
  Channels whose `LiveValue.text` is set (u8_enum from PR #60)
  are filtered out — no numeric distribution to plot.
- `ServiceFunction` extended to carry `routines: &[ModuleRoutine]`
  instead of a single `(target, routine)` pair
  (`src-tauri/src/data/service_functions.rs`, 8 new unit tests).
  The existing six entries stay byte-identical in shape; the new
  `ModuleRoutine[]` field is the path forward for adding
  chassis-validated EGS / DSC CBS resets without inventing
  routine IDs. The Rust `run_service_function` command takes a
  `module_index: Option<usize>` (defaults to 0 for back-compat);
  the UI now renders one row per (service × module) and sends
  the index on invocation.

### Changed
- README § "What's coming" rewritten so shipped features (Diagnostic
  Story, Community Oracle, DTC Opinions, VPS backend) are labelled
  ✅ shipped and removed from the "coming" list; aspirational items
  (Adaptive Drift Tracker, Tuning Fingerprint Detector) are moved to
  a clearly-labelled "ideas being explored, not on the roadmap"
  subsection. No code change.
- `docs/DECODE_FUNCTIONS.md` § 8 updated with the actual user-facing
  TOML syntax (`enum = { "0" = "P/N", ... }`, quoted decimal byte
  keys) and the `parse_enum_map` rationale.

### Fixed
- N/A

### Security
- N/A

## [0.5.0] — 2026-07-15

The "Ground Truth" release. v0.5.0 closes the loop on the v0.3/v0.4
decoder + UI plumbing by validating the abstractions against real
hardware, surfacing the small tuner-facing features that depend
on real-car evidence, and providing the harness for F/G-series
owners to fill in the remaining `[needs verification]` markers.

### Added

- **Real-car u8_enum validation harness**
  ([`docs/validation/u8_enum-validation.md`](docs/validation/u8_enum-validation.md))
  — checklist for an F/G-series owner with an ENET adapter to
  validate the example enum DIDs (`gear` / `engine_state` /
  `knock_detect`) shipped in v0.4 (PR #60). Three identical-shape
  per-DID tables with pass/fail checkboxes, expected-state
  mappings, and results-submission instructions. Doc-only.
  See PR #72.
- **N55 fuel-trim / adaptation DIDs** in
  [`community/profiles/n55.toml`](community/profiles/n55.toml) —
  long-term fuel trim (`DID 0x1201`) and idle adaptation
  (`DID 0x1202`) on N55 F/G-series DME. Both marked
  `[needs verification]` until an F/G-series owner validates
  them via the same harness pattern as the u8_enum DIDs. The
  DIDs are sourced from the project's own
  [`TECH_SPECS.md`](TECH_SPECS.md) (Adaptation Drift
  Tracker section), not forum threads. Existing `s16_div100`
  decoder covers the percent scaling; no new decoder needed.
  B58 fuel-trim deliberately deferred (no documented source).
  See PR #73.
- **Severity-class styling for enum channels** — pure JS / CSS
  helper `severityClass(text)` in
  [`src/js/live_format.js`](src/js/live_format.js) maps enum-style
  labels to `severity-critical` / `severity-warning` / `""` CSS
  classes. Case-insensitive exact match. The gauge grid and
  the Logging-tab channel list both apply the class so
  `knock_detect`'s "Moderate" or "Severe" states get visible
  amber / red emphasis. 14 unit tests (8 prior + 6 new).
  See PR #74.
- **`v0.5.0_first_pr.md`** — spec doc for the v0.5.0 cycle's
  first PR (the validation harness). Mirrors
  `v0.4.0_first_pr.md`'s shape.

## [0.4.0] — 2026-07-15

The "Tuner Friendly" release. v0.4.0 closes the loop on the v0.3.0
decoder foundation — the one decoder that genuinely didn't ship
(`u8_enum`) is now in, the user-facing docs stop contradicting the
shipped state, and a histogram viewer gives the first client-side
"tuner" affordance on top of the existing Logging tab.

### Added

- **`u8_enum` decoder + per-parameter enum-map pipeline**
  ([`src-tauri/src/data/live.rs`](src-tauri/src/data/live.rs),
  [`src-tauri/src/community.rs`](src-tauri/src/community.rs)) — new
  `Decode::U8Enum` variant + `decode_enum_string(...)` helper maps
  raw bytes to human-readable labels via an inline
  `enum = { "0" = "P/N", ... }` TOML map per parameter (quoted
  decimal byte keys). `LiveValue.text` carries the resolved label
  across the IPC boundary; gauges and CSV export render it
  (PRs #60, #64, #65). Unknown bytes get a `"0xNN ?"` sentinel
  rather than silently dropping the sample (PR #66).
- **Example enum DIDs** in
  [`community/profiles/b58.toml`](community/profiles/b58.toml) and
  [`community/profiles/n55.toml`](community/profiles/n55.toml):
  `gear` (DA0A), `engine_state` (4004), `knock_detect` (401F).
  Marked `[needs verification]` pending real-car validation.
- **Histogram viewer for the Logging tab** (PR #62) — pure
  client-side over the existing `LogSession` data; modal with
  channel + bin-count dropdowns, Chart.js bar mode (no new deps),
  and a stats readout (n / min / max / mean / median / std dev).
  Enum channels are filtered out. 13 unit tests in
  [`src/js/histogram.js`](src/js/histogram.js).
- **`ServiceFunction` multi-module data shape** (PR #67) —
  `ServiceFunction` now carries `routines: &[ModuleRoutine]`
  instead of a single `(target, routine)` pair. The existing six
  entries stay byte-identical in shape; `run_service_function`
  takes `module_index: Option<usize>` (defaults to 0). EGS / DSC
  routine IDs deliberately not invented — wrong IDs can brick NV
  memory; the shape defers to real-car validation. 8 new unit
  tests.
- **DIY ENET cable pinout doc** (PR #61) —
  [`docs/hardware/enet-cable-pinout.md`](docs/hardware/enet-cable-pinout.md)
  covers OBD-II → RJ45 wiring (pins 3/11/12/13 ↔ 1/2/3/6), the
  100 Ω termination resistor, and the Rx/Tx-crossed failure mode
  for the $5 AliExpress F/G-series cable. Plus
  [`docs/hardware/README.md`](docs/hardware/README.md) index.
- **`docs/v0.4.0_first_pr.md`** — written record of why PR #59
  was the v0.4.0 cycle starter (the README / roadmap drift
  cleanup).

### Changed

- README "What's coming" rewritten so shipped features are
  labelled ✅ shipped and aspirational items are clearly labelled
  "ideas being explored, not on the roadmap" (PR #59).
- [`ROADMAP.md`](ROADMAP.md) rewritten with explicit Ready /
  Needs-research / Deferred-to-v0.5.0+ splits per cycle (PR #59).
- [`docs/DECODE_FUNCTIONS.md`](docs/DECODE_FUNCTIONS.md) § 8
  documents the canonical `u8_enum` TOML syntax and the
  `parse_enum_map` rationale.

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
