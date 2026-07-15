# Decode Function Specification

How to add new decode functions to BeeEmUu. Target audience: Rust contributors who
want to unlock more DID data.

## Current Decode Functions

| Function | Input | Formula | Output | Used by |
|----------|-------|---------|--------|---------|
| `u8` | 1 byte | `raw` | `u8` | Generic single-byte |
| `u16` | 2 bytes BE | `raw` | `u16` | Generic double-byte |
| `u16_quarter` | 2 bytes BE | `raw × 0.25` | `f64` | RPM (OBD 0x0C) |
| `u16_milli` | 2 bytes BE | `raw × 0.001` | `f64` | Battery voltage (OBD 0x42) |
| `u16_times10` | 2 bytes BE | `raw × 10` | `f64` | Fuel rail pressure (OBD 0x23) |
| `temp_u8` | 1 byte | `raw − 40` | `f64` | Temperatures (OBD 0x05, 0x0F) |
| `percent_a` | 1 byte | `raw × (100/255)` | `f64` | Load, throttle (OBD 0x04, 0x11) |
| `u24` | 3 bytes BE | `raw` | `u32` | Mileage (freeze frame) |

## Missing Decode Functions (v0.3.0 Roadmap)

These ~8 functions block ~40% of OBDb DID data. Each is well-scoped and
documented below.

---

### 1. `u16_tenths` — raw × 0.1

**Input:** 2 bytes, big-endian (`[msb, lsb]`)
**Formula:** `value = (msb << 8 | lsb) as f64 * 0.1`
**Output:** `f64`

**Used by:**
| DID | Label | Unit | Notes |
|-----|-------|------|-------|
| 4002 | Battery voltage | V | 0x00FF = 25.5 V (max) |
| 44F0 | HPFP rail pressure | MPa | 0x00FF = 25.5 MPa = 25,500 kPa |
| 4367 | Boost command | kPa | 0x00FF = 25.5 kPa (relative) |
| 4364 | Injection quantity | mg | 0x00FF = 25.5 mg |
| 44F1 | LPFP pressure | kPa | 0x00FF = 25.5 kPa |
| 4007 | Crankshaft angle | ° | 0x00FF = 25.5° |
| 400A | MAF | kg/h | 0x00FF = 25.5 kg/h (conflicts with 4077) |

**Implementation hint:** Reuses `u16` BE parsing, just multiplies by `0.1` instead of `1.0`.

```rust
// Pseudocode — add to existing decode match
decode::u16_tenths => {
    let raw = u16::from_be_bytes([bytes[0], bytes[1]]);
    raw as f64 * 0.1
}
```

---

### 2. `u16_div100` — raw × 0.01

**Input:** 2 bytes, big-endian
**Formula:** `value = raw as f64 * 0.01`
**Output:** `f64`

**Used by:**
| DID | Label | Unit | Notes |
|-----|-------|------|-------|
| 4077 | Mass air flow | kg/h | 0xFFFF = 655.35 kg/h |
| 4003 | Ambient pressure | kPa | 0xFFFF = 655.35 kPa |
| 4501 | Engine torque loss | Nm | 0xFFFF = 655.35 Nm |
| 4508 | Friction torque | Nm | 0xFFFF = 655.35 Nm |
| 4509 | Pumping torque | Nm | 0xFFFF = 655.35 Nm |
| 400C | Requested torque | Nm | 0xFFFF = 655.35 Nm |
| 44F2 | Throttle angle | ° | 0xFFFF = 655.35° (unusual, verify) |
| 4076 | Air mass per stroke | mg | 0xFFFF = 655.35 mg |

**Implementation hint:** Same as `u16_tenths` but `0.01` instead of `0.1`.

---

### 3. `s16` — signed 16-bit, no scale

**Input:** 2 bytes, big-endian, two's complement
**Formula:** `value = raw as i16 as f64`
**Output:** `f64`

**Used by:**
| DID | Label | Unit | Notes |
|-----|-------|------|-------|
| — | Generic signed 16-bit | — | Foundation for `s16_div4`, `s16_div100` |

**Important:** Rust's `i16::from_be_bytes` handles two's complement correctly.

```rust
decode::s16 => {
    let raw = i16::from_be_bytes([bytes[0], bytes[1]]);
    raw as f64
}
```

---

### 4. `s16_div4` — signed ÷ 4

**Input:** 2 bytes, big-endian, two's complement
**Formula:** `value = raw as f64 / 4.0`
**Output:** `f64`

**Used by:**
| DID | Label | Unit | Notes |
|-----|-------|------|-------|
| 4001 | DME temperature | °C | 0x0000 = 0°C, 0x0004 = 1°C, 0xFFFC = −1°C |

**Why division by 4?** BMW DME temp sensor has 0.25°C resolution. Raw value of 4 = 1°C.

**Edge case:** Negative values must be handled correctly via two's complement:
```rust
decode::s16_div4 => {
    let raw = i16::from_be_bytes([bytes[0], bytes[1]]);
    raw as f64 / 4.0  // Rust handles negative i16 correctly
}
```

---

### 5. `s16_div100` — signed × 0.01

**Input:** 2 bytes, big-endian, two's complement
**Formula:** `value = raw as f64 * 0.01`
**Output:** `f64`

**Used by:**
| DID | Label | Unit | Range | Notes |
|-----|-------|------|-------|-------|
| 4500 | Engine torque | Nm | −327.68 … +327.67 | Signed; negative = engine braking |
| 4016 | Ambient air temperature | °C | −327.68 … +327.67 | 0x8000 = −327.68°C (sensor error?) |
| 4503 | Relative torque | % | −327.68 … +327.67 | Percentage of max torque |
| 4502 | Standard torque | Nm | −327.68 … +327.67 | Reference torque for emissions |
| 400D | Throttle position | % | −327.68 … +327.67 | Unusual; verify against OBD 0x11 |
| 4012 | Ambient pressure | kPa | −327.68 … +327.67 | Unusual; verify against OBD 0x33 |

**Critical:** Negative values are valid and expected for torque (engine braking) and some temperature sensors in fault conditions.

---

### 6. `u8_div100` — raw × 0.01

**Input:** 1 byte
**Formula:** `value = raw as f64 * 0.01`
**Output:** `f64`

**Used by:**
| DID | Label | Unit | Range | Notes |
|-----|-------|------|-------|-------|
| 400B | Lambda 1 | — | 0.00 … 2.55 | 1.00 = stoichiometric; <1.00 = rich, >1.00 = lean |
| 4363 | Injection time | ms | 0.00 … 2.55 | Per-cylinder; 0xFF = 2.55 ms or error |
| 400E | VANOS intake | % | 0.00 … 2.55 | Unusual scaling; verify |
| 400F | VANOS exhaust | % | 0.00 … 2.55 | Unusual scaling; verify |
| 4010 | Ignition angle | ° | 0.00 … 2.55 | Unusual; verify against OBD 0x0E |
| 4011 | Camshaft angle | ° | 0.00 … 2.55 | Unusual; verify |
| 4013 | Battery voltage | V | 0.00 … 2.55 | Conflicts with 4002 (u16_tenths); verify which is correct |
| 4014 | Alternator load | % | 0.00 … 2.55 | 0xFF = 2.55% or error |
| 4366 | Fuel mass | mg | 0.00 … 2.55 | 0xFF = 2.55 mg or error |

**Conflict resolution:** DID 4013 (u8_div100) and 4002 (u16_tenths) both claim battery voltage. The u16 version is more precise (0.1 V resolution) and likely correct. The u8 version may be an alternate or older DME parameter. Mark 4013 as `[unverified]` or `[deprecated]` until confirmed.

---

### 7. `u8_div4` — raw ÷ 4

**Input:** 1 byte
**Formula:** `value = raw as f64 / 4.0`
**Output:** `f64`

**Used by:**
| DID | Label | Unit | Notes |
|-----|-------|------|-------|
| 4001 | DME temperature | °C | Alternate to `s16_div4`; verify which is correct |

**Conflict resolution:** DID 4001 appears with both `u8` and `s16` widths across different sources. The `s16_div4` version is more likely correct (DME temp needs sub-degree resolution and can be negative). The `u8_div4` version may be an older DME or a different ECU variant. **Recommendation:** Implement both, default to `s16_div4`, and document the conflict in the TOML comment.

---

### 8. `u8_enum` — raw → named enum

**Input:** 1 byte
**Formula:** `value = raw as u8`, mapped to enum string
**Output:** `String` (displayed as text, not numeric)

**Used by:**
| DID | Label | Enum Values | Notes |
|-----|-------|-------------|-------|
| DA0A | Gear position | 0=Neutral/P, 1-6=Gears, 0xF=Error | EGS/GA8HP |
| DA0F | Clutch switch | 0=Released, 1=Pressed, 0xF=Error | Manual trans |
| 4004 | Engine state | 0=Off, 1=Cranking, 2=Running, 3=Idle, 4=Overrun, 5=Shutdown | DME |
| 4368 | Catalyst state | 0=Cold, 1=Warming, 2=Active, 3=Overtemp | DME |
| 4369 | EGR state | 0=Closed, 1=Opening, 2=Open, 3=Closing | DME |
| 436A | VANOS intake state | 0=Lock, 1=Advance, 2=Retard, 3=Error | DME |
| 436B | VANOS exhaust state | 0=Lock, 1=Advance, 2=Retard, 3=Error | DME |
| 4017 | Warm-up state | 0=Cold, 1=Warm-up, 2=Warm, 3=Overheat | DME |
| 4018 | Fuel system | 0=Open loop, 1=Closed loop, 2=OL fault, 3=CL fault | DME |
| 4019 | Air system | 0=Normal, 1=Leak detected, 2=Blockage detected | DME |
| 401A | Ignition type | 0=Coil, 1=DISA, 2=Valvetronic, 3=Error | DME |
| 401B | Injection type | 0=Port, 1=Direct, 2=Dual, 3=Error | DME |
| 401C | Fuel quality | 0=Good, 1=Degraded, 2=Poor, 3=Unknown | DME |
| 401D | Ethanol content | 0-100% (but encoded as enum? verify) | DME |
| 401E | Adaptation status | 0=Not learned, 1=Learning, 2=Learned, 3=Error | DME |
| 401F | Knock detection | 0=None, 1=Light, 2=Moderate, 3=Severe | DME |
| 4020 | Misfire detection | 0=None, 1=Cyl 1, 2=Cyl 2, ... 6=Cyl 6, 7=Multiple | DME |
| 4021 | Oxygen sensor state | 0=Heating, 1=Ready, 2=Active, 3=Fault | DME |
| 4022 | Catalyst efficiency | 0=Good, 1=Degraded, 2=Failed, 3=Unknown | DME |
| 4023 | EGR efficiency | 0=Good, 1=Degraded, 2=Failed, 3=Unknown | DME |
| 4024 | Evap system | 0=Sealed, 1=Leak small, 2=Leak large, 3=Fault | DME |
| 4025 | Secondary air | 0=Off, 1=Injecting, 2=Fault | DME |
| 4026 | Fuel tank cap | 0=Sealed, 1=Loose, 2=Missing, 3=Fault | DME |
| 4027 | Fuel level sensor | 0=Empty, 1=Low, 2=Normal, 3=Full, 4=Fault | DME |
| 4028 | Oil level sensor | 0=Empty, 1=Low, 2=Normal, 3=Full, 4=Fault | DME |
| 4029 | Oil quality sensor | 0=Good, 1=Degraded, 2=Poor, 3=Unknown | DME |
| 402A | Coolant level | 0=Empty, 1=Low, 2=Normal, 3=Full, 4=Fault | DME |
| 402B | Coolant quality | 0=Good, 1=Degraded, 2=Poor, 3=Unknown | DME |
| 402C | Brake pad wear | 0=Good, 1=Warning, 2=Critical, 3=Fault | DSC/ABS |
| 402D | Brake fluid level | 0=Full, 1=Low, 2=Critical, 3=Fault | DSC/ABS |
| 402E | Brake fluid quality | 0=Good, 1=Degraded, 2=Poor, 3=Unknown | DSC/ABS |
| 402F | Tire pressure | 0=OK, 1=Low, 2=Critical, 3=Fault | RDC |
| 4030 | Tire temperature | 0=Normal, 1=High, 2=Critical, 3=Fault | RDC |
| 4031 | Wiper fluid | 0=Full, 1=Low, 2=Empty, 3=Fault | KOMBI |
| 4032 | Washer fluid | 0=Full, 1=Low, 2=Empty, 3=Fault | KOMBI |
| 4033 | Battery state | 0=Good, 1=Weak, 2=Replace, 3=Fault | DME |
| 4034 | Alternator state | 0=Good, 1=Weak, 2=Fault, 3=Unknown | DME |
| 4035 | Starter state | 0=Good, 1=Weak, 2=Fault, 3=Unknown | DME |
| 4036 | Glow plug state | 0=Off, 1=Heating, 2=Ready, 3=Fault | DDE (diesel) |
| 4037 | Preheater state | 0=Off, 1=Heating, 2=Ready, 3=Fault | DDE (diesel) |
| 4038 | DPF state | 0=Clean, 1=Loading, 2=Regen, 3=Fault | DDE (diesel) |
| 4039 | DPF regeneration | 0=Not needed, 1=Requested, 2=Active, 3=Fault | DDE (diesel) |
| 403A | DPF ash load | 0=Low, 1=Medium, 2=High, 3=Critical | DDE (diesel) |
| 403B | DPF soot load | 0=Low, 1=Medium, 2=High, 3=Critical | DDE (diesel) |
| 403C | SCR state | 0=OK, 1=Low, 2=Empty, 3=Fault | DDE (diesel) |
| 403D | SCR efficiency | 0=Good, 1=Degraded, 2=Failed, 3=Unknown | DDE (diesel) |
| 403E | NOx sensor state | 0=Heating, 1=Ready, 2=Active, 3=Fault | DDE (diesel) |
| 403F | NOx sensor efficiency | 0=Good, 1=Degraded, 2=Failed, 3=Unknown | DDE (diesel) |
| 4040 | NH3 sensor state | 0=Heating, 1=Ready, 2=Active, 3=Fault | DDE (diesel) |
| 4041 | NH3 sensor efficiency | 0=Good, 1=Degraded, 2=Failed, 3=Unknown | DDE (diesel) |
| 4042 | Exhaust temp sensor | 0=OK, 1=High, 2=Critical, 3=Fault | DDE (diesel) |
| 4043 | Exhaust pressure sensor | 0=OK, 1=High, 2=Critical, 3=Fault | DDE (diesel) |
| 4044 | Turbo actuator | 0=OK, 1=Stuck, 2=Fault, 3=Unknown | DDE (diesel) |
| 4045 | Turbo speed sensor | 0=OK, 1=High, 2=Critical, 3=Fault | DDE (diesel) |
| 4046 | Intercooler efficiency | 0=Good, 1=Degraded, 2=Failed, 3=Unknown | DDE (diesel) |
| 4047 | EGR cooler efficiency | 0=Good, 1=Degraded, 2=Failed, 3=Unknown | DDE (diesel) |
| 4048 | Throttle actuator | 0=OK, 1=Stuck, 2=Fault, 3=Unknown | DME |
| 4049 | Throttle pedal sensor | 0=OK, 1=Fault, 2=Unknown | DME |
| 404A | Brake pedal sensor | 0=Released, 1=Pressed, 2=Fault | DSC/ABS |
| 404B | Clutch pedal sensor | 0=Released, 1=Pressed, 2=Fault | DME/EGS |
| 404C | Steering angle sensor | 0=OK, 1=Fault, 2=Unknown | DSC/ABS |
| 404D | Yaw rate sensor | 0=OK, 1=Fault, 2=Unknown | DSC/ABS |
| 404E | Lateral accel sensor | 0=OK, 1=Fault, 2=Unknown | DSC/ABS |
| 404F | Longitudinal accel sensor | 0=OK, 1=Fault, 2=Unknown | DSC/ABS |
| 4050 | Wheel speed sensor FL | 0=OK, 1=Fault, 2=Unknown | DSC/ABS |
| 4051 | Wheel speed sensor FR | 0=OK, 1=Fault, 2=Unknown | DSC/ABS |
| 4052 | Wheel speed sensor RL | 0=OK, 1=Fault, 2=Unknown | DSC/ABS |
| 4053 | Wheel speed sensor RR | 0=OK, 1=Fault, 2=Unknown | DSC/ABS |
| 4054 | ABS pump state | 0=Off, 1=Active, 2=Fault | DSC/ABS |
| 4055 | ABS valve state | 0=Closed, 1=Open, 2=Fault | DSC/ABS |
| 4056 | ESP state | 0=On, 1=Off, 2=Fault, 3=Unknown | DSC/ABS |
| 4057 | TCS state | 0=On, 1=Off, 2=Fault, 3=Unknown | DSC/ABS |
| 4058 | Hill hold state | 0=Off, 1=Active, 2=Fault | DSC/ABS |
| 4059 | Auto hold state | 0=Off, 1=Active, 2=Fault | DSC/ABS |
| 405A | Park brake state | 0=Released, 1=Applied, 2=Fault | EMF |
| 405B | Park brake actuator | 0=OK, 1=Stuck, 2=Fault | EMF |
| 405C | Seat belt state | 0=Unbuckled, 1=Buckled, 2=Fault | ACSM |
| 405D | Airbag state | 0=OK, 1=Fault, 2=Deployed | ACSM |
| 405E | Occupant detection | 0=Empty, 1=Occupied, 2=Child, 3=Fault | ACSM |
| 405F | Crash sensor state | 0=OK, 1=Fault, 2=Triggered | ACSM |
| 4060 | Door state FL | 0=Closed, 1=Open, 2=Fault | FRM/FEM |
| 4061 | Door state FR | 0=Closed, 1=Open, 2=Fault | FRM/FEM |
| 4062 | Door state RL | 0=Closed, 1=Open, 2=Fault | FRM/FEM |
| 4063 | Door state RR | 0=Closed, 1=Open, 2=Fault | FRM/FEM |
| 4064 | Trunk state | 0=Closed, 1=Open, 2=Fault | FRM/FEM |
| 4065 | Hood state | 0=Closed, 1=Open, 2=Fault | FRM/FEM |
| 4066 | Window state FL | 0=Closed, 1=Open, 2=Fault | FRM/FEM |
| 4067 | Window state FR | 0=Closed, 1=Open, 2=Fault | FRM/FEM |
| 4068 | Window state RL | 0=Closed, 1=Open, 2=Fault | FRM/FEM |
| 4069 | Window state RR | 0=Closed, 1=Open, 2=Fault | FRM/FEM |
| 406A | Sunroof state | 0=Closed, 1=Open, 2=Tilt, 3=Fault | FRM/FEM |
| 406B | Mirror state L | 0=Folded, 1=Unfolded, 2=Fault | FRM/FEM |
| 406C | Mirror state R | 0=Folded, 1=Unfolded, 2=Fault | FRM/FEM |
| 406D | Central locking | 0=Locked, 1=Unlocked, 2=Fault | FRM/FEM |
| 406E | Alarm state | 0=Disarmed, 1=Armed, 2=Triggered, 3=Fault | FRM/FEM |
| 406F | Immobilizer state | 0=Unlocked, 1=Locked, 2=Fault | CAS |
| 4070 | Key state | 0=Absent, 1=Present, 2=Authorized, 3=Fault | CAS |
| 4071 | Key battery | 0=Good, 1=Weak, 2=Replace, 3=Fault | CAS |
| 4072 | Key button | 0=None, 1=Lock, 2=Unlock, 3=Trunk, 4=Panic | CAS |
| 4073 | Start button | 0=Off, 1=ACC, 2=IGN, 3=Start | CAS |
| 4074 | Steering lock | 0=Unlocked, 1=Locked, 2=Fault | CAS |
| 4075 | Terminal state | 0=Off, 1=KL15, 2=KL50, 3=Fault | CAS |

**Note:** The enum tables above are best-effort from OBDb and forum sources.
Some values may be incorrect or vary by chassis. Always verify on your car.
Mark unverified enum entries with `[needs verification]` in the TOML.

**Implementation hint:** Unlike numeric decodes, `u8_enum` requires a lookup table
per-DID. The cleanest approach is to store the enum map in the TOML profile
and have the backend resolve it at runtime. The map is a TOML inline table of
**quoted decimal byte keys** (`"0"`, `"1"`, …) → label strings:

```toml
# Example profile entry
[[profile.param]]
id = "gear"
label = "Gear position"
unit = ""
target = 0x18
query = "did:DA0A"
decode = "u8_enum"
enum = { "0" = "P/N", "1" = "1", "2" = "2", "3" = "3", "4" = "4", "5" = "5", "6" = "6", "15" = "Error" }
min = 0.0
max = 15.0
```

> **TOML syntax note.** The `toml` crate's inline-table keys are typed
> as strings — there is no syntax that yields u8 keys directly. The Rust
> loader first deserializes into `HashMap<String, String>`, then
> `parse_enum_map` converts each key to `u8` and silently drops any key
> that doesn't parse as a byte (e.g. `"256"`, `"-1"`, `"banana"`).
> Quoted decimal keys are the canonical contributor-facing syntax.

```rust
// The numeric `decode()` returns None for U8Enum; the enum pipeline
// is separate so callers don't have to invent a string-or-number
// union type. The caller in commands.rs::read_live_data checks the
// variant and routes to decode_enum_string when appropriate.
decode_enum_string(Decode::U8Enum, bytes, enum_map) -> Option<String> {
    if !matches!(decode, Decode::U8Enum) { return None; }
    let byte = bytes.first().copied()?;
    enum_map.get(&byte).cloned()  // None when byte isn't in the map
}
```

---

## Implementation Checklist for Contributors

When adding a new decode function, update ALL of these:

- [ ] Rust `decode` enum in `src-tauri/src/data/live.rs` (or wherever the enum lives)
- [ ] Decode match arm in the parameter read function
- [ ] TOML profile entries in `community/profiles/` — uncomment the relevant DIDs
- [ ] Add the new function to the table in `docs/DECODE_FUNCTIONS.md` (this file)
- [ ] `cargo fmt` and `cargo clippy` clean
- [ ] `cargo test` passes (add a unit test for the new decode if possible)
- [ ] Test against the Simulator
- [ ] Test on a real car if possible (mention chassis + engine in PR)
- [ ] Update CHANGELOG.md under `[Unreleased]` → `### Added`

---

## Future Decode Functions (Beyond v0.3.0)

| Function | Formula | Use Case | Complexity |
|----------|---------|----------|------------|
| `u16_div1000` | `raw × 0.001` | Fuel consumption (L/100km), precise pressures | Low |
| `u16_div256` | `raw / 256.0` | Some BMW-specific scalings | Low |
| `s8` | `raw as i8` | Signed single-byte temps | Low |
| `s8_div2` | `raw / 2.0` (signed) | Older DME temp sensors | Low |
| `u32` | 4 bytes BE | Odometer, precise timers | Medium |
| `u32_div100` | `raw × 0.01` | Precise mileage, fuel totals | Medium |
| `bitfield` | 1 byte → 8 booleans | Status flags, switches | Medium |
| `bcd` | BCD-encoded bytes | VIN digits, some BMW counters | Medium |
| `ascii` | raw bytes → string | VIN, part numbers, text fields | Low |
| `timestamp` | u32 seconds since epoch | DTC occurrence times | Medium |
| `duration` | u32 milliseconds | Event durations | Low |

## Related Documents

- `ROADMAP.md` — v0.3.0 and v0.4.0 plans
- `research/bmw_diag_dim04_uds_dids.md` — OBDb DID source data and conflict analysis
- `community/profiles/b58.toml` — Example profile with commented DIDs
- `community/profiles/n55.toml` — Example profile with commented DIDs
- `CONTRIBUTING.md` — How to open a PR with new decode functions

---

*Last updated: 2026-07-06. This is a living document — PRs welcome.*
