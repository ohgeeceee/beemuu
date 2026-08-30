# N5x / E9x bench-verification harness — v0.14.5

> **Status:** v0.14.5 slice 1 (PR #223) added the
> `0x5C` oil-temp swap from `local:10` placeholder to
> `community/profiles/n52.toml` and
> `community/profiles/n54.toml`, plus the three new PIDs
> (`0x5E` fuel rate L/h, `0x5F` engine runtime s, `0x62`
> fuel rate g/s) that mirror the v0.14.3 N62 enrichment
> (PR #186). All four OBD-II PIDs are SAE J1979
> emissions-mandated; all four decoders are already
> shipped in v0.14.3 PR #185. **Bench verification on a
> real E9x is the gating step for every new entry.** This
> doc is the harness for that step.

## What this is

v0.14.2's N62 / E70 cycle shipped the original
`0x5C` swap and the per-PID NRC error surface; v0.14.3
extended that to the three N62 fuel-rate / runtime PIDs;
v0.14.5 generalises the work to the **N52 / N54**
E-series family. The N52 / N54 community profiles already
existed (they predate v0.14.x entirely — they're
conservative-sourced from OBDb and project knowledge,
verified by design for the emissions-mandated OBD-II
PIDs). What v0.14.5 adds is the same `0x5C` swap + the
three new PIDs the N62 cycle established, plus the
per-chassis harness doc an E9x owner can run on a real
car to lift the `[needs verification, N5x/E9x bench]`
markers.

The N52 / N54 profiles ship:

- `0x05` (coolant temp) — emissions-mandated; the
  harness confirms the encoder is `temp_u8` (byte - 40
  °C) on the E9x.
- `0x0C` (engine speed) — emissions-mandated; the
  harness confirms the encoder is `u16_quarter` on the
  E9x.
- `0x0F` (intake air temp) — emissions-mandated.
  **N54 nuance:** the N54 post-intercooler IAT reads
  higher than ambient due to charge-air heat soak; the
  expected range at cruise is ambient + 5–15 °C, not
  ambient.
- `0x04` (engine load) — emissions-mandated. **N52
  nuance:** Valvetronic idle load is 15–25 %; the
  inverse load/throttle trace (high throttle, low load
  at part-throttle) is the Valvetronic fingerprint.
- `0x11` (throttle position) — emissions-mandated.
  Same Valvetronic footnote: throttle reads high at
  part-throttle because the valve is doing the
  throttling.
- `0x0B` (manifold pressure) — emissions-mandated.
  **NA engines** (N52): reads as vacuum at idle
  (well below ambient ~100 kPa). **Twin-turbo** (N54):
  u8 OBD MAP tops out at 255 kPa absolute — enough for
  stock-ish tunes; for tuned N54s you'll want the
  relative-boost computation `map - baro`.
- `0x33` (barometric pressure) — emissions-mandated
  (N54 only; N52 doesn't ship the `baro` PID).
- `0x23` (fuel rail pressure) — emissions-mandated
  (N54 only). N54 HPFP rail pressure is ~5,000–20,000
  kPa depending on load; failing HPFP shows as
  pressure collapsing under demand (long crank, limp
  mode, 2FBF-family codes).
- `0x0D` (vehicle speed) — emissions-mandated.
- `0x42` (module voltage) — emissions-mandated; the
  idle-voltage heuristic (see "Idle voltage target" in
  the profile header block) depends on this reading.
- `0x46` (ambient temp) — emissions-mandated.
- `0x5C` (engine oil temperature) — **the v0.14.5 new
  PID** (replaces `local:10`). Standard SAE J1979 PID,
  `byte - 40 °C`. **N52-specific failure mode:** the
  N52 DME reads oil condition via BSD (Bit Serial
  Data) from the oil condition sensor, not over
  KWP2000. The OBD-II `0x5C` swap is the surface the
  desktop app reads, but the DME may return an NRC
  (`0x11 serviceNotSupported` / `0x12
  subFunctionNotSupported`) for `0x5C` on a given
  firmware. The harness-doc protocol reverts to
  `local:10` in that case. See Step 5.
- `0x5E` (engine fuel rate L/h) — **the v0.14.5 new
  PID**. Standard SAE J1979 PID, `raw × 0.02`
  (`u16_fiftieths` decoder). Idle on a warm N52 /
  N54 should be ~1–2 L/h; WOT ~50–90 L/h (N52) or
  ~80–150 L/h (N54, twin-turbo pulls more fuel at WOT).
- `0x5F` (engine runtime since start) — **the v0.14.5
  new PID**. Standard SAE J1979 PID, 4-byte BE
  seconds (`u32_be` decoder). Resets on each
  ignition cycle; `0xFFFFFFFF` is the overflow
  sentinel.
- `0x62` (engine fuel rate g/s) — **the v0.14.5 new
  PID**. Standard SAE J1979 PID, `raw × 0.5`
  (`u16_half` decoder). The load-bearing PID for BSFC
  (brake-specific fuel consumption) heuristics —
  divide by `rpm × cyl_count` for instantaneous BSFC.
  Idle ~1–2 g/s; WOT ~40–70 g/s (N52) or ~60–100 g/s
  (N54).

The harness is the report-back loop. You read each
profile PID via the desktop app, compare against a
known-good expected value at key-off / idle / cruise,
and file a single issue with the diff. Everything
below is the recipe for doing that.

## What you need

- A real BMW with one of the supported engines:
  - **N52** (2.5 / 3.0 NA I6, MSV70 / MSV80): E9x
    323i / 325i / 328i / 330i; E60 523i / 525i / 530i;
    E63 630i; E83 X3 2.5i / 3.0i; E85 / E86 Z4 2.5i /
    3.0i. 2004–2013.
  - **N54** (3.0 twin-turbo I6, MSD80 / MSD81): E8x /
    E9x 135i / 335i; E60 535i; E89 Z4 35i. 2006–2013.
- A K+DCAN cable (INPA-compatible, FTDI-based). The
  K+DCAN cable **cannot** passively listen to raw
  broadcast frames (its FTDI firmware terminates
  ISO-TP upstream on both D-CAN and K-line), so the
  live-data path goes through the UDS diagnostic
  services, not the CAN broadcast IDs the v0.14.0
  harness doc validates. The `read_live_data` Tauri
  command is what reads each `[[profile.param]]`.
- The BeeEmUu desktop app connected to the car.
- A diagnostic session where the ignition is on
  (engine-off is fine for cold values, key-on
  engine-off is fine for voltage / oil temp ambient
  readings; engine running is required for coolant
  warm-up, oil-temp cruise band, and N52
  Valvetronic / N54 charge-air observations).

## Step 1 — wire up

1. Connect the K+DCAN cable to the car's OBD-II
   port (pin 6+14 for D-CAN on E9x / E60; E83 / E85
   may need the K-line fallback on pin 7 — try D-CAN
   first). If the DME does not respond after 30
   seconds, try the K-line fallback.
2. Open the BeeEmUu app, click **Connect**, select
   **`n52`** or **`n54`** from the profile dropdown.
3. Click the **Live Data** tab. You should see the
   13 gauges (N52: engine speed, coolant, oil, IAT,
   load, throttle, MAP, speed, voltage, ambient,
   fuel rate L/h, engine runtime, fuel rate g/s) or
   15 gauges (N54: same as N52 plus baro + HPFP
   rail) populated within ~1 second.

If any gauge is missing, the corresponding
`[[profile.param]]` entry failed to read — the most
likely cause is the DME returning an NRC
(`0x11 serviceNotSupported`, `0x12
subFunctionNotSupported`, `0x14 responseTooLong`,
`0x31 requestOutOfRange`). See Step 5 for the
report-back shape; this is exactly the failure mode
the v0.14.2 slice 2 NRC error surface is designed to
surface in the log.

## Step 2 — capture the cold readings

With the engine **off** and the ignition **on** (so
the DME is awake but the engine is not running), read
each gauge and record the value.

### N52 (13 PIDs)

| PID | OBD-II query | Decoder | Expected at key-on engine-off | Notes |
|---|---|---|---|---|
| Engine speed | `obd:0C` | `u16_quarter` | 0 rpm | Cranking will spike; key-on idle is 0 |
| Coolant temp | `obd:05` | `temp_u8` | ambient (typically 20–30 °C if the car sat overnight) | Critical for the slow-warm-up detection |
| Oil temp | `obd:5C` | `temp_u8` | ambient ± 2 °C | **The new PID** — primary verification target. See Step 5 for the N52 BSD-not-supported failure mode. |
| IAT | `obd:0F` | `temp_u8` | ambient | Same ambient as oil temp; if it diverges, the sensor is suspect |
| Engine load | `obd:04` | `percent_a` | 0 % | Engine is not running |
| Throttle | `obd:11` | `percent_a` | 10–20 % (idle, foot off) | Valvetronic idle position; **not** 0 % |
| MAP | `obd:0B` | `u8` | ~100 kPa (atmospheric) at sea level | Drops as altitude rises |
| Vehicle speed | `obd:0D` | `u8` | 0 km/h | Stationary |
| Module voltage | `obd:42` | `u16_milli` | 12.0–12.6 V (battery, alternator not charging) | Alternator is OFF at key-on engine-off |
| Ambient | `obd:46` | `temp_u8` | ambient | Climatronic sensor, not IAT |
| Fuel rate (L/h) | `obd:5E` | `u16_fiftieths` | ~0 L/h (engine off) | **The new PID**; raw × 0.02 |
| Engine runtime | `obd:5F` | `u32_be` | ~0 s on a cold start (resets each ignition cycle) | **The new PID**; 4-byte BE seconds; 0xFFFFFFFF = overflow sentinel |
| Fuel rate (g/s) | `obd:62` | `u16_half` | ~0 g/s (engine off) | **The new PID**; raw × 0.5; idle ~1–2, WOT ~40–70 |

### N54 (15 PIDs)

| PID | OBD-II query | Decoder | Expected at key-on engine-off | Notes |
|---|---|---|---|---|
| Engine speed | `obd:0C` | `u16_quarter` | 0 rpm | Cranking will spike; key-on idle is 0 |
| Coolant temp | `obd:05` | `temp_u8` | ambient | Twin-turbo; coolant loop runs hotter than N52 at cruise (see Step 3) |
| Oil temp | `obd:5C` | `temp_u8` | ambient ± 2 °C | **The new PID** — same BSD caveat as N52, but N54 typically reports on `0x5C` reliably because the MSV80 firmware path supports it |
| IAT (post-IC) | `obd:0F` | `temp_u8` | ambient + 0–5 °C | N54 IAT reads post-intercooler; at key-on with no heat soak, expect ambient ± a few degrees |
| MAP (abs) | `obd:0B` | `u8` | ~100 kPa (atmospheric) at sea level | Same as N52 |
| Baro | `obd:33` | `u8` | ~100 kPa at sea level | N54 only; drops with altitude |
| HPFP rail | `obd:23` | `u16_times10` | ~0 kPa (engine off, no pump duty) | N54 only; failing HPFP shows as pressure collapsing under demand at idle/cruise |
| Engine load | `obd:04` | `percent_a` | 0 % | Engine is not running |
| Throttle | `obd:11` | `percent_a` | 5–15 % (idle, foot off) | Twin-turbo; slightly lower than N52's Valvetronic position |
| Vehicle speed | `obd:0D` | `u8` | 0 km/h | Stationary |
| Module voltage | `obd:42` | `u16_milli` | 12.0–12.6 V (battery, alternator not charging) | Same as N52 |
| Ambient | `obd:46` | `temp_u8` | ambient | Same as N52 |
| Fuel rate (L/h) | `obd:5E` | `u16_fiftieths` | ~0 L/h (engine off) | **The new PID**; raw × 0.02; idle ~1–2, WOT ~80–150 |
| Engine runtime | `obd:5F` | `u32_be` | ~0 s on a cold start | **The new PID**; same as N52 |
| Fuel rate (g/s) | `obd:62` | `u16_half` | ~0 g/s (engine off) | **The new PID**; raw × 0.5; idle ~1–2, WOT ~60–100 |

The **critical row is oil temp**. If `0x5C` returns
a value within ±2 °C of the IAT reading, the encoder
is `temp_u8` and the swap from `local:10` is
**confirmed** for that DME firmware. If it returns
`-40 °C` (the SAE J1979 sentinel for "unsupported"),
the PID is absent on this DME firmware and the slice
1 enrichment needs a fallback to `local:10` or a
different OBD-II PID. See Step 5 for the N52-specific
protocol when the DME returns an NRC for `0x5C`.

The **critical row for fuel rate** is `0x5E` at
idle / WOT and `0x62` at idle / WOT. If both fuel-rate
gauges read ~0 L/h and ~0 g/s on a warm idle (engine
running, oil temp ≥ 90 °C, throttle at idle), the
decoders (`u16_fiftieths`, `u16_half`) are fine but
the OBD-II PID is unsupported on this DME firmware
and the entries should be removed. The v0.14.3
backend ships the support for that path:
`protocol::nrc_from_error` parses the per-PID
`(sid, nrc)` pair (PR #187) and the async Tauri
command `remove_profile_pid` (also PR #187) writes
the updated TOML behind a `tauri-plugin-dialog`
confirmation. The frontend consumer of that backend
(per-PID dim + one-click-remove UI in
`src/js/main.js::pollOnce` +
`src/js/live_data_panel.js`) shipped in v0.14.3
PR #190. If the fuel-rate gauges read wildly *high*
(> 100 L/h at idle on N52, or > 200 L/h at idle on
N54), the decoder scale constant is wrong and
`decode = "u16_fiftieths"` /
`decode = "u16_half"` needs to be swapped — see Step
4 for the report shape.

## Step 3 — capture the running readings

Start the engine. Wait 10 minutes for the oil and
coolant to reach operating temperature (or just idle
until the coolant stabilises). Read each gauge and
record:

### N52 (warm idle)

| PID | Expected at idle (warm) | Plausible range | Notes |
|---|---|---|---|
| Engine speed | 700–800 rpm (idle, warm) | 0–7000 rpm | 750 ± 50 is the target |
| Coolant | 88–95 °C (thermostat closed) | -40–150 °C | **Watch the slow warm-up curve** — see profile header context |
| Oil temp | 95–110 °C (sustained cruise) | -40–150 °C | **Healthy N52: oil ≥ coolant.** Oil consistently > coolant + 15 °C = clogged oil cooler |
| IAT | ambient + 5–15 °C (under-hood heating) | -40–150 °C | Diverge from coolant = sensor problem |
| Engine load | 15–25 % (idle, warm) | 0–100 % | Valvetronic idle load |
| Throttle | 10–20 % (idle) | 0–100 % | **Valvetronic inverse**: at part throttle, throttle is high, load is low |
| MAP | 30–50 kPa (idle, vacuum) | 0–255 kPa | Lower than atmospheric = vacuum |
| Vehicle speed | 0 km/h | 0–255 km/h | Stationary |
| Module voltage | 13.8–14.4 V (alternator regulating) | 0–65.535 V | **< 13.5 V sustained = failing voltage regulator** |
| Ambient | ambient (steady) | -40–150 °C | Climatronic sensor |
| Fuel rate (L/h) | 1–2 L/h (idle, warm) | 0–100 L/h | **v0.14.5 row**; WOT 50–90 L/h; clamped to 0 if NRC 0x11/0x12 surfaces in the log |
| Engine runtime | monotonic since ignition | 0–4 294 967 295 s | **v0.14.5 row**; if the gauge jumps to `0xFFFFFFFF` and stays, the decoder is fine but the DME hit the overflow sentinel — note the timestamp and continue |
| Fuel rate (g/s) | 1–2 g/s (idle, warm) | 0–100 g/s | **v0.14.5 row**; BSFC numerator — divide by `rpm × 6` (N52 cyl count) for instantaneous BSFC; WOT 40–70 g/s |

### N54 (warm idle)

| PID | Expected at idle (warm) | Plausible range | Notes |
|---|---|---|---|
| Engine speed | 700–800 rpm (idle, warm) | 0–7000 rpm | Same as N52 |
| Coolant | 90–100 °C (twin-turbo runs hotter) | -40–150 °C | Higher than N52 because of the additional turbo cooling demand |
| Oil temp | 100–115 °C (sustained cruise) | -40–150 °C | **Healthy N54: oil ≥ coolant.** The known N54 failure mode is oil leaks from the VANOS solenoid seal; the oil-temp entry supports spotting that via consistent drops over weeks |
| IAT (post-IC) | ambient + 5–15 °C (steady at idle) | -40–100 °C | Sustained > ambient + 30 °C = failing intercooler or charge-air leak |
| MAP (abs) | 30–50 kPa (idle, vacuum) | 0–255 kPa | Lower than atmospheric = vacuum |
| Baro | ~100 kPa at sea level | 60–110 kPa | Reference for relative-boost computation |
| HPFP rail | 5,000 kPa (idle, low demand) | 0–25 000 kPa | **Failing HPFP:** pressure collapsing under demand (long crank, limp mode, 2FBF-family codes) |
| Engine load | 18–30 % (idle, warm) | 0–100 % | Twin-turbo; slightly higher than N52 |
| Throttle | 5–15 % (idle) | 0–100 % | Same Valvetronic inverse as N52 |
| Vehicle speed | 0 km/h | 0–255 km/h | Stationary |
| Module voltage | 13.8–14.4 V (alternator regulating) | 0–65.535 V | **< 13.5 V sustained = failing voltage regulator** (common N54 age-related failure) |
| Ambient | ambient (steady) | -40–150 °C | Climatronic sensor |
| Fuel rate (L/h) | 1–2 L/h (idle, warm) | 0–200 L/h | **v0.14.5 row**; WOT 80–150 L/h; clamped to 0 if NRC 0x11/0x12 surfaces in the log |
| Engine runtime | monotonic since ignition | 0–4 294 967 295 s | **v0.14.5 row**; same overflow sentinel note as N52 |
| Fuel rate (g/s) | 1–2 g/s (idle, warm) | 0–200 g/s | **v0.14.5 row**; BSFC numerator — divide by `rpm × 6` (N54 cyl count) for instantaneous BSFC; WOT 60–100 g/s |

If any value is wildly off, the decoder scale or
the OBD-II PID encoding on the DME is non-standard.
**The fix is one constant in
`community/profiles/n52.toml` or
`community/profiles/n54.toml`** (the `decode` field
for that PID) — see Step 4 for the report shape.

## Step 4 — file the report

Open a GitHub issue at
`github.com/ohgeeceee/beemuu/issues/new` with the
template:

```markdown
### v0.14.5 N5x / E9x bench verification

**Chassis:** E9x 325i / 328i / 330i (N52) or E9x 335i / E60 535i / E89 Z4 35i (N54)
**Firmware:** [MSV70 / MSV80 (N52) or MSD80 / MSD81 (N54) version, e.g. from ISTA — or "unknown"]
**Cable:** K+DCAN (INPA-compatible, FTDI-based)
**Profile:** `n52` or `n54`
**App version:** [from the about panel]

**Cold readings (key-on engine-off, ambient = X °C):**

| PID | Value | Expected |
|---|---|---|
| Engine speed | _ rpm | 0 rpm |
| Coolant | _ °C | ambient |
| Oil temp | _ °C | ambient ± 2 °C |
| IAT | _ °C | ambient |
| ... | ... | ... |
| Fuel rate (L/h) | _ L/h | ~0 L/h (engine off) |
| Engine runtime | _ s | ~0 s on cold start |
| Fuel rate (g/s) | _ g/s | ~0 g/s (engine off) |

**Running readings (idle, 10 min warm-up):**

| PID | Value | Expected |
|---|---|---|
| Engine speed | _ rpm | 700–800 |
| Coolant | _ °C | 88–95 (N52) / 90–100 (N54) |
| Oil temp | _ °C | 95–110 (N52) / 100–115 (N54) |
| ... | ... | ... |
| Fuel rate (L/h) | _ L/h | 1–2 (idle), 50–90 (N52 WOT) / 80–150 (N54 WOT) |
| Engine runtime | _ s | monotonic since ignition (note any 0xFFFFFFFF jumps) |
| Fuel rate (g/s) | _ g/s | 1–2 (idle), 40–70 (N52 WOT) / 60–100 (N54 WOT) |

**PID(s) that failed to read** (if any): [list, with the NRC the
app surfaced in the log if available]

**N5x-instrumentation observations** (any of the
profile-header context notes — BSD oil condition
sensor for N52, charge-air / boost / HPFP for N54 —
that exhibited the documented failure mode):

**Suggested fix (if obvious):** [the `decode = "..."` value or the
`query = "obd:XX"` value to change in `community/profiles/n52.toml`
or `community/profiles/n54.toml`]
```

## Step 5 — what we will do with the report

### Passing report (N52 OR N54)

A passing report (all 13 N52 / 15 N54 gauges within
expected ranges; `0x5C` oil temp matches IAT at
key-on and reaches the expected cruise band; `0x5E`
and `0x62` are within the per-engine WOT ranges;
`0x5F` is monotonic since ignition) **removes the
`[needs verification, N5x/E9x bench]` label from
all four v0.14.5 PIDs (`0x5C`, `0x5E`, `0x5F`,
`0x62`) in the next v0.14.x release cut** and is the
gating evidence for the v0.14.5 cycle close.

### Failing report — the N52 BSD-not-supported failure mode

The N52 DME reads oil condition via BSD from the
oil condition sensor, not over KWP2000. **If the
N52 DME returns an NRC (`0x11 serviceNotSupported`
or `0x12 subFunctionNotSupported`) for `0x5C`** on
a given firmware:

1. **Document the firmware** in the report (the
   `MSV70 / MSV80 version, e.g. from ISTA — or
   "unknown"` field above).
2. **Revert the `oil` entry to `local:10`** with
   the `[UNVERIFIED placeholder]` label, matching
   the v0.14.2 pre-PR-#175 N52 state. This is the
   failure-mode protocol the v0.14.3 PR #187
   per-PID NRC surface + the
   `remove_profile_pid` async Tauri command
   automate: the per-PID dim UI flags the
   `0x5C` row, the user clicks "Remove from
   profile", the confirmation dialog appears,
   and the updated TOML is written.
3. **Note in the report** that the N52
   `0x5C` enrichment is firmware-gated; the
   slice 1 enrichment ships unverified for
   that firmware and the harness-doc protocol
   documents the revert path.

### Failing report — any other failure mode

For any other failure (oil temp returns `-40 °C`,
any of `0x5E` / `0x5F` / `0x62` returns an NRC, or
the fuel-rate gauges read wildly off):

1. **Document the failure** in the report.
2. **Revert the enrichment for that PID only** —
   the corresponding `[[profile.param]]` entry
   is removed (or, for `0x5C`, restored to the
   `local:10` placeholder) and marked
   `[UNVERIFIED placeholder]` with a comment
   pointing at the failing report.
3. The harness doc is extended with a new Step
   2.5 that captures the raw PID request and
   response bytes via the **Parameter Explorer**
   (`src/js/explorer.js`).

## Cross-references

- v0.14.5 plan: `docs/v0.14.5_plan.md` (PR #222,
  slice 0 of v0.14.5)
- v0.14.5 slice 1: PR #223 — N52 + N54 profile
  enrichment (the four new PIDs this doc
  verifies)
- v0.14.5 cycle name: "Open & Committed" (matches
  the public `frontend/roadmap/v0.14.5.html` page
  published in PR #221)
- N52 instrumentation context:
  `community/profiles/n52.toml` header block
- N54 instrumentation context:
  `community/profiles/n54.toml` header block
- **Predecessors (the N62 cycle this doc mirrors):**
  - v0.14.2 plan: `docs/v0.14.2_plan.md`
  - v0.14.3 plan: `docs/v0.14.3_plan.md`
  - v0.14.3 cycle: PRs #185 (decoders), #186
    (profile entries), #187 (per-PID NRC +
    remove UI), #188 (harness extension), #190
    (frontend rewire)
  - `docs/validation/n62-real-car.md` — the N62
    harness doc this doc mirrors
  - `community/profiles/n62.toml` — the N62
    profile (reference for the per-chassis
    instrumentation-context pattern)
- **N52-specific failure mode (BSD oil
  condition sensor):** the v0.14.2 slice 1 PR
  #175 comment + the v0.14.3 slice 3a PR #187
  per-PID NRC surface
- **Per-PID NRC + remove UI:**
  - `src/js/live_data_panel.js::parseNrcError` +
    `isUnsupportedNrc` (v0.14.2 slice 2, PR
    #177)
  - `protocol::nrc_from_error` (v0.14.3 slice
    3a, PR #187) — async Tauri command
    `remove_profile_pid` at
    `src-tauri/src/commands.rs:746`
  - frontend consumer: `main.js::pollOnce` +
    `live_data_panel.js::classifyNrc` (v0.14.3
    slice 3b, PR #190)
- v0.14.0 broadcast harness (for users who
  eventually get an OBDLink SX on the same
  chassis): `docs/validation/can-broadcast.md`
- Decoder spec: `docs/DECODE_FUNCTIONS.md` § 3
  (`temp_u8`), § 10 (`u16_fiftieths`), § 11
  (`u32_be`), § 12 (`u16_half`)

*Harness doc saved 2026-08-02. Companion PRs: #222
(cycle plan), #223 (N5x profile enrichment). Slice
2 of v0.14.5 — the cycle closes when a real E9x
report lands (per the per-chassis verification
discipline the v0.14.2 + v0.14.3 N62 cycle
established).*
