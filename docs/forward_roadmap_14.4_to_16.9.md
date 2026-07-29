# Forward Roadmap — v0.14.4 → v0.16.9

> **Status:** planning artifact. Authored 2026-07-29 against
> `main` @ `8175540` (v0.14.2 closed; v0.14.3 cycle-plan PR #179
> open). This is a **list of candidate work** for the next 12
> release cycles, not a commitment. Per the project convention,
> each cycle ships its own `docs/v0.14.x_plan.md` and a
> maintainer-opened Discussion thread; this doc seeds the
> community conversation for that work.

## How to read this

Each version below has a working name, a one-paragraph premise,
a candidate slice list, the tier split, and the open dependencies
(gating it on other work or external acquisitions like a
specific cable). Slices are **candidates** — the maintainer
narrows or expands them at cycle-plan time. A "🟢 Ready" badge
means the work is unblocked, well-scoped, and the right size for
a single Tier A PR; a "🟡 Needs research" badge means there's
domain work to do before the slice list is firm; a "🔴 Gated"
badge means an external dependency (cable acquisition, real-car
data) is the blocker.

## v0.14.4 — "N62 Bench Verification" (Aug 2026)

**Premise:** the v0.14.2 slice 3 harness doc asks an E70 owner to
verify the 10 N62 PIDs against a real car. v0.14.3 adds three more
PIDs (`0x5E` / `0x5F` / `0x62`). v0.14.4 is the cycle that
**consumes the report**: turns the E70 owner's findings into
profile fixes, decoder corrections, and the first
`[needs verification]` → `verified` labels on the N62 profile.

**Tier split:** 3 Tier A + 0 Tier B + 0 Tier C in the slice list.
The release cut is Tier C and follows slice 3.

### Candidate slices

1. 🟢 **N62 profile fixes from the v0.14.2/v0.14.3 reports**
   (Tier A, data only). Decode corrections, min/max range fixes,
   removed dead entries. Drives directly from the GitHub issues
   filed per the harness doc.
2. 🟢 **Remove the `[needs verification]` markers on
   `n62.toml`** for PIDs the report confirms (Tier A, data only).
   Pure label changes + comments linking the confirming issue.
3. 🟡 **`docs/validation/n62-real-car.md` closeout** (Tier A,
   docs only). Adds a "Verification results" section summarising
   what worked, what didn't, and the decoder corrections that
   resulted. Marks the N62 profile as **chassis-validated** in
   the v0.14.2 / v0.14.3 cycle tables.

**Open dependencies:** the E70 owner's harness-doc report. If
no report is filed by mid-cycle, the slice list shrinks to
"close the v0.14.3 cycle + re-verify the deferred PIDs in a
later cycle" and the release cut slips.

## v0.14.5 — "Bench Round 2" (Sep 2026)

**Premise:** the E70 harness doc pattern generalises to other
E-series DMEs that the v0.14.0 `can-broadcast.md` harness
already targets (E46 / E9x / E6x) and to the N52 / N54 family
that the existing community profiles already cover.

**Tier split:** 3 Tier A + 0 Tier B.

### Candidate slices

1. 🟢 **`community/profiles/n52.toml` + `n54.toml` enrichment
   for the same OBD-II PIDs** (Tier A, data only). `0x5C` oil
   temp swap (mirroring the N62 slice 1 work in v0.14.2), plus
   the three v0.14.3 PIDs. Same `[needs verification]` discipline.
2. 🟢 **`docs/validation/n5x-real-car.md` harness doc**
   (Tier A, docs only). E60/E90 N52/N54, the E90 being the
   reference chassis the issue #161 E90 sim fix (v0.14.1) was
   built against.
3. 🟢 **`n52.toml` / `n54.toml` instrumentation-context header
   blocks** (Tier A, data only). The N62 cycle's instrumentation
   context (valley-pan slow-coolant, oil-temp cruise band, idle
   voltage) has E-series analogues; N52 has the N52-specific
   oil-condition sensor (BSD, not KWP2000) as the load-bearing
   known issue.

**Open dependencies:** an E90 owner willing to run the harness.

## v0.15.0 — "Live Gauges from the Bench" (Oct 2026)

**Premise:** v0.14.0 shipped the Live Gauges panel as
**sim-only** by explicit user decision (the v0.14.2 cycle-pick
conversation, Option B). v0.15.0 connects the existing
`read_live_data` UDS path to the Live Gauges panel so it shows
**real data on the K+DCAN cable**, without the OBDLink SX
acquisition the v0.14.0 Tier B was waiting for. The
"**DID-projection bridge**" the v0.14.2 plan deferred to
v0.14.3+ lands here.

**Tier split:** 2 Tier A + 1 Tier B.

### Candidate slices

1. 🟢 **DID-projection bridge** (Tier A, frontend). Maps each
   `[[profile.param]]` to the corresponding `data-live-can-gauge`
   slot. Pure mapping logic in a new `src/js/live_data_bridge.js`
   module + tests. Reuses the v0.14.0 `can_decoders.js` for
   byte-level decoding when the live-data value comes through
   the broadcast path.
2. 🟢 **Live Gauges panel data source flip** (Tier A,
   frontend). When `connected && profile selected`, the panel
   reads from the bridge instead of the simulator mirror. The
   sim-only fallback stays for non-connected sessions.
3. 🟡 **`update_can_listen` async command** (Tier B, Rust). New
   Tauri command that starts / stops the existing `watch_tick`
   loop with a `ListenerMode::KwpDids { profile, interval_ms }`
   variant. Different from the v0.14.0 Tier B
   `ListenerMode::Simulator / OBDLinkSx` because it reads
   through the diagnostic protocol, not the raw CAN bus.

**Open dependencies:** the DID-projection bridge is pure
mapping, but the Rust command needs the existing
`read_live_data` async refactor (per CLAUDE.md's async-commands
invariant — v0.6.0 release blocker that's been outstanding for
months). The Tier B slice should be paired with a **broader
async refactor** that other slices in this cycle can also use.

## v0.15.1 — "The Async Refactor" (Oct 2026, parallel with v0.15.0)

**Premise:** CLAUDE.md's async-commands invariant (any
`#[tauri::command]` that touches serial / network transport must
be `async fn` or offload via `spawn_blocking`) is the
v0.6.0 release blocker. v0.6.0 never cut a release; the
invariant has been carried forward as a "don't make it worse"
rule. v0.15.1 is the cycle that **pays down the debt** so
v0.15.0's Tier B command and every subsequent transport-touching
command is async by construction.

**Tier split:** 0 Tier A + 5 Tier B (one per command).

### Candidate slices

1. 🟢 **`connect` → async + spawn_blocking** (Tier B, Rust).
   Serial-port open + initialisation. The v0.15.0 cycle
   references this PR.
2. 🟢 **`scan_modules` → async + spawn_blocking** (Tier B, Rust).
   Iterates over the `ecus.rs` address table; currently the
   main-thread block that freezes the webview during the scan.
3. 🟢 **`read_faults` → async + spawn_blocking** (Tier B, Rust).
4. 🟢 **`read_live_data` → async + spawn_blocking** (Tier B,
   Rust). Already required by v0.15.0's bridge.
5. 🟢 **`watch_tick` + `run_service_function` +
   `security_access` → async + spawn_blocking** (Tier B, Rust).
   The last three synchronous transport-touching commands.

**Tests gate:** the `tests/async_commands.rs` allowlist guard
fails CI for any sync command not in `SYNC_ALLOWLIST`. Each
slice is the same recipe documented in
`beemuu-windows-dev-quirks` §10: keep the work as a sync
`_impl` function, the `#[tauri::command]` wrapper is `async` +
`spawn_blocking`, the impl takes a `home_override: Option<&str>`
for unit-test speed. Pattern is mechanical; ~3-5 PRs' worth of
test work is the only real cost.

**Open dependencies:** none — this is the foundational work
that unblocks v0.15.0's bridge and every subsequent Tier B
transport-touching slice. The v0.15.0 + v0.15.1 cycles can
parallelise in separate clones.

## v0.15.2 — "Test-Plan Walks on the Bench" (Nov 2026)

**Premise:** v0.7.0 / v0.8.0 / v0.9.0 / v0.10.0 shipped the
walkthrough bundle, the test-plan walk reducer, the verified
routine marker, and the share-as-HTML export — all on the
simulator. v0.15.2 ports the test-plan walk to **real-car
sessions**: walks against the K+DCAN cable, records
results against the real freeze-frame data, exports to the
same self-contained HTML.

**Tier split:** 2 Tier A + 1 Tier B.

### Candidate slices

1. 🟢 **Test-plan walk on real freeze-frames** (Tier A,
   frontend). Reuses the v0.14.0 freeze-frame schema split
   (PR #170) so each walk step knows which freeze-frame fields
   to read from which DME.
2. 🟡 **`record_walk_result` async Tauri command** (Tier B,
   Rust). Saves a walk outcome (passed/failed/skipped per step)
   to `<HOME>/beeemuu/walks/<timestamp>.json`. Mirrors the
   v0.12.0 DTC history pattern.
3. 🟢 **Walk export to HTML includes real freeze-frame
   snippets** (Tier A, frontend). The v0.11.0 share-as-HTML
   PR (#142) embeds the freeze-frame in the HTML; this slice
   ensures the embedded freeze-frame is the **real one** for
   walks on real cars, not the simulator's.

**Open dependencies:** v0.15.1's async refactor for the
`record_walk_result` command.

## v0.15.3 — "Service Functions on Real Cars" (Dec 2026)

**Premise:** v0.8.0 shipped the routine ID / risk classification
/ simulator-grade `[UNVERIFIED]` marker. v0.15.3 is the cycle
that **graduates routines from unverified to chassis-validated**
on a per-chassis basis. The N62/E70 N62's `bleed_dme` (DME
adaptation bleed) and the E90 N54's `register_injector` are
the reference candidates.

**Tier split:** 2 Tier A + 1 Tier B.

### Candidate slices

1. 🟢 **Per-chassis routine validation table in the
   community profile** (Tier A, data). A new
   `[[profile.routine_validation]]` block in each profile TOML
   that pins which routine IDs are chassis-confirmed for which
   DME firmware.
2. 🟢 **`run_service_function` reads the per-chassis
   validation table** (Tier A, frontend). When a routine is
   run, the UI surfaces the chassis-validation status, not just
   the global `verified: bool`.
3. 🟡 **`list_service_functions` filter by chassis
   validation** (Tier B, Rust). The command now returns a
   `verified_for: Vec<ChassisKey>` field; the frontend uses
   this to grey out routines that aren't validated for the
   selected profile.

**Open dependencies:** requires at least one E70 N62 + one E90
N54 report from the harness docs (v0.14.2, v0.14.5, this cycle).
If the community hasn't filed any, the cycle is "ship the
schema and wait."

## v0.15.4 — "Tier B Cleanup" (Dec 2026, parallel)

**Premise:** CLAUDE.md rule 5 ("never widen a PR's scope after
opening") + the multi-writer skill's Tier B/C gate has built up
a list of **refactor-only carve-outs** that have been deferred
across multiple cycles: the `bmw_diag/` bulk deletion, the
`server/dtc/` bulk deletion, the ENET/DoIP transport
auto-detection (RoW), ISO-TP multi-frame (FF/CF/FC) per ISO
15765-2, BLE adapter support, WiFi adapter support, tester
present keep-alive. v0.15.4 takes the **docs-only + refactor**
backlog in one cycle.

**Tier split:** 0 Tier A + 2 Tier B (refactor) + 1 Tier C
(deprecation decision).

### Candidate slices

1. 🟢 **Delete `bmw_diag/` + `server/dtc/` dead modules**
   (Tier B, refactor). The pre-rename `bmw_diag/` and the
   `server/dtc/` Flask templates have been commented-out in
   the repo since v0.5.0. No consumers; deleting shrinks the
   surface area for new contributors.
2. 🟢 **Consolidate the four test runners** (Tier B, refactor).
   `cargo test`, `node --test`, `pytest backend/tests/`, and
   the front-end `vitest` / `node --test` glob are four
   different invocations across four different directories.
   A `make test` (or `just test`) recipe with one entry point
   per runner is the cleanup.
3. 🟡 **Deprecate or commit to the ENET / DoIP /
   ISO-TP-multi-frame / BLE / WiFi backlog** (Tier C, decision).
   Either a GitHub issue per item with an explicit
   "deferred to v0.20+" milestone + a `help wanted` label, or
   a v0.16.x cycle that picks one of them. **Not** a code
   change — a decision document the maintainer signs off on.

**Open dependencies:** the Tier C slice is a Decision, not a
code change. Per CLAUDE.md rule 2 + the multi-writer skill's
"Tier C = always a human decision (propose, never execute),"
this cycle's Tier C slice is a `docs(v0.15.4): deprecate
backlog decision` PR with a clear yes/no/move-to-16.x
recommendation for each item.

## v0.15.5 — "Profile Edit Workflow" (Jan 2027)

**Premise:** the v0.14.3 slice 3 (per-PID remove-from-profile UI)
exposed the workflow gap: the user can now click "×" to remove a
PID from the active session, but the change is local-only — on
the next profile load, the PID comes back. v0.15.5 is the cycle
that **lets the user persist profile edits** (add/remove/rename
a PID, change a unit, tweak a min/max range) and round-trips
the edited profile to a user-writable copy at
`<HOME>/beeemuu/profiles/<id>.toml`.

**Tier split:** 2 Tier A + 2 Tier B.

### Candidate slices

1. 🟢 **User profile directory bootstrap** (Tier A, Rust).
   `ensure_user_profiles_dir()` creates
   `<HOME>/beeemuu/profiles/` on first run. Read precedence:
   user dir first, then bundled.
2. 🟢 **Profile read precedence: user > bundled** (Tier A,
   Rust + frontend). `list_profiles` returns the merged set;
   the user copy shadows the bundled one. A new
   `profile_source: "bundled" | "user"` field surfaces in
   the UI.
3. 🟡 **`save_profile` async Tauri command** (Tier B, Rust).
   Writes the edited TOML to the user dir. Validates against
   the schema before write. `async_commands` allowlist guard
   applies.
4. 🟡 **`remove_profile_pid` async Tauri command** (Tier B,
   Rust). The v0.14.3 Tier B slice lands in v0.15.5 because
   the user-profile dir bootstrap is the prerequisite for the
   command to have a writable target.

**Open dependencies:** v0.15.1's async refactor for the new
commands. This cycle and v0.15.1 can land in either order as
long as v0.15.5's commands land on the post-v0.15.1 tip.

## v0.16.0 — "The Tier B Land Rush" (Q1 2027)

**Premise:** with v0.15.1's async refactor done, the Tier B
backlog from v0.15.4's decision document becomes a land rush.
v0.16.0 picks **one Tier B item** as the cycle's spine and
adds the chassis-validation + harness-doc infrastructure to
make future Tier B items faster to ship.

**Tier split:** 1 Tier A + 2 Tier B.

### Candidate spine: ISO-TP multi-frame (FF/CF/FC) per ISO 15765-2

The pre-existing Tier A-listed "🟢 Ready" item from the v0.3.0
roadmap. Required for long UDS responses (VIN, full DTC list,
freeze-frame blocks > 6 bytes). Currently the protocol layer
sends a single-frame request and silently truncates anything
> 7 bytes. The fix:

1. 🟢 **ISO-TP frame assembler** (Tier A, Rust, pure helper).
   `isotp.rs::assemble(frames: Vec<Vec<u8>>) -> Vec<u8>` with
   the FF/CF/FC state machine. Tested in isolation.
2. 🟡 **ISO-TP frame disassembler** (Tier B, Rust).
   Splits a long response into the right number of CF frames
   with the right SN counter. Reuses the existing
   `kdcan.rs` transport — the serial-port byte stream is
   unchanged.
3. 🟡 **UDS services that benefit from ISO-TP wire up**
   (Tier B, Rust). `read_dtc_info` (full DTC list), `read_data_by_identifier`
   for long DIDs (VIN = 17 bytes, calibration ID = 24+), and
   the freeze-frame read for blocks > 6 bytes.

**Why this is the v0.16.0 spine and not a smaller cycle:** the
ISO-TP work unlocks every long-DID profile entry that's
commented out in the existing community profiles (DA0A
gear, 4010 VIN, etc.) and is the gating dependency for
"compare logs across sessions" / VIN-locked features the
user has been asking about.

**Open dependencies:** v0.15.1's async refactor.

## v0.16.1 — "Bundle Export 2.0" (Q1 2027)

**Premise:** v0.11.0 shipped the walkthrough-as-HTML export
(PR #142). v0.16.1 is the cycle that generalises the export
shape: any log + walk + freeze-frame combination into a single
self-contained HTML, viewable in any browser, no JS framework
required.

**Tier split:** 2 Tier A + 0 Tier B.

### Candidate slices

1. 🟢 **Multi-tab bundle export** (Tier A, frontend). Tab
   strips: walk + log + freeze-frame + DTC table. Reuses the
   v0.11.0 self-contained HTML scaffold.
2. 🟢 **PDF export via the browser's print stylesheet** (Tier A,
   frontend). A `Print to PDF` button that triggers `window.print()`
   after a `@media print` stylesheet hides the controls. No
   new crate, no headless browser.

## v0.16.2 — "Multi-Profile Sessions" (Q2 2027)

**Premise:** every cycle's harness doc has said "verify on
your car, file a report." A multi-profile session lets the
shop owner / tuner load **two profiles at once** (e.g. B58
N55 + the M-tuned B58 variant), run a walk on both, diff
the freeze-frames, and export the diff as a single HTML.

**Tier split:** 1 Tier A + 2 Tier B.

### Candidate slices

1. 🟢 **Side-by-side profile panel** (Tier A, frontend).
   Two profile dropdowns; the Live Data tab shows the
   selected profile's gauges on the left, the comparison
   profile's on the right. Pure presentation; the existing
   `read_live_data` handles both calls.
2. 🟡 **Freeze-frame diff** (Tier B, frontend + Rust). Pick
   a DID, show the two profiles' last-known values + the
   delta. The Rust side computes the diff; the frontend
   renders it.
3. 🟡 **Diff export to HTML** (Tier B, frontend). Reuses
   the v0.16.1 multi-tab bundle scaffold.

**Open dependencies:** the v0.14.0 freeze-frame schema split
(PR #170) is the foundation; the per-DID freeze-frame read
needs the v0.16.0 ISO-TP multi-frame to ship first if the
freeze-frame is > 6 bytes.

## v0.16.3 — "OBD-II Mode 09 (vehicle info)" (Q2 2027)

**Premise:** OBD-II Mode 09 is the standard "tell me about
this car" service — VIN, calibration ID, ECU name, CVN
(calibration verification number). The protocol layer doesn't
support it today. v0.16.3 is the cycle that adds Mode 09 read
support and exposes it as a "Vehicle info" tab.

**Tier split:** 1 Tier A + 1 Tier B.

### Candidate slices

1. 🟢 **Mode 09 PID 02 (VIN) + 04 (calibration ID) + 06
   (CVN)** (Tier A, Rust). Pure protocol additions. The
   existing `read_did` command's encoding already covers
   the 09 xx shape; this is a new command-path entry.
2. 🟡 **Vehicle info tab** (Tier B, frontend). New tab in
   the desktop app; displays the VIN, calibration IDs, CVN.
   Exports the info as a one-shot JSON the user can attach
   to a forum post.

**Open dependencies:** v0.16.0's ISO-TP multi-frame — VIN is
17 bytes, calibration ID is 24+ bytes, neither fits in a
single-frame UDS response.

## v0.16.4 — "B58 / N55 N20 (modular B-family) UDS DIDs" (Q2 2027)

**Premise:** the v0.3.0 / v0.4.0 / v0.5.0 / v0.6.0 cycles
shipped B58 and N55 DIDs based on OBDb's published list. The
list is not complete — many DIDs are commented out pending
real-car validation. v0.16.4 is the cycle that **uncomments
the DIDs that the harness docs (v0.14.2 / v0.14.5 / v0.15.2)
have validated**, plus the F/G-series-specific DIDs that
require ENET (not K+DCAN).

**Tier split:** 2 Tier A + 0 Tier B.

### Candidate slices

1. 🟢 **Uncomment B58/N55 DIDs that the v0.14.5 / v0.15.2
   reports confirm** (Tier A, data). Decode corrections as
   needed. Pure profile edits.
2. 🟢 **`docs/validation/b58-real-car.md` + `n55-real-car.md`
   harness docs** (Tier A, docs). Mirrors the v0.14.2
   N62 harness doc shape.

**Open dependencies:** the F-series ENET owner (per
ROADMAP_ISSUES.md issue 2). The harness doc makes the request
explicit; if no report files, the cycle closes without
uncommenting anything.

## v0.16.5 — "DTCOdometer Sync" (Q3 2027)

**Premise:** every BMW profile has a `mileage` DID that's
read as part of the freeze-frame. The value is a 3-byte BE
integer in km. v0.16.5 is the cycle that **persists the
mileage across sessions** (so the dashboard shows the
last-known value when the car is off) and exposes a
"set odometer" action (with the dialog plugin confirmation)
for cases where the DME was reset.

**Tier split:** 1 Tier A + 1 Tier B.

### Candidate slices

1. 🟢 **Last-known mileage cache** (Tier A, Rust + frontend).
   `<HOME>/beeemuu/last_mileage.json` keyed by VIN. The
   dashboard reads this on launch if no live data is
   available.
2. 🟡 **`set_odometer` async Tauri command** (Tier B, Rust).
   Writes a new mileage to the DME. Confirmation dialog
   mandatory (it's a write). `async_commands` allowlist
   guard applies.

**Open dependencies:** v0.16.0's ISO-TP multi-frame (the
mileage DID is short, so this might fit; verify at cycle-plan
time).

## v0.16.6 — "Calibration Compare" (Q3 2027)

**Premise:** v0.16.0's ISO-TP multi-frame + v0.16.1's
multi-tab bundle export + v0.16.3's Mode 09 calibration ID
read together enable a "Calibration Compare" workflow:
read the current calibration ID, compare against the
expected-for-this-DME-firmware ID, flag mismatches.

**Tier split:** 1 Tier A + 1 Tier B.

### Candidate slices

1. 🟢 **Calibration ID cache + expected-firmware table**
   (Tier A, Rust). `<HOME>/beeemuu/calibration_ids.toml`
   with the per-DME-firmware expected IDs (community-curated).
2. 🟡 **Calibration mismatch warning in the Vehicle Info
   tab** (Tier B, frontend). Yellow border on the tab if
   the read ID doesn't match; one-click report-to-issue.

## v0.16.7 — "Multi-ECU Diagnostic Sweep" (Q3 2027)

**Premise:** the v0.12.0 DTC history per-module recorder
(v0.12.0 PRs #144-#148) is per-address. A multi-ECU
diagnostic sweep reads **every present module's DTCs in
one go** and exports the table as a single CSV.

**Tier split:** 1 Tier A + 1 Tier B.

### Candidate slices

1. 🟢 **Multi-ECU DTC table view** (Tier A, frontend).
   New tab; rows are (module, DTC code, status, first seen,
   last seen). Reuses the v0.12.0 `dtc_history.js` for the
   per-row data.
2. 🟡 **`sweep_all_dtcs` async Tauri command** (Tier B,
   Rust). Iterates over the `ecus.rs` address table, calls
   `read_dtc_info` for each present module, aggregates.
   `async_commands` allowlist guard applies.

**Open dependencies:** v0.15.1's async refactor; v0.16.0's
ISO-TP multi-frame (the full DTC list per module is > 6 bytes
on most DMEs).

## v0.16.8 — "Adaptive Value Reset" (Q4 2027)

**Premise:** the BMW DME has a set of "adaptation values" that
the ECU learns over time (idle air, knock threshold, fuel
trim). v0.16.8 is the cycle that **exposes the reset action**
with the dialog plugin's confirmation (per CLAUDE.md Tier B
+ the v0.14.1 #161 fix pattern).

**Tier split:** 0 Tier A + 1 Tier B.

### Candidate slices

1. 🟡 **`reset_adaptations` async Tauri command** (Tier B,
   Rust). Per-DME-firmware routine ID (the
   `register_injector` routine in v0.8.0 is the
   shape). Confirmation dialog mandatory. `async_commands`
   allowlist guard applies.

## v0.16.9 — "Year-End Cleanup" (Q4 2027)

**Premise:** the v0.15.4 cycle is the first "Tier B Cleanup"
cycle. v0.16.9 is the **second** — by Q4 2027 there will be
12+ cycles of accumulated minor cleanups (dead code, schema
drift, doc rot). v0.16.9 is a no-feature cycle that pays
down the technical debt and re-baselines the docs.

**Tier split:** 3 Tier A (docs + tests) + 1 Tier B (refactor)
+ 0 Tier C.

### Candidate slices

1. 🟢 **Doc rot audit** (Tier A, docs). Re-verify every link
   in every `docs/validation/*.md` resolves. Refresh
   `docs/DECODE_FUNCTIONS.md` to match the current decoder
   catalog (will have grown to 11+ decoders by then).
2. 🟢 **Test coverage audit** (Tier A, tests). Every
   `#[tauri::command]` has a `cargo test --lib` test; every
   `src/js/*.js` has a `.test.js` companion; every
   `backend/seed_*.py` has a test in `backend/tests/`. The
   "needs test" gaps go into 1-2 follow-up Tier A PRs.
3. 🟡 **Dependency bump sweep** (Tier A, CI). Bump every
   Dependabot PR that's been open > 30 days. Update the
   pinned `tauri-action@v?` per the v0.7.0 cycle convention.
4. 🟡 **Bulk rename of `beeemuu` → `beemuu` in any remaining
   user-visible string** (Tier B, refactor). The repo
   `beemuu` / `beeemuu` inconsistency was documented in the
   CLAUDE.md history. v0.16.9 is the cycle that pays it
   down (or explicitly documents why it stays).

## Cross-cutting items (not tied to a single cycle)

These are the items that span every cycle in this roadmap. They
are **tracked in `docs/ROADMAP_ISSUES.md`** (or the v0.16.x
equivalent) and are the long-tail work:

- **ENET/DoIP auto-detection** (CLAUDE.md's stated invariant,
  not yet implemented). The K+DCAN cable + the OBDLink SX are
  the two transports supported today; ENET is the third. v0.16.0
  is the natural cycle to pick this up if the user gets an
  ENET cable.
- **BLE adapter support** (Vgate iCar Pro BLE, OBDLink CX).
  Requires the `btleplug` crate. The Tier B refactor in v0.15.1
  is the prerequisite.
- **WiFi adapter support** (Vgate iCar Pro WiFi, OBDLink MX+).
  Similar to BLE but on the network transport.
- **Tester Present keep-alive** (CLAUDE.md invariant, not yet
  implemented). Required for any long diagnostic session on a
  real car. The 2000–4000 ms `3E 00` / `3E 80` send loop is a
  small Rust slice; the open question is where it lives
  (the `connect` command's async-refactored home, or a
  dedicated `keepalive` worker).
- **E-series CAN broadcast frames from a real car**
  (`docs/validation/can-broadcast.md`). v0.14.0 Tier B was
  gated on OBDLink SX; v0.15.0's DID-projection bridge is
  the path that doesn't need the OBDLink SX at all. The
  harness doc remains open until a real-car report files.

## Tier summary

- Tier A (no human review): ~17 slices across the 12 cycles.
- Tier B (one human merge): ~14 slices. The biggest single
  batch is v0.15.1's async refactor (5 slices), which is
  the cycle that unblocks every subsequent Tier B command.
- Tier C (always a human decision): 0-2 per cycle. v0.15.4
  has one (deprecate-the-backlog decision); v0.16.0 has
  one (release cut); every other cycle has the release
  cut.

## Open questions for the maintainer

1. **Is v0.15.1 (the async refactor) the right cycle to pay
   down the async-debt?** It blocks every subsequent Tier B
   command. If the maintainer wants a different cycle to do
   it, every Tier B item in v0.15.0 / v0.15.5 / v0.16.x
   shifts forward.
2. **Is v0.16.0's spine ISO-TP multi-frame, or should the
   Tier B land rush pick a different item** (ENET auto-detect,
   BLE adapter, tester-present keep-alive)? The v0.15.4
   decision document is the right place to commit to one.
3. **Multi-Profile Sessions (v0.16.2) is a Tier B-heavy
   cycle. Is the user actually asking for that, or is it a
   nice-to-have that's eating cycles that should go to
   ISO-TP / BLE / ENET?** The v0.15.4 decision document is
   also the right place to defer it.
4. **The doc says "year 2026" / "year 2027"** in the cycle
   cadence, but the cadence is per-cycle not per-quarter. If
   the user wants quarterly releases, every cycle becomes a
   single-slice cycle. If the user wants the
   3-5-day-per-slice v0.14.0 / v0.14.2 cadence, the year
   estimates are right.
