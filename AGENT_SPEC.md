# Session Recorder — Agent Coordination Spec

## Goal
Add persistent session recording and a playback browser to BeeEmUu.

## Non-Goals
- Replace CSV export (keep existing export buttons)
- Change the live-data polling interval (still 250 ms)
- Modify the transport layer or simulator behavior

## Architecture
- **Rust backend**: new `session.rs` module with JSONL storage in `~/beeemuu-sessions/`
- **Frontend**: new session browser panel in the Logging tab, reuses existing `loadPlayback()`
- **Data contract**: `load_session` returns raw CSV text; frontend parses it identically to file-picker

## Interfaces (do not change without approval)
- `loadPlayback(csvText)` in `src/js/main.js` line ~710
- `export_text(filename, content)` Tauri command
- `read_live_data(profile)` Tauri command
- `logChart` (Chart.js instance) and `logSeries` Map in frontend
- Existing Tauri command signatures in `src-tauri/src/commands.rs`

## Files
- `src-tauri/src/session.rs` — new
- `src-tauri/src/commands.rs` — add 4 commands + `SessionMeta` struct
- `src-tauri/src/lib.rs` — wire `mod session`
- `src/index.html` — Logging tab additions (session browser panel)
- `src/js/main.js` — session browser UI, auto-save toggle logic
- `src/js/sessions.js` — optional: separate session UI module (Worker B may inline)

## Worker A owns (Rust backend)
- `src-tauri/src/session.rs` (session storage, list, load, delete)
- `src-tauri/src/commands.rs` (add commands: `save_session`, `list_sessions`, `load_session`, `delete_session`)
- `src-tauri/src/lib.rs` (wire `mod session`)
- Unit tests in `session.rs`

Validation:
- `cargo check` passes
- `cargo test` passes (unit test: write, list, load, delete round-trip)

## Worker B owns (Frontend UI)
- `src/index.html` — add session browser panel inside Logging tab
- `src/js/main.js` — add session browser UI logic, auto-save toggle
- Must call `loadPlayback()` with CSV from `load_session` command
- Must work against existing `logChart` and `logSeries` Map

Validation:
- `npm run dev` smoke test against simulator
- Manual test: record session, see in browser, load it, verify scrubber + replay works

## Worker C will own (Integration & QA)
- End-to-end test plan
- Verify backward compatibility: CSV export still works, file-picker still works
- Check edge cases: empty session, delete during replay, session with 10k+ samples

## Merge Order
A → B → C (merge Rust first, then Frontend on top, then QA)
