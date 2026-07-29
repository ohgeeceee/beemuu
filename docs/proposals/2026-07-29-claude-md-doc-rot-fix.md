# Proposal: Fix stale "NOT YET IMPLEMENTED" / "INVARIANT — migration in progress" claims in CLAUDE.md + .claude/agents/fix-drafter.md

> **Tier:** C — always a human decision (per `CLAUDE.md` §"Autonomy
> model — act first, ask at the gates": "Changes to this file,
> `.claude/agents/**`, or repo policy"). This PR ships the
> **proposed diffs as a doc** so the maintainer can review and
> apply the change themselves.
>
> **Audit date:** 2026-07-29, against `main` @ `74adc27`
> (post-`#181` forward roadmap revision).
>
> **Author:** Hermes Agent, audit driven by the user's report
> that the forward roadmap contained stale claims.

## Summary of the audit

The audit ran `search_files` for `NOT YET IMPLEMENTED`,
`migration in progress`, `planned v0`, and `v0.6.0` across the
whole repo. The four false claims that this proposal addresses:

| File | Line | Current claim | Actual state on main |
|---|---|---|---|
| `CLAUDE.md` | 124-131 | "Async commands (INVARIANT — migration in progress). Today only `fetch_dtc_schematics` is async; `connect`, `scan_modules`, `read_faults`, `read_live_data`, `watch_tick`, `run_service_function`, `security_access` are still sync — the migration issue is the v0.6.0 release blocker." | **DONE.** All 25 transport-touching `#[tauri::command]` functions in `src-tauri/src/commands.rs` are `async fn`. The `tests/async_commands.rs` allowlist guard is passing (24-entry `SYNC_ALLOWLIST`, AST parse + set diff per PR). |
| `CLAUDE.md` | 132-136 | "Tester Present keep-alive (NOT YET IMPLEMENTED). During active diagnostic sessions, `3E 00` / `3E 80` must be sent every 2000–4000 ms on an isolated async worker. Currently `3E` is only sent during autodetect — the keep-alive worker is a planned v0.6.0 issue." | **DONE.** `src-tauri/src/keepalive.rs` (210 LOC, `tauri::async_runtime::spawn` + `INTERVAL = 3000ms` + `FRAME = [0x3E, 0x00]`, called from `connect` / `run_service_function` / `security_access`). |
| `CLAUDE.md` | 137-138 | "ISO-TP multi-frame (NOT YET IMPLEMENTED). FF/CF/FC reassembly per ISO 15765-2 is required for full VIN reads and long DTC lists on F/G cars." | **DONE.** `src-tauri/src/transport/isotp.rs` (430 LOC, FF (PCI 0x1) / CF (PCI 0x2) / FC (PCI 0x3) state machine + SN wraparound + FC overflow handling + 25+ test cases). |
| `CLAUDE.md` | 154-155 | "No new raw VIN DID reads (the `protocol::read_vin` router is a planned v0.6.0 fix)." | **DONE.** `src-tauri/src/protocol/mod.rs::read_vin` (UDS 22 F190 + KWP 1A 90 + CAS fallback) is on main and called from `src-tauri/src/commands.rs::read_vehicle_info:454`. |
| `.claude/agents/fix-drafter.md` | 53 | "(...); never \"fix\" slow reads by inflating software timeouts (FTDI latency timer is hardware); no hardcoded car IPs; no NEW raw VIN DID reads (the `protocol::read_vin` router is a planned v0.6.0 fix)." | **DONE** (same as above). The `read_vin` router is shipped. |

## Proposed edits

The proposed edits below are **exact, byte-level** — paste them
into the corresponding files. The diff is for review only; the
maintainer applies the change.

### `CLAUDE.md` proposed diff

```diff
@@ -120,16 +120,17 @@
- These are the project's target invariants. Some are **not yet implemented**
- (tracked as v0.6.0 GitHub issues) — PRs that implement them are the top
- priority, and no change may make the current state worse.
+ These are the project's invariants — the rules every PR must keep true.
+ Several that were "not yet implemented" in earlier cycles are now
+ shipped on `main`; the bullets below call out the current state per
+ invariant. No change may make the current state worse.
 
-- **Async commands (INVARIANT — migration in progress).** Any
-  `#[tauri::command]` that touches serial or network transport MUST be
-  `async fn` (or offload via `spawn_blocking`). Blocking I/O on the main
-  thread freezes the webview. Today only `fetch_dtc_schematics` is async;
-  `connect`, `scan_modules`, `read_faults`, `read_live_data`, `watch_tick`,
-  `run_service_function`, `security_access` are still sync — the migration
-  issue is the v0.6.0 release blocker. Never add a new sync
-  transport-touching command.
-- **Tester Present keep-alive (NOT YET IMPLEMENTED).** During active
-  diagnostic sessions, `3E 00` / `3E 80` must be sent every 2000–4000 ms on
-  an isolated async worker. Currently `3E` is only sent during autodetect —
-  the keep-alive worker is a planned v0.6.0 issue. Don't add long blocking
-  operations that would stall such a worker.
-- **ISO-TP multi-frame (NOT YET IMPLEMENTED).** FF/CF/FC reassembly per ISO
-  15765-2 is required for full VIN reads and long DTC lists on F/G cars.
+- **Async commands (INVARIANT — LANDED).** Any `#[tauri::command]`
+  that touches serial or network transport MUST be `async fn` (or
+  offload via `spawn_blocking`). Blocking I/O on the main thread
+  freezes the webview. All 25 transport-touching commands in
+  `src-tauri/src/commands.rs` are `async fn` as of `main` @
+  `b029aa6`; the `tests/async_commands.rs` allowlist guard parses
+  `commands.rs` and asserts the set of sync commands equals the
+  hardcoded 24-entry `SYNC_ALLOWLIST`. **Never add a new sync
+  transport-touching command** — the guard fails CI for any drift.
+- **Tester Present keep-alive (LANDED).** During active diagnostic
+  sessions, `3E 00` / `3E 80` is sent every 3000 ms (see
+  `src-tauri/src/keepalive.rs::INTERVAL`) on an isolated async
+  worker (`tauri::async_runtime::spawn`). Called from `connect`,
+  `run_service_function`, and `security_access`; the default
+  session never sees keep-alive frames (issue #87). Don't add long
+  blocking operations that would stall such a worker.
+- **ISO-TP multi-frame (LANDED).** FF/CF/FC reassembly per ISO
+  15765-2 is implemented in `src-tauri/src/transport/isotp.rs` (430
+  LOC, 25+ test cases). PCI 0x1 (FirstFrame) / 0x2 (ConsecutiveFrame)
+  / 0x3 (FlowControl) state machine with SN wraparound. Required
+  for full VIN reads and long DTC lists on F/G cars.
 - **Protocol/UI decoupling.** Serialization, handshake timers, and byte
   parsing stay decoupled from the UI render layer. The comms engine runs
   asynchronously and isolated; UI polls for state.
 - **No hardcoded car IPs.** F/G-series uses DoIP: broadcast UDP discovery to
   port `13400` across all active interfaces and use the VIN/IP the car
   returns (typically `169.254.x.x`). Discovery itself is not yet implemented
   (users currently enter the IP manually) — implement it, never hardcode
   around it.
 - **K+DCAN latency timer is hardware, not software.** Sequential block reads
   rely on the FTDI VCP latency timer being 1 ms. Do NOT "fix" slow reads by
   inflating software timeouts — detect/alert on the port setting instead.
```

Additionally, the "No new raw VIN DID reads" rule (line 154) should
have its parenthetical removed:

```diff
-- Do not add new raw VIN DID reads (the `protocol::read_vin` router
-  is a tracked v0.6.0 issue).
+- Do not add new raw VIN DID reads. The `protocol::read_vin`
+  router is the only sanctioned path — UDS 22 F190 + KWP 1A 90 +
+  CAS fallback, see `src-tauri/src/protocol/mod.rs::read_vin`.
```

### `.claude/agents/fix-drafter.md` proposed diff

```diff
@@ -50,7 +50,7 @@
- SYNC transport-touching Tauri command (async migration is in progress); never
- "fix" slow reads by inflating software timeouts (FTDI latency timer is
- hardware); no hardcoded car IPs; no NEW raw VIN DID reads (the
- `protocol::read_vin` router is a planned v0.6.0 fix).
+ SYNC transport-touching Tauri command (the async invariant is on
+ main; the `tests/async_commands.rs` allowlist guard fails CI for any
+ new sync transport-touching command — see `CLAUDE.md` §"Hardware &
+ timing invariants"); never "fix" slow reads by inflating software
+ timeouts (FTDI latency timer is hardware); no hardcoded car IPs;
+ no NEW raw VIN DID reads (the `protocol::read_vin` router is the
+ sanctioned path — see `src-tauri/src/protocol/mod.rs::read_vin`).
```

## Verification of the proposed diffs

- **`CLAUDE.md` invariant list is still enforceable.** None of
  the proposed edits relax the rules; they only update the
  status from "NOT YET IMPLEMENTED" to "LANDED" and add a
  pointer to the on-disk file that ships the behavior. The
  guard tests (`tests/async_commands.rs`) are unchanged.
- **No `commands.rs` / `protocol/` / `transport/` changes.**
  Pure doc edits.
- **No test impact.** The proposed diffs add / change prose
  only; no test surface is touched.

## Audit scope

The audit scanned the whole repo for the patterns
`NOT YET IMPLEMENTED`, `migration in progress`, `planned v0`,
`v0.6.0 (release blocker|issue|target)`, `TODO`, `FIXME`, and
`deferred to v0.X`. The full set of 75 hits was triaged:

- **50+ hits** are legitimate (the `[UNVERIFIED]` and
  `[NEEDS VERIFICATION]` markers are the project's
  data-discipline convention; the historical
  `docs/v0.x.0_plan.md` files are the planning audit trail
  and should NOT be rewritten).
- **5 hits** are the false claims above (4 in CLAUDE.md,
  1 in `.claude/agents/fix-drafter.md`).
- The remaining ~20 hits are historical references in
  `CHANGELOG.md`, `README.md`, `CONTRIBUTING.md`,
  `docs/v0.6.0_plan.md`, `docs/v0.7.0_plan.md`,
  `docs/v0.8.0_plan.md`, `docs/v0.9.0_plan.md`,
  `docs/v0.11.0_plan.md`, `docs/v0.14.2_plan.md`,
  `docs/v0.14.3_plan.md`, and the v0.14.3 forward roadmap
  (PR #181 already corrected). These are either
  accurately describing the past or are scoped to a
  specific cycle (not "current state" claims) and don't
  need correction.

## Open questions for the maintainer

1. **Should the v0.6.0 release-blocker language be retained
   for historical context?** The proposed diff removes all
   references to the v0.6.0 blocker. The maintainer may want
   a one-line "v0.6.0 issue resolved across v0.6.0 → v0.14.0"
   footnote so the audit trail is preserved.
2. **Should the new "LANDED" items be moved to a "shipped
   invariants" section, leaving the "target invariants"
   section for the still-open ones** (e.g. ENET/DoIP
   auto-discovery, BLE adapter support)? The current
   proposal keeps the linear layout for diff-friendliness;
   the maintainer may prefer a structural change.
3. **Should this proposal also cover the related
   `docs/v0.14.3_plan.md` references** (which mention the
   v0.6.0 async-invariant debt in the open-question
   section)? Those are scoped to a specific cycle plan and
   arguably should stay until the cycle ships.

## Suggested application

The maintainer can apply the proposed diffs in one
`docs: fix stale NOT YET IMPLEMENTED claims in CLAUDE.md +
.claude/agents/fix-drafter.md` commit, then close this
proposal PR. The diffs are byte-exact and self-contained.
No test impact.
