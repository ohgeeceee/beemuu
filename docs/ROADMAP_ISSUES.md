# Roadmap Issues — Pre-written for GitHub

Since the GitHub MCP token may not have issue-creation permissions, here are
pre-written issues for the v0.3.0 roadmap. Copy-paste each into a new GitHub
issue.

---

## Issue 1: [v0.3.0] Add new decode functions: u16_tenths, s16_div100, u8_enum, etc.

**Labels:** `help wanted`, `good first issue`, `v0.3.0`, `backend`

**Body:**

```markdown
## Roadmap Item
[v0.3.0] "Real Car" — Release Blocker

## Problem
~40% of OBDb-verified DIDs are currently commented out in `profiles/b58.toml` and `profiles/n55.toml` because BeeEmUu's `decode` enum doesn't support the needed scale/bias combinations.

## Required Decodes

| Function | Formula | Example DIDs | Impact |
|----------|---------|------------|--------|
| `u16_tenths` | `raw × 0.1` | 4002 (battery), 44F0 (HPFP), 4367 (boost) | High |
| `u16_div100` | `raw × 0.01` | 4077 (MAF), 4003 (ambient pressure) | Medium |
| `s16_div4` | `raw ÷ 4` (signed) | 4001 (DME temp) | Medium |
| `s16_div100` | `raw × 0.01` (signed) | 4500 (torque), 4016 (ambient air) | Medium |
| `u8_enum` | raw byte → named enum | DA0A (gear), DA0F (clutch), 4004 (engine state) | Medium |
| `u8_div100` | `raw × 0.01` | 400B (lambda), 4363 (injection time) | Medium |
| `u8_div4` | `raw ÷ 4` | 4001 (DME temp — alternate decode) | Low |
| `s16` | `raw` (signed, no scale) | — | Low |

## Implementation Notes
- Add to `decode` enum in Rust backend
- Update `community/` profiles to uncomment the affected DIDs
- Document in `docs/DECODE_FUNCTIONS.md` (new file)
- Consider whether `freeze_schemas.toml`'s `scale`/`bias` model should be unified with `decode` to avoid this mismatch in the future

## Related
- OBDb source: https://github.com/obdb/Vehicle-Parameter
- Research: `research/bmw_diag_dim04_uds_dids.md`
```

---

## Issue 2: [v0.3.0] Real-car validation: B58 F/G-series UDS DIDs on ENET

**Labels:** `needs real-car test`, `v0.3.0`, `community-data`, `help wanted`

**Body:**

```markdown
## Roadmap Item
[v0.3.0] "Real Car"

## What Needs Testing
The 5 OBDb-verified UDS DIDs added for B58 in v0.2.0 need real-car validation:
- `did:4506` — Oil temperature (°C, `temp_u8`)
- `did:411E` — Coolant temperature (°C, `temp_u8`)
- `did:4015` — Intake air temperature (°C, `temp_u8`)
- `did:DA12` — ATF temperature (°C, `u8`, decode uncertain)
- `did:DA1F` — Kickdown switch (`u8`, 0/1)

## How to Test
1. Connect ENET adapter to F/G-series BMW (e.g., F30, G20, G30)
2. Open BeeEmUu → Diagnostics → load B58 profile
3. Read each DID and compare to:
   - OBD-II PID equivalent (if available): 0x05 (coolant), 0x0F (IAT), 0x5C (oil)
   - Gauge cluster display
   - Physical correlation (e.g., oil temp rises with engine warm-up)
4. Report raw bytes + expected value + verification method in this issue

## Needed
- F30/F32/F36 (B58) owner with ENET adapter
- G20/G30 (B58) owner with ENET adapter

## Related
- `profiles/b58.toml`
- `research/bmw_diag_dim04_uds_dids.md`
- OBDb: https://github.com/obdb/Vehicle-Parameter
```

---

## Issue 3: [v0.3.0] E-series KWP2000 local identifier hunt (N52/N54/N55/N62)

**Labels:** `research`, `needs real-car test`, `v0.3.0`, `community-data`, `help wanted`

**Body:**

```markdown
## Roadmap Item
[v0.3.0] "Real Car" — Research

## The Problem
No open-source KWP2000 local identifier (`local:HH`) table exists for any BMW E-series DME (MSV70, MSV80, MSD80, MSD81, ME9.2). This is a structural data desert, not a search failure. The `local:10` oil temp placeholder in all E-series profiles is unverified and has no community source.

## Goal
Use the Parameter Explorer to find and document actual KWP2000 local identifiers on real cars.

## What to Look For
- `local:HH` values that respond with non-zero data
- Correlation with known OBD-II PIDs (to cross-check)
- Parameters that change with engine state (warm-up, RPM, load)
- Oil temperature (especially N52 — BSD protocol is the known pathway, but KWP2000 may have a copy)
- Boost pressure (N54/N55)
- Fuel rail pressure (N54/N55)
- VANOS position (all)
- Knock retard (all)

## How to Contribute
1. Open a new issue using the **"New DID / local identifier mapped"** template
2. Include: chassis, engine, year, raw bytes, verification method, confidence level
3. Link back to this issue for tracking

## Alternative Path
If KWP2000 local IDs are truly unfindable, we can document **CAN bus broadcast frames** instead:
- 0x0AA — RPM
- 0x1D0 — Coolant temp
- 0x545 — Oil temp (E46, may differ for E9x)
- 0x0CE — Wheel speeds

This would require adding a CAN listener mode to BeeEmUu.

## Related
- `research/bmw_diag_dim07_local_ids.md` — exhaustive search proving zero open-source tables
- `profiles/n52.toml`, `profiles/n54.toml`, `profiles/n55.toml`, `profiles/n62.toml`
```

---

## Issue 4: [v0.3.0] Add N20/N26 and S55 engine profiles

**Labels:** `help wanted`, `good first issue`, `v0.3.0`, `community-data`

**Body:**

```markdown
## Roadmap Item
[v0.3.0] "Real Car"

## N20/N26 (F-series 2.0L turbo 4-cyl)
- Protocol: UDS over ENET
- Expected DID set: Similar to B58/N55 (oil 4506, coolant 411E, IAT 4015)
- Needs: Real-car tester with F30 320i, F10 528i, etc.
- Status: 🟢 Ready — mostly copy B58 DID set, adapt for 4-cyl

## S55 (F80 M3 / F82 M4 / F87 M2 Competition)
- Protocol: UDS over ENET
- Expected DID set: Similar to N55 but with higher limits and M-specific additions
- Oil temp critical for track use — same DID 4506 as B58/N55
- Needs: Real-car tester with F8x M car
- Status: 🟢 Ready — copy N55 DID set, add M-specific notes

## Implementation Notes
- Create `community/profiles/n20.toml` and `community/profiles/s55.toml`
- Base on `profiles/b58.toml` or `profiles/n55.toml`
- OBD-II PIDs are identical (0x0C, 0x05, 0x0F, 0x0B, etc.)
- Add notes about oil temp importance for track use (S55)

## Related
- `profiles/b58.toml`
- `profiles/n55.toml`
- OBDb: https://github.com/obdb/Vehicle-Parameter
```

---

## Issue 5: [v0.3.0] ISO-TP multi-frame (FF/CF/FC) support

**Labels:** `help wanted`, `v0.3.0`, `backend`, `protocol`

**Body:**

```markdown
## Roadmap Item
[v0.3.0] "Real Car"

## Problem
BeeEmUu currently handles single-frame UDS responses. Long responses (e.g., VIN read, full DTC list, multi-DID read) require ISO-TP multi-frame protocol:
- First Frame (FF) — announces total length
- Consecutive Frames (CF) — data chunks
- Flow Control (FC) — receiver says "send next" or "wait"

## When It's Needed
- Reading VIN (`did:F190`) — 17 bytes, always multi-frame
- Reading full fault memory on some ECUs — can exceed 7 bytes
- Reading multiple DIDs in one request — future optimization
- EGS/TCU responses — often longer than 7 bytes

## Implementation Notes
- See ISO 15765-2 for protocol details
- `serialport` crate may need to handle the timing between FF/CF/FC
- Need to handle both sender and receiver sides (we send requests, we receive responses)
- Consider timeout for inter-frame spacing (IFS)

## Related
- ISO 15765-2 (ISO-TP)
- UDS ISO 14229-1 (diagnostic services)
- `src-tauri/src/transport/` — where this lives
```

---

## Issue 6: [v0.3.0] CAN bus listener mode for E-series

**Labels:** `research`, `help wanted`, `v0.3.0`, `backend`, `protocol`

**Body:**

```markdown
## Roadmap Item
[v0.3.0] "Real Car" — Alternative to KWP2000 local IDs

## Problem
E-series KWP2000 local identifiers are unmapped in open sources. But BMW ECUs broadcast many parameters on the CAN bus without requesting them.

## Known Broadcast Frames (E-series)

| CAN ID | Content | Bytes | Notes |
|--------|---------|-------|-------|
| 0x0AA | RPM, torque, throttle | 8 | DME broadcast, 10ms period |
| 0x1D0 | Coolant temp, ambient temp | 8 | DME broadcast |
| 0x545 | Oil temp, oil pressure | 8 | E46 confirmed; E9x needs verification |
| 0x0CE | Wheel speeds (4 wheels) | 8 | DSC broadcast |
| 0x130 | Vehicle speed, gear | 8 | EGS/DME broadcast |
| 0x316 | Battery voltage, charging | 8 | DME/IHKR broadcast |

## Goal
Add a "CAN Monitor" mode to BeeEmUu that listens to these broadcasts and displays the decoded values without needing KWP2000 local IDs.

## Implementation Notes
- Requires switching the K+DCAN cable to CAN mode (not K-line mode)
- Need to set the CAN bus speed (500 kbit/s for BMW PT-CAN)
- Filter by CAN ID to reduce noise
- Decode functions for each known frame layout
- New transport mode: `Transport: CAN Listener` alongside Simulator and K+DCAN

## Related
- `research/bmw_diag_dim07_local_ids.md` — CAN broadcast as alternative pathway
- E46 CAN bus documentation (forum posts, open sources)
- PT-CAN vs K-CAN bus distinction (diagnostic vs comfort)

## Risks
- Frame layouts may differ between E46, E9x, and E6x chassis
- Need real-car testing on each chassis to confirm
- Some frames may only broadcast when engine is running
```

---

*Generated from ROADMAP.md. Copy each block into a new GitHub issue.*
