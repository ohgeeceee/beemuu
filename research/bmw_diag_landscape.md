# Phase 1: Targeted Landscape Scan — Open-Source BMW Diagnostic Data

**Route**: D (File-Augmented Research)  
**Date**: 2026-07-06  
**Scan focus**: Gaps identified in Phase F — DTC fault texts, DID mappings, freeze-frame schemas, per-engine parameters.

---

## Search 1: Open-Source BMW DTC Databases

**Query**: `open source BMW DTC fault code database community reverse engineering GitHub`

**Key findings**:
- ProCarManuals aggregates BMW DTCs but is a commercial database; provenance unclear.
- **BimmerFest forum post** (Error code 2a82 and 2a99, 2012) contains a community-compiled list of ~100 BMW hex DTCs with descriptions, including misfire (29CD–29D2), fuel mixture (29E0–29E2), VANOS (2A80, 2A85, 2A87), boost/turbo (2ABC, 2ABD, 30FC–3100), lambda (2C2B–2C7F), DSC (5DE0–5E5B), and body/CAS (A0B0–A8B6) codes.
- **usro.net blog** (2025) lists BMW hex DTCs with some overlap but also unique codes (2E85, 2F44, 5E19, CF15, A0B5).
- **forumbmw.net PDF** (2004) has comprehensive DTC tables for MS42/MS43 era with SAE P-code cross-references.
- MTX DTC Remover and similar commercial tools are irrelevant (proprietary).

**Dominant narrative**: Community DTC knowledge exists in forum compilations, not in structured open databases. The BimmerFest thread is the richest single source found.

**Gaps**: No open-source structured database with >200 BMW-specific hex DTCs. No GitHub-native DTC repository for BMW.

---

## Search 2: BMW DID Mappings — Oil Temp, Local Identifiers

**Query**: `BMW DID data identifier mapping oil temperature local identifier N52 N54 N55 forum bimmerpost`  
**Result**: Search failed (404). Replaced with targeted forum searches.

**Key findings**:
- **OBDb (github.com/OBDb)** is a CC-BY-SA open-source vehicle diagnostic database with BMW-specific repos.
- OBDb `BMW/default.json` and `BMW-3-Series/default.json` contain **verified UDS DID mappings** for F/G-series (2012+):
  - DME (0x12): `22 400B` lambda, `22 4015` IAT, `22 411E` coolant, `22 4402` oil temp (raw−60), `22 4506` oil temp (raw−40), `22 4AB1` VSS, `22 4C5B` EGT, `22 57C3` oil temp alt (raw/10), `22 586F` oil pressure, `22 5AC3` fuel pressure
  - EGS (0x18): `22 DA12` ATF temp, `22 DA1F` kickdown, `22 DA22` torque converter lockup, `22 DA23` odometer, `22 DA25` oil temp, `22 DA2A` torque converter speed, `22 DA2E` gear, `22 DA37` time in D/S/M
  - DSC (0x19): `22 DB32` axle torque, `22 DBE4` wheel speeds
  - Body (0x56): `22 DCDD` doors/locks
  - Cluster (0x60): `22 D107` VSS, `22 D10D` odometer, `22 D111` range, `22 D112` ambient temp
  - Steering (0x29): `22 DBE4` wheel speeds, `21 01` wheel speeds, `21 04` steering angle / acceleration / yaw rate

- **Forum searches** (BimmerFest, SpoolStreet) discuss oil temperature behavior but **do not reveal the actual diagnostic identifier** used to read it. Community members reference ISTA, INPA, or OBD scanners without publishing raw identifiers.
- **N52 oil temp**: The N52 oil temp is NOT available via OBD-II or simple local identifier. Some forum posts suggest it requires a BSD (Bit Serial Data) read from the oil level sensor, which is a separate protocol from KWP2000/UDS.

**Dominant narrative**: UDS DID mappings for F/G-series are partially documented in OBDb. KWP2000 local identifiers for E-series are **not publicly documented** in open sources — they are reverse-engineered from proprietary tools or discovered via Parameter Explorer on real cars.

**Gaps**: No open-source E-series (KWP2000) local identifier tables. No comprehensive DID mapping for N52/N54/N55/N62 DMEs.

---

## Search 3: BMW N54/N55/B58 Extended Parameters — HPFP, Boost, Charge Air

**Query**: `BMW N54 N55 B58 OBD PID local identifier HPFP rail pressure boost charge air temperature community`

**Key findings**:
- SpoolStreet forum (N54/N55 tuning community) extensively discusses HPFP volume control valve tuning, rail pressure behavior, and logging. These are **tuning discussions**, not diagnostic identifier documentation.
- **N54 HPFP rail pressure**: OBD-II PID `0x23` (raw × 10 kPa) is emissions-mandated and already in `n54.toml`. This is public OBD-II standard data.
- **N55/B58 HPFP**: No OBD-II PID for rail pressure on these engines (the emissions mandate only requires PID 0x23 on direct-injection engines where it is used for emissions control; some N55 DMEs have it, others don't).
- OBDb `22 5AC3` (fuel pressure) on DME exists but is confirmed on F/G-series only, not E-series.
- **Charge-air temperature**: No OBD-II PID. No open-source DID found. Some forum posts suggest it is available via BMW-specific tools but the identifier is not published.
- **Boost pressure**: OBD-II MAP (`0x0B`) + barometric (`0x33`) gives relative boost. This is already in the profiles. Actual boost control actuator data (WGDC, target boost) is not in open sources.

**Dominant narrative**: Turbo-specific parameters (charge-air temp, WGDC, actual boost) are **tuning parameters** discussed in tuning forums, not diagnostic parameters published in open-source databases. The OBD-II baseline is the only public layer.

**Gaps**: No open-source DID/local identifier for charge-air temp, WGDC, or actual boost on N54/N55/B58.

---

## Search 4: BMW Freeze-Frame and Diagnostic Tool Landscape

**Query**: `BMW diagnostic freeze frame byte layout open source INPA NCSExpert EDIBIAS reverse engineering`

**Key findings**:
- BimmerFest has extensive historical documentation on INPA, EDIABAS, NCSExpert, and NCS Dummy. These are **BMW factory tools** that have been leaked/community-shared.
- INPA can read DTCs, clear them, and read freeze frames. The `.IPO` files in INPA contain the UI layouts for reading parameters, but their data source is proprietary BMW `SGBD` files.
- **TUM FTM academic paper** (2025): "Holistic Approach for Automated Reverse Engineering of Unified Diagnostics Service Data" — GitHub repo provides a Python toolkit for DoIP reverse engineering. This is a legitimate open-source academic project.
- **Open-mechanic, OBDium, Libre-Diagnostic**: These are generic OBD-II tools with plans for manufacturer-specific modules but no BMW-specific data yet.

**Dominant narrative**: Freeze-frame byte layouts are **deeply embedded in proprietary BMW data files** (SGBDs, .prg files). No open-source community has reverse-engineered and published them. The only legitimate path is car-by-car Parameter Explorer discovery.

**Gaps**: No open-source freeze-frame schemas for any BMW ECU. The simulator's 5-field DME schema is the only published one.

---

## Search 5: Open-Source BMW Diagnostic Repositories

**Query**: `open source BMW diagnostic tools github repo DTC DID live data profiles community data`

**Key findings**:
- **OBDb (github.com/OBDb)** is the most significant open-source BMW diagnostic data repository. 38 BMW-related repos covering models from 3-Series to iX3. Data is CC-BY-SA licensed.
- **OBDb BMW repos** contain `signalsets/v3/default.json` files with UDS DID mappings, but these are filtered for 2012+ vehicles (F/G-series).
- **speed785/open-mechanic**: Plans BMW-specific modules but currently only generic OBD-II.
- **provrb/obdium**: Rust-based OBD-II tool, no BMW-specific PIDs yet.
- **TUMFTM/Holistic-Approach...**: Academic UDS reverse engineering toolkit, not a data repository.
- **No GitHub repo** was found containing a structured BMW DTC database or KWP2000 local identifier table.

**Dominant narrative**: OBDb is the only mature, open-source, licensed BMW diagnostic data project. It is UDS-centric and modern-chassis-focused. E-series KWP2000 data is a desert.

**Gaps**: No open-source E-series KWP2000 data. No open-source structured BMW DTC database on GitHub. No community freeze-frame schema library.

---

## Landscape Synthesis

### What EXISTS in open sources

| Data Category | Source | Quality | Coverage |
|---------------|--------|---------|----------|
| OBD-II PIDs | SAE J1979 standard | High | All 1996+ vehicles, including all BMW engines |
| BMW hex DTCs | BimmerFest forum compilation | Medium | ~100 codes, mostly powertrain + some body/chassis |
| UDS DID mappings (F/G-series) | OBDb (CC-BY-SA) | Medium-High | DME, EGS, DSC, body, cluster for 2012+ |
| Academic reverse-engineering tools | TUM FTM GitHub | High | UDS/DoIP automated discovery (requires hardware) |
| INPA/EDIABAS tool documentation | BimmerFest | N/A | Tool installation guides, not data |

### What DOES NOT exist in open sources

| Data Category | Why it's missing | Path to obtain |
|---------------|-----------------|---------------|
| KWP2000 local identifiers (E-series) | Not published by BMW; reverse-engineered from proprietary tools | Parameter Explorer on real cars, or academic reverse engineering |
| Freeze-frame byte layouts | Embedded in proprietary SGBD files | Parameter Explorer per ECU per chassis |
| DTC texts beyond ~100 common codes | Not compiled into open database; scattered in forums | Community compilation from forum posts + car observations |
| Turbo-specific DIDs (WGDC, charge-air temp, actual boost) | Tuning-community data, not diagnostic-community data | Parameter Explorer + community sharing |
| Service function identifiers | Security-sensitive, not published | Community reverse engineering per function |

### Strategic Implications for BeeEmUu

1. **DTC fault texts**: Can be expanded significantly from forum compilations (BimmerFest, usro.net). These are community-derived, not extracted from ISTA. ~100+ additional codes can be added with medium confidence.
2. **DID mappings for F/G-series**: OBDb provides a solid foundation. Can add `did:HHHH` entries to B58 and late-N55 profiles. Must note that these are for UDS/DoIP only (F/G-series).
3. **DID mappings for E-series**: No open-source data available. The `local:10` oil temp placeholder cannot be verified from open sources. Must remain placeholder with explicit "verify on car" note.
4. **Freeze-frame schemas**: No open-source data. Must remain simulator-only or car-verified.
5. **New decode functions needed**: BeeEmUu currently lacks `u16_div10`, `u16_tenths`, `u8_offset` (for raw−60), and `u16_mixed` (for signed 16-bit). These would be needed to fully use OBDb data.

### Key Sources (for citation)

[^1]: OBDb — Open Vehicle Database. BMW UDS DID mappings. CC-BY-SA 4.0. https://github.com/OBDb/BMW
[^2]: BimmerFest — "Error code 2a82 and 2a99" forum thread. Community-compiled BMW hex DTC list. https://www.bimmerfest.com/threads/error-code-2a82-and-2a99.604589/
[^3]: usro.net — "BMW Fault & DTC Codes: Complete List Explained". 2025. https://blog.usro.net/2025/04/bmw-fault-dtc-codes-complete-list-explained/
[^4]: TUM FTM — "Holistic Approach for Automated Reverse Engineering of Unified Diagnostics Service Data". World Electric Vehicle Journal, 2025. https://github.com/TUMFTM/Holistic-Approach-for-Automated-Reverse-Engineering-of-Unified-Diagnostics-Service-Data
[^5]: BimmerFest — "Making sense of INPA, EDIABAS, NCSExpert..." 2011. Tool documentation. https://www.bimmerfest.com/threads/making-sense-of-inpa-ediabas-ncsexpert-ncs-dummies.561237/
