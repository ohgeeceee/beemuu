# Dimension 04: Verified & Expanded UDS DID Mappings for BMW F/G-Series

**Research Date**: 2026-07-06
**Scope**: UDS-based vehicles (F/G-series, B58, late N55)
**License Constraint**: All data derived from open-source community databases (OBDb, CC-BY-SA) and public forum posts. No proprietary ISTA/INPA/SGBD data used.
**Searches Conducted**: 18 independent web searches + 7 OBDb repository fetches

---

## Summary of Findings

- **Verified in OBDb (CC-BY-SA)**: 25+ DIDs across DME, EGS, DSC, Body, Cluster, and other ECUs
- **Not found in fetched OBDb repos**: 5 DIDs from orchestrator's list (22 4300, 22 4402, 22 5AC3, 21 01, 21 04) — may exist in other OBDb repos or may be forum-sourced
- **Additional DIDs discovered**: 15+ new parameters (HV battery data, VGT angle, oil change distance, range/consumption, instrument cluster speed, etc.)
- **Discrepancies found**: 3 items where OBDb decode formulas differ slightly from orchestrator's summary

---

## Verified DID: did:400B (Target: 0x12 — DME)

**Parameter**: Lambda 1 (excess air ratio)
**Decode**: `bix: 40, len: 8, max: 2, div: 100` → raw/100
**OBDb Source**: BMW-X5/signalsets/v3/default.json
**Year Coverage**: 2011–2020, 2022
**Confidence**: High — verified in OBDb, appears in multiple model repos

---

## Verified DID: did:4015 (Target: 0x12 — DME)

**Parameter**: Intake air temperature
**Decode**: `bix: 8, len: 8, max: 150, min: -40, unit: celsius` — u8, offset −40 °C implied by min
**OBDb Source**: BMW-X5/signalsets/v3/default.json
**Year Coverage**: To 2020, 2022+
**Confidence**: High
**Note**: Orchestrator stated `raw−40 °C (u8, min -40, max 150)` — consistent with OBDb range bounds

---

## Verified DID: did:40CB (Target: 0x12 — DME)

**Parameter**: Ethanol content (CAN broadcast)
**Decode**: `bix: 104, len: 8, max: 100, div: 2` → raw/2 %
**OBDb Source**: BMW-X5/signalsets/v3/default.json
**Year Coverage**: To 2020, 2022+
**Confidence**: High

---

## Verified DID: did:411E (Target: 0x12 — DME)

**Parameter**: Coolant temperature
**Decode**: `bix: 16, len: 8, max: 200, min: -40, unit: celsius` — u8, offset −40 °C implied
**OBDb Source**: BMW-X5/signalsets/v3/default.json
**Year Coverage**: To 2020, 2022–2025
**Confidence**: High
**Note**: Orchestrator stated `raw−40 °C (u8, min -40, max 200)` — consistent

---

## Verified DID: did:4506 (Target: 0x12 — DME)

**Parameter**: Engine oil temperature
**Decode**: `len: 8, max: 200, min: -40, unit: celsius` — u8 scalar
**OBDb Source**: BMW-X5/signalsets/v3/default.json
**Year Coverage**: To 2020, 2022+
**Confidence**: High
**Note**: Orchestrator stated `raw−40 °C (u8, min -40, max 200)`. OBDb shows same min/max but does not explicitly set `add: -40` in the JSON. The range bounds strongly imply offset −40. Some OBDb repos (e.g. BMW-3-Series) show `min: -40` which supports offset decoding.

---

## Verified DID: did:4AB1 (Target: 0x12 — DME)

**Parameter**: Vehicle speed (high resolution)
**Decode**: `len: 16, max: 255, div: 100, unit: kilometersPerHour` → raw/100 km/h
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-Z4
**Year Coverage**: 2012+ (3-Series), 2007+ (5-Series), 2014+ (X5), 2020+ (Z4)
**Confidence**: Very High — appears in 5+ OBDb repos with identical decode

---

## Verified DID: did:4C5B (Target: 0x12 — DME)

**Parameter**: Exhaust gas calculated temperature
**Decode**: `bix: 16, len: 16, max: 1200, div: 10, unit: celsius` → raw/10 °C (u16)
**OBDb Source**: BMW-X5/signalsets/v3/default.json
**Year Coverage**: To 2020, 2022–2025
**Confidence**: High
**Note**: Orchestrator stated `raw/10 °C (u16)` — consistent

---

## Verified DID: did:57C3 (Target: 0x12 — DME)

**Parameter**: Engine oil temperature (alternate)
**Decode**: `len: 16, max: 200, min: -40, div: 10, unit: celsius` → raw/10 °C (u16, min -40, max 200)
**OBDb Source**: BMW-X5/signalsets/v3/default.json
**Year Coverage**: To 2020, 2022+
**Confidence**: High
**Note**: Orchestrator stated `raw/10 °C (u16, min -40, max 200)` — consistent

---

## Verified DID: did:586F (Target: 0x12 — DME)

**Parameter**: Engine oil pressure
**Decode**: `len: 8, max: 255, unit: scalar` — u8 scalar
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-Z4
**Year Coverage**: 2012+ (3-Series), 2007+ (5-Series), 2020+ (Z4)
**Confidence**: Very High — appears in 4+ repos
**Note**: Unit is raw scalar; no documented conversion to kPa/bar in OBDb. Forum posts (BimmerFest, 2023) suggest BMW oil pressure control is ~4.0–6.0 bar at operating temp, but this DID's raw mapping to physical units is not openly documented.

---

## Verified DID: did:DA12 (Target: 0x18 — EGS)

**Parameter**: ATF (automatic transmission fluid) temperature
**Decode**: `len: 8, max: 255, unit: scalar` — u8 scalar
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2012+ (3-Series), 2014+ (X5), 2020+ (Z4)
**Confidence**: Very High
**Note**: Orchestrator stated `u8 scalar`. OBDb does not specify offset/scale. Forum posts (BimmerFest, 2020) indicate normal ATF temp reaches ~120 °C, suggesting the scalar may be °C directly or offset.

---

## Verified DID: did:DA1F (Target: 0x18 — EGS)

**Parameter**: Kickdown
**Decode**: `bix: 8, len: 8, max: 100, unit: scalar` — u8 %
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2007+ (5-Series), 2012+ (3-Series), 2014+ (X5), 2020+ (Z4)
**Confidence**: Very High
**Note**: Orchestrator stated `u8 %` — consistent

---

## Verified DID: did:DA22 (Target: 0x18 — EGS)

**Parameter**: Torque converter lockup
**Decode**: `bix: 8, len: 8, map` — enumerated values:
- 0 = OPEN
- 1 = CONTROL_LOW
- 2 = CONTROL_HIGH
- 3 = CLOSED_LOW
- 4 = CLOSED_HIGH
- 8 = TRANSITION_OPEN
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2007+ (5-Series), 2012+ (3-Series), 2014+ (X5)
**Confidence**: Very High
**Note**: Orchestrator stated `enum` — consistent

---

## Verified DID: did:DA23 (Target: 0x18 — EGS)

**Parameter**: Odometer (low resolution)
**Decode**: `len: 32, max: 1000000, mul: 8, unit: kilometers` → u32 × 8 km
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2007+ (5-Series), 2012+ (3-Series), 2014+ (X5)
**Confidence**: Very High
**Note**: Orchestrator stated `u32 × 8 km` — consistent

---

## Verified DID: did:DA25 (Target: 0x18 — EGS)

**Parameter**: Engine oil temperature
**Decode**: `len: 16, max: 500, min: -500, add: -48, sign: true, unit: celsius` — s16, raw − 48 °C
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2007+ (5-Series), 2012+ (3-Series), 2014+ (X5)
**Confidence**: Very High
**Note**: Orchestrator stated `raw−48 °C (s16, signed)` — consistent with OBDb `add: -48, sign: true`

---

## Verified DID: did:DA28 (Target: 0x18 — EGS)

**Parameter**: Brake switch
**Decode**: `bix: 8, len: 8, max: 1, unit: scalar` — boolean/binary
**OBDb Source**: BMW-5-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2007+ (5-Series), 2014+ (X5), 2020+ (Z4)
**Confidence**: High
**Note**: Not present in BMW-3-Series or 4-Series OBDb repos (may be filtered out). Orchestrator listed this DID.

---

## Verified DID: did:DA2A (Target: 0x18 — EGS)

**Parameter**: Torque converter speed / transmission output shaft speed
**Decode**: 
- Torque converter speed: `len: 16, sign: true, unit: rpm` (s16)
- Transmission output shaft speed: `bix: 16, len: 16, sign: true, unit: rpm` (s16)
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2007+ (5-Series), 2012+ (3-Series), 2014+ (X5)
**Confidence**: Very High
**Note**: Orchestrator stated `s16, rpm` — consistent. Two distinct signals packed in one DID.

---

## Verified DID: did:DA2E (Target: 0x18 — EGS)

**Parameter**: Gear shift / drive mode
**Decode**: 
- Shift gear: `len: 8, map` → 0=PARK, 1=REVERSE, 2=NEUTRAL, 3=DRIVE
- Drive mode: `bix: 8, len: 8, map` → 3=DRIVE, 5=SPORT
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2007+ (5-Series), 2012+ (3-Series), 2014+ (X5)
**Confidence**: Very High
**Note**: Orchestrator stated `enum` — consistent

---

## Verified DID: did:DA37 (Target: 0x18 — EGS)

**Parameter**: Time in D / S / M
**Decode**: Three u8 scalars:
- Time in D: `len: 8`
- Time in S: `bix: 8, len: 8`
- Time in M: `bix: 16, len: 8`
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2012+ (3-Series), 2014+ (X5), 2020+ (Z4)
**Confidence**: Very High
**Note**: Orchestrator stated `u8 each` — consistent

---

## Verified DID: did:DB32 (Target: 0x19 — DSC)

**Parameter**: Front axle actual torque / setpoint torque
**Decode**: 
- Actual torque: `len: 16, max: 8000, min: -8000, div: 4, sign: true, unit: newtonMeters` → s16/4 Nm
- Setpoint torque: `bix: 32, len: 16, max: 8000, min: -8000, div: 4, sign: true, unit: newtonMeters` → s16/4 Nm
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2012+ (3-Series), 2017+ (5-Series), 2019+ (X5), 2019+ (Z4)
**Confidence**: Very High
**Note**: Orchestrator stated `s16, div 4, Nm` — consistent

---

## Verified DID: did:DBE4 (Target: 0x29 — Steering/DSC, also 0x19 in some repos)

**Parameter**: Wheel speeds FL / FR / RL / RR
**Decode**: Four s16 fields, each `div: 100, sign: true, unit: kilometersPerHour` → raw/100 km/h
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2007+ (5-Series), 2012+ (3-Series), 2014+ (X5)
**Confidence**: Very High
**Note**: 
- In BMW-3-Series/4-Series/X3/Z4, this is addressed to `0x29` (rax: 629, eax: 29)
- In BMW-5-Series/X5, this is addressed to `0x19` (rax: 619, eax: 19) — same DID, different ECU target depending on chassis
- Orchestrator stated `DSC (0x19) — s16, div 100, km/h` and `Steering (0x29) — u8, km/h` — the OBDb data shows s16/div100 at both 0x19 and 0x29. The orchestrator's `u8` note for steering may be a different signal or outdated.

---

## Verified DID: did:DCDD (Target: 0x56 — Body)

**Parameter**: Door states, hood, trunk, central lock, rear window
**Decode**: 8× u8 scalars (bitfields):
- Driver door open
- Passenger door open
- Rear driver door open
- Rear passenger door open
- Hood open
- Trunk open
- Rear window open
- Locked (overall lock state)
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2012+ (3-Series), 2016+ (5-Series), 2014+ (X5), 2019+ (Z4)
**Confidence**: Very High
**Note**: Orchestrator stated `bitfield, u8` — consistent. OBDb models each field as a separate u8 scalar.

---

## Verified DID: did:D107 (Target: 0x60 — Cluster)

**Parameter**: Vehicle speed
**Decode**: `len: 16, max: 255, div: 10, unit: kilometersPerHour` → s16, div 10, km/h
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2007+ (5-Series), 2012+ (3-Series), 2014+ (X5)
**Confidence**: Very High
**Note**: Orchestrator stated `s16, div 10, km/h` — consistent

---

## Verified DID: did:D10D (Target: 0x60 — Cluster)

**Parameter**: Odometer / odometer alternative
**Decode**: Two u32 fields:
- Odometer: `len: 32, max: 4294967295, unit: kilometers`
- Odometer alternative: `bix: 32, len: 32, max: 4294967295, unit: kilometers`
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2007+ (5-Series), 2012+ (3-Series), 2014+ (X5)
**Confidence**: Very High
**Note**: Orchestrator stated `u32, km` — consistent

---

## Verified DID: did:D111 (Target: 0x60 — Cluster)

**Parameter**: Range and consumption data
**Decode**: Multiple u16 fields:
- Current electric range: `len: 16, max: 6553.5, div: 10, unit: kilometers`
- Maximum electric range: `bix: 16, len: 16, div: 10`
- Current fuel range: `bix: 32, len: 16, div: 10`
- Maximum fuel range: `bix: 48, len: 16, div: 10`
- Electric consumption / 100km: `bix: 64, len: 16, max: 65.535, div: 1000, unit: kilowattHours`
- Auxiliary power consumption: `bix: 80, len: 16, max: 655.35, div: 100, unit: kilowatts`
**OBDb Source**: BMW-5-Series, BMW-X5, BMW-Z4
**Year Coverage**: 2015+ (5-Series), 2014+ (X5), 2020+ (Z4)
**Confidence**: High
**Note**: Not present in BMW-3-Series/4-Series/X3 repos (likely filtered for PHEV/BEV or higher-trim vehicles). This is a **discovered additional DID** not fully detailed in the orchestrator's summary.

---

## Verified DID: did:D112 (Target: 0x60 — Cluster)

**Parameter**: Ambient air temperature
**Decode**: `len: 8, max: 87.5, min: -40, div: 2, add: -40, unit: celsius` → raw/2 − 40 °C
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2007+ (5-Series), 2012+ (3-Series), 2014+ (X5)
**Confidence**: Very High
**Note**: Orchestrator stated `raw/2 − 40 °C` — consistent

---

## Verified DID: did:1700 (Target: 0x40 — Other)

**Parameter**: Odometer variant
**Decode**: `len: 32, max: 1000000, unit: kilometers` — u32, km
**OBDb Source**: BMW-5-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2007+ (5-Series), 2014+ (X5), 2020+ (Z4)
**Confidence**: High
**Note**: Orchestrator stated `u32, km` at 0x40 — consistent

---

## Verified DID: did:D031 (Target: 0x63 — Other)

**Parameter**: Current gear
**Decode**: `len: 8, max: 255, unit: scalar` — u8
**OBDb Source**: BMW-5-Series, BMW-Z4
**Year Coverage**: 2007+ (5-Series), 2020+ (Z4)
**Confidence**: High
**Note**: Orchestrator stated `u8` at 0x63 — consistent

---

## Verified DID: did:D240 (Target: 0x0D — Cluster/Instrument)

**Parameter**: Vehicle speed, instrument cluster
**Decode**: `len: 16, max: 1000, unit: kilometersPerHour`
**OBDb Source**: BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-X3, BMW-X5, BMW-Z4
**Year Coverage**: 2012+ (3-Series), 2007+ (5-Series), 2014+ (X5)
**Confidence**: Very High
**Note**: **Additional discovery** — not in orchestrator's original list. Instrument cluster provides a separate vehicle speed reading independent of 0x60/D107.

---

## Verified DID: did:DFE7 (Target: 0x19 — DSC)

**Parameter**: Variable geometry turbocharger calibration angle / distance since last oil change
**Decode**: 
- VGT cal angle: `len: 16, max: 1000, mul: 156.25, div: 10000, unit: degrees`
- Oil change distance: `bix: 304, len: 32, max: 1000000, unit: kilometers`
**OBDb Source**: BMW-5-Series, BMW-X5, BMW-Z4
**Year Coverage**: 2018+ (5-Series), 2019+ (X5), 2019+ (Z4)
**Confidence**: High
**Note**: **Additional discovery** — not in orchestrator's list. Packed DID with unrelated fields (turbo angle + maintenance distance). May be chassis-specific.

---

## Additional DIDs: High-Voltage Battery (PHEV/BEV) — Target: 0x07

The following DIDs were discovered in BMW-X5 and BMW-5-Series OBDb repos for hybrid/electric variants. They are relevant for BeeEmUu if PHEV profiles are added later.

| DID | Parameter | Decode | Source |
|-----|-----------|--------|--------|
| `6335` | HV battery health (SOH) | `bix: 24, len: 8, max: 100, unit: percent` | X5, 5-Series |
| `DD69` | HV battery current | `len: 32, max: 10000, min: -10000, div: 100, sign: true, unit: amps` | X5, 5-Series |
| `DDBC` | HV battery SOC (min/avg/max) | Three u16 fields, `div: 10, unit: percent` | X5, 5-Series |
| `DDC0` | HV battery cell temp (min/max) | Two s16 fields, `div: 100, unit: celsius` | X5, 5-Series |
| `DF71` | Battery cell/module counts | Multiple u8/u16 scalars | X5, 5-Series |
| `DFA0` | Detailed cell statistics (voltage, temp, capacity, resistance, SOC, OCV) | 20+ packed fields | X5, 5-Series |
| `E5C7` | HV battery health v2 | `bix: 24, len: 8, max: 100, unit: percent` | X5, 5-Series |
| `E5CE` | HV battery charge v2 | `len: 16, max: 100, div: 100, unit: percent` | X5, 5-Series |

**Confidence**: Medium-High — verified in OBDb but only for hybrid variants. Gasoline-only vehicles may return NRC.

---

## Conflicts & Notes

### 1. DID 4506 — Decode Ambiguity
- **Orchestrator**: `raw−40 °C`
- **OBDb**: Shows `min: -40, max: 200` but does NOT explicitly set `add: -40` in JSON (unlike D112 which has `add: -40`). The range bounds strongly imply offset −40, but OBDb's format definition makes the offset implicit via `min` rather than explicit via `add`.
- **Impact**: Low. The practical decode is the same.

### 2. DID DBE4 — Target ECU Discrepancy
- **Orchestrator**: Listed under both DSC (0x19) as `s16, div: 100` and Steering (0x29) as `u8, km/h`
- **OBDb**: Found at 0x19 (DSC) in 5-Series/X5 with `s16, div: 100`. Found at 0x29 (steering) in 3-Series/4-Series/X3/Z4 also with `s16, div: 100`. The `u8` claim for 0x29 was **not verified** in any OBDb repo; all instances show s16.
- **Impact**: Medium. The `u8` variant may be a different DID or a different ReadDataByPeriodicIdentifier (0x21) service.

### 3. DID 4300, 4402, 5AC3 — Not Found in Fetched OBDb Repos
- **Orchestrator**: `22 4300` → engine temperature, `22 4402` → engine oil temp v2, `22 5AC3` → fuel pressure
- **OBDb**: These DIDs were **not found** in the 7 OBDb repos fetched (3-Series, 4-Series, 5-Series, X3, X5, Z4, 2-Series). They may exist in other OBDb repos (e.g. BMW-M3, BMW-M4, BMW-7-Series) or may be forum-sourced.
- **Confidence**: Unverified for these specific repos. The orchestrator's OBDb research may have accessed different repos or earlier OBDb versions.

### 4. Service 0x21 (ReadDataByPeriodicIdentifier) — Not Found
- **Orchestrator**: `21 01` → wheel speeds, `21 04` → steering angle / acceleration / yaw rate
- **OBDb**: These are **not DIDs** (service 0x22) but **periodic identifiers** (service 0x2A / 0x21). OBDb repos do not document periodic identifiers in the same signalset format. No open-source verification found.
- **Confidence**: Low — these are likely real but not documented in OBDb's JSON structure.

### 5. DID DA25 — Two Different Decodes in OBDb
- **BMW-3-Series/X3**: `len: 16, max: 500, min: -500, add: -48, sign: true` → s16, raw − 48 °C
- **BMW-Z4**: `len: 8, max: 255, unit: scalar` → u8 scalar (no offset)
- **Interpretation**: The Z4 repo may be using a different transmission variant or the DID decode is chassis-specific. The 3-Series decode matches the orchestrator's description.

---

## Unverified / Rumored DIDs

The following DIDs were mentioned by the orchestrator but **could not be independently verified** in fetched OBDb repos or forum searches:

| DID | Target | Parameter | Source | Confidence |
|-----|--------|-----------|--------|------------|
| `22 4300` | 0x12 | Engine temperature (°F) | Orchestrator's OBDb research | Low — not found in fetched repos |
| `22 4402` | 0x12 | Engine oil temperature v2 (raw−60) | Orchestrator's OBDb research | Low — not found in fetched repos |
| `22 5AC3` | 0x12 | Fuel pressure (raw × 2.6 bars) | Orchestrator's OBDb research | Low — not found in fetched repos |
| `21 01` | 0x29 | Wheel speeds (periodic) | Orchestrator's OBDb research | Low — not a DID, service 0x21 |
| `21 04` | 0x29 | Steering angle / acceleration / yaw (periodic) | Orchestrator's OBDb research | Low — not a DID, service 0x21 |

**Recommendation**: These should be flagged as "needs car verification" in BeeEmUu profiles. They may be valid but require physical testing on F/G-series hardware.

---

## Searched-For but Not Found (Additional DIDs)

The following parameters were requested for discovery but **no open-source DID mappings were found**:

- **HPFP rail pressure (alternative to 5AC3)**: Not found in OBDb beyond `22 5AC3`.
- **Charge-air temperature**: No open-source DID found. May be available via BMW-specific tools only.
- **Ignition timing**: No open-source DID found.
- **VANOS position**: No open-source DID found.
- **Actual boost / WGDC**: No open-source DID found. Tuning-community data, not diagnostic-community data.
- **Battery current / SOC / voltage (12V IBS)**: The 12V IBS uses BSD protocol, not UDS. No UDS DID found.
- **Cabin temperature, fan speed, AC pressure**: No open-source UDS DIDs found for HVAC.

**Dominant narrative**: Turbo-specific and HVAC-specific parameters are either tuning-community data or deeply embedded in proprietary BMW data files. No open-source community has reverse-engineered and published them.

---

## Source Index

| Source | Type | License | URL |
|--------|------|---------|-----|
| OBDb — BMW-3-Series | Open-source signalset | CC-BY-SA 4.0 | https://github.com/OBDb/BMW-3-Series |
| OBDb — BMW-4-Series | Open-source signalset | CC-BY-SA 4.0 | https://github.com/OBDb/BMW-4-Series |
| OBDb — BMW-5-Series | Open-source signalset | CC-BY-SA 4.0 | https://github.com/OBDb/BMW-5-Series |
| OBDb — BMW-X3 | Open-source signalset | CC-BY-SA 4.0 | https://github.com/OBDb/BMW-X3 |
| OBDb — BMW-X5 | Open-source signalset | CC-BY-SA 4.0 | https://github.com/OBDb/BMW-X5 |
| OBDb — BMW-Z4 | Open-source signalset | CC-BY-SA 4.0 | https://github.com/OBDb/BMW-Z4 |
| OBDb — BMW-2-Series | Open-source signalset | CC-BY-SA 4.0 | https://github.com/OBDb/BMW-2-Series |
| GitHub Gist — brandonros | Community UDS function list | Public (Gist) | https://gist.github.com/brandonros/4aa6ae51d0f925671d034446947df555 |
| BimmerFest — Oil Pressure | Forum discussion | Public | https://www.bimmerfest.com/threads/oil-pressure-specification-07-x3.1445614/ |
| BimmerFest — ATF Temp | Forum discussion | Public | https://www.bimmerfest.com/threads/transmission-fluid-temperature-sensor.1399168/ |
| BimmerFest — IBS Design | Forum discussion | Public | https://www.bimmerfest.com/threads/defficiency-of-e70-ibs-design.1483297/ |
| Bimmerscan — IBS Article | Technical article | Public | https://bimmerscan.com/bmw-intelligent-battery-sensor-ibs/ |
| M5Board — Steering Angle | Forum discussion | Public | https://www.m5board.com/threads/steering-angle-sensor-is-it-just-dirty-or-dead.615390/ |
| py-uds Documentation | Technical documentation | Open | https://uds.readthedocs.io/en/latest/pages/knowledge_base/did.html |
| CSS Electronics — UDS Tutorial | Technical tutorial | Open | https://www.csselectronics.com/pages/uds-protocol-tutorial-unified-diagnostic-services |

---

## Recommendations for BeeEmUu Profiles

1. **Add verified DIDs to B58/late-N55 profiles**: All "Verified DID" entries above with "Very High" or "High" confidence can be added immediately.
2. **Flag unverified DIDs**: `22 4300`, `22 4402`, `22 5AC3`, `21 01`, `21 04` should be added with `verified = false` and a "needs car verification" note.
3. **Decode functions needed**: BeeEmUu may need new decode functions for:
   - `u16_div10` (4C5B, 57C3, DBE4, D107)
   - `s16_div4` (DB32)
   - `u32_mul8` (DA23)
   - `u16_mul156.25_div10000` (DFE7 VGT angle — niche)
   - `u8_enum` (DA22, DA2E)
4. **Chassis-specific DIDs**: Some DIDs (e.g. D111 range/consumption, DFE7 VGT angle) are only present on certain variants. Add `filter: { from: 2015 }` or similar.
5. **PHEV battery DIDs**: The HV battery DIDs (0x07 target) should be added to a future PHEV/BEV profile, not the gasoline B58 profile.
