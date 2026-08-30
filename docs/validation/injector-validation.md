# Real-car injector-time validation harness

> **Purpose.** v0.4.0 shipped the `u8_div100` decoder (foundation
> from v0.3) and the example profile entries for B58 / N55
> include an `inj_time` channel (DID `0x4363`, target `0x12`,
> range 0–2.55 ms). v0.5.0 PR #72 established the
> `[needs verification]` discipline via the u8_enum harness;
> this doc extends that discipline to the injector-time channel.

## Why this exists

The B58 / N55 example profiles both include the
`inj_time` channel:

- `community/profiles/b58.toml` — `id = "inj_time"`, target
  `0x12`, query `did:4363`, decode `u8_div100`,
  range 0–2.55 ms
- `community/profiles/n55.toml` — same shape

The DID, decode, and range are based on documented BMW DME
behaviour (DID `0x4363` is "injection time bank 1" on the
MSV70 / MSV80 DME; `u8_div100` matches the byte scaling at
0.01 ms resolution). Both entries are marked
`[needs verification]` pending real-car validation — the same
discipline the v0.5.0 PR #72 harness established for the
u8_enum DIDs.

If `inj_time` is wrong on a real car — wrong byte scaling,
wrong DID, wrong target, signed vs. unsigned — the visible
number doesn't match what ISTA / a scan tool shows for the
same session. **That mismatch is the validation.** A channel
that's within ~5% of an external tool is correctly decoded;
anything outside that window needs the next thing to check
(decode scale → DID → target → signedness).

## Pre-flight checklist

Before you fill in the harness:

- [ ] BeeEmUu is at v0.5.0 or newer (`Help → About`).
- [ ] You have the ENET cable from `docs/hardware/enet-cable-pinout.md`
  OR a working K+DCAN cable.
- [ ] You have a working connector to your F/G-series BMW
  (verified by running `ista` against the same car and
  seeing DTCs).
- [ ] You're parked, parking brake set, transmission in P/N,
  battery tender connected (long logs with the engine off
  will drain a battery fast).
- [ ] You have either the ISTA / ISTA+ tool OR a known-good
  external scanner (BimmerLink, ProTool, etc.) running on a
  laptop so you can take the reference numbers.
- [ ] You have the engine running and at operating temperature
  (coolant ≥ 80°C).

## How to record an injection-time log

1. Open BeeEmUu, connect to the car, switch to the
   **LiveData** tab.
2. Make sure the **`inj_time`** row is visible in the gauge
   grid (you may need to scroll; the channel is in the bottom
   half of the list by default).
3. Switch to the **Logging** tab, check the **`inj_time`**
   channel in the sidebar, click **Start recording**.
4. Capture three steady-state points:

   | Point | What to do | Duration |
   |-------|------------|----------|
   | Idle  | Engine idling in P/N, all accessories off | 60 seconds |
   | Cruise| Drive at ~80 km/h on a level highway in D (steady) | 90 seconds |
   | WOT   | Full-throttle pull in 2nd gear (test track / safe place) | 20 seconds |

5. Click **Stop recording**, then **Export CSV**. Save the
   CSV somewhere you can re-open.
6. Repeat the same three points with ISTA (or your external
   tool) and export the equivalent injector-time readings.
   ISTA labels this as "Inj. time (bank 1)" in the live-data
   view; the read is in milliseconds.

## Per-state validation tables

For each steady-state point, compare BeeEmUu and your
reference tool at the *same wall-clock minute* (so the
engine's actual state is comparable). Round to 0.01 ms.

### State 1 — Idle (P/N, accessories off)

| Source | Sample t (s) | Reading (ms) |
|--------|-------------:|-------------:|
| BeeEmUu |              |              |
| ISTA / external |        |              |
| **Δ** |                |              |

- Expected range: 0.80 – 2.20 ms (varies by ambient, idle
  speed target, battery voltage).
- **Pass** if |Δ| ≤ 0.05 ms.
- **Investigate** if |Δ| > 0.10 ms.

### State 2 — Cruise (D, ~80 km/h, level road)

| Source | Sample t (s) | Reading (ms) |
|--------|-------------:|-------------:|
| BeeEmUu |              |              |
| ISTA / external |        |              |
| **Δ** |                |              |

- Expected range: 1.50 – 3.00 ms (varies by gear ratio, load).
- **Pass** if |Δ| ≤ 0.05 ms.

### State 3 — WOT pull (2nd gear, full throttle)

| Source | Sample t (s) | Reading (ms) |
|--------|-------------:|-------------:|
| BeeEmUu |              |              |
| ISTA / external |        |              |
| **Δ** |                |              |

- Expected range: 8.00 – 18.00 ms (varies by target boost,
  fuel pressure).
- **Pass** if |Δ| ≤ 0.10 ms.

## How to file the results

1. **All three states pass** — open a PR that:
   - Replaces the `[needs verification]` markers in
     `community/profiles/{b58,n55}.toml` with `[verified
     YYYY-MM-DD on chassis <VIN-LAST-7>]` per the v0.5.0
     PR #72 result-submission convention.
   - Pastes the three validation tables in the PR body.
   - Notes any oddities (e.g. "the WOT number was always
     5% high — checked with a third tool, it agrees with
     BeeEmUu, ISTA rounds differently").
2. **Some states fail** — open an issue first with the
   symptom, the byte-level raw response (from BeeEmUu's
   service-console view, see `docs/forum_post.md` §
   "Service console"), and your reference numbers. **Do
   not** silently flip the DID or the decode in a profile
   edit — the next contributor needs to see the symptom
   in public.

## What if a byte doesn't match?

Don't fake a pass. The `[needs verification]` discipline
exists precisely so we don't paper over wrong DIDs.

If your BeeEmUu number is consistently 100x the ISTA
number: the decoder is wrong (`u8_div100` should be
something else). Check `docs/DECODE_FUNCTIONS.md` § 5 and
open an issue with your two readings.

If your BeeEmUu number is consistently off by 1.00 ms:
the DID is probably right but the `min` / `max` in the
profile TOML is wrong — the `u8_div100` decoder treats the
byte as an unsigned value, so if the DME sends signed,
the value would look wrong. Open an issue with the raw
byte.

If only one of the three states fails (e.g. idle is fine,
WOT is wildly off): the DID is probably right but the
encoder on the DME side saturates at high load and the
byte you get back is a sentinel value. Open an issue with
the symptom and the WOT samples.

## Maintainer note

When a `[verified YYYY-MM-DD on chassis XYZ]` PR lands:

1. The marker stays in the profile TOML alongside the
   verified-by record. **Do not delete the marker** — it's
   the audit trail.
2. The PR should be reviewed by a maintainer with F/G
   chassis access (not a forum thread; the marker is
   strong evidence, but the maintainer should sanity-check
   the steady-state expectations).
3. The validated `inj_time` entry becomes a reference for
   related work (e.g. if a future DID for per-cylinder
   injection timing is found, the verified `inj_time`
   values tell us the encoding is at least consistent).

## See also

- `docs/validation/u8_enum-validation.md` — the v0.5.0
  validation harness this one mirrors.
- `docs/DECODE_FUNCTIONS.md` § 5 — the `u8_div100` decoder
  spec (signed-vs-unsigned note in particular).
- `community/profiles/b58.toml`, `community/profiles/n55.toml`
  — the entries this harness validates.
- `docs/hardware/enet-cable-pinout.md` — for the cable, if
  you don't have one.
