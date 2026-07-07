# Dimension 07: KWP2000 Local Identifiers & Extended OBD-II PIDs — E-Series BMWs

**Research Date**: 2026-07-06  
**Researcher**: BeeEmUu Deep-Research Agent  
**Searches Conducted**: 20+ varied queries across forums, GitHub, academic sources, open-source databases  
**Constraint**: NO proprietary data from ISTA, INPA .prg files, SGBD files, or leaked BMW software.

---

## Summary

| Category | Count | Notes |
|----------|-------|-------|
| **Verified KWP2000 local identifiers** | **0** | No open-source community has published a verifiable KWP2000 local identifier table for any E-series BMW DME. |
| **Extended OBD-II PIDs with BMW E-series evidence** | **0** | No community-verified extended Mode $01 PID list exists for BMW E-series engines. |
| **Standard OBD-II PIDs supported** | 9+ | BMW E-series DMEs support the mandatory SAE J1979 PIDs (0x0C, 0x05, 0x0B, 0x0F, 0x04, 0x11, 0x0D, 0x42, 0x33, 0x23, 0x46). These are already in the existing profiles. |
| **CAN bus broadcast signals documented** | 20+ | Community has reverse-engineered E90/E60 CAN bus broadcast frames (coolant temp, RPM, wheel speed, throttle, etc.), but these are **not** KWP2000 diagnostic identifiers. |
| **Academic reverse-engineering tools** | 1 | USENIX Security 2022 paper (DP-Reverser) automated KWP2000/UDS reverse engineering on real BMWs, but did not publish identifier tables. |
| **Open-source tools capable of extracting local IDs** | 1 | `BimmerDis` can disassemble BMW PRG/SGBD files to extract DS2/KWP2000 telegrams, but requires proprietary BMW files. |

**Overall Confidence**: **Very Low** for KWP2000 local identifiers. The open-source community has not documented them. **High** for the conclusion that they are *not* publicly available.

---

## Verified Local Identifiers

**None found.**

After 20+ targeted searches across BimmerFest, BimmerPost, E46Fanatics, N54Tech, SpoolStreet, GitHub, arXiv, and IEEE, **no open-source publication, forum post, or community wiki was found that lists a single verified KWP2000 `local:HH` identifier for any E-series BMW DME** (MSV70, MSV80, MSD80, MSD81, or ME9.2).

The following angles were exhausted:
- "BMW E90 local identifier oil temperature KWP2000"
- "BMW N52 KWP2000 local identifier forum"
- "BMW E60 local identifier list KWP2000 community"
- "INPA local identifier oil temp N52 forum post"
- "BimmerPost E90 local identifier KWP2000"
- "BMW E92 K-line local identifier KWP2000"
- "N54 local identifier 0x10 oil temperature BMW"
- "BMW E70 local identifier transmission temperature KWP2000"
- "BMW KWP2000 local identifier coolant E90"
- "E46fanatics local identifier KWP2000"
- "BMW E-series diagnostic local identifier list community"
- "BMW N55 local identifier E90"
- "BMW N62 local identifier E60"
- "KWP2000 BMW E-series parameter address"
- "BMW E90 diagnostic data local identifier"
- "BMW extended OBD-II PID list N52 N54 N55"
- "FORScan BMW extended PID list"
- "OBDb BMW E-series E90 E60 data GitHub"
- "BMW E90 KWP2000 readDataByLocalIdentifier 0x21"
- "BMW E-series diagnostic parameter list open source GitHub"
- "OBDb BMW E90 E60 E70 github default.json"
- "academic paper BMW E-series KWP2000 diagnostic reverse engineering"

In every case, results were either:
1. Generic KWP2000 protocol documentation (no BMW-specific identifiers),
2. Discussions of proprietary tools (INPA, ISTA, Tool32) without raw identifier disclosure,
3. CAN bus reverse-engineering projects (unrelated to KWP2000 diagnostic identifiers), or
4. Commercial tuning/parts listings with no diagnostic data.

---

## Unverified / Placeholder Local Identifiers

### `local:10` (oil temperature)

**Current status**: UNVERIFIED placeholder — almost certainly incorrect.

**Evidence against `local:10`**:
- No forum post, GitHub repo, or academic paper was found that identifies `0x10` as an oil temperature local identifier on any BMW E-series DME.
- The Nefarious Motorsports forum (a major ECU reverse-engineering community) explicitly states: *"With the KWP2000 protocol since common and local identifiers aren't defined, you have to do everything by memory addresses, which change with each ECU."* [^1] This was discussing VAG ME7.x, but the pattern holds: BMW E-series DMEs do not expose manufacturer-specific parameters through standardized local identifiers.
- The E46Fanatics forum confirms that BMW DMEs (MS43/MS45 and later MSV/MSD) *"only support the bare minimum as far as OBDII PIDs go. Everything else, you've got to request via DS2 / KWP2000."* [^2] However, the poster (who has disassembled DME software) does not publish the actual DS2/KWP2000 command bytes.
- Oil temperature on N52 engines is measured by the oil condition sensor (BSD/Bit Serial Data protocol, not KWP2000). The DME receives this via a separate serial line, not via the diagnostic K-line. Multiple forum posts (BimmerFest, SpoolStreet) reference oil temp being unavailable via OBD-II because the sensor communicates via BSD, not via a diagnostic parameter. [^3]

**Likely correct for**: Nothing. There is no evidence `local:10` returns oil temperature on any E-series engine.

**Likely wrong for**: All E-series engines (N52, N54, N55, N62). The placeholder appears to be a guess inherited from early community profiles.

**Recommendation**: Remove `local:10` from all E-series profiles or mark it as `[DEPRECATED — unverified, likely incorrect]`. If oil temperature is needed, the only open-source path is:
- **For E46 (MS43/MS45)**: Oil temp is broadcast on CAN bus at ARBID `0x545`, byte B4, formula `°C = hex2dec(byte) - 48.373`. [^2] This is community-verified but only for E46, not E9x/E60.
- **For E9x/E60**: No open-source method found. The Parameter Explorer feature in BeeEmUu is the only viable path.

---

## Extended OBD-II PIDs

### Standardized SAE PIDs (Mode $01) — BMW Support Status

The following extended PIDs are defined in SAE J1979-DA and *may* be supported by some BMW DMEs, but **no community verification was found** for E-series specifically:

| PID | Parameter | BMW E-series Support | Notes |
|-----|-----------|---------------------|-------|
| `0x3C` | Catalyst temperature | **Unknown** | Not confirmed in any forum post for E9x/E60. |
| `0x44` | Fuel-air equivalence ratio | **Unknown** | Not confirmed in any forum post for E9x/E60. |
| `0x5C` | Oil temperature | **Disputed / Likely unsupported** | One E46Fanatics post claims "pid is 0x1 0x5c" [^2], but the same poster immediately contradicts this: "the oil temp sensor is NON-EXISTANT in non-M E46es." Standardized PID 0x5C is optional; BMW E-series DMEs are known to support only the mandatory PID set. Multiple forum posts confirm oil temp is NOT available via generic OBD-II on BMWs. |
| `0x5D` | Fuel injection timing | **Unknown** | No evidence found. |
| `0x5E` | Fuel rate | **Unknown** | No evidence found. |
| `0x61` | Driver demand torque | **Unknown** | No evidence found. |
| `0x62` | Actual engine torque | **Unknown** | No evidence found. |
| `0x63` | Engine reference torque | **Unknown** | No evidence found. |
| `0x64` | Engine percent torque | **Unknown** | No evidence found. |
| `0x6E` | Fuel pressure control system | **Unknown** | No evidence found. |
| `0x70` | Boost pressure control | **Unknown** | No evidence found. |

**Key finding**: BMW E-series DMEs are widely reported in enthusiast forums (E46Fanatics, BimmerFest, Torque-BHP) to support **only the minimum legally mandated OBD-II PIDs**. The Torque app admin explicitly stated in 2011: *"If anyone finds a list of PIDs (not fault codes) with associated units and equations, publically accessible on the internet, then I have no problems adding them to the predefined lists."* [^4] — **This list was never found**, confirming that extended PID data for BMW E-series is not in the public domain.

### Mode $09 (Vehicle Information)
- PID `0x02` (VIN) — universally supported, already known.
- PID `0x04` (Calibration ID) — universally supported.
- PID `0x06` (CVN) — universally supported.

These are standard and already in the OBD-II baseline.

---

## Related Data Found (Not KWP2000 Local Identifiers)

### CAN Bus Broadcast Signals (E90/E60)

Multiple community projects have reverse-engineered BMW E90 CAN bus broadcast messages. These are **not** diagnostic local identifiers — they are periodic broadcast frames on PT-CAN / K-CAN that modules transmit without a tester request. They are listed here because they represent the *only* open-source parameter data available for E-series BMWs.

| CAN ID | Source | Parameter | Decode Formula | Source |
|--------|--------|-----------|--------------|--------|
| `0x0AA` | DME | Engine RPM + throttle position | `RPM = raw16 * 1` (scale varies by source) | GitHub gist [^5] |
| `0x0A8` | DME | Torque, clutch, brake status | Bitfields | GitHub gist [^5] |
| `0x0CE` | DSC | Individual wheel speeds | `km/h = raw16 * 0.0643699` | GitHub gist [^5] |
| `0x1D0` | DME | Engine coolant temperature | `°C = byte - 48` | GitHub gist [^5], RealDash forum [^6] |
| `0x1D2` | KOMBI | Gear status / shift lever position | Bitfields | GitHub gist [^5] |
| `0x545` | DME (E46) | Oil temperature | `°C = hex2dec(byte04) - 48.373` | E46Fanatics [^2] |
| `0x0C8` | SZL | Steering wheel angle | `deg = raw16 * scale` | GitHub [^7] |
| `0x1B4` | KOMBI | Vehicle speed | `MPH = raw` | GitHub [^7] |
| `0x3B4` | JBBF | Battery voltage | `V = raw24 * 0.001` | GitHub gist [^5] |
| `0x3EF` | DIA | OBD engine data broadcast | Various | GitHub gist [^5] |

**Important distinction**: These CAN frames are **broadcast data**. To read them, a tool simply listens on the CAN bus. KWP2000 `local:HH` identifiers, by contrast, are **diagnostic request/response** parameters read via service `0x21` (ReadDataByLocalIdentifier) over K-line or D-CAN. The two are completely different mechanisms. BeeEmUu's `local:` parameters target the diagnostic protocol, not CAN broadcast frames.

---

## Open-Source Tools with E-Series Data

### 1. OBDb (github.com/OBDb)
- **License**: CC-BY-SA 4.0
- **BMW coverage**: 38+ repos, but **F/G-series only (2012+)**.
- **E-series data**: None. OBDb's `BMW/default.json` and `BMW-3-Series/default.json` contain UDS DID (`did:HHHH`) mappings for F30, F10, G20, etc. No KWP2000 `local:HH` entries for E90, E60, E70, etc. [^8]
- **Verdict**: Not applicable to E-series KWP2000.

### 2. EliasTuning / KWP2000-CAN (Python library)
- **License**: MIT
- **What it does**: Implements KWP2000 transport over CAN and K-line for BMW and VAG.
- **Example**: `client.readDataByLocalIdentifier(local_identifier=0x01)`
- **E-series data included**: **None**. The library is a protocol stack; it does not ship BMW parameter tables. [^9]
- **Verdict**: Useful for BeeEmUu's KWP2000 transport layer, but provides no parameter mappings.

### 3. BimmerDis (radelbro/BimmerDis)
- **License**: Unspecified (GitHub repo)
- **What it does**: Disassembles BMW PRG/SGBD (BEST language) files to extract DS2 diagnostic telegrams and KWP2000 job definitions.
- **Critical constraint**: Requires BMW proprietary `.prg` files (EDIABAS SGBD files). These are **proprietary BMW software** and explicitly excluded by the "No Proprietary Data" rule of this project.
- **Verdict**: Capable of extracting local identifiers, but doing so would require proprietary files. Cannot be used under current project constraints. [^10]

### 4. DP-Reverser (USENIX Security 2022)
- **Paper**: "Towards Automatically Reverse Engineering Vehicle Diagnostic Protocols" by Yu et al.
- **What it does**: Automated reverse engineering of KWP2000 and UDS protocols using genetic programming to infer formulas from diagnostic tool UI screenshots.
- **BMW testing**: Tested on real BMW vehicles (Car G: "BMW N", Car J: "BMW 3 Series") using AUTEL diagnostic tools.
- **Key finding**: Confirmed that KWP2000 service `0x21` (ReadDataByLocalIdentifier) with local identifier `0x00` can be used to read engine RPM on some vehicles, with response formulas like `Y = X0 * X1 / 5`. However, **the paper does not publish the local identifier tables or semantic mappings** for any vehicle. [^11]
- **Source code**: https://github.com/yulele/DP-Reverser (released by authors)
- **Verdict**: Valuable methodology, but does not provide usable E-series data.

### 5. FORScan
- **What it does**: Popular open-source (with paid license) diagnostic tool for Ford, Mazda, Lincoln, Mercury.
- **BMW support**: **None**. FORScan is explicitly designed for Ford-family vehicles. [^12]
- **Verdict**: Not applicable.

### 6. PyDIABAS / BembelBytes/pydiabas
- **License**: Unspecified
- **What it does**: Python wrapper for BMW EDIABAS API.
- **E-series data included**: **None**. Provides protocol access (KWP2000, BMW-FAST, DS2) but no parameter tables. [^13]
- **Verdict**: Useful for protocol access, not for parameter discovery.

---

## Key Gaps (No Open-Source Data Found)

| Gap | Severity | Why It Matters | Path to Close |
|-----|----------|---------------|---------------|
| **KWP2000 local identifiers for E-series DMEs** | **Critical** | The entire `local:` parameter layer in BeeEmUu E-series profiles is unverified. | Parameter Explorer on real cars; academic reverse engineering with legal proprietary file access. |
| **Extended OBD-II PIDs for BMW E-series** | High | Only mandatory PIDs are confirmed. Oil temp, boost, charge-air temp, etc. are missing. | Same as above — these parameters are known to exist in BMW proprietary tools but are not published. |
| **Freeze-frame byte layouts for E-series ECUs** | Critical | No open-source schema exists. | Parameter Explorer per ECU per chassis. |
| **EGS (transmission) local identifiers** | High | ATF temp, gear data, torque converter lockup are commonly requested. | Parameter Explorer on E-series with automatic transmission. |
| **DSC local identifiers** | Medium | Wheel speeds, brake pressure, yaw rate are available via CAN but not as KWP2000 locals. | Parameter Explorer or CAN broadcast integration. |
| **Service / activation function identifiers** | Medium | Required for features like fuel pump activation, fan tests. | Community reverse engineering per function. |

---

## Strategic Implications for BeeEmUu

1. **The `local:10` placeholder must be removed or heavily annotated.** It has no verifiable basis in any open-source source. Continuing to ship it risks user confusion and incorrect data displays.

2. **E-series profiles should rely on OBD-II PIDs + CAN broadcast data.** The only open-source data layers that are verified and community-documented are:
   - Standard SAE J1979 OBD-II PIDs (already in profiles).
   - CAN bus broadcast frames (documented in GitHub gists and RealDash forums).

3. **Parameter Explorer is the only viable path for E-series `local:` parameters.** Since no open-source KWP2000 local identifier tables exist, BeeEmUu's Parameter Explorer feature (discovering parameters by probing a real car) is not just a nice-to-have — it is the **only** legitimate mechanism to populate E-series local identifiers under the project's "No Proprietary Data" constraint.

4. **Consider UDS DID integration for F/G-series.** OBDb provides verified UDS DID mappings for F/G-series (2012+). These can be added to B58 and late-N55 profiles as `did:HHHH` entries, but must be clearly labeled as F/G-series only.

5. **Document the gap explicitly.** Users should be informed that E-series manufacturer-specific parameters (oil temp, VANOS position, valvetronic lift, ignition timing, etc.) are **not available** in open sources and require either car-specific discovery or proprietary BMW tools.

---

## Sources

[^1]: Nefarious Motorsports forum, "Logging with KWP-2000 protocol", Nov 2010. Tony@NefMoto: *"With the KWP2000 protocol since common and local identifiers aren't defined, you have to do everything by memory addresses, which change with each ECU."* https://nefariousmotorsports.com/forum/index.php?topic=271.0

[^2]: E46Fanatics forum, "Oil Temperature via OBD", Jun 2016. Post #28 (TerraPhantm): *"They only support the bare minimum as far as OBDII PIDs go. Everything else, you've got to request via DS2 / KWP2000."* Post #12: CAN ARBID 0x545 oil temp formula. https://www.e46fanatics.com/threads/oil-temperature-via-obd.1106967/

[^3]: SpoolStreet forum, "Oil Temperature problem", Jun 2018. Quote from BMW TIS: *"The oil condition sensor consists of two cylinder capacitors... A temperature sensor has been fitted to the electronic evaluation unit to measure the engine oil temperature."* The oil temp is measured by the oil level sensor and transmitted via BSD, not via OBD-II. https://spoolstreet.com/threads/oil-temperature-problem.3582/

[^4]: Torque-BHP forum, "BMW E90 oil temp readings", May 2011. Admin: *"If anyone finds a list of PIDs (not fault codes) with associated units and equations, publically accessible on the internet, then I have no problems adding them to the predefined lists."* https://torque-bhp.com/community/main-forum/bmw-e90-oil-temp-readings/

[^5]: GitHub Gist, "BMW E90 CAN bus definitions", nberlette. Documents CAN IDs 0x0AA, 0x0A8, 0x0CE, 0x1D0, 0x1D2, 0x3B4, 0x3EF, etc. https://gist.github.com/nberlette/0ed4967da74d626da377e1b1cff70989

[^6]: RealDash Forum, "BMW E90 Canbus DBC to Real Dash XML", Feb 2022. Documents 0x1D0 engine data frame with `TEMP_EOI` (oil temp) and `TEMP_ENG` (engine temp). https://forum.realdash.net/t/bmw-e90-canbus-dbc-to-real-dash-xml-file/1169

[^7]: GitHub, llilakoblock/bmw-e87-e90-can-bt. Documents 0x0C8 steering angle, 0x1B4 speed, 0x1C2 PDC. https://github.com/llilakoblock/bmw-e87-e90-can-bt

[^8]: OBDb — Open Vehicle Database. BMW repos at https://github.com/OBDb. UDS DID mappings for F/G-series only; no E-series KWP2000 data.

[^9]: GitHub, EliasTuning/KWP2000-CAN. Python KWP2000 library for BMW/VAG. https://github.com/EliasTuning/KWP2000-CAN

[^10]: GitHub, radelbro/BimmerDis. BMW PRG/SGBD disassembler. https://github.com/radelbro/BimmerDis

[^11]: Yu, Le, et al. "Towards Automatically Reverse Engineering Vehicle Diagnostic Protocols." USENIX Security 2022. https://www.usenix.org/system/files/sec22summer_yu-le.pdf — Source: https://github.com/yulele/DP-Reverser

[^12]: FORScan forum. FORScan is explicitly for Ford, Mazda, Lincoln, Mercury vehicles. https://forum.forscan.org/

[^13]: GitHub, BembelBytes/pydiabas. Python EDIABAS API wrapper. https://github.com/BembelBytes/pydiabas

[^14]: GitHub Gist, MorGuux, "BMW E90 KCAN Notes". K-CAN message ID table for E90. https://gist.github.com/MorGuux/1f93228d5dde65fc7f81d78ddf405f99

[^15]: BimmerForums, "E90 CAN bus project", Jan 2021. Documents D-CAN diagnostic addressing: KWP2000 commands over CAN using 0x6F1/0x6XX framing. https://www.bimmerforums.com/forum/showthread.php?2298830-E90-Can-bus-project-(E60-E65-E87-)/page8

[^16]: Torque-BHP forum, "The key to getting more PIDs working", Jan 2012. Admin explains ETI licensing costs: "it's an extra 2.5K for scantool providers, and you still have to pay things like 17K for BMW's information." https://torque-bhp.com/community/main-forum/the-key-to-getting-more-pids-working/

[^17]: BimmerFest forum, multiple threads. Users reference INPA/ISTA for parameter readings but never publish raw KWP2000 identifiers. Examples: N52 cooling system diagnostics, VANOS readings, oil pressure discussions. https://www.bimmerfest.com/

[^18]: E90 CAN bus diagnostic documentation on loopybunny.net (referenced in BimmerForums post). Partial list of module CAN IDs for D-CAN diagnostic access. Not a local identifier table.

---

*End of report. Total searches: 20+. Total verifiable local identifiers found: 0. Total extended OBD-II PIDs with BMW E-series evidence: 0.*
