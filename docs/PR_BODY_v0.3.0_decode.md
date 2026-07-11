# feat(decode): v0.3.0 decode functions + 8 new DIDs per profile

Unlocks ~40% of previously-blocked OBDb DID data per `ROADMAP.md`,
landed in 4 commits on `chore/decommission-beemuu-montanablotter`:

| Commit  | What |
|---------|------|
| `6312241` | 7 Rust decode variants in `src-tauri/src/data/live.rs` + 17 unit tests |
| `9a33305` | 8 new DID entries per engine profile in `community/profiles/{b58,n55}.toml` |
| `6623649` | `docs/DECODE_FUNCTIONS.md` table updated + `CHANGELOG.md` `[Unreleased]` entries |
| `71f7c74` | `docs/FORUM_PLAN.md` — companion decision doc for the "forum + config sharing" half of the standing goal |

## What changed

### 7 new decode functions (`src-tauri/src/data/live.rs`)

| Function | Formula | Unlocks |
|---|---|---|
| `u16_tenths` | raw × 0.1 | battery V (4002), HPFP MPa (44F0), boost kPa (4367) |
| `u16_div100` | raw × 0.01 | MAF kg/h (4077), ambient kPa (4003), torque Nm (4501/4508/4509/400C) |
| `s16` | raw as i16 | signed 16-bit passthrough (foundation) |
| `s16_div4` | raw / 4 | DME temp (4001, signed, 0.25 °C resolution) |
| `s16_div100` | raw × 0.01 | engine torque (4500), ambient air (4016) |
| `u8_div100` | raw × 0.01 | lambda (400B), injection ms (4363) |
| `u8_div4` | raw / 4 | alternate DME temp scaling |

All variants flow through the existing `decode()` match; no new
control flow, no new dependencies, no API surface change for callers
that already go through `decode_from_str` / `decode_to_str`. The
`Decode` enum gained `Debug, PartialEq` so tests can use
`assert_eq!` cleanly.

### 8 new DID entries per profile

**`community/profiles/b58.toml`** — 11 → 19 params
**`community/profiles/n55.toml`** — 11 → 20 params (existing `local:10` oil-temp placeholder preserved for E-series KWP2000 compatibility)

Wired to the new decoders:
`battery_v` (4002), `hpfp_rail` (44F0), `boost_cmd` (4367), `maf`
(4077), `ambient_pres` (4003), `dme_temp` (4001), `eng_torque` (4500),
`lambda_1` (400B), `inj_time` (4363).

**Conflict resolution** (documented inline in each TOML):
- DID 4001 DME temp: chose `s16_div4` (signed) over the `u8_div4`
  alternate — one source of truth per channel.
- DID 4002 battery V: chose `u16_tenths` over the lower-precision
  `u8_div100` DID 4013.

## How I verified it

```text
$ cargo build --lib
Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.86s

$ cargo test --lib
test result: ok. 25 passed; 0 failed; 0 ignored; 0 measured
                   ^^^^^ including all 17 new data::live tests

$ python -c "import tomllib; ..."   # both TOML files parse cleanly
community/profiles/b58.toml: PARSED OK, 19 params, 9 entries using new v0.3.0 decoders
community/profiles/n55.toml: PARSED OK, 20 params, 9 entries using new v0.3.0 decoders
```

The 8 pre-existing tests in `analysis`, `backend_dashboard`, and
`hosted` still pass — **zero regressions**.

## Protected paths

**None touched.** All code work is in `src-tauri/src/data/live.rs`.
The protected paths (`src-tauri/src/transport/**`,
`src-tauri/src/protocol/**`, `src-tauri/src/commands.rs`,
`bmw_diag/core/**`) are untouched.

## Known issues / follow-ups

- **Pre-existing clippy warnings (14)** across the codebase — none
  in my new code, but `cargo clippy --lib --no-deps -D warnings`
  will fail until they're addressed. Tracked in a separate
  follow-up; not in scope for this PR.
- **Real-car validation still pending.** Per `ROADMAP.md` v0.3.0
  "Real-Car Validation" section, the new DIDs need testing against
  B58 and N55 F-series chassis with ENET adapters before tagging
  v0.3.0. No blockers from this PR — just a research task.
- **`u8_enum` not in this PR.** The `docs/DECODE_FUNCTIONS.md`
  spec describes it as needing per-DID lookup tables stored in the
  TOML profile (not a math formula), which is a different surface
  area. Tracked as a separate work item.

## Related documents

- `ROADMAP.md` — v0.3.0 "Real Car" section, lists these decoders as 🟢 Ready
- `docs/DECODE_FUNCTIONS.md` — full spec + derivation + edge cases
- `docs/FORUM_PLAN.md` — companion decision doc for the forum + config sharing goal
- `CHANGELOG.md` — `[Unreleased]` → `### Added` has matching entries

---

*Per CLAUDE.md: requesting human review. This PR touches code in
`src-tauri/` so it should not auto-merge.*