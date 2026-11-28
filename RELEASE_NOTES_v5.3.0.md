# BeeEmUu v5.3.0 — Plugin Confidence

Released 2026-11-28.

v5.3.0 delivers the two P0 items from the v5.3 plan: the marketplace's last
offline gap is closed, and app updates are no longer a silent background
process.

## What's new

- **Sideload installs.** Install a marketplace `.zip` straight from disk —
  no network needed. The app hashes the archive locally, shows the full
  SHA-256 in the consent dialog next to a plain "unverified source" warning
  (there is no registry digest to compare), and validates `plugin.json`
  through the same extraction path as registry installs. Sideloaded plugins
  start disabled, appear as managed cards even though they are not in the
  registry, and can be updated from the registry later if the id matches.
- **About → Updates panel.** Current version, a manual **Check for
  updates** button, live download progress, and a link to the release notes
  for the incoming version. Manual checks report up-to-date, available, or
  failure with a retry. The automatic loop and the button share one busy
  flag so they cannot race, and the long-standing safety rule is unchanged:
  nothing downloads or relaunches while a vehicle is connected.

## Under the hood

- `marketplace_ui.js`: sideload staging + consent (`stageSideload`,
  `renderSideloadConsent`) reusing the bounded zip reader and the existing
  install/consent components.
- `update_status.js`: new pure helpers (version parsing, release-notes URL,
  updater event → progress folding) with full node test coverage;
  `auto_update.js` is now thin webview glue over the same helpers, bundled
  by esbuild as before.
- New tests: 3 jsdom sideload scenarios (consent + confirm, malformed
  archive refusal, cancel) and 4 helper suites for update status.
  1181 frontend tests pass.

## Upgrade

v5.1.0 and newer update themselves while no vehicle is connected — or use
About → Updates → Check for updates. Manual installers for Windows (MSI,
NSIS) and Linux (deb, AppImage) are attached, all signed.
