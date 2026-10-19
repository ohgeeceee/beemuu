# Feature status — v5.0.0 baseline

Audited 2026-10-19 against main at `bcf296474f77059314137de107f4bc7170c0ccde`.
This records source and integration evidence, not a real-car certification.

| Area | Implemented evidence | Remaining boundary |
|---|---|---|
| Desktop diagnostics | `src/index.html`, `src/js/main.js`, Rust core: scan, faults, live data, logging, guided checks, snapshots | Hardware coverage depends on chassis, ECU firmware and profile validation. |
| First scan | `src/js/first_scan_guide.js` | Connection recovery and stale-reading handling need further work. |
| Vehicle history and repair comparison | Garage, passport, repair verification and snapshot comparison modules under `src/js/` | A unified, resumable diagnostic case is not established by these modules alone. |
| Analysis panels | `v3_ui.js`, `v4_ui.js`, signal quality, drive cycle, fleet, provenance, sensor plausibility and consensus modules | Results depend on supplied evidence. A module or passing unit test is not hardware validation or a calibrated diagnostic probability. |
| Installed plugins | `plugins_ui.js`, `plugin_runner.js`, API 1/2 package loader and registry client | Explicit JSON tools and data packs; no automatic vehicle host access. |
| Capability decision layer | `plugin_capability_bridge.js`, `plugin_bridge.js`, `plugin_host.js`, Diagnostics review panel | Full installed-package consent, host binding and revocation need end-to-end integration verification. Vehicle write capabilities remain refused. |
| Publisher trust | Package digest and source review | A digest is not a signature. Publisher signatures and author-key verification remain planned. |
| Installers | Public GitHub release v5.0.0 exists | The release had zero attached assets when checked on 2026-10-19. Use the download center to inspect current availability; building from source remains documented. |
| Hosted admin | Source integrated by PRs #368–#370 | Merge history does not establish production deployment or readiness. Deployment is a separate controlled operation. |

## Hardware evidence still needed

The roadmap retains B58/N55 UDS, N52/N54 local-ID and E-series broadcast
validation work. Preserve verification markers until a report identifies the
chassis, ECU firmware, adapter, parameter, units and observed result. Do not
promote a profile to verified based only on simulator or unit-test success.

## Source of truth

`package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` describe
the source version. GitHub release assets describe downloadable installers.
`ROADMAP.md` preserves historical cycles; `docs/next-updates.md` records the
next proposed sequence. This audit does not bump versions or publish a release.
