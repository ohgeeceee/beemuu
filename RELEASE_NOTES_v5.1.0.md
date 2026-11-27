# BeeEmUu v5.1.0 — Plugin Marketplace

This minor release brings the community plugin marketplace into the app. The
Plugins tab now lists everything published on
[plugins.beemuu.com](https://plugins.beemuu.com/) — twelve plugins at release
time, including DTC explanations in plain English, emission-readiness checks,
live-data threshold alarms, fuel-trim health analysis, acceleration timing,
custom gauge dashboards, coding snapshots, guided battery registration and a
maintenance planner.

Installing is one click: the download is SHA-256-verified against the
registry before it is extracted, the archive must match the registry listing
exactly, and a consent screen shows precisely which capabilities the plugin
receives — and which are refused — before anything is stored. Installed
plugins are enabled, opened, updated and removed from the same section, and
update badges appear when a newer version is published.

Marketplace plugins run in an isolated frame with no network access. Panels
render inside that frame, file exports arrive as ordinary downloads, and
vehicle access is limited to read-only capabilities the plugin declared and
the user saw at install time. ECU writes (`clear-dtc`, `coding-write`,
`ecu-flash`) are never granted in this build; a plugin that declares them
installs with those calls refused and the refusal shown.

## Validation

The implementation passed 1,166 JavaScript tests via the CI glob (17 new
marketplace tests covering registry validation, archive extraction with both
stored and deflated zip entries, store bounds, and the runner's
grant/refusal matrix and sandbox policy), the Python backend suite, both
Rust CI test workflows, browser plugin-isolation tests and theme checks.
Browser tests use a mocked Tauri connection; real-cable/chassis validation
remains outstanding.

## Install and recovery

Download the installer for your operating system from this release's Assets.
Close Beemuu and disconnect from the vehicle before upgrading. Installed
plugins and their enabled state are preserved across the upgrade; exported
files are unaffected.

No database migration or ECU-write functionality is added by this release.
To revert, close the app and reinstall your previously used installer.
Windows and Linux packages are the configured targets; macOS installers are
not provided by the release workflow.
