# File Intake & Deep Analysis: BeeEmUu Community TOML Files

## File Inventory

| File | Size | Type | Content Summary |
|------|------|------|-----------------|
| `dtc_texts.toml` | 0.5 KB | TOML | Community fault-code descriptions — only 7 hex codes |
| `freeze_schemas.toml` | 1.1 KB | TOML | Freeze-frame byte layouts — only DME (0x12), 5 fields, simulator-based |
| `profiles.toml` | 1.0 KB | TOML | Example E70 N62 profile with 3 OBD-II parameters |
| `profiles/n52.toml` | 3.1 KB | TOML | N52 engine profile — 9 params, all OBD-II except unverified `local:10` oil temp |
| `profiles/n54.toml` | 4.0 KB | TOML | N54 engine profile — 11 params, OBD-II + placeholder oil temp + HPFP rail |
| `profiles/n55.toml` | 3.4 KB | TOML | N55 engine profile — 10 params, OBD-II + placeholder oil temp |
| `profiles/n62.toml` | 3.2 KB | TOML | N62 engine profile — 9 params, OBD-II + placeholder oil temp |
| `profiles/b58.toml` | 3.5 KB | TOML | B58 engine profile — 9 params, all OBD-II, no oil temp placeholder |
| `profiles/example_e70_n62.toml` | 1.0 KB | TOML | Example/template per-car profile |
| `README.md` | 2.5 KB | Markdown | Format documentation and contribution rules |

---

## Per-File Extraction

### `dtc_texts.toml`
- **Core theme**: Fault-code text overlay for DTC hex codes
- **Key claims**: 7 codes mapped to short descriptions (VANOS, coolant pump, oil pressure, DSC, FRM)
- **Data points**: All hex codes are 4-character BMW-style DTCs (not OBD-II 5-digit P-codes)
- **Limitations**: Extremely sparse — only 7 codes. Common codes like misfire (29CD, 29CE, 29CF…), O2 sensor, boost, HPFP, etc. are missing. No codes for transmission, ABS, or body modules.
- **Bias**: Heavily weighted toward N52/N62 era (VANOS, electric coolant pump) with almost nothing for turbo engines (N54/N55/B58)

### `freeze_schemas.toml`
- **Core theme**: Per-ECU freeze-frame byte layouts for environmental data snapshots
- **Key claims**: One schema for address `0x12` (DME) with 5 fields: rpm, coolant temp, vehicle speed, battery voltage, mileage
- **Methodology**: `width` types (u8, i8, u16, i16, u24), big-endian multi-byte, `value = raw * scale + bias`
- **Limitations**: Only DME. No EGS (0x18), DSC, CAS, FRM, or other modules. Fields are simulator-based (likely not real car layout). Mileage as u24 is unusual — need verification. No lambda, load, or DTC-specific data.
- **Bias**: Simulator-centric; may not match real ECU freeze-frame structures.

### `profiles.toml` + `profiles/*.toml`
- **Core theme**: Live-data parameter profiles per engine/vehicle
- **Key claims**: 
  - All profiles use only OBD-II PIDs (`obd:0C`, `0B`, `05`, `0F`, `04`, `11`, `0D`, `42`, `33`, `23`, `46`) — these are emissions-mandated and work on any 2007+ vehicle by design.
  - Oil temperature is consistently `local:10` as a placeholder in N52/N54/N55/N62, explicitly marked `[UNVERIFIED]`.
  - B58 has no oil temp at all — deliberately missing because it needs `did:HHHH` and none is confirmed.
  - N54 uniquely adds HPFP rail pressure (`obd:23`) and barometric pressure (`obd:33`) for boost calculation.
- **Methodology**: `query` uses `did:HHHH`, `obd:HH`, or `local:HH`. Decode functions: `temp_u8`, `u8`, `u8_tenths`, `u16`, `u16_quarter`, `u16_milli`, `u16_times10`, `percent_a`.
- **Limitations**: No actual BMW-specific DIDs are used. No transmission temps (EGS), no per-bank lambda, no ignition timing, no VANOS position, no DISA flap position, no charge-air pressure, no fuel trims per bank, no battery current/SOC, no oil pressure.
- **Bias**: OBD-II-only means many BMW-specific parameters are inaccessible. `local:10` for oil temp is a guess across all engines — unlikely to be correct for all.

### `README.md`
- **Core theme**: Contribution guidelines and file format documentation
- **Key rules**: No ISTA/proprietary data. Only original or community-derived knowledge.
- **How to find values**: Parameter Explorer on real car — scan, watch, confirm.

---

## Cross-File Mapping

### Overlapping Themes
- All engine profiles share the same OBD-II PID baseline (rpm, coolant, load, throttle, speed, voltage, MAP, IAT)
- All NA/turbo I6 profiles (N52/N54/N55/N62) share the same `local:10` oil temp placeholder
- Oil temp is the only non-OBD parameter attempted, and it's consistently unverified

### Complementary Information
- `n54.toml` adds HPFP rail pressure (`obd:23`) — useful for N55/B58 too but missing there
- `b58.toml` adds ambient temp (`obd:46`) — could apply to N55/N62 as well
- `profiles.toml` has a per-car example but no real car data

### Contradictions
- Oil temp at `local:10` is claimed as placeholder across all engines, but this is almost certainly wrong for at least some. E-series DMEs on K-line vs D-CAN vs UDS may use different local identifiers.
- No differentiation between K-line (E-series pre-2007) and D-CAN/UDS (post-2007) for the same engine — the same `local:10` is used for N52 in both E9x (D-CAN) and E85 (K-line) contexts.

---

## Gap Analysis

### Critical Gaps (blocking meaningful use for BMW-specific diagnostics)

1. **DID mappings for model-specific live data**: Zero actual `did:HHHH` queries exist. Need:
   - Oil temperature per engine/chassis (DME DID, not local)
   - Transmission temp (EGS DID)
   - Charge-air / intake manifold temp (turbo engines)
   - HPFP / LPFP pressure (DME DID for N55/B58, not just OBD)
   - Lambda / AFR per bank
   - Ignition timing / knock retard
   - VANOS position (actual vs target)
   - Valvetronic lift position
   - Battery current / SOC (on cars with IBS/IBS2)
   - Exhaust flap position, DPF pressure, SCR/NOx (where applicable)

2. **DTC fault texts**: Only 7 codes. Need hundreds of common BMW-specific codes:
   - Misfire (29CD, 29CE, 29CF, 29D0, 29D1, 29D2 — cylinder-specific)
   - Boost / charge-air (30FF, 3100, 3101 — N54/N55 under-/over-boost)
   - HPFP / fuel pressure (2FBF, 2FC0, 2FC1 — low pressure, rail pressure)
   - O2 sensors / cat efficiency (various 2Cxx, 2Dxx)
   - VANOS (2A82, 2A87, 2A88, 2A89 — already have 2A82/2A87)
   - DISA / throttle (various 2Exx, 2Fxx)
   - DSC / ABS (various 5Dxx)
   - Transmission (various 4Fxx, 50xx, 51xx)
   - Body / FRM (various 9Cxx)
   - Battery / charging (various A0xx, A1xx, A2xx)

3. **Freeze-frame schemas**: Only DME. Need:
   - EGS (0x18) transmission freeze frame
   - DSC (various addresses) brake/hydraulic data
   - CAS / key-related
   - FRM / body module
   - Real car DME freeze frames (may differ from simulator)

4. **Per-chassis transport nuances**: 
   - K-line vs D-CAN local identifiers differ
   - UDS DIDs vs KWP2000 local identifiers are completely different address spaces
   - ENET/DoIP (F/G-series) has different DID conventions

5. **Per-engine model-specific parameters**:
   - N54: no charge-air temp, no actual boost PID (only MAP + baro), no WGDC, no injector duty
   - N55: no charge-air temp, no HPFP rail (N55 has it, should be added)
   - B58: no oil temp, no transmission temp, no charge-air temp, no HPFP/LPFP
   - N62: no transmission temp, no oil pressure (N62 has oil pressure sensor)
   - N52: no transmission temp, no DISA position, no valvetronic lift

### Informational Gaps (would enhance but not block)

6. **Service function registry**: `service_functions.rs` in architecture — no community TOML equivalent exists yet.
7. **Security access seed/key algorithms**: Pluggable but community data is missing.
8. **Vehicle-specific profiles**: No E46, E39, E36, F30, G20 profiles.
9. **Diagnostic address completeness**: Only DME (0x12) and EGS (0x18) mentioned. Full BMW address table needed for module scan.

---

## Consolidated Theme List (for Phase 2 Dimension Decomposition)

1. **DTC fault texts**: Reverse-engineering common BMW DTCs from open sources
2. **DME DID mappings (E-series, KWP2000)**: Oil temp, lambda, ignition, VANOS, valvetronic
3. **DME DID mappings (F/G-series, UDS)**: Oil temp, lambda, ignition, VANOS, boost, HPFP (B58-specific)
4. **EGS/transmission DID mappings**: Oil temp, clutch fill pressure, shift times
5. **Turbo engine parameters (N54/N55/B58)**: Charge-air temp, boost control, WGDC, HPFP/LPFP
6. **NA engine parameters (N52/N62)**: DISA, valvetronic, oil pressure, VANOS
7. **Freeze-frame byte layouts**: Real car DME, EGS, DSC, CAS schemas
8. **Per-chassis transport and address differences**: K-line vs D-CAN vs ENET/DoIP
9. **OBD-II PID completeness**: Extended PIDs beyond the basic 9 currently used
10. **Body module and chassis parameters**: FRM, CAS, battery, lighting, climate
11. **Open-source community data sources**: Repos, forums, wikis with reverse-engineered BMW data
12. **Proprietary data boundaries**: What is publicly documented vs. what must be avoided
