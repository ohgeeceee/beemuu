# BeeEmUu Swarm Coding Spec

## Goal
Implement three independent roadmap features without destabilizing the simulator:

- **A: Security Access UX** — Per-ECU unlock state tracking, retry/backoff UI, NRC-aware messages.
- **B: Freeze-Frame Schema Discovery** — Let users build per-ECU freeze-frame schemas from the Parameter Explorer and persist them to TOML.
- **C: Chart Playback / Scrubbing** — Pause, rewind, scrub, and replay recorded live-data logs with keyboard shortcuts.

## Non-Goals
- No changes to the `Transport` trait signature.
- No changes to the `protocol` service functions (identify, read_dtcs, etc.).
- No changes to the ENET or K+DCAN transport implementations.
- No new ECU profiles or live-data parameters.
- No new backend analysis algorithms beyond the `ByteWatcher` already in `analysis.rs`.

## Repo Facts
- **Stack:** Tauri v2 (Rust 2021) + vanilla JS frontend, no React/Vue.
- **Package manager:** npm (lockfile present). `src-tauri` is a Rust workspace member with `Cargo.toml`.
- **Test commands:** `cd src-tauri && cargo test` (Rust), `cargo clippy` (lint). No frontend test suite.
- **Build:** `cargo tauri build` (full) or `cargo tauri dev` (dev). The JS side is served as static files; no JS build step.
- **Theme:** Dark cockpit style (`#0b1119` bg, `#4da3ff` accent, `#e05545` danger, `#3ddc84` success). Fonts: Segoe UI.
- **Charting:** Chart.js v4.4.1 from CDN (`https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js`). Use `animation: false`, `parsing: false` for performance.
- **Tauri invoke naming:** All commands use `snake_case`. Existing ones are listed in `lib.rs`.
- **SimTransport:** Must continue answering all existing services. New services are additive only.
- **AppState:** Lives in `commands.rs`. Fields: `transport`, `watch`, `traffic`. Add new fields; do not remove existing ones.

## Shared Contracts (Do Not Break)

### Transport Trait (`transport/mod.rs`)
```rust
pub trait Transport: Send {
    fn name(&self) -> &'static str;
    fn request(&mut self, target: u8, payload: &[u8]) -> Result<Vec<u8>>;
    fn disconnect(&mut self) {}
}
```

### Protocol Service Functions (`protocol/mod.rs`)
All existing functions keep their signatures:
- `identify`, `read_dtcs`, `clear_dtcs`, `read_did`, `read_obd_pid`, `read_local_ident`, `read_freeze_frame`, `set_session`, `routine`
- `security::unlock(t, address, level) -> Result<Unlock, String>`
- `security::Unlock` enum has `Granted` and `AlreadyUnlocked`.

### Existing Tauri Commands (in `lib.rs` invoke_handler)
All existing commands remain. New commands are additive.

### Freeze-Frame Types (`data/freeze.rs`)
```rust
pub struct FreezeItem { pub label: String, pub value: String }
pub struct FreezeField { pub label: &'static str, pub unit: &'static str, pub offset: usize, pub width: Width, pub scale: f64, pub bias: f64, pub decimals: u8 }
pub struct FreezeSchema { pub fields: Vec<FreezeField> }
pub struct FreezeRegistry { /* private */ }
```
- `registry().register_for(address, schema)` and `registry().register_default(schema)` are the public API.
- `registry().decode(address, data)` returns `Vec<FreezeItem>`.

### Community Data Loading (`community.rs`)
- Loads TOML from `community/` at startup.
- Returns `LoadReport` with counts.
- Can load profiles, DTC texts, and freeze schemas.

## Task Slices

### Workstream A: Security Access UX
**Owner:** Worker A
**Allowed write paths:**
- `src-tauri/src/commands.rs` — add `unlocked` state to `AppState`, add new commands
- `src-tauri/src/protocol/security.rs` — expose `Unlock` outcome details to caller (minor)
- `src-tauri/src/lib.rs` — register new commands in invoke_handler
- `src/index.html` — add lock/unlock indicators to module tree and fault panel
- `src/js/main.js` — unlock status tracking, NRC-specific messages, retry countdown
- `src/css/app.css` — lock/unlock icon styles, countdown timer

**Forbidden:**
- `transport/mod.rs` (trait signature)
- `transport/sim.rs`, `transport/enet.rs`, `transport/kdcan.rs` (transport implementations)
- `protocol/mod.rs` service function signatures
- `data/freeze.rs`

**New commands:**
- `security_access` — already exists; extend to return `{ granted: bool, already_unlocked: bool }` or similar
- `is_unlocked(address: u8) -> bool`
- `security_status() -> Vec<{ address: u8, unlocked: bool }>` (or `HashMap<u8, bool>` serializable)

**Validation:**
- `cd src-tauri && cargo test`
- `cd src-tauri && cargo clippy`
- Connect to simulator, verify unlock button appears, verify it works, verify NRC 0x37 shows countdown

**Merge order:** After C (second).

---

### Workstream B: Freeze-Frame Schema Discovery
**Owner:** Worker B
**Allowed write paths:**
- `src-tauri/src/data/freeze.rs` — add serialization helpers, make `FreezeField`/`FreezeSchema` constructable from non-static strings (or add a builder)
- `src-tauri/src/commands.rs` — add `save_freeze_schema`, `load_freeze_schemas`, `get_freeze_schema(address)` commands
- `src-tauri/src/community.rs` — add TOML round-trip for freeze schemas (if not already present)
- `src-tauri/src/lib.rs` — register new commands
- `src/index.html` — add "Map freeze frame" panel to Parameter Explorer
- `src/js/main.js` — schema builder UI: mark offsets, name fields, pick width/scale/bias, preview decoded value
- `src/css/app.css` — schema builder styles

**Forbidden:**
- `transport/mod.rs` (trait signature)
- `transport/sim.rs` (except: must keep freeze-frame responses unchanged)
- `protocol/mod.rs` service function signatures (except `read_freeze_frame` which is fine to keep calling)
- `analysis.rs`

**New commands:**
- `get_freeze_schema(address: u8) -> Option<Vec<FreezeFieldDef>>` — where `FreezeFieldDef` is a serializable struct with label, unit, offset, width, scale, bias, decimals
- `save_freeze_schema(address: u8, fields: Vec<FreezeFieldDef>) -> Result<(), String>` — persist to `community/freeze/<address>.toml`
- `load_freeze_schemas() -> Result<(), String>` — reload from disk

**Validation:**
- `cd src-tauri && cargo test`
- `cd src-tauri && cargo clippy`
- Connect to simulator, read a freeze frame, verify default schema decodes. Build a custom schema via the UI, save, reload, verify it decodes correctly.

**Merge order:** After A (last).

---

### Workstream C: Chart Playback / Scrubbing
**Owner:** Worker C
**Allowed write paths:**
- `src/js/main.js` — logging section only (the `logChart`, `logTimer`, `logSeries`, `logTick`, `startLogging`, `stopLogging` functions and related UI)
- `src/index.html` — add play/pause/scrub controls to the Logging tab
- `src/css/app.css` — playback controls, scrubber, marker styles

**Forbidden:**
- Any `.rs` file in `src-tauri/`
- Any Tauri command registration
- The `Gauge` class in `gauges.js`
- The Parameter Explorer section of `main.js`
- The Live Data polling section of `main.js`

**Scope:**
- Replace `logSeries` with a `LogSession` class that stores all samples in a ring buffer (max 10 000 points per series, or configurable).
- Add `play()`, `pause()`, `scrubTo(time)`, `stepForward()`, `stepBack()` methods.
- When paused: show a vertical cursor on the chart; Chart.js data is sliced to `0..scrubIndex`.
- When playing: append new samples and auto-scroll the x-axis (window of last N seconds, e.g., 30s).
- Add keyboard shortcuts: Space = pause/play, ←/→ = step 1s, Shift+←/→ = step 5s.
- Add markers: double-click on chart to drop a labeled marker at that timestamp. Show markers in a list below the chart.
- Add controls: Play/Pause button, a time display (e.g., "0:12 / 2:34"), a scrubber input range, Clear markers button.
- Optionally: persist the current session to `localStorage` as JSON (key: `beeemuu-log-session-<timestamp>`) so it survives tab switch.

**Validation:**
- Connect to simulator, start logging, verify live data plots.
- Click Pause, verify chart stops updating and shows cursor.
- Scrub backward, verify chart re-renders at that time.
- Press Space, verify playback resumes.
- Double-click to add a marker, verify it appears in the list.
- Refresh page, optionally verify session restored from `localStorage`.
- No Rust changes needed, so no `cargo test`.

**Merge order:** First (no Rust dependencies).

## Integration Notes
- All three workers add new Tauri commands to `lib.rs`. The main agent will merge these additions.
- Worker A and B both add fields to `AppState`. The main agent will merge these carefully.
- Worker A and B both modify `index.html` and `main.js`. The main agent will merge these sections.
- CSS additions from all three are independent (different UI areas) and should merge cleanly.
- After all merges, the main agent will run `cargo test` and `cargo clippy` to verify.

## Final Verification Checklist
- [ ] `cargo test` passes in `src-tauri/`
- [ ] `cargo clippy` is clean in `src-tauri/`
- [ ] Simulator connects and vehicle test works
- [ ] Live data gauges work
- [ ] Logging tab: play/pause/scrub/markers work
- [ ] Security unlock works, shows status, handles NRC 0x37
- [ ] Freeze frame reads with default schema; custom schema can be saved and loaded
- [ ] Traffic log still works
- [ ] Profile import/export still works
- [ ] All worktrees cleaned up (or noted as leftover)
