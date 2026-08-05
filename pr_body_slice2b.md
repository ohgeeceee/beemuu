## Summary

Tier A, frontend-only PR. Lands the K+DCAN data source wiring module
(`src/js/live_data_source_wiring.js`) that the Live Gauges panel will
use to read real DID data from the K+DCAN cable via `read_live_data`.

This is **slice 2b** of the v0.15.0 cycle. Slices 1 (`live_data_bridge.js`)
+ 2a (`live_kdcan_source.js`) merged in PR #229. Slice 2b is the
wiring layer that ties the bridge + K+DCAN source adapter into a shape
`main.js` can call. Slice 2c (the caller integration in `main.js` +
source swap in `live_gauges.js`) is the next PR.

## What this PR adds

- `src/js/live_data_source_wiring.js` (new, 94 LOC): the
  `initKdcanDataSource({ invoke, log })` factory. Creates the
  DID-projection bridge + K+DCAN source adapter, exposes
  `startPolling(intervalMs)` / `stopPolling()` / `reset()`, and
  getter helpers `getKdcanSource()` / `getBridge()` for `live_gauges.js`
  to wire the source into the gauges controller.

- `module.exports` + `window.beeemuuKdcanDataSource` dual export,
  matching the project's existing pattern (`live_data_bridge.js`,
  `live_kdcan_source.js`).

## What this PR does NOT do

- ❌ No `main.js` caller integration. `initKdcanDataSource()` is
  exported but not called yet. That wiring lands in slice 2c.
- ❌ No `live_gauges.js` source swap (sim → kdcan). That lands in
  slice 2c.
- ❌ No CSS changes. The data-source indicator (badge showing
  "sim" vs "K+DCAN") lands in slice 2c.
- ❌ No new Tauri commands. Reuses the existing `read_live_data`
  command added in v0.14.2 (PR #175).
- ❌ No backend / `transport/**` / `protocol/**` / `commands.rs`
  changes. Pure frontend, ~95 LOC.

## Verification

- `node --check src/js/live_data_source_wiring.js` — passes (no syntax
  errors).
- `git diff --cached --stat` — 1 file, +94 insertions.
- No new test file in this slice. The module is thin glue between
  the bridge (`live_data_bridge.js`, 20 unit tests in PR #229) and
  the source adapter (`live_kdcan_source.js`, 6 unit tests + 1 skip
  in PR #229). End-to-end behavior is verified in slice 2c's tests.
- No protected-path touches (no `transport/**`, no `protocol/**`,
  no `commands.rs`, no `Cargo.toml` changes). Pure `src/js/`.

## Tier

**Tier A — no human review required.** Pure frontend module under
`src/`, no `src-tauri/src/**` touches, no `community/**` changes,
no CI workflow changes. Per `CLAUDE.md` golden rule #1, the
auto-merge bot will merge this PR once CI is green.

## Cycle context

v0.15.0 "Live Gauges from the Bench" — see
[`docs/v0.15.0_plan.md`](../tree/main/docs/v0.15.0_plan.md) for the
full plan. The cycle's spine: route the existing `read_live_data`
UDS path through to the v0.14.0 Live Gauges panel, so the panel
shows real data on the K+DCAN cable without needing an OBDLink SX.

## Author note

Commit authored with `ohgeeceee@users.noreply.github.com` to bypass
GH007 (private-email push block). Content unchanged.