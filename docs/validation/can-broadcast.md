# CAN bus broadcast frame harness — v0.14.0

> **Status:** v0.14.0 shipped 2026-07-25 with the wired Live Gauges
> panel + simulator broadcast personality. Real-car verification is
> the v0.14.1 follow-up. This doc is the harness for that follow-up.

## What this is

The v0.14.0 "Live CAN" cycle ships a `Live Gauges` panel under the
existing Live Data tab. Six broadcast gauges (RPM, coolant, oil
temp, vehicle speed, battery voltage, throttle) get values from
six raw CAN broadcast frames the BMW DME / DSC / IHKR / EGS ECUs
send on the bus at 500 kbit/s without being asked.

The bytes are free — we just don't normally listen. The decoder
(`src/js/can_decoders.js`) and the simulator broadcast worker
(`src-tauri/src/transport/sim.rs::broadcast_frames_at`) are
**best-effort** implementations of the documented BMW frame
layouts. The byte-by-byte scales, offsets, and bit positions in
the decoder are inferred from canonical BMW DME conventions and
community reverse-engineering sources. **They have not been
verified against a real car.**

The harness is the report-back loop. You dump a few seconds of
raw CAN traffic, compare against the decoder's expected output,
and file a single issue with the diff. Everything below is the
recipe for doing that.

## What you need

- A real BMW (E46, E9x, E6x are the priority chassis; E46 is the
  v0.14.0 reference chassis per `docs/ROADMAP_ISSUES.md`).
- An OBDLink SX, PEAK PCAN-USB, or any other raw-CAN interface
  that can log 500 kbit/s standard-ID traffic.
- A laptop with the interface's vendor software installed
  (OBDLink's `STN Term` for the SX, PEAK's `PCAN-View` for the
  PCAN-USB).
- A diagnostic session where the engine is running OR the
  ignition is on (engine-off still produces some broadcast
  frames — battery voltage, wheel speeds zero — but RPM and
  throttle only step when the engine is being cranked or is
  running).

## Step 1 — capture the raw frames

Run the engine at idle for ~30 seconds. If you have a friend on
the bench, blip the throttle a few times up to ~3000 rpm and
back. Stop recording and export the log as a CSV or `.trc` file
with the columns `time_ms, can_id, d0, d1, d2, d3, d4, d5, d6, d7`.

For a 30-second capture at 500 kbit/s you should see roughly
30,000–40,000 frames. Filter the log to the 6 broadcast IDs
the v0.14.0 decoder knows about:

| CAN ID | Decoded fields | Source ECU | Period |
|---|---|---|---|
| 0x0AA | RPM, throttle | DME | 10 ms |
| 0x1D0 | Coolant, ambient | DME | 100 ms |
| 0x545 | Oil temp | DME | 1000 ms¹ |
| 0x0CE | Wheel speeds (×4) | DSC | 20 ms |
| 0x130 | Vehicle speed | EGS / DME | 100 ms |
| 0x316 | Battery voltage | DME / IHKR | 1000 ms |

¹ 0x545 oil temp is **E46 confirmed; E9x needs verification** per
`docs/ROADMAP_ISSUES.md`. If you have an E9x, this is the most
valuable frame to dump.

## Step 2 — replay the log through the decoder

A small driver script lets you replay the captured frames through
the same decoder the panel uses. The script reads the CSV, feeds
each row to `can_decoders.decodeFor(id, data)`, and prints the
decoded values.

```bash
# from the repo root, with Node 18+
node - <<'NODE'
const fs = require("fs");
const decoders = require("./src/js/can_decoders.js");

const text = fs.readFileSync(process.argv[2], "utf8");
const lines = text.trim().split("\n");
const header = lines.shift().split(",");
const idIdx = header.indexOf("can_id");
const dataIdxs = ["d0","d1","d2","d3","d4","d5","d6","d7"].map(c => header.indexOf(c));

let lastById = {};
for (const line of lines) {
  const cols = line.split(",");
  const id = parseInt(cols[idIdx], 16);
  const data = dataIdxs.map(i => parseInt(cols[i], 16));
  const decoded = decoders.decodeFor(id, data);
  if (decoded == null) continue;
  // Print the first 10 frames per ID + a sample every 100 frames.
  if (!lastById[id] || (parseInt(cols[0], 10) - lastById[id].t) > 1000) {
    console.log(`t=${cols[0]}ms id=0x${id.toString(16).padStart(3,"0")} ${JSON.stringify(decoded)}`);
    lastById[id] = { t: parseInt(cols[0], 10) };
  }
}
NODE node capture.csv
```

## Step 3 — sanity-check the values

Open the Live Gauges panel in the desktop app, connect to the
same car (real hardware, after the slice 5/6 Tier B wiring
lands), and **cross-reference** the running values against the
decoder output. For each gauge, the two should match within the
encoder resolution:

| Gauge | Expected at idle | Plausible range |
|---|---|---|
| RPM | 750 ± 50 | 0–8000 |
| Coolant | 80–95 °C (warm) | -40–130 °C |
| Oil temp | 80–105 °C (warm) | -40–150 °C |
| Vehicle speed | 0 km/h (stationary) | 0–127.5 km/h² |
| Battery voltage | 13.8–14.4 V (running) | 6.0–16.0 V |
| Throttle | 0 % (foot off) | 0–100 % |

² Vehicle speed byte is `km/h * 2` clamped at 255 → 127.5 km/h.
Cars going faster than that need a different encoding (the next
v0.14.x cycle).

If any value is wildly off (e.g. RPM reads 2500 instead of 750,
or coolant reads -40 °C when the engine is clearly warm), the
decoder scale or byte offset is wrong. **The fix is one constant
in `src/js/can_decoders.js`** — see Step 4.

## Step 4 — file the report

Open a GitHub issue at `github.com/ohgeeceee/beemuu/issues/new`
with the template:

```
### v0.14.1 decoder verification — [chassis] [year]

**Hardware:** OBDLink SX / PEAK PCAN-USB / other
**Capture file:** [attach capture.csv or .trc]
**Frame(s) affected:** 0x0AA / 0x1D0 / 0x545 / ...

**Observed decoded value at idle:** [e.g. RPM = 2500]
**Expected value at idle:** [e.g. RPM ≈ 750]

**Decoder output (paste from Step 2):**
```
t=10320ms id=0x0aa {"rpm":2500,"throttle":12.5}
```

**Suggested fix (if obvious):** [the scale, byte offset, or
bit-field that's wrong, with the canonical source. e.g. "RPM
should be `bytes[0:2] * 0.25`, not `* 4`. The BMW DME
broadcasts RPM at 4 counts per rev, so divide by 4, not multiply."]
```

The decoder constants live in one place —
`src/js/can_decoders.js`, near the top of the file. The labels
are `RPM_SCALE`, `THROTTLE_SCALE`, `TEMP_OFFSET_C`, `WHEEL_SCALE`,
`VEHICLE_SPEED_SCALE`, `BATTERY_SCALE`, `BATTERY_OFFSET_V`. A
v0.14.1 PR can adjust these in one commit and the panel will
show the corrected values on next reload.

## Step 5 — once a chassis is verified, lock it down

The decoder doesn't track which chassis was verified. The
harness doc captures the verification, but a follow-up cycle
should add a `verified_chassis` field to the decoder module
(per-ID) that's set to `["E46"]` once Step 3 passes on that
chassis. The panel header can show a "✓ E46" badge for each
gauge where the chassis is verified, and a "⚠ E9x only" warning
for users on a chassis that's still pending.

That's a v0.14.2 follow-up — this harness doc is the report-back
loop for v0.14.1.

## What this doc is NOT

- **Not a real-time capture script.** Step 1 uses vendor software
  (OBDLink, PEAK) for the raw capture, not the desktop app. The
  desktop app's CAN listener (slice 5/6) is the runtime consumer,
  not the verifier.
- **Not a regression test.** The decoder's existing tests
  (`src/js/can_decoders.test.js`) are byte-pattern tests against
  synthetic frames; the harness is for real-car data. Both
  belong in the matrix.
- **Not a K+DCAN cable extension.** The new v0.14.0 transport is
  additive — the K+DCAN cable keeps doing KWP2000-over-CAN for
  diagnostic sessions in parallel. The harness is for the raw
  CAN bus, not the KWP line.

## References

- `src/js/can_decoders.js` — the decoder module. Scales near the top.
- `src-tauri/src/transport/sim.rs::broadcast_frames_at` — the Rust
  simulator generator. The JS-side mirror in `live_can_source.js`
  uses the same scales; parity tests pin this.
- `docs/ROADMAP_ISSUES.md` "Known Broadcast Frames" — the
  documented ID list and chassis-uncertainty notes.
- `docs/v0.14.0_plan.md` — the cycle plan, including the
  E46-only chassis scope and the v0.14.1 follow-up.
