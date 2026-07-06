# Cross-Verification Results — BeeEmUu Community Data Expansion

**Date**: 2026-07-06  
**Route**: D (File-Augmented Research)  
**Sources**: 4 sub-agent dimension files + Phase 1 landscape scan + Phase F file analysis.

---

## Confidence Tier Classification

### High Confidence (≥2 independent sources or authoritative open-source database)

| Finding | Dimensions | Evidence | Confidence |
|---------|-----------|----------|------------|
| 213 BMW hex DTCs collected from community forums | Dim 01 | BimmerFest, SpoolStreet, BimmerProfs, M5Board, BabyBMW — multiple independent forum compilations with overlapping codes | High |
| 25+ UDS DID mappings verified across OBDb repos | Dim 04, 05 | OBDb (CC-BY-SA) BMW-3-Series, 4-Series, 5-Series, X3, X5, Z4 repos — identical DIDs and decodes across multiple models | High |
| `did:4506` → oil temp (DME 0x12, `temp_u8`) | Dim 04 | OBDb BMW-X5, BMW-3-Series, BMW-4-Series, BMW-5-Series, BMW-Z4 — consistent min/max (-40, 200) implying offset | High |
| `did:DA12` → ATF temp (EGS 0x18) | Dim 04, 05 | OBDb 6+ repos — same DID, same target, same decode | High |
| `did:DBE4` → wheel speeds (DSC 0x19 / Steering 0x29) | Dim 04, 05 | OBDb 6+ repos — s16, div 100, km/h | High |
| `did:D112` → ambient temp (Cluster 0x60, `raw/2 − 40`) | Dim 04 | OBDb 6+ repos — explicit `div: 2, add: -40` | High |
| Zero verifiable KWP2000 local identifiers for E-series | Dim 07 | 20+ exhaustive searches across forums, GitHub, academic databases — no publication found; Nefarious Motorsports, E46Fanatics, Torque-BHP forums all confirm non-existence | High |
| Zero freeze-frame schemas in open sources | Dim 09 | 17+ searches across forums, GitHub, academic databases — no byte layouts found; OBDb explicitly does not cover freeze frames | High |
| BMW E-series DMEs support only mandatory OBD-II PIDs | Dim 07 | Multiple forum sources (E46Fanatics, BimmerFest, Torque-BHP) confirm this; BMW ETI licensing costs are prohibitive for scantool providers | High |
| `local:10` oil temp placeholder is unverified | Dim 07 | No forum post or GitHub repo identifies `0x10` as oil temp; N52 oil temp travels via BSD (separate serial protocol), not KWP2000 | High |
| 4 academic papers on BMW diagnostic reverse engineering | Dim 09 | TUM FTM (2025), DP-Reverser (USENIX 2022), Tencent KeenLab (2018), NeoMore (2022) — all verified via DOI/GitHub | High |

### Medium Confidence (1 authoritative source or single open-source database)

| Finding | Dimensions | Evidence | Confidence |
|---------|-----------|----------|------------|
| `did:4402` → oil temp v2 (raw − 60) | Dim 04 | Found in orchestrator's OBDb research but NOT in sub-agent's fetched OBDb repos (3-Series, 4-Series, 5-Series, X3, X5, Z4, 2-Series) | Medium |
| `did:5AC3` → fuel pressure (raw × 2.6 bars) | Dim 04 | Found in orchestrator's OBDb research but NOT in sub-agent's fetched repos | Medium |
| `did:4300` → engine temperature (°F) | Dim 04 | Found in orchestrator's OBDb research but NOT in sub-agent's fetched repos | Medium |
| `did:DFE7` → VGT calibration angle + oil change distance | Dim 04 | Found in OBDb BMW-5-Series/X5/Z4 repos — chassis-specific (2018+), not in 3-Series/4-Series | Medium |
| `did:D111` → range/consumption (PHEV/BEV multi-field) | Dim 04 | Found in OBDb BMW-5-Series/X5/Z4 — PHEV-specific, not in 3-Series/4-Series | Medium |
| `did:DA25` → oil temp at EGS (s16, raw − 48) | Dim 04 | OBDb 3-Series/X3 shows `s16, add: -48`; Z4 repo shows `u8` scalar — chassis-specific decode variation | Medium |
| 2D2A description ambiguity | Dim 01 | BimmerFest PDF: "Differential pressure sensor, suction pipe: adaptation"; N20 forums: "throttle-angle plausibility under boost" | Medium |
| 279B vs 2EF4 thermostat code | Dim 01 | BimmerFest thread explicitly states "code 2EF4 (279B)" — same fault, alternate representation | Medium |
| NOx sensor code variants (2AF2 / 2B06 / 2B09) | Dim 01 | BimmerProfs community guide confirms DME-specific variants (MSD80 vs MSD81 vs B38/B48) | Medium |
| N52 oil temp via BSD protocol | Dim 07 | SpoolStreet forum cites BMW TIS; multiple BimmerFest threads confirm BSD sensor | Medium |
| CAN broadcast frames for E-series (0x1D0 coolant, 0x545 oil temp) | Dim 07 | GitHub gists, RealDash forum, E46Fanatics — community-verified but not diagnostic protocol data | Medium |

### Low Confidence (single source, unverified, or incomplete)

| Finding | Dimensions | Evidence | Confidence |
|---------|-----------|----------|------------|
| `did:4300`, `4402`, `5AC3` in orchestrator's original OBDb list | Dim 04 | Orchestrator fetched from `BMW/default.json` (26KB); sub-agent fetched from model-specific repos. These DIDs may exist only in the generic `BMW` repo or may have been removed/deprecated in newer OBDb versions | Low |
| Service 0x21 periodic identifiers (`21 01`, `21 04`) | Dim 04 | Orchestrator found them in `BMW/default.json` but OBDb model repos do not document periodic identifiers | Low |
| `120308` B58 charging pressure DTC | Dim 01 | AutoExplain article — single source, no forum cross-verification | Low |
| CD87 E-Wastegate control deviation | Dim 01 | AutoExplain article — single source | Low |
| 2FD4 fuel system (N20) | Dim 01 | BabyBMW single forum post | Low |
| 2D29 MAP sensor error | Dim 01 | Bimmerforums single thread | Low |
| 4F82, 507B transmission errors | Dim 01 | Bimmerforums single thread | Low |
| CDA7 transmission status | Dim 01 | 5series.net single thread | Low |
| A10A, A127 body codes | Dim 01 | BimmerFest community PDF — incomplete descriptions | Low |
| 2F4A, 2F4C, 2F6C, 2F9E, 2FBE, 2DC3, 2DC5, 2DEC, 2DED, 30F1, 30F2 | Dim 01 | BimmerFest community PDF — no full descriptions | Low |
| E18C, E18F CAN codes | Dim 01 | BimmerFest community PDF — incomplete descriptions | Low |
| CF33, 6140 transmission codes | Dim 01 | BimmerFest community PDF — incomplete descriptions | Low |

### Conflict Zone

| Conflict | Description | Resolution | Status |
|----------|-------------|------------|--------|
| **DID 4506 decode formula** | Orchestrator: `raw − 40 °C`; OBDb: `min: -40, max: 200` but no explicit `add: -40` | The range bounds strongly imply `temp_u8` offset. OBDb's `D112` (ambient temp) explicitly uses `add: -40` in the same repo, confirming OBDb supports offset fields. The absence of `add` on `4506` is likely a repo inconsistency, not a semantic difference. | **Resolved** — treat as `temp_u8` |
| **DID DBE4 target ECU** | Orchestrator: `0x19` (DSC) as `s16, div: 100` and `0x29` (Steering) as `u8, km/h` | OBDb shows `s16, div: 100` at BOTH `0x19` and `0x29`. The `u8` claim for `0x29` was NOT found in any OBDb repo. It may be a different periodic identifier (0x21) or an outdated forum post. | **Resolved** — `s16, div: 100` at both targets |
| **DID DA25 decode variation** | BMW-3-Series/X3: `s16, add: -48`; BMW-Z4: `u8` scalar | Chassis-specific decode variation. The Z4 repo may use a different transmission variant or the DID has different meaning on that chassis. | **Unresolved** — mark as chassis-specific |
| **279B vs 2EF4** | Same fault (map cooling thermostat stuck), two hex codes | BimmerFest thread explicitly links them: "code 2EF4 (279B)". Both are valid representations; 2EF4 may be the internal DME code, 279B the hex presentation. | **Resolved** — include both with cross-reference note |
| **2D2A description** | BimmerFest PDF: "Differential pressure sensor, suction pipe: adaptation"; N20 forums: "throttle-angle plausibility under boost" | These may be module-specific variants (same root cause: intake pressure deviation). | **Unresolved** — include both descriptions with caveat |
| **DTC agent count: 213 total vs 156 net-new** | The agent's "net-new" count was relative to the orchestrator's initial 57-code list. The 7 existing project codes are also in the 213. | After cross-check: 213 total found = 7 existing + 57 orchestrator-known + 149 net-new. The agent's 156 count may have double-counted some orchestrator codes or included low-confidence codes. | **Resolved** — use 149 as the conservative net-new count |

---

## Source Quality Assessment

| Source | Type | License/Access | Reliability | Bias |
|--------|------|---------------|-------------|------|
| OBDb (github.com/OBDb) | Open-source signalset database | CC-BY-SA 4.0 | High — cross-model verification | F/G-series only; no E-series data |
| BimmerFest forum | Community forum | Public | Medium-High — multiple users, long history | Mostly US-market BMWs; some codes may be region-specific |
| SpoolStreet forum | Tuning community forum | Public | Medium-High — N54/N55 specialists | Tuning-focused; may miss non-performance codes |
| BimmerProfs | Community repair guide | Public | Medium — single-author compilation | N43/N53 focused; some codes may not apply to other engines |
| M5Board forum | Community forum | Public | Medium — E60/E63/M5/M6 focus | V8/S85 specific; may not apply to I6 engines |
| BabyBMW forum | Community forum | Public | Medium — UK/EU 1-Series focus | N20/N47 specific |
| forumbmw.net PDF | Public PDF (2004) | Public | Medium — old MS42/MS43 data | Dated; may not apply to newer DMEs |
| usro.net blog | Community blog | Public | Medium — general BMW content | May aggregate from other sources without attribution |
| AutoExplain | Commercial blog | Public | Low-Medium — single source | SEO-optimized; some codes may be scraped |
| TUM FTM paper | Academic journal | Open access (DOI) | High — peer-reviewed methodology | No BMW-specific data published |
| DP-Reverser paper | Academic conference | Open access (USENIX) | High — peer-reviewed methodology | No BMW-specific data published |
| Nefarious Motorsports | ECU reverse-engineering forum | Public | High — technical depth | VAG-focused; BMW content is secondary |
| E46Fanatics | Community forum | Public | Medium-High — E46 specialists | E46/MS43/MS45 specific |
| Torque-BHP forum | Scantool community | Public | Medium — scantool user reports | UK-focused; limited technical depth |

---

## Overall Assessment

- **DTC fault texts**: Can be expanded from ~7 to ~150+ codes with high/medium confidence. The remaining ~60 low-confidence codes should be excluded or held for community validation.
- **UDS DID mappings (F/G-series)**: 25+ DIDs are ready to add with high confidence. 5 additional DIDs need car verification or chassis-specific testing.
- **KWP2000 local identifiers (E-series)**: No open-source data exists. This is a fundamental gap that cannot be closed by research alone.
- **Freeze-frame schemas**: No open-source data exists. The simulator schema should be explicitly marked as unverified.
- **New decode functions needed**: `u16_tenths`, `u16_div100`, `s16_div4`, `s16_div100`, `u32_mul8`, `u8_enum` are needed to fully use the OBDb data.
