# feature/hosted-dashboard-panel — implementation plan

## Goal
Add a Tauri command and UI panel that fetches the **remote VPS** dashboard from
`https://beemuu.montanablotter.com/api/dashboard` and renders it inside the
Tauri desktop app, alongside the existing local `backend_dashboard` panel.

## Why a separate command, not an extension of `backend_dashboard`

`backend_dashboard` already exists and aggregates *local* app state (transport,
traffic log, community profiles loaded locally, hunt status). That data is
already on the device. The hosted panel reports *remote* repo/build health
(commit, dirty flag, bundle artifacts on the VPS) and is read over HTTPS.

Same name, different purpose. Splitting them keeps each command focused and
testable. The UI shows both panels.

## Files touched

- `src-tauri/Cargo.toml` — add `reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "json"] }`
- `src-tauri/src/hosted.rs` *(new)* — `HostedDashboard` struct + `fetch()` function + tests
- `src-tauri/src/lib.rs` — add `pub mod hosted;`
- `src-tauri/src/commands.rs` — add `fetch_hosted_dashboard` async command (PROTECTED PATH)
- `src/index.html` — add a "Hosted" panel under the existing dashboard tab
- `src/js/main.js` — add `refreshHostedDashboard()` and wire its button

## Tauri command shape

```rust
#[tauri::command]
pub async fn fetch_hosted_dashboard(url: Option<String>) -> Result<HostedDashboard, String>
```

- `url` defaults to `https://beemuu.montanablotter.com/api/dashboard`
- 5-second timeout (Tauri calls hang the UI otherwise)
- Maps `reqwest::Error` → `String` for the frontend
- Returns the same JSON shape the VPS sends, deserialized into the typed struct

## Frontend shape

A new section in the existing dashboard tab:

```
[Connection: Connected] [Transport: kdcan] ...    (existing local)
[Hunt points: 12] [Community profiles: 6] ...
- - - - - - - - - - - - - - - - - - - - - - - -
Hosted build status (beemuu.montanablotter.com)
[Commit: e5a7103] [Branch: main] [Dirty: no] [Profiles: 6] [Bundles: 3]
- Build artifacts:
    src-tauri/target/release/bundle/deb/BeeEmUu_0.2.0_amd64.deb
    src-tauri/target/release/bundle/rpm/BeeEmUu-0.2.0-1.x86_64.rpm
    src-tauri/target/release/bundle/appimage/BeeEmUu_0.2.0_amd64.AppImage
```

Failure modes handled:
- VPS unreachable → "Hosted dashboard offline: <reason>"
- Slow (>5s) → same as above
- Bad JSON → same as above

## Verification

1. `cargo test -p beeemuu_lib hosted::tests` passes (covers struct deserialization)
2. `cargo check -p beeemuu_lib` clean
3. Manual: run `npm run dev`, open the dashboard tab, click "Refresh hosted" — see live data
4. Manual: turn off network, refresh → graceful offline message

## PR

- Title: `feat: hosted VPS dashboard panel`
- Body: links this plan, calls out the `commands.rs` protected-path change at top
- Branch: `feature/hosted-dashboard-panel`
- Target: `main`
- NO auto-merge (CLAUDE.md rule for code-touching PRs)