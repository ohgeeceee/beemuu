# N62 / E70 bench-verification harness — v0.14.2

> **Status:** v0.14.2 slice 1 (PR #175) replaced the unverified
> `local:10` oil-temp placeholder in `community/profiles/n62.toml`
> with the standard OBD-II PID `0x5C` (engine oil temperature,
> `byte - 40 °C`). Bench verification on the E70 X5 4.8i / N62 is
> the gating step. **This doc is the harness for that step.**

## What this is

v0.14.2's N62 profile enrichment ships **only one new OBD-II PID
(`0x5C`)** instead of the four the cycle plan originally called for
(`0x5C`, `0x5E`, `0x5F`, `0x62`). The reason is in PR #175's
description: the three deferred PIDs each require a decoder that
doesn't yet exist in the catalog — shipping a profile entry that
references a non-existent decoder breaks every consumer at load time
with `unknown decode: X`, so the **decoder-first discipline is
preserved**.

What the profile does ship, and what this doc verifies:

- `0x05` (coolant temp) — already emissions-mandated; the harness
  confirms the encoder is `temp_u8` (byte - 40 °C) on the E70.
- `0x0C` (engine speed) — already emissions-mandated; the harness
  confirms the encoder is `u16_quarter` on the E70.
- `0x0F` (intake air temp) — already emissions-mandated.
- `0x04` (engine load) — already emissions-mandated.
- `0x11` (throttle position) — emissions-mandated. **The
  Valvetronic footnote matters here**: throttle reads high at part
  load because the valve is doing the throttling.
- `0x0B` (manifold pressure) — emissions-mandated.
- `0x0D` (vehicle speed) — emissions-mandated.
- `0x42` (module voltage) — emissions-mandated; the N62 idle-voltage
  heuristic (see "Idle voltage target" in `community/profiles/n62.toml`)
  depends on this reading.
- `0x5C` (engine oil temperature) — **the new one**. Standard SAE
  J1979 PID, `byte - 40 °C`. Replaces the unverified `local:10`
  placeholder. **This is the only PID that needs bench verification
  on the E70 in this cycle** — the rest are emissions-mandated and
  confirmed by design.

The harness is the report-back loop. You read each profile PID via
the desktop app, compare against a known-good expected value at
key-off / idle / cruise, and file a single issue with the diff.
Everything below is the recipe for doing that.

## What you need

- A real BMW E70 X5 4.8i (N62/BTU, MSV80-family DME, D-CAN @
  500 kbps). E60 545i and E65 750i are mechanically the same DME
  family — they all use the same Bosch ME9.2 firmware; the harness
  is identical for any of them, just change "E70" to "E60" / "E65"
  in your report.
- A K+DCAN cable (INPA-compatible, FTDI-based). The K+DCAN cable
  **cannot** passively listen to raw broadcast frames (its FTDI
  firmware terminates ISO-TP upstream on both D-CAN and K-line), so
  the live-data path goes through the UDS diagnostic services, not
  the CAN broadcast IDs the v0.14.0 harness doc validates. The
  `read_live_data` Tauri command is what reads each `[[profile.param]]`.
- The BeeEmUu desktop app connected to the car.
- A diagnostic session where the ignition is on (engine-off is fine
  for cold values, key-on engine-off is fine for voltage / oil temp
  ambient readings; engine running is required for coolant warm-up,
  oil-temp cruise band, and Valvetronic load/throttle traces).

## Step 1 — wire up

1. Connect the K+DCAN cable to the E70 OBD-II port (pin 6+14 for
   D-CAN). If the DME does not respond after 30 seconds, try the
   K-line fallback on pin 7.
2. Open the BeeEmUu app, click **Connect**, select **`n62`** from
   the profile dropdown.
3. Click the **Live Data** tab. You should see the 10 gauges
   (engine speed, coolant, oil, IAT, load, throttle, MAP, speed,
   voltage, ambient) populated within ~1 second.

If any gauge is missing, the corresponding `[[profile.param]]` entry
failed to read — the most likely cause is the DME returning an NRC
(0x11 serviceNotSupported, 0x12 subFunctionNotSupported, 0x14
responseTooLong, 0x31 requestOutOfRange). See Step 5 for the
report-back shape; this is exactly the failure mode the v0.14.2
slice 2 NRC error surface is designed to surface in the log.

## Step 2 — capture the cold readings

With the engine **off** and the ignition **on** (so the DME is
awake but the engine is not running), read each gauge and record
the value:

| PID | OBD-II query | Decoder | Expected at key-on engine-off | Notes |
|---|---|---|---|---|
| Engine speed | `obd:0C` | `u16_quarter` | 0 rpm | Cranking will spike; key-on idle is 0 |
| Coolant temp | `obd:05` | `temp_u8` | ambient (typically 20–30 °C if the car sat overnight) | Critical for the slow-warm-up detection |
| Oil temp | `obd:5C` | `temp_u8` | ambient ± 2 °C | **The new PID** — this is the primary verification target |
| IAT | `obd:0F` | `temp_u8` | ambient | Same ambient as above; if it diverges, the sensor is suspect |
| Engine load | `obd:04` | `percent_a` | 0 % | Engine is not running |
| Throttle | `obd:11` | `percent_a` | 10–20 % (idle, foot off) | Valvetronic idle position; **not** 0 % |
| MAP | `obd:0B` | `u8` | ~100 kPa (atmospheric) at sea level | Drops as altitude rises |
| Vehicle speed | `obd:0D` | `u8` | 0 km/h | Stationary |
| Module voltage | `obd:42` | `u16_milli` | 12.0–12.6 V (battery, alternator not charging) | Alternator is OFF at key-on engine-off |
| Ambient | `obd:46` | `temp_u8` | ambient | Climatronic sensor, not IAT |

The **critical row is oil temp**. If `0x5C` returns a value within
±2 °C of the IAT reading, the encoder is `temp_u8` and the swap
from the `local:10` placeholder is **confirmed**. If it returns
`-40 °C` (the SAE J1979 sentinel for "unsupported"), the PID is
absent on this DME firmware and the slice 1 enrichment needs a
fallback to `local:10` or a different OBD-II PID. See Step 4.

## Step 3 — capture the running readings

Start the engine. Wait 10 minutes for the oil and coolant to reach
operating temperature (or just idle until the coolant stabilises).
Read each gauge and record:

| PID | Expected at idle (warm) | Plausible range | Notes |
|---|---|---|---|
| Engine speed | 700–800 rpm (idle, warm) | 0–6800 rpm | 750 ± 50 is the target |
| Coolant | 88–95 °C (thermostat closed) | -40–150 °C | **Watch the slow warm-up curve** — see N62 instrumentation context |
| Oil temp | 95–110 °C (sustained cruise) | -40–150 °C | **Healthy N62: oil ≥ coolant.** Oil consistently > coolant + 15 °C = clogged oil cooler |
| IAT | ambient + 5–15 °C (under-hood heating) | -40–150 °C | Diverge from coolant = sensor problem |
| Engine load | 15–25 % (idle, warm) | 0–100 % | Valvetronic idle load |
| Throttle | 10–20 % (idle) | 0–100 % | **Valvetronic inverse**: at part throttle, throttle is high, load is low |
| MAP | 30–50 kPa (idle, vacuum) | 0–255 kPa | Lower than atmospheric = vacuum |
| Vehicle speed | 0 km/h | 0–255 km/h | Stationary |
| Module voltage | 13.8–14.4 V (alternator regulating) | 0–65.535 V | **< 13.5 V sustained = failing voltage regulator** |
| Ambient | ambient (steady) | -40–150 °C | Climatronic sensor |

If any value is wildly off, the decoder scale or the OBD-II PID
encoding on the DME is non-standard. **The fix is one constant
in `community/profiles/n62.toml`** (the `decode` field for that
PID) — see Step 4 for the report shape.

## Step 4 — file the report

Open a GitHub issue at
`github.com/ohgeeceee/beemuu/issues/new` with the template:

```markdown
### v0.14.2 N62 / E70 bench verification

**Chassis:** E70 X5 4.8i / N62 / ME9.2 (or E60 545i / E65 750i)
**Firmware:** [MSV80 version, e.g. from ISTA — or "unknown"]
**Cable:** K+DCAN (INPA-compatible, FTDI-based)
**Profile:** `n62`
**App version:** [from the about panel]

**Cold readings (key-on engine-off, ambient = X °C):**

| PID | Value | Expected |
|---|---|---|
| Engine speed | _ rpm | 0 rpm |
| Coolant | _ °C | ambient |
| Oil temp | _ °C | ambient ± 2 °C |
| IAT | _ °C | ambient |
| ... | ... | ... |

**Running readings (idle, 10 min warm-up):**

| PID | Value | Expected |
|---|---|---|
| Engine speed | _ rpm | 700–800 |
| Coolant | _ °C | 88–95 |
| Oil temp | _ °C | 95–110 |
| ... | ... | ... |

**PID(s) that failed to read** (if any): [list, with the NRC the
app surfaced in the log if available]

**N62-instrumentation observations** (any of the four
context-block notes from the profile — slow warm-up, oil-temp
cruise band, Valvetronic load/throttle, idle voltage — that
exhibited the documented failure mode):

**Suggested fix (if obvious):** [the `decode = "..."` value or the
`query = "obd:XX"` value to change in `community/profiles/n62.toml`]
```

## Step 5 — what we will do with the report

A passing report (all 10 gauges within expected ranges, `0x5C` oil
temp matches IAT at key-on and reaches 95–110 °C at idle cruise)
**removes the `[needs verification]` label from the `0x5C` profile
entry** in the next v0.14.x release cut and is the gating evidence
for the v0.14.3+ work that re-enables the deferred `0x5E` / `0x5F`
/ `0x62` PIDs (each still needs its own decoder first).

A failing report (oil temp returns -40 °C, or any PID returns an
NRC) **reverts the slice 1 enrichment for that PID only** — the
`local:10` placeholder is restored as a `[UNVERIFIED placeholder]`
with a comment pointing at the failing report, and the harness is
extended with a new Step 2.5 that captures the raw PID request and
response bytes via the **Parameter Explorer** (`src/js/explorer.js`).

## Cross-references

- v0.14.2 plan: `docs/v0.14.2_plan.md` (slice 3 lines 75-92,
  142-151)
- Companion slice: PR #175 (slice 1, `n62.toml` enrichment),
  PR #177 (slice 2, Live Data panel UX polish)
- N62 instrumentation context: `community/profiles/n62.toml`
  header block
- NRC error surface: `src/js/live_data_panel.js::parseNrcError` +
  `src/js/live_data_panel.js::isUnsupportedNrc` (slice 2)
- v0.14.0 broadcast harness (for users who eventually get an
  OBDLink SX on the same chassis): `docs/validation/can-broadcast.md`
