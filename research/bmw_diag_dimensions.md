# Phase 2: Dimension Decomposition — BeeEmUu Community Data Expansion

**Route**: D (File-Augmented Research)  
**Derived from**: Phase F file analysis + Phase 1 targeted landscape scan

---

## Dimension 01: DTC Powertrain — Misfire, Fuel, Ignition
**Scope**: BMW hex DTCs for engine misfire (29CD–29D2 family), fuel mixture control (29E0–29E2), fuel pressure (2FBF–2FC7), ignition, and common DME faults.  
**Angle**: Exhaustive collection from community forum compilations.  
**Expected sources**: BimmerFest, BimmerPost, E90Post, N54Tech, SpoolStreet, usro.net.  
**Overlap with**: Dim 02 (turbo/VANOS), Dim 07 (N52/N54/N55/N62 specifics).

## Dimension 02: DTC Turbo, VANOS & Valvetrain
**Scope**: BMW hex DTCs for VANOS (2A80–2A9A family), turbocharger/boost (2ABC–2ABD, 30CF–3100), charge-air, DISA, and valvetronic faults.  
**Angle**: Turbo-specific and variable valve timing faults.  
**Expected sources**: BimmerFest, N54Tech, SpoolStreet, BimmerPost.  
**Overlap with**: Dim 01 (powertrain), Dim 07 (per-engine specifics).

## Dimension 03: DTC Chassis, Body & Network
**Scope**: BMW hex DTCs for DSC/ABS (5DE0–5E5B), steering angle, wheel speed sensors, FRM/lighting (9Cxx), CAS/keyless (A0xx), CAN/PT-CAN/K-CAN errors (Dxxx, Exxx).  
**Angle**: Non-powertrain codes that appear in module scans.  
**Expected sources**: BimmerFest, BimmerPost, E90Post, forumbmw.net PDF.  
**Overlap with**: Dim 01 (some CAN errors relate to engine comms).

## Dimension 04: UDS DID Mappings — DME (F/G-Series)
**Scope**: UDS ReadDataByIdentifier (0x22) DIDs for DME address 0x12 on F/G-series BMWs. Oil temp, coolant, IAT, lambda, EGT, fuel pressure, oil pressure, ethanol content, vehicle speed.  
**Angle**: Open-source DID verification from OBDb + community forum cross-checks.  
**Expected sources**: OBDb GitHub repos, BimmerPost F-series threads, F30/F32 community wikis.  
**Overlap with**: Dim 05 (EGS/DSC/body DIDs), Dim 10 (tool integration).

## Dimension 05: UDS DID Mappings — EGS, DSC, Body, Cluster (F/G-Series)
**Scope**: UDS DIDs for EGS (0x18) transmission data, DSC (0x19) dynamics data, body module (0x56) doors/locks, cluster (0x60) VSS/odo/ambient, steering (0x29) wheel speeds.  
**Angle**: Complete the per-module DID picture for F/G-series.  
**Expected sources**: OBDb GitHub repos, BimmerPost coding threads.  
**Overlap with**: Dim 04 (DME DIDs), Dim 10 (tool integration).

## Dimension 06: OBD-II Extended PIDs & BMW-Specific Mode 01/09
**Scope**: Beyond the basic 9 OBD-II PIDs already in profiles. Extended Mode 01 PIDs for fuel trims, O2 sensors, MAF, EGR, VVT. Mode 09 VIN/calibration data.  
**Angle**: Public SAE J1979 standard data that applies universally but is underutilized.  
**Expected sources**: SAE J1979-DA, OBD-II PID databases, OBDb.  
**Overlap with**: All engine profiles (Dim 04, 07, 10).

## Dimension 07: KWP2000 Local Identifiers — E-Series DME (N52/N54/N55/N62)
**Scope**: KWP2000 local identifier (Mode 0x21) mappings for E-series DMEs. Oil temp, lambda, DISA, VANOS position, valvetronic lift, ignition timing, knock retard.  
**Angle**: The "holy grail" of E-series data — notoriously scarce in open sources.  
**Expected sources**: Forum posts with explicit local identifier numbers, INPA/EDIABAS community documentation (careful: must not extract from proprietary files), BimmerPost coding wikis.  
**Overlap with**: Dim 08 (EGS local IDs), Dim 09 (freeze frames).
**Note**: High likelihood of low yield. If no open-source data found, document the gap explicitly.

## Dimension 08: KWP2000 Local Identifiers — E-Series EGS & Other Modules
**Scope**: KWP2000 local identifiers for EGS (0x18), DSC, CAS, FRM on E-series. Transmission temp, gear data, brake pressure, wheel speeds.  
**Angle**: Per-module local identifier discovery for E-series.  
**Expected sources**: Same as Dim 07 — forum posts, community wikis.  
**Overlap with**: Dim 07 (E-series DME).
**Note**: Also high likelihood of low yield.

## Dimension 09: Freeze-Frame Byte Layouts & Environmental Data
**Scope**: Per-ECU freeze-frame schemas for real BMWs (not simulator). DME, EGS, DSC, CAS layouts.  
**Angle**: Any open-source documentation of what bytes appear in a freeze frame and their meaning.  
**Expected sources**: Academic papers, INPA documentation (layout only, not data extraction), forum posts describing freeze-frame contents.  
**Overlap with**: Dim 07/08 (local identifiers, since freeze frames often reuse the same parameter IDs).
**Note**: Extremely unlikely to find structured open-source data. Expect to document this as a major gap.

## Dimension 10: Open-Source Tool Integration & Academic Research
**Scope**: OBDb (CC-BY-SA), TUM FTM UDS reverse-engineering toolkit, FORScan BMW data, other open-source diagnostic tools with BMW modules. Academic papers on BMW diagnostics.  
**Angle**: Cross-reference tool data with community knowledge; identify tools that can accelerate data discovery.  
**Expected sources**: GitHub, arXiv, IEEE, automotive research conferences.  
**Overlap with**: Dim 04/05 (UDS DIDs), Dim 06 (OBD-II).

---

## Dimension Assignment Summary

| Dim | Topic | Expected yield | Priority |
|-----|-------|---------------|----------|
| 01 | DTC Powertrain | High | P1 |
| 02 | DTC Turbo/VANOS | High | P1 |
| 03 | DTC Chassis/Body | High | P1 |
| 04 | UDS DID — DME | High | P1 |
| 05 | UDS DID — EGS/DSC/Body | Medium-High | P1 |
| 06 | OBD-II Extended PIDs | Medium | P2 |
| 07 | KWP2000 Local IDs — DME | Low-Medium | P2 |
| 08 | KWP2000 Local IDs — EGS/etc | Low | P2 |
| 09 | Freeze-Frame Layouts | Very Low | P3 |
| 10 | Tool Integration | Medium | P2 |
