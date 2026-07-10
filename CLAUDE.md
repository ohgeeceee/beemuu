# CLAUDE.md — Guardrails for AI agents working on Beemuu

Beemuu is an open-source BMW diagnostics tool (Tauri + Rust backend, web frontend,
plus a Python core in `bmw_diag/`). Code here can flash ECUs and talk to real
vehicle hardware. Correctness and timing are safety-relevant. Read this file fully
before making changes.

## Golden rules

1. **Never push to `main`.** All work lands as a pull request for human review.
2. **Never merge a PR that touches code.** Only doc-only PRs may auto-merge.
3. **Never widen scope.** Make the smallest change that satisfies the task.
4. **Always add/keep tests passing** (`cargo test` for Rust, `pytest` for `bmw_diag/`).

## Protected paths — extra caution, always human-reviewed, never auto-merged

- `src-tauri/src/transport/**` — K+DCAN (serial/FTDI) and ENET/DoIP transport
- `src-tauri/src/protocol/**` — byte-level UDS/KWP parsing and security access
- `src-tauri/src/commands.rs` — Tauri command surface / threading boundary
- `bmw_diag/core/**` — Python protocol, ECU, and interface core

If a task requires editing these, still open a PR, but flag it prominently and
request human review. Do not treat these as routine.

## Hardware & timing invariants (do not break)

- **Async commands.** Any `#[tauri::command]` that touches the serial port or
  network transport MUST be `async fn`. Non-async commands run on the main thread;
  blocking I/O there freezes the entire webview. Async commands taking
  `tauri::State` must return a `Result` or they fail to compile.
- **Tester Present keep-alive.** During active diagnostic sessions, a `3E 00` /
  `3E 80` frame must be sent every 2000–4000 ms on an async/isolated worker.
  Never let a long-running operation block the event loop, or the ECU drops the
  session mid-operation.
- **Protocol/UI decoupling.** Keep serialization, handshake timers, and byte
  parsing decoupled from the UI render layer. UI rendering can drop bytes or add
  micro-stutters to serial streams; the comms engine must run asynchronously and
  isolated.
- **No hardcoded car IPs.** F/G-series uses DoIP: broadcast UDP discovery to port
  `13400` and use the VIN/IP the car returns (typically `169.254.x.x`). Broadcast
  across all active interfaces; never hardcode a target IP.
- **K+DCAN latency timer is hardware, not software.** Sequential block reads rely
  on the FTDI VCP latency timer being 1 ms. Do NOT "fix" slow reads by inflating
  software thread timeouts — detect/alert on the port setting instead.
- **VIN reads go through `protocol::read_vin`.** It handles the UDS `22 F1 90`
  (F/G/sim) vs KWP `1A 90` (E-series DME, CAS fallback) split. Don't call a raw
  DID read.

## PR expectations

- Describe what changed and how you verified it.
- Link the issue you're resolving.
- Call out any protected-path changes at the top of the description.
