# BeeEmUu v5.2.0 — Offline Marketplace

Released 2026-11-27.

The marketplace no longer depends on being online. v5.1.0 shipped the Plugin
Marketplace tab and signed auto-updates; v5.2.0 makes the marketplace usable
in the places diagnostics actually happens — workshops with poor or no
connectivity — and cuts the clicks needed to keep plugins current.

## What's new

- **Offline marketplace browsing.** The last successfully validated registry
  is cached locally. If plugins.beemuu.com is unreachable, the Plugins tab
  shows the cached listing with a clear notice instead of an empty grid.
  Cached JSON is re-validated before use; a corrupt cache is discarded, never
  trusted.
- **Installed plugins are always manageable.** Enable, disable, open and
  remove work with no network at all — even with no cache. Plugins missing
  from the current listing get their own card instead of disappearing.
- **Update all.** When two or more plugins have updates, one confirmation
  covers the batch. Every package still passes SHA-256 verification against
  the registry before install, a failing download leaves that plugin at its
  current version, and the results are listed per plugin.
- **Updates keep your choices.** Updating a plugin (single or batch) now
  preserves its enabled/disabled state instead of resetting it to disabled;
  a running copy is stopped before the replace.
- **Marketplace filter.** A search box narrows cards by name, id,
  description, author or category, case-insensitively.

## Under the hood

- `marketplace_store.js`: advisory registry cache (`saveRegistryCache` /
  `loadRegistryCache`) with a 256 KiB cap, stored separately from installed
  plugin state.
- `marketplace_registry.js`: pure `filterEntries` helper.
- `marketplace_ui.js`: shared verified-download pipeline for single and batch
  installs, offline rendering, update-all consent and results view.
- New jsdom UI tests drive the real module offline: no-cache management,
  cache restore with update badges, corrupt-cache handling, filtering and
  cache writes on refresh. 1174 frontend tests pass.

## Upgrade

Desktop releases ship with signed auto-updates — v5.1.0 installs update
themselves while no vehicle is connected. Manual installers for Windows
(MSI, NSIS) and Linux (deb, AppImage) are attached to this release.
