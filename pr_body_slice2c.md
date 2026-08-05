## Summary

Tier A, frontend-only PR. Wires the K+DCAN data source into main.js's
existing `read_live_data` polling loop and flips the Live Gauges
panel from the simulator mirror to the bridge-backed K+DCAN source.

This is **slice 2c** of the v0.15.0 cycle. Slice 2b (PR #234)
shipped the wiring module; this slice actually wires it in. After
this lands, an E90 / E60 / E70 owner with the $15 K+DCAN cable will
see real RPM, coolant, oil temp, vehicle speed, battery voltage,
and throttle values in the Live Gauges panel — without needing the
OBDLink SX.

## What this PR adds

- `src/index.html` — loads `live_data_bridge.js` +
  `live_kdcan_source.js` + `live_data_source_wiring.js` BEFORE
  `live_gauges.js` so the bridge factories exist when the panel
  auto-mounts.

- `src/js/main.js` — at startup, calls
  `window.beeemuuKdcanDataSource.initKdcanDataSource({invoke, log})`
  and pushes the resulting kdcan source into the Live Gauges
  controller via `window.beeemuuLiveGauges.controller.setSource()`.
  In `pollOnce()`, after each successful `read_live_data` invoke,
  feeds `(values, errors)` into `kdcanDataSource.applySweep()` so
  the bridge cache stays current.

- `src/js/live_gauges.js` — new `setSource(newSource)` method on
  the controller. Stops the old source if running, replaces via
  a `sourceHolder` indirection (the destructured `source` from
  options is a const binding, so we wrap it in a mutable holder),
  starts the new one if the controller was ticking. Stashes the
  controller on `window.beeemuuLiveGauges.controller` so main.js
  can grab it after initKdcanDataSource runs.

## Refactor of slice 2b

- `src/js/live_data_source_wiring.js` — slice 2b's module had an
  internal `setInterval` that would have double-polled
  `read_live_data` (once from main.js's existing loop, once from
  the wiring module). Refactored to a passive consumer — main.js
  owns the timer; the wiring module just transforms each
  `LiveSweepResult` into a bridge cache update. New API:
  `{ applySweep, start, stop, reset, getKdcanSource, getBridge }`.
  `start()`/`stop()` now only mark the source running (FPS
  tracking), they don't spawn a timer.

## Tests

- `src/js/live_data_source_wiring.test.js` (new, 202 LOC, 10 tests):
  module surface, initKdcanDataSource fallback (no modules
  loaded), init with modules loaded, `applySweep` with/without
  running source, null handling, lifecycle (start/stop/reset
  idempotency, peak reset). `node --test` passes 10/10. The
  `after()` hook clears tracked controllers so `node --test`
  exits cleanly on Windows (FPS-timer teardown hang workaround,
  matches the v0.14.0 / v0.14.2 / v0.14.5 `live_can_source.test.js`
  pattern).

- `src/js/live_gauges.test.js` (+74 LOC, +4 tests for `setSource`):
  replace when stopped (no auto-restart), replace when running
  (stops old, starts new), `setSource(null)` detach, `setSource`
  on the controller surface. Full suite: **14/14 pass** (10
  existing + 4 new).

## What this PR does NOT do

- ❌ No new Tauri commands. Reuses the existing `read_live_data`
  command added in v0.14.2 (PR #175).
- ❌ No backend / `transport/**` / `protocol/**` / `commands.rs` /
  `Cargo.toml` changes. Pure frontend (~430 LOC including tests).
- ❌ No CSS changes. The data-source indicator (badge showing
  "sim" vs "K+DCAN") is a future polish item — the current
  panel header FPS counter is the user-visible signal.

## Tier

**Tier A — no human review required.** Pure frontend module under
`src/`, no `src-tauri/src/**` touches, no `community/**` changes,
no CI workflow changes. Per `CLAUDE.md` golden rule #1, the
auto-merge bot will merge this PR once CI is green.

## Cycle context

v0.15.0 "Live Gauges from the Bench" — see
[`docs/v0.15.0_plan.md`](../tree/main/docs/v0.15.0_plan.md) for the
full plan. The cycle's user-facing win: connect the existing
`read_live_data` UDS path to the v0.14.0 Live Gauges panel so it
shows **real data on the K+DCAN cable**, without the OBDLink SX
acquisition the v0.14.0 Tier B was waiting for.

Slices shipped so far: #228 (cycle plan), #229 (slice 1 + 2a),
#234 (slice 2b), **this PR (slice 2c)**. Cycle is code-side closed
once this lands — the Tier C release cut (version bumps + tag +
`release.yml` + landing-page deploy) is the next PR.

## Author note

Commit authored with `ohgeeceee@users.noreply.github.com` to bypass
GH007 (private-email push block). Content unchanged.