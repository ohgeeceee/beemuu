# BeeEmUu v0.5.1 Release Notes

> **Ground Truth + Plugins.** v0.5.1 formalizes the plugin system for custom
> decode functions — community contributors can add per-parameter enum maps via
> TOML without touching Rust. Built on the v0.4.0 `u8_enum` foundation.

## What's New

### 🔌 Plugin system for custom decoders (formalized)

The `community/` TOML loader (`src-tauri/src/community.rs`) is now an explicit
plugin system:

- New `build_u8_enum_map()` — parses `enum = { "0" = "P/N", ... }` inline tables
  (quoted decimal byte keys, silently drops invalid keys like `"256"` / `"banana"`).
- Stubs `build_u16_enum_map()` / `build_s16_enum_map()` for future `u16_enum` /
  `s16_enum` decoder variants — no Rust change needed when those land.
- `build_profile()` branches on `decode` variant so only `u8_enum` params carry
  an `enum_map`; numeric params keep an empty map (backward compatible).
- Example plugin profile: `community/profiles/test_plugin.toml` (gear / engine state).

This makes the roadmap item **"Plugin system for custom decode functions"**
(Backlog, High complexity) shippable as governance + code: add a TOML file,
restart the app, the Diagnostics tab shows what loaded.

6 new unit tests: `enum_map_parses_from_toml`, `legacy_toml_without_enum_key_still_parses`,
`parse_enum_map_drops_invalid_byte_keys` + 3 decoder round-trips in `data::live`.

### 📦 Version bump

- `package.json` `0.4.0` → `0.5.1`
- `src-tauri/Cargo.toml` `0.4.0` → `0.5.1`
- `src-tauri/tauri.conf.json` `0.4.0` → `0.5.1`
- `package-lock.json` synced
- `README.md` badge `v0.4.0` → `v0.5.1` + active cycle docs updated

## Known Limitations

- `u16_enum` / `s16_enum` stubs are not yet wired to `Decode` enum variants —
  they are placeholders for the next decoder addition. Only `u8_enum` is live
  in `src-tauri/src/data/live.rs`.
- Real-car validation for `u8_enum` example DIDs (`gear` DA0A, `engine_state` 4004,
  `knock_detect` 401F) still needs F/G-series owner with ENET adapter.

## How to Upgrade

From v0.4.0: `git pull` and restart (`npm run dev` or installer). TOML profiles
load at runtime with no recompile. Older `community/profiles/*.toml` without
`enum` keys parse unchanged (`#[serde(default)]`).

## Contributors

- **ohgeeceee** — plugin system formalization + v0.5.1 release

## Links

- Full changelog: [`CHANGELOG.md`](CHANGELOG.md)
- Roadmap: [`ROADMAP.md`](ROADMAP.md)
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Release tag: `v0.5.1`

*Released 2026-08-30. Plugin system formalized; ready for community decoder contributions.*
