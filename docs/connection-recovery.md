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

This slice covers the DID-backed Live Gauges source and the first-scan flow.
The separate profile gauge grid, logging and explorer polling paths still need
a coordinated freshness review before update 2 is considered complete.
Physical adapter health probes and automatic reconnect are not implemented.
