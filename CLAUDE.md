# CLAUDE.md — Operating rules for AI agents working on Beemuu

Beemuu is an open-source BMW diagnostics tool. The shipping product is a
**Tauri 2 desktop app**: Rust core (`src-tauri/src`) + web UI (`src/`).
`backend/` (Python, stdlib-only) is the hosted read-only API behind
`api.beemuu.com`. Code here can talk to real vehicle hardware, so correctness
and timing are safety-relevant — but **process friction is not safety**. The
safety lives in tests, invariants, and the tier gates below, not in requiring
a human to eyeball every diff.

## Autonomy model — act first, ask at the gates

**Default behavior: do the work without asking.** Editing files, running
tests, creating branches, opening PRs, updating PRs, addressing review
comments, and merging routine changes are all pre-authorized. Do not pause
for confirmation on routine development work. The only time you stop and ask
is at a Tier B or Tier C gate below.

### Tier A — land autonomously (no human review)

Merge your own PR once checks are green, then move on.

- Docs, README/CHANGELOG/release notes
- Tests (adding, fixing, wiring into CI)
- Frontend UI (`src/**`)
- Community data (`community/**` TOML/JSON profiles, DTC seeds)
- `backend/**` read-only API and its tests
- CI workflows, scripts, tooling, `.gitignore`, dependency patch/minor bumps
- Bug fixes and features outside the protected paths

### Tier B — do all the work, then request one human merge

Open the PR, get tests green, write the review notes, **flag the protected
path at the top of the PR description**, and wait for a human to merge. Do
not ping for anything before that point — the PR is the review.

- `src-tauri/src/transport/**` — K+DCAN (serial/FTDI) and ENET/DoIP transport
- `src-tauri/src/protocol/**` — byte-level UDS/KWP parsing, security access
- `src-tauri/src/commands.rs` — Tauri command surface / threading boundary
- Anything that can write to an ECU: routines, flashing, SecurityAccess
  seed/key logic, VIN/coding writes
- Bulk deletion of dead code (e.g. dropping `bmw_diag/`, `server/dtc/`)
- Major-version dependency upgrades

### Tier C — always a human decision (propose, never execute)

- Releases: version bumps, git tags, publishing installers
- Production: deploys, `ops/**` changes, anything touching the VPS
- Changes to this file, `.claude/agents/**`, or repo policy
- Force-push, history rewrites, branch deletion
- New repos, apps, or domains (see Topology)

## Golden rules

1. **No direct pushes to `main`.** Everything lands via PR so CI runs. Tier A
   PRs you may merge yourself; Tier B/C you may not.
2. **Tests green before merge, no exceptions.** Run them locally before
   opening the PR:
   - `cargo test` (in `src-tauri/`)
   - `pytest backend/tests/`
   - `node --test` on the JS suites (`src/js/*.test.js`)
3. **Smallest change that satisfies the task.** No drive-by refactors.
4. **Commit style:** follow the repo convention, e.g.
   `feat(v0.6.0): …`, `fix(v0.6.0): …`, `docs: …`, `chore: …`.
5. **Never widen a PR's scope after opening.** New findings get new issues.

## Topology — one app, one repo, one domain

- **Repo:** `github.com/ohgeeceee/beemuu` — the only source of truth.
- **Domains (production):**
  - `beemuu.com` → landing page (static, nginx)
  - `api.beemuu.com` → hosted backend API (`backend/`, nginx → systemd unit)
- **Desktop app:** the Tauri webview (`src/`) talks to the **Rust core**
  (`src-tauri/src`) via `invoke()`. The desktop app calls the hosted API only
  for DTC schematics (`fetch_dtc_schematics` → `api.beemuu.com`).
- **No other VPS / domain.** The retired LA VPS (`montanablotter.com`,
  `beemuu.montanablotter.com`, `74.208.64.42`) is decommissioned and must not
  be referenced or reactivated. The only production host is the NJ Spectrum
  VPS (`vps3490050.trouble-free.net`, `162.35.175.39`).

If a task seems to require splitting Beemuu into multiple apps/repos/domains
— that's Tier C. Propose it; never start it.

## Hardware & timing invariants

These are the project's target invariants. Some are **not yet implemented**
(tracked as v0.6.0 GitHub issues) — PRs that implement them are the top
priority, and no change may make the current state worse.

- **Async commands (INVARIANT — migration in progress).** Any
  `#[tauri::command]` that touches serial or network transport MUST be
  `async fn` (or offload via `spawn_blocking`). Blocking I/O on the main
  thread freezes the webview. Today only `fetch_dtc_schematics` is async;
  `connect`, `scan_modules`, `read_faults`, `read_live_data`, `watch_tick`,
  `run_service_function`, `security_access` are still sync — the migration
  issue is the v0.6.0 release blocker. Never add a new sync
  transport-touching command.
- **Tester Present keep-alive (NOT YET IMPLEMENTED).** During active
  diagnostic sessions, `3E 00` / `3E 80` must be sent every 2000–4000 ms on
  an isolated async worker. Currently `3E` is only sent during autodetect —
  the keep-alive worker is a planned v0.6.0 issue. Don't add long blocking
  operations that would stall such a worker.
- **ISO-TP multi-frame (NOT YET IMPLEMENTED).** FF/CF/FC reassembly per ISO
  15765-2 is required for full VIN reads and long DTC lists on F/G cars.
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
- **VIN reads (KNOWN GAP).** All VIN reads must go through
  `protocol::read_vin`, which handles UDS `22 F1 90` (F/G/sim) vs KWP `1A 90`
  (E-series DME, CAS fallback). **That function does not exist yet** —
  `connect`/`read_vehicle_info` currently do a raw UDS DID read, which is
  broken for E-series cars. Implementing `read_vin` and routing all callers
  through it is a tracked v0.6.0 issue. Do not add new raw VIN DID reads.

## PR expectations

- Describe what changed and how you verified it (test output, simulator run).
- Link the issue you're resolving.
- Call out any protected-path (Tier B) changes at the top of the description.
- Tier A: merge when green. Tier B: hand to a human with review notes.
