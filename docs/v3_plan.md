# v3 plan — "The Car Remembers"

Branch: `feat/v3-cycle` (off `origin/main` @ `ceb4450`, v2.2.0).
Status: in progress.

## Where v2.2.0 actually stands

Grounded in the tree, not the marketing:

- **Shipped and real:** scanner + transport (ENET, KDCAN, ISO-TP, sim), DTC
  read/clear, freeze frames, live data + gauges, CSV logging with import/export,
  snapshots, test-plan walks, plugins v1/v2 (data + tool), the read-only Python
  backend, and a 21-page static site.
- **Shipped in the "never seen before" set:** Predictive CBS Timeline,
  Wiring Detective, Diagnostic Story Mode, Community Oracle, Virtual Second
  Opinion (Rust-side), Secure Snapshot anonymizer, beginner guides, engine
  profile packs.
- **Designed in `TECH_SPECS.md`, not built** — verified: `tuning_detect.rs`,
  `ghost.rs`, `drift.rs`, `misfire.rs`, `hunt.rs`, `dyno.rs`, `cold_start.rs`,
  `flash_counter.rs` do not exist. `VISION.md` is stale here: it claims "14
  designed, mostly unbuilt" and does not know about the seven that *did* ship.
- **Not built, and not on a branch:** the plugin capability bridge and engine
  profile packs are unbuilt. The `feat/plugin-capability-bridge` and
  `feat/engine-profile-packs` branches named here previously do not exist on
  `origin` — verified with `git ls-remote --heads origin`. v3 does not depend on
  either; the bridge's design of record is
  `docs/plugin_capability_bridge_plan.md`, which is on `main`.

## The v3 thesis

Every v3 feature answers one question: **"what does this car know about itself
that it has never been able to tell anyone?"** The app is already good at
asking a module a question once and rendering the answer. v3 is about the
*history*: what the ECU learned, what it keeps re-learning wrongly, what it
counts, and what it would have told you last month if anyone had been writing
it down.

That makes almost the whole cycle **pure analysis over data the app already
has** — logs, snapshots, and community TOML. That is the cheapest possible
place to build, and the safest: no new transport, no ECU writes, nothing that
can brick a car.

## The ten features

| # | Feature | Why it earns a place | Tier | Module |
|---|---------|---------------------|------|--------|
| 1 | **Misfire Pattern Recognition** | Per-cylinder misfire counts exist; nobody correlates them with RPM/load/temp *at the time*. The correlation is the diagnosis. | A | `src/js/misfire_patterns.js` |
| 2 | **Adaptation Drift Tracker** | Long-term fuel trims and idle learnings are the earliest honest signal a DME gives. Cross-session trend + regression is read-only. | A | `src/js/adaptation_drift.js` |
| 3 | **Tuning Fingerprint Detector** | Detect a non-stock calibration from *read-only* evidence (DMF correlation, boost-vs-boost-target, lambda signature). Analysis only — no map browser, no writes. | A | `src/js/tuning_fingerprint.js` |
| 4 | **Flash Counter & History Auditor** | A flash counter that moved between two of your own snapshots is proof. Reconstruct the history from snapshots you already saved. | A | `src/js/flash_audit.js` |
| 5 | **Cold Start Auto-Logger** | The intermittent cold-start fault nobody can reproduce. Arm it, drive away, the log is already there in the morning. | A | `src/js/cold_start.js` |
| 6 | **Parameter Hunt** | Turns the E-series data desert into a community sport. Scoring is pure and local; the leaderboard ships as data. | A | `src/js/parameter_hunt.js` |
| 7 | **Symptom Index** | Owners describe symptoms, not codes. Index "cold start stumble" → the 6 codes and 3 components that actually cause it. | A | `src/js/symptom_index.js` |
| 8 | **Signal Library** | Every decodable signal in one searchable catalog across all engines — the missing front door to the Parameter Explorer. | A | `src/js/signal_library.js` |
| 9 | **Vehicle Passport** | One portable, anonymizable file per car: profile, DID map, DTC texts, wiring, CBS history, drift history. Builds on the existing anonymizer. | A | `src/js/vehicle_passport.js` |
| 10 | **Registry integrity + search** | A download ecosystem is only as good as its integrity story. sha256 on install, real search/filter in the registry, capability names surfaced. | A | `backend/plugins_registry.py`, `src/js/plugins_registry_client.js` |

## Explicitly out of scope for v3

- **Any ECU write.** No coding, no flashing, no `ecu-flash` capability. Stage 3c
  of `VISION.md` stays shut until 3a/3b prove out and the safety review exists.
- **`network` / `filesystem` plugin capabilities.** Still refused at install.
- **A frontend framework rewrite.** v2.2.0 is vanilla JS and it is fast. v3
  adds modules, not a build step.
- **The `ui` plugin capability.** Still structurally blocked (worker has no
  safe DOM surface). Not this cycle.

## Build order

1. **1–5** — the "car remembers" core. Each is a pure engine + tests, then a
   panel. No dependency on anything unlanded.
2. **6–8** — the discovery/ecosystem set. Data-heavy, low risk.
3. **9** — depends on 2 and 4 producing stable shapes to serialize.
4. **10** — independent; can be built in parallel with any of the above.

## Standing rules for this cycle

- Every engine is **pure** (`require()`-able, no DOM, no Tauri) so it is
  testable under `node --test` without a browser. Panel code is a thin shim
  over it, exactly like `cbs_predict.js` / `cbs_ui.js`.
- No engine invents a byte layout for a signal no capture pins. If the data
  is not there, the module says so and returns an empty result with a reason.
- Every number that ends up in a diagnosis carries a confidence and a note
  saying what it was derived from. A diagnosis the user cannot audit is worse
  than no diagnosis.
- Tier A throughout. Nothing in this cycle touches `src-tauri/src/transport/`,
  `protocol/`, or `commands.rs`, so no human merge is required.
