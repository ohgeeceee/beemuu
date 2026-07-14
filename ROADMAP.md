# BeeEmUu Roadmap

This document tracks planned work and rough priorities. Items are not
promised in any order — contributors are welcome to grab anything marked
"help wanted".

## Legend

| Label | Meaning |
|-------|---------|
| 🔴 Blocker | Blocks a release or major feature |
| 🟡 Needs research | Not well understood yet; needs investigation |
| 🟢 Ready | Well-scoped; open a PR when you want it |
| ⭐ High impact | Would significantly improve user experience |

---

## v0.3.0 — "Real Car" (Shipped 2026-07-11)

### ✅ Decode Functions (done in v0.3.0 — keep this section historical)

The six new decoders landed before v0.3.0 cut. They are live in
`src-tauri/src/data/live.rs` (see `enum Decode` + unit tests at the bottom
of that file), and the corresponding DIDs are already uncommented in
`community/profiles/b58.toml` and `community/profiles/n55.toml`.

| Item | Status | Notes |
|------|--------|-------|
| Add `u16_tenths` | ✅ Done | Battery voltage (4002), HPFP rail (44F0), boost command (4367) |
| Add `u16_div100` | ✅ Done | Mass-air flow (4077), ambient pressure (4003) |
| Add `s16_div4` | ✅ Done | DME temperature (4001) — signed |
| Add `s16_div100` | ✅ Done | Engine torque (4500), ambient air temp (4016) |
| Add `u8_div100` | ✅ Done | Lambda (400B), injection time (4363) |
| Add `u8_enum` | 🟡 Deferred | Spec'd in `docs/DECODE_FUNCTIONS.md` § 8; requires per-DID enum table in TOML profile. Genuinely extra work — *not* just "uncomment lines." Pull forward if a contributor wants it. |

### ⭐ Real-Car Validation

| Item | Status | Notes |
|------|--------|-------|
| B58 F/G-series UDS DID test | 🟡 Needs research | Need owner with ENET adapter + F/G chassis |
| N55 F-series UDS DID test | 🟡 Needs research | Same as above; F30/F32 owners ideal |
| N52 E-series KWP2000 local ID hunt | 🟡 Needs research | Use Parameter Explorer; document findings in issue |
| N54 E-series KWP2000 local ID hunt | 🟡 Needs research | Same as above; E92 335i owners ideal |
| E-series CAN broadcast frames | 🟡 Needs research | Validate 0x0AA (RPM), 0x1D0 (coolant), 0x545 (oil temp E46) |

### 🔴 New Engine Profiles

| Engine | Protocol | Status | Notes |
|--------|----------|--------|-------|
| N20/N26 (F-series 4-cyl) | UDS | 🟢 Ready | Similar to B58 DID set; needs real-car tester |
| S55 (F80 M3/M4) | UDS | 🟢 Ready | High-performance variant of N55; oil temp critical |
| N63/S63 (F10/F15 V8 TT) | UDS | 🟡 Needs research | Different DID set; fewer community sources |
| B48 (G-series 4-cyl) | UDS | 🟡 Needs research | Newer protocol; may need DoIP support |
| S58 (G80 M3/M4) | UDS | 🟡 Needs research | Newest; limited open-source data |

### ⭐ Protocol & Transport

| Item | Status | Notes |
|------|--------|-------|
| ENET/DoIP auto-detection | 🟡 Needs research | Detect adapter type without manual selection |
| KWP2000 slow-module timeout fix | 🟢 Ready | CIC and other modules timeout on slow responses |
| BLE adapter support | 🟡 Needs research | Vgate iCar Pro BLE, OBDLink CX, etc. |
| WiFi adapter support | 🟡 Needs research | Vgate iCar Pro WiFi, OBDLink MX+ WiFi |
| CAN bus listener mode | 🟡 Needs research | E-series alternative to KWP2000 local IDs |
| ISO-TP multi-frame (FF/CF/FC) | 🟢 Ready | Required for long UDS responses (VIN, full DTC list) |

### UI / UX

| Item | Status | Notes |
|------|--------|-------|
| Dark/light theme toggle | 🟢 Ready | Currently dark-only; CSS variables exist |
| Gauge theming | 🟢 Ready | Per-profile color schemes (e.g., M colors for S55) |
| Mobile-responsive layout | 🟡 Needs research | Tauri supports mobile; needs testing |
| Save/load workspace layout | 🟢 Ready | Remember which gauges user had open |
| Export PNG/SVG from charts | 🟢 Ready | Useful for forum posts |
| Real-time data logging to disk | 🟢 Ready | Stream CSV to file instead of in-memory only |

### 🟡 Research: E-series Data Desert

The open-source community has no published KWP2000 local identifier table for any
BMW E-series DME (MSV70, MSV80, MSD80, MSD81, ME9.2). This is a structural gap.

**Possible paths forward:**
- CAN bus broadcast frame decoding (0x0AA, 0x1D0, 0x545, 0x0CE) — bypass KWP2000 entirely
- Parameter Explorer crowdsourcing — every E-series owner who maps a local ID contributes to a community table
- BSD protocol documentation — N52 oil condition sensor uses BSD, not KWP2000

See `research/bmw_diag_dim07_local_ids.md` for the exhaustive search results.

---

## v0.4.0 — "Tuner Friendly" (Target: TBD)

**Premise.** v0.3.0 shipped the decoder foundation (six new numeric decoders
+ uncommented B58/N55 DIDs). v0.4.0 builds *tuner-facing* features on top
of that foundation — features that only make sense once real numbers like
HPFP rail, boost command, lambda bank, and engine torque are actually
readable. The first PR in this cycle is a small docs fix; see
`docs/v0.4.0_first_pr.md`.

### ✅ Ready (small, can ship in any order)

| Item | Status | Notes |
|------|--------|-------|
| README profile-listing fix | 🟢 Ready | Verify no other "in v0.3.0 / coming soon" claim is stale. First PR. |
| Histograms of logged channels | 🟢 Ready | Operates on existing CSV log output; client-side (no protocol change). |
| `u8_enum` decoder + enum tables | 🟢 Spec'd | Genuinely new work; spec already in `docs/DECODE_FUNCTIONS.md` § 8. |
| CBS reset for EGS / DSC | 🟢 Ready | Extends existing CBS reset (`src-tauri/src/data/service_functions.rs`) — verify scope first. |
| $5 AliExpress ENET cable pinout doc | 🟢 Ready | Doc-only; link from `README.md` hardware section. |

### 🟡 Needs research (larger, defer if scope is tight)

| Item | Status | Notes |
|------|--------|-------|
| Log file merge / comparison | 🟡 | Before/after diffing; client-side over CSV. |
| Custom math channels | 🟡 | `map - baro`, `rail / load` etc.; needs safe expression sandbox. |
| Knock detection visualisation | 🟡 | DIDs exist (DME-side); mostly a UI affordance over existing data. |
| AFR / lambda bank readout polish | 🟡 | Decoder exists (400B); needs the wider lambda + O2 readiness story. |
| Adaptation / fuel trim readout | 🟡 | Likely a new decode; needs real-car evidence. |
| Injector duty cycle | 🟡 | Needs new decode; not in current table. |
| Real-car validation B58 F/G | 🟡 | Owner with ENET + F/G chassis. **Hardest blocker.** |
| Real-car validation N55 F-series | 🟡 | Same as above. |
| Trigger-based logging | 🟡 | Threshold / DTC-crossed autostart. |
| OBDLink MX+ support | 🟡 | USB + BLE; popular with iOS users (natural tuner audience). |
| ENET/DoIP auto-detection | 🟡 | Detect adapter without manual selection. |

### Deferred to v0.5.0+

These are explicitly **not** v0.4.0 work:

- Cloud sync (opt-in log upload) — needs privacy + ops story first.
- Raspberry Pi CAN bridge — hardware project of its own.
- Plugin system for custom decoders — community governance work before code.
- Bootmod3 / MHD integration — legal risk; not appropriate scope.
- Multi-language UI — translation coordination problem.
- Web-based shared-log viewer — needs hosted backend work first.

---

## Backlog — Nice to Have

| Item | Why it would be cool | Complexity |
|------|---------------------|------------|
| Multi-language support (DE, EN, FR, CN) | Broader audience | Medium |
| Plugin system for custom decode functions | Community extensibility | High |
| Web-based viewer for shared logs | No app needed to view a friend's log | Medium |
| Integration with tuning platforms (MHD, Bootmod3) | Read/write flash logs | High (legal risk) |
| Automatic BMW service manual lookup | Contextual repair info per DTC | Medium |
| OBD-II PID auto-discovery | Scan all standard PIDs, report which respond | Low |
| Vehicle database (VIN → options, build sheet) | VIN decode enrichment | Medium |

---

## How to Claim an Item

1. Open a GitHub issue referencing this roadmap item (e.g., "Working on u16_tenths decode for v0.3.0")
2. Comment on the issue so others know it's taken
3. Open a PR when ready; reference the issue and this roadmap

---

*Last updated: 2026-07-14. v0.3.0 decode-fn rows flipped to ✅ Done; v0.4.0 rewritten with explicit Ready / Needs-research / Deferred split.*
