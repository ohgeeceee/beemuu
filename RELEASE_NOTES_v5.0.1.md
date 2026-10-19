# BeeEmUu v5.0.1 — Connection Recovery

This patch adds adapter-specific connection recovery instructions, prevents
duplicate connection attempts and rejects K+DCAN connections without a selected
port. A disconnect failure clears the local session and explicitly reports that
transport closure could not be confirmed.

The DID-backed Live Gauges panel marks failed readings stale immediately and
ages other readings after five seconds. Profile/session changes and listener
restarts clear cached readings. Late responses from previous sessions or
profiles are ignored, and the live polling loop avoids overlapping requests.

The v5 baseline documentation now distinguishes implemented analysis modules
from installed-plugin host access, which still needs integration. See
`docs/connection-recovery.md` for this slice's boundaries.

## Validation

The implementation passed 1,136 JavaScript tests (one existing skip), 275 Python
tests and 33 subtests, both Rust CI test workflows, browser recovery and plugin
isolation tests, and theme checks. Desktop and narrow-window recovery states
were inspected. Browser tests use a mocked Tauri connection; real-cable/chassis
validation remains outstanding. The profile gauge grid, logger and explorer
freshness review is separate work.

## Install and recovery

Download the installer for your operating system from this release's Assets.
Close Beemuu and disconnect from the vehicle before upgrading. Preserve exported
logs, snapshots and plugin packages before replacing an installation.

No database migration, ECU-write functionality or automatic reconnection is
added by this patch. To revert, close the app and reinstall your previously
used installer. Retain the previous installer until this version is verified
in your environment. Windows and Linux packages are the configured targets;
macOS installers are not provided by the release workflow.
