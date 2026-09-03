# AGENTS.md — AI agent guide for Beemuu

Beemuu is an open-source BMW diagnostics tool. The shipping product is a
**Tauri 2 desktop app**: Rust core (`src-tauri/src`) + web UI (`src/`).
`backend/` (Python, stdlib-only) is the hosted read-only API behind
`api.beemuu.com`. Code here can interact with real vehicle hardware, so
correctness and timing are safety-relevant.

---

## Repository layout

```
beemuu/
├── src/                  # Tauri webview UI (HTML/CSS/JS)
│   ├── index.html
│   ├── css/
│   └── js/               # Frontend JS + unit tests (*.test.js, *.test.cjs)
├── src-tauri/            # Rust core (Tauri 2)
│   ├── src/
│   │   ├── commands.rs   # Tauri command surface — TIER B
│   │   ├── keepalive.rs  # Tester Present keep-alive worker
│   │   ├── protocol/     # UDS/KWP byte-level parsing — TIER B
│   │   └── transport/    # K+DCAN (FTDI) and ENET/DoIP — TIER B
│   └── tests/            # Rust integration tests (incl. async_commands.rs)
├── backend/              # Python stdlib-only hosted API (api.beemuu.com)
│   └── tests/            # pytest suite
├── community/            # TOML/JSON vehicle profiles and DTC seeds
├── frontend/             # Static landing page (beemuu.com)
├── data/                 # Bundled data (schematics, etc.)
├── docs/                 # Project documentation
└── .github/workflows/    # CI, auto-merge, release, CodeQL
```

---

## Autonomy tiers

### Tier A — land autonomously

Perform the work, open the PR, and merge it yourself once CI is green.

Applies to:
- Docs, README, CHANGELOG, release notes
- Tests (adding, fixing, wiring into CI)
- Frontend UI (`src/**`)
- Community data (`community/**` TOML/JSON profiles, DTC seeds)
- `backend/**` read-only API and its tests
- CI workflows, scripts, tooling, `.gitignore`, dependency patch/minor bumps
- Bug fixes and features outside the protected paths
- Landing page (`frontend/`) — regenerated on every tagged release

### Tier B — do the work, then request one human merge

Open the PR, get tests green, write detailed review notes, **flag the
protected path at the top of the PR description**, and wait for a human to
merge. Do not ping before that; the PR is the review.

Applies to:
- `src-tauri/src/transport/**` — K+DCAN (serial/FTDI) and ENET/DoIP transport
- `src-tauri/src/protocol/**` — byte-level UDS/KWP parsing, security access
- `src-tauri/src/commands.rs` — Tauri command surface / threading boundary
- Any code path that can write to an ECU (routines, flashing, SecurityAccess
  seed/key logic, VIN/coding writes)
- Bulk deletion of dead code
- Major-version dependency upgrades

### Tier C — propose only, never execute

- Releases: version bumps, git tags, publishing installers
- Production: deploys, `ops/**` changes, anything touching the VPS
- Changes to `CLAUDE.md`, `.claude/agents/**`, or repo policy
- Force-push, history rewrites, branch deletion
- New repos, apps, or domains

---

## Running tests

Always run tests before opening a PR.

```bash
# Rust core
cd src-tauri && cargo test

# Python backend
pytest backend/tests/

# Frontend JS
node --test "src/js/**/*.test.js" "src/js/**/*.test.cjs" "frontend/**/*.test.js"
```

On Linux (CI and bare machines) you must install Tauri system dependencies
before `cargo test`:

```bash
sudo apt-get install -y libglib2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev libudev-dev
```

---

## Enforced hardware & timing invariants

These invariants are enforced by tests or code-path contracts. No PR may
re-introduce a violation.

### Async Tauri commands
Any `#[tauri::command]` that touches serial or network transport **must** be
`async fn`. The `tests/async_commands.rs` regression guard asserts that every
non-async command is in the `SYNC_ALLOWLIST` (24 in-memory/filesystem helpers).
Adding a new sync transport-touching command fails CI.

### Tester Present keep-alive
During active diagnostic sessions, UDS `3E 00` is sent every **3 000 ms** on
an isolated async worker (`tauri::async_runtime::spawn`), implemented in
`src-tauri/src/keepalive.rs`. Never add long blocking operations that would
stall this send.

### ISO-TP multi-frame reassembly
FF/CF/FC reassembly per ISO 15765-2 is in
`src-tauri/src/transport/isotp.rs`. All callers go through `IsoTpTransport`.
Do not reintroduce single-frame-only code paths.

### VIN reads
All VIN reads go through `protocol::read_vin`
(`src-tauri/src/protocol/mod.rs`), which handles UDS `22 F1 90` (F/G/sim) vs
KWP `1A 90` (E-series). Do not add new raw VIN DID reads anywhere.

### No hardcoded car IPs
F/G-series uses DoIP with UDP broadcast discovery on port `13400`. Never
hardcode a `169.254.x.x` literal.

### K+DCAN latency timer
Sequential block reads rely on the FTDI VCP latency timer being **1 ms**. Do
**not** fix slow reads by inflating software timeouts — detect/alert on the
port setting instead.

### Protocol/UI decoupling
Serialization, handshake timers, and byte parsing stay decoupled from the UI
render layer. The comms engine runs asynchronously and in isolation; UI polls
for state.

---

## Golden rules

1. **No direct pushes to `main`.** Everything lands via PR so CI runs.
2. **Tests green before merge, no exceptions.**
3. **Smallest change that satisfies the task.** No drive-by refactors.
4. **Commit style:** `feat(vX.Y.Z): …`, `fix(vX.Y.Z): …`, `docs: …`, `chore: …`
5. **Never widen a PR's scope after opening.** New findings → new issues.
6. **Keep the version surface in sync.** Every release PR must ship a
   `## [X.Y.Z]` section in `CHANGELOG.md` and bump the release badge in
   `README.md` (line 18).

---

## PR description checklist

- What changed and how you verified it (test output, simulator run)
- Link to the issue being resolved
- For Tier B changes: flag the protected path at the very top
- Tier A: merge when CI is green; Tier B: hand to a human with review notes

---

## Topology

| Surface | Location | Notes |
|---|---|---|
| Desktop app (shipping) | `src/` + `src-tauri/src/` | Tauri 2 webview + Rust core |
| Hosted API | `backend/` → `api.beemuu.com` | Python, stdlib-only, read-only |
| Landing page | `frontend/` → `beemuu.com` | Static, auto-deployed on `v*` tags |
| Admin console | VPS only, not in repo | Tier C — never auto-deployed |

The only production host is the NJ Spectrum VPS
(`vps3490050.trouble-free.net`, `162.35.175.39`). The retired LA VPS
(`montanablotter.com`, `74.208.64.42`) is decommissioned — do not reference
or reactivate it.

## Imported Claude Cowork project instructions

# Beemuu Setup and Usage Instructions

Welcome to **Beemuu**, an open-source alternative to BMW ISTA+ for vehicle diagnostics, programming, and service functions. 

> ⚠️ **Disclaimer:** Modifying vehicle electronics carries inherent risks. Beeemuu is provided "as-is." Always connect a stable battery maintainer (minimum 15-30A) before performing any ECU flashing or deep coding.

---

## 1. Prerequisites & Environment Setup

### System Requirements
* **OS:** Windows 10/11 (Recommended for native driver support), Linux, or macOS.
* **Runtime:** Node.js v18+ (if frontend/backend-based) or Python 3.10+ (depending on your project stack).
* **Hardware Interface:** 
  * **ENET Cable / Adapter:** For F, G, and I-series models (Ethernet-to-OBD).
  * **K+DCAN Cable:** For E-series models (USB-to-OBD with FTDI chip).

### Driver Setup (K+DCAN Only)
If you are using a K+DCAN cable on Windows:
1. Download and install the latest **FTDI Virtual COM Port (VCP) drivers**.
2. Open **Device Manager**, find your USB Serial Port, go to **Properties -> Port Settings -> Advanced**.
3. Set the **Latency Timer to 1 msec** (crucial for protocol timing to prevent timeouts).

---

## 2. Quick Start / Installation

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/your-username/beeemuu.git](https://github.com/your-username/beeemuu.git)
   cd beeemuu
