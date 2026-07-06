# Dimension 09: Freeze-Frame Schemas, Academic Papers & Open-Source Tools

## Research Metadata
- **Date**: 2026-07-06
- **Researcher**: BeeEmUu Deep Research Agent
- **Searches performed**: 17+ across web and Kimi data services
- **Constraint**: No proprietary BMW data (ISTA, INPA .prg, SGBD, etc.)

---

## Summary

| Category | Count | Assessment |
|----------|-------|------------|
| Freeze-frame sources found | **0** (BMW-specific) | No open-source documentation of BMW proprietary freeze-frame byte layouts was found. |
| Academic papers found | **4** | 4 relevant papers; only 1 (TUM FTM) is strongly applicable; 1 (DP-Reverser) includes BMW in test set. |
| Open-source tools found | **10** | Several generic diagnostic tools exist; only a few have BMW-specific protocol support. |

**Overall assessment**: BMW freeze-frame data is effectively undocumented in open sources. What exists is:
1. Generic OBD-II Mode `$02` freeze frames (SAE J1979 standardized PIDs) — these are NOT BMW proprietary freeze frames.
2. Academic reverse-engineering methodologies that could theoretically discover them, but no published DID-to-freeze-frame mappings.
3. Community forum posts describe freeze frame *contents* conceptually (e.g., "lambda reading at time of fault") but never provide raw byte layouts.

The existing BeeEmUu simulator schema (DME 0x12: u16 RPM @ 0, u8 coolant @ 2, etc.) has **no verified basis** in real BMW DME behavior and is likely incorrect for actual UDS snapshot records.

---

## Freeze-Frame Data

### Finding: No BMW-Specific Freeze-Frame Byte Layouts Found in Open Sources

After 17+ searches across forums, academic databases, GitHub, and the open web, **no open-source or community documentation was found that describes the raw byte layout of BMW proprietary freeze frames** (a.k.a. DTC Snapshot Records, UDS Service 0x19 0x04).

**What WAS found:**
- General OBD-II freeze frame documentation (Mode `$02`, SAE J1979) — standardized PIDs like 0x0C (RPM), 0x05 (coolant temp), 0x0D (vehicle speed). These are manufacturer-agnostic and use well-documented formulas.
- FCOM documentation noting: "pre-UDS (ISO14229) ECU freeze frame is mostly limited only to petrol engines. All ISO14229 UDS ECUs usually support freeze frames. Freeze frame contents is determined by ECU for each DTC."
- Forum posts where users describe freeze frame *interpretations* (e.g., "smooth running value of cylinder 1 was 800" or "pre-cat O2 values were super lean") but never the raw hex bytes or offsets.

**What was NOT found:**
- No forum post stating: "byte 0-1 is RPM, byte 2 is coolant temp, byte 3 is vehicle speed..."
- No GitHub repository with documented BMW snapshot record schemas.
- No academic paper publishing BMW freeze-frame DID mappings.
- No OBDb signalset for freeze-frame data (OBDb focuses on live data PIDs via Service 0x22).

### Why This Is So Scarce

1. **BMW uses UDS Service 0x19 0x04** (`reportDTCSnapshotRecordByDTCNumber`) for enhanced freeze frames, not OBD-II Mode `$02`.
2. **Snapshot records are DTC-specific** — the DID sequence in each snapshot is configured per-DTC in the ECU firmware, making universal schemas impossible without ECU-specific ODX data.
3. **BMW extended addressing** complicates generic tools: as noted in Torque Pro forum posts, "BMWs are particularly awkward for extended PIDs as they use extended addressing and normally require dynamically defined PIDs (service 2C) rather than normal requests (service 21/22)."
4. **OBDb does not cover freeze frames**: The OBDb database structure (`signalsets/v3/default.json`) only documents live data commands, not snapshot records.

### The Current BeeEmUu Schema is Likely Wrong

The project's existing DME (0x12) freeze-frame schema:
```
- Engine speed (u16, offset 0)
- Coolant temp (u8, offset 2, bias -40)
- Vehicle speed (u8, offset 3)
- Battery voltage (u8, offset 5, scale 0.1)
- Mileage (u24, offset 6)
```

This is a **simulator approximation**. Real BMW DME snapshot records would likely:
- Use **DID-based structure** (sequence of 2-byte DIDs followed by their data values)
- Include **DTC-specific data** (e.g., which cylinder misfired, lambda sensor reading at fault time, fuel pressure, engine load, ambient pressure)
- Include **status bits** (test conditions, readiness flags, operation-cycle counters)
- Vary **by DTC** — a misfire DTC snapshot will have different DIDs than a catalyst efficiency DTC snapshot

---

## Academic Papers

### 1. Holistic Approach for Automated Reverse Engineering of Unified Diagnostics Service Data
- **Authors**: Rosenberger, N.; Hoffmann, Nikolai; Mitscherlich, Alexander; Lienkamp, M.
- **Venue**: World Electric Vehicle Journal, 2025, 16(7), 384
- **URL**: https://doi.org/10.3390/wevj16070384
- **GitHub**: https://github.com/TUMFTM/Holistic-Approach-for-Automated-Reverse-Engineering-of-Unified-Diagnostics-Service-Data
- **Relevance**: **HIGH** — Provides a complete methodology for discovering UDS DIDs and their physical meaning via the OBD-II port without physical vehicle manipulation.
- **Methodology**:
  - Creates overview of all available ECUs and DIDs via automated scanning.
  - Executes guided experiments for signal gathering (stimulating vehicle inputs while logging UDS responses).
  - Uses linear regression and machine learning (neural networks) to correlate raw DID data with physical signals.
- **BMW-specific data**: The methodology is generic and tested on TUM's own vehicle fleet. The paper does not publish any specific DID mappings or freeze-frame layouts. The GitHub repository contains code for the pipeline but no pre-computed BMW datasets.
- **Usable for BeeEmUu**: The methodology and code can be adapted to discover freeze-frame DIDs by logging UDS 0x19 0x04 responses across a fleet of real BMWs and correlating them with known OBD-II sensor values.

### 2. Towards Automatically Reverse Engineering Vehicle Diagnostic Protocols (DP-Reverser)
- **Authors**: Yu-Le Le, et al.
- **Venue**: USENIX Security Symposium, 2022
- **URL**: https://www.usenix.org/system/files/sec22summer_yu-le.pdf
- **GitHub**: https://github.com/yulele/DP-Reverser
- **Relevance**: **HIGH** — First CPS-based framework to automatically reverse engineer UDS and KWP2000 diagnostic protocols from professional diagnostic tools.
- **Methodology**:
  - Uses robotic arms and cameras to interact with professional scan tools (LAUNCH X431, AUTEL919) and capture screenshots.
  - OCR extracts sensor values from the tool's UI.
  - Genetic programming (GP) infers formulas from the raw hex response bytes.
  - Achieves **98.3% precision** for formula inference across UDS and KWP2000.
  - Tests on 18 real vehicles including **Car G (BMW N1, UDS)** and **Car J (BMW 5T3L1, UDS)**.
- **BMW-specific data**: BMW vehicles were included in the test fleet, but the paper does not publish the specific DID mappings or formulas extracted from them. The tool can recover proprietary formulas but the outputs are not released.
- **Usable for BeeEmUu**: The approach validates that reverse engineering BMW UDS formulas is feasible with high precision. However, the tool itself requires physical hardware (robotic arm, professional scan tool) and is not a direct data source.

### 3. Experimental Security Assessment of BMW Cars (Tencent KeenLab)
- **Authors**: KeenLab (Tencent)
- **Venue**: Whitepaper, 2018
- **URL**: https://keenlab.tencent.com/en/whitepapers/Experimental_Security_Assessment_of_BMW_Cars_by_KeenLab.pdf
- **Relevance**: **MEDIUM** — Focuses on security vulnerabilities, not diagnostics data. However, it reverse-engineered UDS diagnostic message flows.
- **Key findings**:
  - Reverse engineered the NGTP (Next Generation Telematics Patterns) protocol.
  - Identified that the TCB's "LastStateCall" task extracts diagnostic CAN messages (UDS) from firmware and sends them through the Central Gateway to target ECUs.
  - Found a memory corruption vulnerability enabling remote code execution on the TCB.
- **BMW-specific data**: Mentions UDS diagnostic messages flowing to ECUs on PT-CAN, K-CAN, etc., but does not document freeze-frame formats or DID mappings.
- **Usable for BeeEmUu**: No direct data value. Confirms that BMW UDS diagnostic traffic is accessible via the OBD-II port through the Central Gateway.

### 4. UDS-based Reverse Engineering (NeoMore Engineering Report)
- **Authors**: NeoMore GmbH
- **Venue**: Engineering Report V1.2, 2022
- **URL**: https://neomore.com/wp-content/uploads/2022/11/UDS-based-Reverse-Engineering-V1.2.pdf
- **Relevance**: **MEDIUM** — Practical guide for reverse engineering UDS measurement signals using a Vector CANalyzer/Vehicle Spy setup.
- **Key findings**:
  - Describes both "naive" (stimulating physical signals and correlating) and "smart" (gateway-based signal manipulation) approaches.
  - Explicitly mentions: "This set was used to reverse engineer a BMW i3."
  - Supports multiframe messages with UDS extended addressing.
- **BMW-specific data**: Mentions BMW i3 was reverse engineered but does not publish any DID mappings or formulas.
- **Usable for BeeEmUu**: Methodology is relevant but requires expensive hardware (Vector CANalyzer, FIRE2 gateway). No data is published.

---

## Open-Source Tools

### 1. OBDb (Open OBD Database)
- **URL**: https://github.com/OBDb / https://obdb.community
- **License**: CC BY-SA 4.0 (for signalsets)
- **BMW data coverage**: Has repositories for BMW 3-Series, 4-Series, 5-Series, X5, M4, i3, etc. Each contains `signalsets/v3/default.json` with live data commands (Service 0x22 DIDs). Examples: `BMW-X5`, `BMW-i3`, `BMW-5-Series`.
- **Usable for BeeEmUu**: **YES** — Live data DID mappings are directly usable for parameter exploration. However, **freeze-frame data is NOT included** in OBDb signalsets. The format only covers `commands` (live data requests), not snapshot records.
- **Notes**: VS Code extension available for editing signalsets. MCP server allows querying signals. Good for discovering what DIDs are already known for BMW models, but freeze-frame schemas would need to be added as a new dimension.

### 2. KWP2000-CAN (by EliasTuning)
- **URL**: https://github.com/EliasTuning/KWP2000-CAN
- **License**: Not specified (appears open source)
- **BMW data coverage**: Python library implementing KWP2000 over CAN, KWP2000 over K-Line, and DS2 protocols — all used by BMW E-series. Supports BMW-specific variants: KWP2000 (10400 baud, additive checksum), KWP2000-STAR (9600 baud, XOR), BMW-FAST (115200 baud).
- **Usable for BeeEmUu**: **YES** — Can be used to build a diagnostic client that communicates with BMW ECUs over K-Line or CAN. Does not include pre-defined DID mappings or freeze-frame schemas, but provides the protocol transport layer.
- **Notes**: Clean API with context managers. Supports J2534 Pass-Thru adapters and serial transports.

### 3. pBmwScanner
- **URL**: https://github.com/gigijoe/pBmwScanner
- **License**: Not specified
- **BMW data coverage**: Python scan tool for BMW E38/E39. Supports DS2 protocol and KWP2000. Tested on Bosch ME7.2 (M62tu engine) and ZF5HP24 transmission. Reads engine/transmission real-time data and DTCs.
- **Usable for BeeEmUu**: **PARTIALLY** — Focused on older E38/E39 models. Codebase is small and may serve as a reference for K-Line/KWP2000 communication, but does not include modern UDS or freeze-frame parsing.
- **Notes**: Includes an ECU simulator. Python 2/3 compatible.

### 4. OpenVehicleDiag
- **URL**: https://github.com/rnd-ash/OpenVehicleDiag (thesis reference)
- **License**: Open source (thesis project)
- **BMW data coverage**: Cross-platform open-source diagnostic platform. Supports UDS, KWP2000, ISO-TP. Has a JSON schema for ECU definitions. Mentions EGS52 (Mercedes) in examples but framework is generic.
- **Usable for BeeEmUu**: **YES** — The framework architecture (JSON schema for ECU variants, automated ECU scanner) is a good reference. The automated ISO-TP scanner can discover ECU addresses on the bus. Would need BMW-specific JSON definitions to be useful.
- **Notes**: Gained ~150 GitHub stars. Thesis PDF available with detailed implementation notes.

### 5. GenericDiagnosticTool
- **URL**: https://github.com/jakka351/GenericDiagnosticTool
- **License**: Open source (evolved to commercial at tester.engineering)
- **BMW data coverage**: Generic J2534 diagnostic tool supporting KWP2000 and UDS. Can set ECU RX/TX addresses (e.g., 7E0/7E8). Includes DID/PID bruteforcing tool, direct memory read, security access bruteforcing.
- **Usable for BeeEmUu**: **YES** — The DID bruteforcing feature (Service 0x22) is exactly what would be needed to discover freeze-frame DIDs. The security access bruteforcer could be useful for deeper ECU access. Open-source version is functional but basic.
- **Notes**: Author actively seeks OEM diagnostic data contributions (DTC definitions, DID mappings, etc.).

### 6. Scapy (Automotive Layer)
- **URL**: https://github.com/secdev/scapy
- **License**: GPL-2.0+
- **BMW data coverage**: Includes `BMW HSFZ` (High-Speed Flashing/ZGW) protocol support, `UDS` packet classes, `ISO-TP` transport, and `OBD` services. The `UDS_HSFZSocket` allows communication with BMW gateways.
- **Usable for BeeEmUu**: **YES** — Excellent for building low-level UDS communication scripts. Can craft UDS 0x19 0x04 requests and parse responses. Does not include BMW-specific DID knowledge, but provides the protocol stack.
- **Notes**: Works best on Linux (kernel ISOTP sockets). Python library.

### 7. odxtools
- **URL**: https://github.com/mercedes-benz/odxtools (or similar ODX parsers)
- **License**: MIT (for odxtools)
- **BMW data coverage**: Python library for parsing ODX (Open Diagnostic Data Exchange) files. ODX is the standard format that contains ECU diagnostic descriptions including DTCs, DIDs, and freeze-frame DOPs (Data Object Properties).
- **Usable for BeeEmUu**: **POTENTIALLY** — If a BMW ODX file could be obtained from legitimate sources (e.g., BMW public technical documentation, or created from community reverse engineering), odxtools can parse freeze-frame DOPs. However, **BMW ODX files are proprietary** and not publicly available.
- **Notes**: The example in ODX documentation shows: `dtc.freeze_frame_dops` — confirming that ODX natively supports freeze-frame schema definitions.

### 8. python-obd / PyOBD / PyOBD-Dashboard
- **URL**: https://github.com/barracuda-fsh/pyobd / https://github.com/Paul-HenryP/PyOBD-Dashboard
- **License**: Open source
- **BMW data coverage**: Generic OBD-II tools. Support standard PIDs (Mode `$01`, `$02`, `$03`, etc.). PyOBD-Dashboard offers "Pro Packs" for BMW manufacturer-specific sensors, but these are commercial add-ons, not open source.
- **Usable for BeeEmUu**: **LIMITED** — Only covers standardized OBD-II data. Cannot access BMW proprietary freeze frames or enhanced DIDs without the commercial Pro Pack. The PyOBD-Dashboard "Full Backup" feature saves freeze frame + codes to JSON, but this is generic OBD-II Mode `$02` data.
- **Notes**: PyOBD-Dashboard includes a "PyCAN Hacker" tool for reverse engineering CAN traffic.

### 9. BimmerLink / BimmerCode / ProTool (BimmerGeeks)
- **URL**: https://bimmerlink.app / https://www.bimmergeeks.net/protool
- **License**: **COMMERCIAL (NOT OPEN SOURCE)**
- **BMW data coverage**: These are the most capable BMW diagnostic apps available. BimmerLink reads/clears codes from ALL control units, displays real-time sensor data, and has "improved freeze-frame parsing" (per v2.36.1 release notes). ProTool supports coding, adaptations, and deep diagnostics.
- **Usable for BeeEmUu**: **NO** — Closed-source commercial apps. Cannot extract their data or formulas. However, they confirm that freeze-frame parsing is a solved problem for commercial tools, just not in the open.
- **Notes**: BimmerLink log export is CSV format; a community project (`bimmerlink_log_analysis`) visualizes these logs but does not reverse engineer the protocol.

### 10. open-mechanic
- **URL**: https://github.com/speed785/open-mechanic
- **License**: Open source
- **BMW data coverage**: Generic OBD-II AI diagnostic tool. Uses python-obd for data acquisition and Claude API for diagnosis. No BMW-specific protocols.
- **Usable for BeeEmUu**: **NO** — Too generic. Roadmap mentions "Manufacturer-specific modules (Ford, VW, BMW)" as future work.
- **Notes**: Good architecture reference for building AI-powered diagnostic interfaces.

---

## Key Gaps

### 1. Freeze-Frame Schemas: The Critical Gap
**Status**: COMPLETELY UNDOCUMENTED in open sources.

BMW proprietary freeze frames (UDS Service 0x19 0x04, DTC Snapshot Records) are not documented anywhere in the open-source or academic literature reviewed. The reasons are structural:
- Snapshot records are **DTC-specific** — each DTC has its own configured DID list.
- The DID list is defined in the ECU firmware / ODX data, which is proprietary.
- BMW uses **extended addressing** and **Service 2C** (dynamically defined DIDs) for many enhanced parameters, making static mapping impossible.
- Community forums discuss freeze-frame *interpretations* ("lambda was lean at time of fault") but never publish raw hex.

**Implication for BeeEmUu**: The current simulator-based DME freeze-frame schema should be marked as "unverified placeholder." A real implementation would need to either:
- (a) Acquire a real BMW and reverse engineer its snapshot records using the TUM FTM methodology, or
- (b) Accept that freeze-frame data will remain a "best-effort" community contribution until enough real-vehicle captures are collected.

### 2. Academic Papers: Methodology Exists, Data Does Not
**Status**: METHODOLOGY AVAILABLE, BMW-SPECIFIC DATA NOT PUBLISHED.

All four academic papers found describe **how** to reverse engineer UDS data, but none publish the **results** for BMW. This is understandable (researchers need to publish methodology, not OEM proprietary data), but it means BeeEmUu cannot directly import any pre-computed DID mappings from these papers.

**Implication for BeeEmUu**: The TUM FTM pipeline (GitHub) is the most promising starting point. It could be adapted to:
1. Scan all BMW ECUs and enumerate available DIDs.
2. Request DTC snapshot records (0x19 0x04) for known DTCs.
3. Log the raw DID sequences returned.
4. Correlate with known OBD-II sensor values to identify physical meaning.

### 3. Open-Source Tools: Transport Layer is Covered, Application Layer is Not
**Status**: PROTOCOL STACKS EXIST, BMW-SPECIFIC KNOWLEDGE DOES NOT.

The open-source community has excellent protocol implementations (Scapy, KWP2000-CAN, OpenVehicleDiag, GenericDiagnosticTool) but very little BMW-specific application data. OBDb is the closest, but it only covers live data DIDs, not freeze frames.

**Implication for BeeEmUu**: The project should:
- Leverage OBDb for live data DID mappings (already useful).
- Use Scapy or KWP2000-CAN for the communication layer.
- Build a community-driven freeze-frame capture database where users contribute raw hex captures from their own vehicles, annotated with the DTC and known sensor values at the time.
- This is essentially what the TUM FTM paper does, but as a community effort rather than a research project.

---

## Recommended Next Steps for BeeEmUu

1. **Mark the existing DME freeze-frame schema as unverified** in the codebase and documentation. Add a prominent comment that it is simulator-based and not validated against real BMW data.

2. **Integrate OBDb signalsets** for live data. The OBDb BMW repositories (e.g., `BMW-3-Series`, `BMW-5-Series`) contain verified DID mappings that can be loaded dynamically based on vehicle VIN.

3. **Add a freeze-frame capture mode** to the BeeEmUu tool: when a user connects to a real BMW, capture raw UDS 0x19 0x04 responses and store them in a community database (anonymized, with DTC and timestamp). Over time, this crowdsourced data can reveal patterns.

4. **Study the TUM FTM pipeline** (GitHub: `TUMFTM/Holistic-Approach-for-Automated-Reverse-Engineering-of-Unified-Diagnostics-Service-Data`) and evaluate whether it can be integrated into BeeEmUu as an optional "discover mode" for users with real vehicles.

5. **For the simulator**, keep the current simplified schema but rename it to make its fictional nature explicit (e.g., `DME_Simulator_FreezeFrame_v1`). Do not present it as a real BMW schema.

---

## Search Log (for audit trail)

| # | Search Query | Source | Key Result |
|---|-------------|--------|------------|
| 1 | "BMW freeze frame data format" | Web | Generic OBD-II freeze frame info (x-engineer.org) |
| 2 | "BMW DTC freeze frame bytes UDS" | Web | FCOM note on pre-UDS vs UDS freeze frames |
| 3 | "BMW E90 freeze frame KWP2000" | Web | OBD2 scanner app listings (no byte layouts) |
| 4 | "BMW E60 freeze frame bytes" | Web | Parts listings, no diagnostic data |
| 5 | "BMW UDS reverse engineering" | Web | TUM FTM paper + DP-Reverser paper |
| 6 | "BMW fault code freeze frame data bytes" | Web | Generic OBD-II PID tables (UCF senior design) |
| 7 | "OBDb BMW signalset" | Web | OBDb GitHub repos for BMW X5, i3, 4-Series, 5-Series, M4 |
| 8 | "BMW E90 freeze frame DTC misfire lambda forum" | Web | Forum posts with interpretations, not raw bytes |
| 9 | "open source BMW ENET DoIP python" | Web | ENET adapter listings (commercial), no open-source BMW tools |
| 10 | "BimmerGeeks ProTool BMW PID" | Web | Commercial app (closed source) |
| 11 | "BimmerLink freeze frame BMW" | Web | Commercial app with "improved freeze-frame parsing" (closed source) |
| 12 | "github bmw diagnostic python" | Web | KWP2000-CAN, pBmwScanner, OpenVehicleDiag, GenericDiagnosticTool |
| 13 | "OBDb BMW signalset default.json" | Web | OBDb format docs — no freeze-frame support |
| 14 | "FORScan BMW PID extended" | Web | Torque Pro forum: BMW uses extended addressing + Service 2C |
| 15 | "BMW freeze frame snapshot data bytes DME" | Kimi Search | No relevant results (proprietary forums only) |
| 16 | "github open source BMW diagnostic python UDS" | Kimi Search | KWP2000-CAN, pBmwScanner, GenericDiagnosticTool, Scapy |
| 17 | "TUM FTM BMW reverse engineering UDS" | Kimi Search | Confirmed TUM FTM repo + paper; no BMW DID dataset published |

---

*Report compiled by BeeEmUu Research Agent. All data sourced from public/academic/open-source channels only. No proprietary BMW data (ISTA, INPA .prg, SGBD) was used.*
