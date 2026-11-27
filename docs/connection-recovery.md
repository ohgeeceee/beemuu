# Connection recovery — first implementation slice

The Connect button is disabled while a connect/disconnect request is pending.
The adapter selector stays locked during an active connection. A K+DCAN
connection with no selected port is rejected before invoking the backend.
Failed connections show cable-specific recovery in the First BMW scan guide;
raw errors remain in the status log. A disconnect error clears the local
session but explicitly leaves transport closure unconfirmed.

## Live Gauges freshness

The DID-backed Live Gauges source tracks the timestamp of each successful
numeric or enum reading independently. An explicit parameter error marks that
channel stale immediately; otherwise a channel becomes stale at five seconds.
This is a presentation threshold, not a change to transport timeouts or polling.
The dial shows Stale, Waiting, Stopped or No data instead of presenting a cached
number as current. Stale enum labels are removed from the status line.

Profile changes, connection changes and listener restarts clear cached readings
and peaks. The existing live-data polling path allows one request at a time and
discards responses from an earlier profile/session or a stopped poll cycle.
No automatic reconnection or replay of diagnostic operations is introduced.

## Verification and remaining work

`scripts/test-connection-recovery.cjs` exercises the shipping app shell with a
mocked Tauri boundary: duplicate clicks, failure/retry, missing ports,
disconnect errors, late read responses, canvas stale states and recovery.
Unit tests exercise per-channel age, errors, labels, reset and peak behavior.
This does not validate cable hardware or certify a chassis/ECU combination.

## Second slice — profile gauge grid freshness (2026-11-27)

The profile gauge grid on the Live Data tab (`main.js::pollOnce`) now applies
the same freshness semantics as the DID-backed Live Gauges source. A pure
tracker (`src/js/live_freshness.js`, dual-exported as
`window.beeemuuLiveFreshness`) records the last successful read and the last
explicit per-PID error per channel, plus whether the sweep loop is running.
The gauge cell greys and its freshness line says `waiting for first read`,
`stale — last read N s ago`, `stale — read rejected`, or `polling stopped`
instead of presenting a cached number as current. `stopPolling()` — user
toggle, systemic sweep failure, or disconnect — marks every channel stopped
immediately. Profile changes and connect/disconnect reset the tracker. The
five-second age threshold is a presentation choice, unchanged from the first
slice; transport timeouts and polling are untouched.

The same slice fixed two load-order defects the wiring guard now pins: the
About modal still showed `v0.1.0` and the `ohgeeceee/beeemuu` repo spelling,
and — more seriously — `live_data_panel.js` was never loaded by
`index.html`, so `startPolling()` dereferenced an undefined
`window.beeemuuLiveDataPanel` in the shipping shell while the module's unit
tests passed under `require()`. Loading it exposed a second latent defect: a
top-level `const api` collision with `workspace_state.js` across the shared
classic-script scope, so both `live_data_panel.js` and the new
`live_freshness.js` use the root/factory IIFE pattern. The new
`src/js/test/script_globals.test.cjs` wiring test fails on any
`window.beeemuu*` global `main.js` dereferences that no loaded script
provides, and the previously unrun `scripts/check-script-collisions.cjs`
guard is now a CI step in `test.yml`.

## Review findings — explorer watch and logging paths

- **Parameter explorer watch** (`watchOnce`, 300 ms): stops on the first
  error and the byte heatmap renders accumulated samples with a sample-count
  header — historical by construction, so no freshness gap. Acceptable as-is.
- **Logging** (`logTick`, 250 ms): stops on sweep error; every recorded point
  carries its own timestamp and the recording pauses visibly. Recorded data
  is historical by design, so no freshness gap. Acceptable as-is.

Physical adapter health probes and automatic reconnect remain unimplemented,
and real-cable recovery behavior still needs a hardware pass before update 2
closes.
