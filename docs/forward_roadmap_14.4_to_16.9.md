# Forward Roadmap — v0.14.4 → v0.16.9

> **Status (revised 2026-08-02 — v0.14.6 audit):** planning
> artifact, audited against `main` @ `5743348` (the post-#225
> v0.14.5 release tip) as part of the v0.14.6 "Forward
> Roadmap Audit" cycle (PR for the audit + the v0.14.6 cycle
> plan doc + ROADMAP v0.14.5 closeout + public landing-page
> v0.14.5 closeout). The previous revision was on
> 2026-07-29 against `main` @ `b029aa6`. Since then, the
> following has changed:
>
> - **v0.14.2 ("Live Data on the Bench")** shipped 2026-07-29
>   (PRs #171, #175, #176, #177, #178; release cut #196 / #197).
> - **v0.14.3 ("Finish the Bench")** shipped 2026-07-30
>   (PRs #185, #186, #187, #188, #190; release cut #197).
> - **v0.14.4 ("Story Coverage")** shipped 2026-07-31
>   (PRs #198, #199, #200, #201, #202, #207, #208; release
>   cut #208; tag `v0.14.4` at `4de03ee`).
> - **v0.14.5 ("Open & Committed")** shipped 2026-08-02
>   (PRs #222, #223, #224, #225; release cut #225; tag
>   `v0.14.5` at `9249b934`; draft release promoted to
>   public 2026-08-02T07:53:09Z at
>   <https://github.com/ohgeeceee/beemuu/releases/tag/v0.14.5>
>   with both Windows installer assets attached).
> - **v0.14.6 ("Forward Roadmap Audit")** opened 2026-08-02
>   with the v0.14.5 doc-rotation closeout + this doc
>   audit + a new `docs/v0.14.6_plan.md` plan doc.
>
> The "Status (revised 2026-07-29)" claims that 4 items
> were "already on main" still hold: the async refactor,
> ISO-TP multi-frame, Tester Present keep-alive, and
> `protocol::read_vin` are all on main as of `5743348`.
>
> Per the project convention, each cycle ships its own
> `docs/v0.14.x_plan.md` and a maintainer-opened Discussion
> thread; this doc seeds the community conversation for
> that work. **It does not commit to any specific work** —
> the per-cycle `docs/v0.14.x_plan.md` remains the
> decision point.

## How to read this

Each version below has a working name, a one-paragraph
premise, a candidate slice list, the tier split, and the
open dependencies (gating it on other work or external
acquisitions like a specific cable). Slices are
**candidates** — the maintainer narrows or expands them at
cycle-plan time. The badge legend:

- 🟢 **Ready** — the work is unblocked, well-scoped, and
  the right size for a single Tier A PR.
- 🟡 **Needs research** — there's domain work to do
  before the slice list is firm.
- 🔴 **Gated** — an external dependency (cable
  acquisition, real-car data) is the blocker.
- ✅ **Shipped** — the cycle's slices all merged; the
  release cut is in the project's history. The cycle
  table is kept here as a closed-out reference; per-cycle
  detail (the actual PRs + commits) lives in `ROADMAP.md`'s
  cycle block.

## v0.14.6 — "Forward Roadmap Audit" (Aug 2026, Shipped 2026-08-02) ✓

**Premise:** the v0.14.5 release cut (PR #225) closed the
"Open & Committed" cycle end-to-end but left 4 docs-rot
findings on `main` that need a follow-up cycle:

1. `ROADMAP.md` v0.14.5 cycle block still says
   "In Progress — slice 0" (PR #225 closed it; the
   ROADMAP block is updated in this cycle's PR).
2. This forward-roadmap doc is stale: 4 cycles
   (v0.14.2 / v0.14.3 / v0.14.4 / v0.14.5) have
   closed since the 2026-07-29 revision, but the
   doc still names v0.14.4 as "N62 Bench
   Verification" (actual: "Story Coverage") and
   v0.14.5 as "Bench Round 2" (actual: "Open &
   Committed").
3. The public `frontend/roadmap/v0.14.5.html`
   cycle detail still claims v0.14.5 is "Planned"
   / "Tier TBD" / "Open & committed" with a
   candidate-slice list (the cycle shipped).
4. The forward-roadmap doc + the public landing-
   page cycle detail are now out of sync for
   v0.14.5 specifically.

**Tier split:** 1 Tier A + 0 Tier B + 0 Tier C in the
slice list. Single-slice docs-only cycle.

### Candidate slices

1. 🟢 **v0.14.5 doc-rotation closeout** (Tier A, docs
   only). Single PR that updates 4 files:
   `ROADMAP.md` v0.14.5 block (In Progress → Shipped
   with `✅ Done` rows for PRs #222 / #223 / #224
   / #225), this forward-roadmap doc (v0.14.4
   + v0.14.5 entries closed out), the public
   `frontend/roadmap/v0.14.5.html` (planned →
   shipped + "What shipped" section + install
   link to the v0.14.5 release), and a new
   `docs/v0.14.6_plan.md` (the v0.14.6 cycle plan
   doc per the established `docs/v0.14.x_plan.md`
   convention).

**Open dependencies:** none. Pure docs work. The
v0.14.6 release cut is a separate Tier C PR
(mirror of PR #225) that follows the slice's merge;
per CLAUDE.md golden rule #5 ("don't let the badge
lie"), the v0.14.6 release cut bumps the version
surface to `0.14.6` so the README release badge
reflects the latest shipped cycle.

## v0.14.4 — "Story Coverage" (Shipped 2026-07-31) ✅

**Premise:** v0.14.4 was the "ship what we promised,
harden what we shipped" cycle. It closed the
test-coverage gap on the user-facing diagnostic-story
(`src-tauri/src/story.rs`) + secure-snapshot
(`src-tauri/src/anonymize.rs`) features (52 new unit
tests, `0 → 201` cargo test count), refreshed stale
CLAUDE.md "NOT YET IMPLEMENTED" claims into "INVARIANT —
enforced" with file:line citations, audited the
ROADMAP v0.3.0 historical section (6 stale 🟢 Ready
items moved to ✅ Done with PR references), and fixed
the missing Tauri Linux system dependencies in
`ci.yml::test-rust`.

**Tier split:** 5 Tier A + 0 Tier B + 0 Tier C in the
slice list (slice 0 cycle plan + ROADMAP header,
slice 1 story + anonymize tests, slice 2 CLAUDE.md
refresh, slice 3 ROADMAP audit, slice 4 ci.yml fix).
The release cut is Tier C (PR #208) and was merged
2026-07-31 at commit `4de03ee`; tag `v0.14.4` was
pushed and `release.yml` built the v0.14.4 installers
in a draft release (the draft-release promotion +
landing-page rsync step shared the v0.14.4 +
v0.14.5 pre-existing failure mode: VPS deploy
secrets not configured).

> **Note (corrected):** the original forward-roadmap
> doc (PR #180) named this cycle "N62 Bench
> Verification" — the maintainer pivoted to "Story
> Coverage" instead. Per-cycle detail is in
> `docs/v0.14.4_plan.md` + the v0.14.4 cycle block
> in `ROADMAP.md`.

## v0.14.5 — "Open & Committed" (Shipped 2026-08-02) ✅

**Premise:** v0.14.5 generalises the v0.14.2 / v0.14.3
N62 / E70 work to the **N52 / N54** E-series family
that the existing community profiles already cover
but that v0.14.2 explicitly deferred to "the next
cycle after N62 wraps up." Three Tier A slices shipped
end-to-end: cycle plan + ROADMAP header (PR #222),
N52 + N54 profile enrichment with the `0x5C` oil-temp
swap + three new PIDs (`0x5E` / `0x5F` / `0x62`)
(PR #223, 13 → 13 N52 / 12 → 15 N54 params), and the
N5x harness doc mirroring the v0.14.2 N62 harness
(PR #224, 450 LOC). The release cut (PR #225) bumped
the version surface to `0.14.5`, tagged
`v0.14.5` at `9249b934`, and produced both Windows
installer assets in the public release at
<https://github.com/ohgeeceee/beemuu/releases/tag/v0.14.5>.

**Tier split:** 3 Tier A + 0 Tier B + 1 Tier C in the
slice list. The Tier C release cut (PR #225) was the
last step; the cycle is closed.

> **Note (corrected):** the original forward-roadmap
> doc (PR #180) named this cycle "Bench Round 2" — the
> maintainer pivoted to "Open & Committed" (matching
> the public `frontend/roadmap/v0.14.5.html` tagline
> published in PR #221). Per-cycle detail is in
> `docs/v0.14.5_plan.md` + the v0.14.5 cycle block
> in `ROADMAP.md`.

**Open dependencies (still pending):** the N52 / N54
`[needs verification, N5x/E9x bench]` markers
attached to the four new OBD-II PIDs are retired only
when a real-car report lands via
`docs/validation/n5x-real-car.md`. Same pattern as
the v0.14.2 + v0.14.3 N62 cycle. The harness doc
(PR #224) is the report-back loop.

## v0.15.0 — "Live Gauges from the Bench" (Shipped 2026-08-05) ✓

**Premise:** v0.14.0 shipped the Live Gauges panel
as **sim-only** by explicit user decision (the
v0.14.2 cycle-pick conversation, Option B). v0.15.0
connected the existing `read_live_data` UDS path to
the Live Gauges panel so it shows **real data on the
K+DCAN cable**, without the OBDLink SX acquisition
the v0.14.0 Tier B was waiting for. The
"**DID-projection bridge**" the v0.14.2 plan deferred
to v0.14.3+ lands here.

**Tier split:** 5 Tier A + 0 Tier B + 1 Tier C in the
slice list (cycle plan + ROADMAP header + CHANGELOG
entry; DID-projection bridge + K+DCAN source adapter;
K+DCAN data source wiring module; main.js caller
integration + Live Gauges `setSource`; docs-amend
reflecting the actual 4-slice shape; release cut).
Tag `v0.15.0` pushed at `39f78eb`; draft release
promoted to public at
<https://github.com/ohgeeceee/beemuu/releases/tag/v0.15.0>
with both Windows installer assets attached
(`BeeEmUu_0.15.0_x64-setup.exe` +
`BeeEmUu_0.15.0_x64_en-US.msi`).

> **Note (revised 2026-08-05):** the cycle shipped as
> 5 Tier A slices (PRs #228, #229, #234, #235, #237)
> instead of the original plan's "1 + 2 + 3" shape. The
> planned Tier B slice 3 (`update_can_listen` async Tauri
> command) was dropped: the frontend converged on
> main.js driving `read_live_data` polling directly
> (the existing async Tauri command added in v0.14.2 /
> PR #175). v0.15.0 ships as frontend-only — exactly what
> the plan's "what this cycle does NOT ship" list
> promised (no `transport/**`, no `protocol/**`, no
> `commands.rs` changes, no new crates). Per-cycle
> detail is in `docs/v0.15.0_plan.md` + the v0.15.0
> cycle block in `ROADMAP.md`.

## v0.15.1 — "Test-Plan Walks on the Bench" (Aug 2026, **active cycle**)

**Premise:** v0.7.0 / v0.8.0 / v0.9.0 / v0.10.0 shipped
the walkthrough bundle, the test-plan walk reducer,
the verified routine marker, and the share-as-HTML
export — all on the simulator. v0.15.1 ports the
test-plan walk to **real-car sessions**: walks against
the K+DCAN cable, records results against the real
freeze-frame data, exports to the same self-contained
HTML.

**Tier split:** 2 Tier A + 1 Tier B.

### Candidate slices

1. 🟢 **Test-plan walk on real freeze-frames** (Tier A,
   frontend). Reuses the v0.14.0 freeze-frame schema
   split (PR #170) so each walk step knows which
   freeze-frame fields to read from which DME.
2. 🟡 **`record_walk_result` async Tauri command**
   (Tier B, Rust). Saves a walk outcome
   (passed/failed/skipped per step) to
   `<HOME>/beeemuu/walks/<timestamp>.json`. Mirrors
   the v0.12.0 DTC history pattern. `async_commands`
   allowlist guard applies.
3. 🟢 **Walk export to HTML includes real freeze-frame
   snippets** (Tier A, frontend). The v0.11.0
   share-as-HTML PR (#142) embeds the freeze-frame in
   the HTML; this slice ensures the embedded
   freeze-frame is the **real one** for walks on
   real cars, not the simulator's.

**Open dependencies:** v0.15.0's DID-projection bridge
is the optional source for the walk's per-step
freeze-frame data; without it, the walk uses the
existing `read_freeze_frame` async command. No hard
dependency.

> **Note (revised 2026-07-29):** this cycle used to
> be v0.15.2 in the original PR #180 draft; renumbered
> to v0.15.1 because the v0.15.1 "Async Refactor" cycle
> is a no-op (see top-of-doc revision note).

## v0.15.2 — "Service Functions on Real Cars" (Dec 2026)

**Premise:** v0.8.0 shipped the routine ID / risk
classification / simulator-grade `[UNVERIFIED]`
marker. v0.15.2 is the cycle that **graduates
routines from unverified to chassis-validated** on
a per-chassis basis. The N62/E70 N62's `bleed_dme`
(DME adaptation bleed) and the E90 N54's
`register_injector` are the reference candidates.

**Tier split:** 2 Tier A + 1 Tier B.

### Candidate slices

1. 🟢 **Per-chassis routine validation table in the
   community profile** (Tier A, data). A new
   `[[profile.routine_validation]]` block in each
   profile TOML that pins which routine IDs are
   chassis-confirmed for which DME firmware.
2. 🟢 **`run_service_function` reads the per-chassis
   validation table** (Tier A, frontend). When a
   routine is run, the UI surfaces the
   chassis-validation status, not just the global
   `verified: bool`.
3. 🟡 **`list_service_functions` filter by chassis
   validation** (Tier B, Rust). The command now
   returns a `verified_for: Vec<ChassisKey>` field;
   the frontend uses this to grey out routines that
   aren't validated for the selected profile.

**Open dependencies:** requires at least one E70
N62 + one E90 N54 report from the harness docs
(v0.14.2 N62 + v0.14.5 N5x + this cycle). If the
community hasn't filed any, the cycle is "ship
the schema and wait."

## v0.15.3 — "Tier B Cleanup" (Dec 2026, parallel)

**Premise:** CLAUDE.md rule 5 ("never widen a PR's
scope after opening") + the multi-writer skill's
Tier B/C gate has built up a list of **refactor-only
carve-outs** that have been deferred across multiple
cycles: the `bmw_diag/` bulk deletion, the
`server/dtc/` bulk deletion, the ENET/DoIP
transport auto-detection (RoW), BLE adapter
support, WiFi adapter support, tester present
keep-alive (already shipped — see
`src-tauri/src/keepalive.rs`). v0.15.3 takes the
**docs-only + refactor** backlog in one cycle.

**Tier split:** 0 Tier A + 2 Tier B (refactor) + 1
Tier C (deprecation decision).

### Candidate slices

1. 🟢 **Delete `bmw_diag/` + `server/dtc/` dead
   modules** (Tier B, refactor). The pre-rename
   `bmw_diag/` and the `server/dtc/` Flask
   templates have been commented-out in the repo
   since v0.5.0. No consumers; deleting shrinks the
   surface area for new contributors.
2. 🟢 **Consolidate the four test runners** (Tier B,
   refactor). `cargo test`, `node --test`,
   `pytest backend/tests/`, and the front-end
   `vitest` / `node --test` glob are four different
   invocations across four different directories.
   A `make test` (or `just test`) recipe with one
   entry point per runner is the cleanup.
3. 🟡 **Deprecate or commit to the ENET / DoIP /
   BLE / WiFi backlog** (Tier C, decision). Either
   a GitHub issue per item with an explicit
   "deferred to v0.20+" milestone + a `help wanted`
   label, or a v0.16.x cycle that picks one of
   them. **Not** a code change — a decision
   document the maintainer signs off on.

> **Note (revised 2026-07-29):** the original
> v0.15.4 plan included "tester present keep-alive"
> in the backlog list. That's already on main (see
> top-of-doc revision note) and is removed from this
> cycle's decision document.

**Open dependencies:** the Tier C slice is a
Decision, not a code change. Per CLAUDE.md rule 2 +
the multi-writer skill's "Tier C = always a human
decision (propose, never execute)," this cycle's
Tier C slice is a `docs(v0.15.3): deprecate backlog
decision` PR with a clear yes/no/move-to-16.x
recommendation for each item.

## v0.15.4 — "Profile Edit Workflow" (Jan 2027)

**Premise:** the v0.14.3 slice 3 (per-PID
remove-from-profile UI) exposed the workflow gap:
the user can now click "×" to remove a PID from the
active session, but the change is local-only — on
the next profile load, the PID comes back. v0.15.4
is the cycle that **lets the user persist profile
edits** (add/remove/rename a PID, change a unit,
tweak a min/max range) and round-trips the edited
profile to a user-writable copy at
`<HOME>/beeemuu/profiles/<id>.toml`.

**Tier split:** 2 Tier A + 2 Tier B.

### Candidate slices

1. 🟢 **User profile directory bootstrap** (Tier A,
   Rust). `ensure_user_profiles_dir()` creates
   `<HOME>/beeemuu/profiles/` on first run. Read
   precedence: user dir first, then bundled.
2. 🟢 **Profile read precedence: user > bundled**
   (Tier A, Rust + frontend). `list_profiles`
   returns the merged set; the user copy shadows
   the bundled one. A new
   `profile_source: "bundled" | "user"` field
   surfaces in the UI.
3. 🟡 **`save_profile` async Tauri command** (Tier B,
   Rust). Writes the edited TOML to the user dir.
   Validates against the schema before write.
   `async_commands` allowlist guard applies.
4. 🟡 **`remove_profile_pid` async Tauri command**
   (Tier B, Rust). The v0.14.3 Tier B slice lands
   in v0.15.4 because the user-profile dir
   bootstrap is the prerequisite for the command
   to have a writable target.

**Open dependencies:** none — the async invariant
is already on main (see top-of-doc revision note).
This cycle and v0.15.0 / v0.15.1 / v0.15.2 can
land in any order.

## v0.16.0 — "The Tier B Land Rush — BLE / WiFi / ENET" (Q1 2027)

**Premise:** with the async refactor done, the Tier B
transport backlog from v0.15.3's decision document
becomes a land rush. v0.16.0 picks **one Tier B
transport item** as the cycle's spine and adds the
chassis-validation + harness-doc infrastructure to
make future Tier B items faster to ship.

> **Note (revised 2026-07-29):** the original PR #180
> draft made v0.16.0's spine ISO-TP multi-frame.
> That's already on main (see top-of-doc revision
> note), so the spine is re-picked. Three candidates:
>
> - **BLE adapter support** (Vgate iCar Pro BLE,
>   OBDLink CX) — requires the `btleplug` crate.
>   Reuses the existing `transport::Transport` trait.
> - **WiFi adapter support** (Vgate iCar Pro WiFi,
>   OBDLink MX+) — reuses the existing `tokio`
>   async stack; closest to the existing
>   `transport::enet` shape.
> - **ENET/DoIP auto-discovery** (the F/G-series
>   broadcast UDP discovery to port 13400) —
>   closes a long-standing manual-IP entry gap in
>   the desktop app.
>
> **Default spine: BLE adapter support.** It's the
> transport class with the most community asks, the
> `btleplug` crate is the smallest dependency to
> add, and the trait surface is uniform with the
> existing serial-port transport.

**Tier split:** 1 Tier A + 2 Tier B.

### Candidate spine: BLE adapter support

1. 🟢 **`transport::ble` module + `BtleTransport`
   impl** (Tier B, Rust). Implements the existing
   `Transport` trait over the `btleplug` API.
   RFCOMM channel for SPP-over-BLE (the OBDLink CX
   protocol). Reuses the existing `kdcan.rs`-style
   byte framing.
2. 🟡 **`Transport::Btle { device_name, channel }`
   variant in `connect`** (Tier B, Rust). Adds the
   new transport to the connection-state machine.
   The desktop app's Connect panel grows a
   "Bluetooth" option alongside the existing
   "Serial" and "ENET" options.
3. 🟢 **`docs/validation/ble-adapter.md` harness
   doc** (Tier A, docs). Step-by-step report-back
   loop for the new transport, mirroring the
   existing `can-broadcast.md` / `n62-real-car.md`
   shape.

**Open dependencies:** none — the async refactor
is on main. v0.15.3's Tier C deprecation decision
commits the maintainer to picking BLE / WiFi / ENET
for v0.16.0.

## v0.16.1 — "Bundle Export 2.0" (Q1 2027)

**Premise:** v0.11.0 shipped the walkthrough-as-HTML
export (PR #142). v0.16.1 is the cycle that
generalises the export shape: any log + walk +
freeze-frame combination into a single self-contained
HTML, viewable in any browser, no JS framework
required.

**Tier split:** 2 Tier A + 0 Tier B.

### Candidate slices

1. 🟢 **Multi-tab bundle export** (Tier A, frontend).
   Tab strips: walk + log + freeze-frame + DTC
   table. Reuses the v0.11.0 self-contained HTML
   scaffold.
2. 🟢 **PDF export via the browser's print
   stylesheet** (Tier A, frontend). A `Print to PDF`
   button that triggers `window.print()` after a
   `@media print` stylesheet hides the controls. No
   new crate, no headless browser.

## v0.16.2 — "Multi-Profile Sessions" (Q2 2027)

**Premise:** every cycle's harness doc has said
"verify on your car, file a report." A multi-profile
session lets the shop owner / tuner load **two
profiles at once** (e.g. B58 N55 + the M-tuned B58
variant), run a walk on both, diff the freeze-frames,
and export the diff as a single HTML.

**Tier split:** 1 Tier A + 2 Tier B.

### Candidate slices

1. 🟢 **Side-by-side profile panel** (Tier A,
   frontend). Two profile dropdowns; the Live
   Data tab shows the selected profile's gauges
   on the left, the comparison profile's on the
   right. Pure presentation; the existing
   `read_live_data` handles both calls.
2. 🟡 **Freeze-frame diff** (Tier B, frontend +
   Rust). Pick a DID, show the two profiles'
   last-known values + the delta. The Rust side
   computes the diff; the frontend renders it.
3. 🟡 **Diff export to HTML** (Tier B, frontend).
   Reuses the v0.16.1 multi-tab bundle scaffold.

**Open dependencies:** the v0.14.0 freeze-frame
schema split (PR #170) is the foundation; the
per-DID freeze-frame read needs the v0.16.0 ISO-TP
multi-frame to ship first if the freeze-frame is
> 6 bytes.

## v0.16.3 — "OBD-II Mode 09 (vehicle info)" (Q2 2027)

**Premise:** v0.16.0's ISO-TP multi-frame (already
on main — see top-of-doc revision note) + the
v0.14.0 freeze-frame schema split together unblock
OBD-II Mode 09 reads, the standard "tell me about
this car" service used by every generic OBD-II
scanner. Mode 09 PID 02 (VIN) is the fallback for
cars that don't expose the BMW-specific
UDS 22 F190 / KWP 1A 90 paths that `read_vehicle_info`
already reads (see `src-tauri/src/commands.rs:454`).
Mode 09 PIDs 04 (calibration ID) and 06 (CVN) are
not exposed by any existing command.

> **Note (revised 2026-07-29):** the original PR
> #180 draft had v0.16.3 as a 2-cycle with the
> BMW-specific VIN read as the spine. That's already
> on main as `read_vehicle_info`. v0.16.3 is
> therefore shrunk to the OBD-II Mode 09 layer only
> — a 1-Tier-A + 1-Tier-B cycle.

**Tier split:** 1 Tier A + 1 Tier B.

### Candidate slices

1. 🟢 **Mode 09 PID 02 (VIN) + 04 (calibration ID)
   + 06 (CVN)** (Tier A, Rust). Pure protocol
   additions. The existing `read_did` command's
   encoding already covers the 09 xx shape; this
   is a new command-path entry. Extends
   `read_vehicle_info` with a `mode09: bool` flag.
2. 🟡 **Vehicle info tab "Calibration" sub-panel**
   (Tier B, frontend). New tab in the desktop
   app; displays the Mode 09 VIN + calibration IDs
   + CVN alongside the existing BMW-specific VIN.
   Exports the combined vehicle info as a one-shot
   JSON the user can attach to a forum post.

**Open dependencies:** the ISO-TP multi-frame is
on main; the new `read_vehicle_info { mode09: true }`
path needs it because Mode 09 PIDs are typically
> 6 bytes.

## v0.16.4 — "B58 / N55 / N20 (modular B-family) UDS DIDs" (Q2 2027)

**Premise:** the v0.3.0 / v0.4.0 / v0.5.0 / v0.6.0
cycles shipped B58 and N55 DIDs based on OBDb's
published list. The list is not complete — many DIDs
are commented out pending real-car validation.
v0.16.4 is the cycle that **uncomments the DIDs
that the harness docs (v0.14.2 / v0.14.5 / v0.15.1)
have validated**, plus the F/G-series-specific DIDs
that require ENET (not K+DCAN).

**Tier split:** 2 Tier A + 0 Tier B.

### Candidate slices

1. 🟢 **Uncomment B58/N55 DIDs that the v0.14.5 /
   v0.15.1 reports confirm** (Tier A, data).
   Decode corrections as needed. Pure profile
   edits.
2. 🟢 **`docs/validation/b58-real-car.md` +
   `n55-real-car.md` harness docs** (Tier A, docs).
   Mirrors the v0.14.2 N62 harness doc shape.

**Open dependencies:** the F-series ENET owner
(per `ROADMAP_ISSUES.md` issue 2). The harness
doc makes the request explicit; if no report
files, the cycle closes without uncommenting
anything.

## v0.16.5 — "Odometer Sync" (Q3 2027)

**Premise:** `read_vehicle_info` already returns a
`mileage_km` field (see
`src-tauri/src/commands.rs:454`), so the read half
of this cycle is shipped. v0.16.5 **persists the
mileage across sessions** (so the dashboard shows
the last-known value when the car is off) and
exposes a "set odometer" action (with the dialog
plugin confirmation) for cases where the DME was
reset.

> **Note (revised 2026-07-29):** the original
> PR #180 draft had v0.16.5 starting from a clean
> slate. Half the work is already done — the read
> path exists. v0.16.5 is therefore shrunk to the
> persistence + write path only.

**Tier split:** 1 Tier A + 1 Tier B.

### Candidate slices

1. 🟢 **Last-known mileage cache** (Tier A, Rust +
   frontend). `<HOME>/beeemuu/last_mileage.json`
   keyed by VIN. The dashboard reads this on
   launch if no live data is available.
2. 🟡 **`set_odometer` async Tauri command** (Tier B,
   Rust). Writes a new mileage to the DME.
   Confirmation dialog mandatory (it's a write).
   `async_commands` allowlist guard applies.

**Open dependencies:** none — the async refactor
is on main.

## v0.16.6 — "Calibration Compare" (Q3 2027)

**Premise:** the v0.16.3 Mode 09 cycle's calibration
ID read + the existing `read_vehicle_info`
calibration decode together enable a "Calibration
Compare" workflow: read the current calibration ID
via Mode 09 PID 04, compare against the
expected-for-this-DME-firmware ID, flag mismatches.

**Tier split:** 1 Tier A + 1 Tier B.

### Candidate slices

1. 🟢 **Calibration ID cache + expected-firmware
   table** (Tier A, Rust).
   `<HOME>/beeemuu/calibration_ids.toml` with the
   per-DME-firmware expected IDs (community-curated).
2. 🟡 **Calibration mismatch warning in the
   Vehicle Info tab** (Tier B, frontend). Yellow
   border on the tab if the read ID doesn't
   match; one-click report-to-issue.

## v0.16.7 — "Multi-ECU Diagnostic Sweep" (Q3 2027)

**Premise:** the v0.12.0 DTC history per-module
recorder (v0.12.0 PRs #144-#148) is per-address. A
multi-ECU diagnostic sweep reads **every present
module's DTCs in one go** and exports the table as
a single CSV.

**Tier split:** 1 Tier A + 1 Tier B.

### Candidate slices

1. 🟢 **Multi-ECU DTC table view** (Tier A, frontend).
   New tab; rows are (module, DTC code, status,
   first seen, last seen). Reuses the v0.12.0
   `dtc_history.js` for the per-row data.
2. 🟡 **`sweep_all_dtcs` async Tauri command**
   (Tier B, Rust). Iterates over the `ecus.rs`
   address table, calls `read_dtc_info` for each
   present module, aggregates.

**Open dependencies:** the ISO-TP multi-frame is
on main (v0.16.0) — the full DTC list per module
is > 6 bytes on most DMEs.

## v0.16.8 — "Adaptive Value Reset" (Q4 2027)

**Premise:** the BMW DME has a set of "adaptation
values" that the ECU learns over time (idle air,
knock threshold, fuel trim). v0.16.8 is the cycle
that **exposes the reset action** with the dialog
plugin's confirmation (per CLAUDE.md Tier B + the
v0.14.1 #161 fix pattern).

**Tier split:** 0 Tier A + 1 Tier B.

### Candidate slices

1. 🟡 **`reset_adaptations` async Tauri command**
   (Tier B, Rust). Per-DME-firmware routine ID
   (the `register_injector` routine in v0.8.0 is
   the shape). Confirmation dialog mandatory.
   `async_commands` allowlist guard applies.

## v0.16.9 — "Year-End Cleanup" (Q4 2027)

**Premise:** the v0.15.3 cycle is the first "Tier B
Cleanup" cycle. v0.16.9 is the **second** — by Q4
2027 there will be 12+ cycles of accumulated minor
cleanups (dead code, schema drift, doc rot).
v0.16.9 is a no-feature cycle that pays down the
technical debt and re-baselines the docs.

> **Note (revised 2026-07-29):** the v0.16.9 doc-rot
> pass should also re-verify every "NOT YET
> IMPLEMENTED" / "planned v0.x.x" claim in the repo
> (the same audit this revision was based on). The
> 2026-07-29 audit found at least 4 false claims
> (CLAUDE.md:124/132/137/155,
> `.claude/agents/fix-drafter.md:53`); there will be
> more by Q4 2027. The v0.14.6 cycle this 2026-08-02
> audit ships is itself a doc-rotation close-of-
> cycle, the same pattern v0.16.9 will repeat.

**Tier split:** 3 Tier A (docs + tests) + 1 Tier B
(refactor) + 0 Tier C.

### Candidate slices

1. 🟢 **Doc rot audit** (Tier A, docs). Re-verify
   every link in every `docs/validation/*.md`
   resolves. Refresh `docs/DECODE_FUNCTIONS.md` to
   match the current decoder catalog (will have
   grown to 11+ decoders by then). Re-verify
   every "NOT YET IMPLEMENTED" / "planned v0.x.x"
   claim against the actual state of the repo.
2. 🟢 **Test coverage audit** (Tier A, tests).
   Every `#[tauri::command]` has a
   `cargo test --lib` test; every `src/js/*.js`
   has a `.test.js` companion; every
   `backend/seed_*.py` has a test in
   `backend/tests/`. The "needs test" gaps go into
   1-2 follow-up Tier A PRs.
3. 🟡 **Dependency bump sweep** (Tier A, CI). Bump
   every Dependabot PR that's been open > 30 days.
   Update the pinned `tauri-action@v?` per the
   v0.7.0 cycle convention.
4. 🟡 **Bulk rename of `beeemuu` → `beemuu` in any
   remaining user-visible string** (Tier B,
   refactor). The repo `beemuu` / `beeemuu`
   inconsistency was documented in the CLAUDE.md
   history. v0.16.9 is the cycle that pays it down
   (or explicitly documents why it stays).

## Cross-cutting items (not tied to a single cycle)

These are the items that span every cycle in this
roadmap. They are **tracked in
`docs/ROADMAP_ISSUES.md`** (or the v0.16.x equivalent)
and are the long-tail work:

- **ENET/DoIP auto-detection** (CLAUDE.md's stated
  invariant, not yet implemented). The K+DCAN
  cable + the OBDLink SX are the two transports
  supported today; ENET is the third. The v0.16.0
  spine is BLE; ENET auto-detect is the natural
  v0.16.x follow-up.
- **WiFi adapter support** (Vgate iCar Pro WiFi,
  OBDLink MX+). Similar to BLE but on the network
  transport. Likely a v0.16.x follow-up to
  v0.16.0.
- **Tester Present keep-alive** — **DONE on main.**
  See `src-tauri/src/keepalive.rs`. Removed from
  the cross-cutting list.
- **ISO-TP multi-frame** — **DONE on main.** See
  `src-tauri/src/transport/isotp.rs`. Removed from
  the cross-cutting list.
- **E-series CAN broadcast frames from a real car**
  (`docs/validation/can-broadcast.md`). v0.14.0
  Tier B was gated on OBDLink SX; v0.15.0's
  DID-projection bridge is the path that doesn't
  need the OBDLink SX at all. The harness doc
  remains open until a real-car report files.
- **Async invariant regression guard** — **ON
  main.** See `src-tauri/tests/async_commands.rs`
  (24-entry `SYNC_ALLOWLIST`, AST parse + set
  diff per PR). Removed from the cross-cutting
  list.
- **N52 / N54 E9x owner harness reports** — the
  `[needs verification, N5x/E9x bench]` markers
  on the four v0.14.5 PIDs (`0x5C` / `0x5E` /
  `0x5F` / `0x62`) are retired only when a real-
  car report lands via
  `docs/validation/n5x-real-car.md` (PR #224).
  Same pattern as the v0.14.2 + v0.14.3 N62
  cycle.

## Tier summary

- Tier A (no human review): ~17 slices across the
  12 cycles. The v0.14.6 cycle adds 1 Tier A
  slice (the doc-rotation closeout).
- Tier B (one human merge): ~14 slices. The biggest
  single batch is **v0.16.0's BLE/WiFi/ENET
  spine** (1 cycle, ~2-3 Tier B slices), the
  natural follow-up to the async refactor.
- Tier C (always a human decision): 0-2 per cycle.
  v0.15.3 has one (deprecate-the-backlog decision);
  v0.16.0 has one (release cut); every other cycle
  has the release cut. **The v0.14.5 release cut
  (PR #225) was Tier C and shipped 2026-08-02.**

## Open questions for the maintainer

1. **Is v0.16.0's spine BLE / WiFi / ENET, or should
   the Tier B land rush pick a different item**
   (per-chassis routine validation deepening, the
   `remove_profile_pid` user-profile work,
   tester-present keep-alive refinement)? The
   v0.15.3 decision document is the right place
   to commit to one. **Default: BLE.**
2. **Multi-Profile Sessions (v0.16.2) is a Tier
   B-heavy cycle. Is the user actually asking for
   that, or is it a nice-to-have that's eating
   cycles that should go to BLE / WiFi / ENET?**
   The v0.15.3 decision document is also the
   right place to defer it.
3. **The doc says "year 2026" / "year 2027"** in
   the cycle cadence, but the cadence is per-cycle
   not per-quarter. If the user wants quarterly
   releases, every cycle becomes a single-slice
   cycle. If the user wants the 3-5-day-per-slice
   v0.14.0 / v0.14.2 cadence, the year estimates
   are right.
4. **The `release.yml` workflow's "Update beemuu.com
   landing page" step is failing on every release
   run** (v0.14.4 + v0.14.5) because the
   `BEEMUU_VPS_SSH_KEY` / `BEEMUU_VPS_HOST` secrets
   aren't configured in the repo. The landing page
   is `stuck` on the version the previous manual
   VPS deploy synced. Should v0.14.6 (or a sibling
   Tier A docs PR) add a `release.yml` change that
   makes the landing-page step best-effort (don't
   fail the whole release when secrets are missing)
   + document the secret-requirements in
   `CONTRIBUTING.md` or a new
   `docs/ops/release-yml-secrets.md`? **Default:
   yes, ship the docs change in v0.14.6 alongside
   the audit PR.**

## Revision history

- **2026-08-02 (v0.14.6 audit):** closed out the
  v0.14.4 entry (renamed "N62 Bench Verification"
  → "Story Coverage" + added the actual close-out
  status from PR #208 + tag `v0.14.4` at
  `4de03ee`); closed out the v0.14.5 entry
  (renamed "Bench Round 2" → "Open & Committed" +
  added the actual close-out status from PRs
  #222 / #223 / #224 + Tier C release cut #225 +
  tag `v0.14.5` at `9249b934` + public release
  URL); added the v0.14.6 entry at the top of
  the cycle list (the Forward Roadmap Audit
  cycle, in flight); updated the v0.15.0 entry's
  status blockquote to reflect the v0.14.5
  close-out + v0.14.6 audit; preserved the
  v0.15.1 / v0.15.2 / v0.15.3 / v0.15.4 / v0.16.0
  – v0.16.9 cycle list as forward-looking
  candidates; added a 4th badge state (✅ Shipped)
  to the legend; added the v0.14.5 N5x harness
  doc to the cross-cutting list; updated the
  "Open questions" section with a v0.14.6 question
  about the `release.yml` landing-page step.
  Audited against `main` @ `5743348` (the post-#225
  v0.14.5 release tip).
- **2026-07-29 (revised):** audited against
  `main` @ `b029aa6` after the user reported the
  forward roadmap contained stale claims.
  Removed v0.15.1 (async refactor already on
  main), reworked v0.16.0 spine (ISO-TP
  multi-frame already on main, pivoted to BLE /
  WiFi / ENET), shrunk v0.16.3 (read_vehicle_info
  is partial shipped) and v0.16.5 (mileage read
  is shipped), added revision notes at the top
  of each affected cycle. Cross-cutting list
  trimmed: removed the 3 items that are already
  on main (async invariant, tester-present
  keep-alive, ISO-TP multi-frame).
- **2026-07-29 (original, PR #180):** initial
  12-cycle forward roadmap, drafted before the
  audit against the current state of `main`.
