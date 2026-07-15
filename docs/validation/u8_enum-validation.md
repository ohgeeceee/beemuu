# Real-car u8_enum Validation Harness

> **Purpose.** v0.4.0 shipped the `u8_enum` decoder (PR #60) and
> added three example enum DIDs to
> `community/profiles/{b58,n55}.toml` (`gear`, `engine_state`,
> `knock_detect`). All three carry `[needs verification]` markers
> because the byte-to-state mappings came from OBDb (CC-BY-SA 4.0)
> and have not been validated on a real car. **This harness is
> the smallest possible path for an F/G-series owner with an ENET
> adapter to retire that blocker.**
>
> **Time required.** 15–30 minutes if you have the rig already
> running. About an hour if you also need to wire the ENET cable
> (see [`docs/hardware/enet-cable-pinout.md`](../hardware/enet-cable-pinout.md)).

## 1. Pre-flight checklist

Before running any of the per-DID tests, confirm all of these:

- [ ] **Cable + adapter wired correctly.** DIY ENET cable
      documented in `docs/hardware/enet-cable-pinout.md`. The
      laptop's Ethernet port should show a solid (not blinking)
      link light.
- [ ] **`ip neigh` (Linux) / `arp -a` (Windows) shows a
      `169.254.x.x` neighbour within 5 seconds of ignition on.**
      If not: check the cable + adapter first (see
      `docs/hardware/enet-cable-pinout.md` § "Verifying it
      works"). BeeEmUu won't talk to a car that the OS can't
      see.
- [ ] **BeeEmUu connected.** Status bar shows your VIN and the
      `169.254.x.x` IP. If not: profile dropdown defaults to
      `sim`; switch to `b58` or `n55` (depending on chassis)
      and reconnect.
- [ ] **Ignition on, engine off** (or running — both work; the
      knock state will be more interesting with the engine
      running).
- [ ] **Simulator NOT connected.** The simulator responds to
      every DID with plausible-looking but fake data; running
      these tests against the simulator gives you the bytes from
      the simulator's table, not from a real DME.

## 2. Per-DID test procedure

For each of the three example DIDs:

1. Open BeeEmUu → Logging tab → **Start recording**.
2. Switch to Live Data → confirm the channel name appears in the
   gauge list. The label should NOT have `[needs verification]`
   — that's the marker that the byte→state mapping is still
   unvalidated. (The marker is on the profile-side label; once
   you start recording, the live-data label comes from the
   decoder.)
3. Verify the **byte values the decoder reports match the car's
   actual state**:
   - For `gear` — put the car in each gear (or P/N) and read
     back the value from BeeEmUu.
   - For `engine_state` — cycle the ignition (Off → Cranking →
     Running → Idle / Overrun → Shutdown) and read back.
   - For `knock_detect` — with the engine running, take a
     30-second sample and check whether the value ever moves
     off `0` ("None").
4. For each row in the per-DID table below, tick ✅ or ❌ and
   add a note if ❌.
5. **Stop recording. Save the session JSON** — it'll help if you
   need to file an issue.
6. Take a **screenshot of the BeeEmUu gauge panel** for that
   DID, showing the byte value AND the resolved text label.

### 2a. `gear` — DID `DA0A` (EGS / transmission)

Query string in profile TOML: `"did:DA0A"`
Decoder: `u8_enum`, enum map: 8 entries (P/N + 6 gears + Error)

| Expected state | Byte value | Pass / Fail | Notes |
|----------------|-----------:|:-----------:|-------|
| P/N            | `0` (0x00) | ☐ | Should be true when selector is in P or N |
| 1              | `1` (0x01) | ☐ | |
| 2              | `2` (0x02) | ☐ | |
| 3              | `3` (0x03) | ☐ | |
| 4              | `4` (0x04) | ☐ | |
| 5              | `5` (0x05) | ☐ | |
| 6              | `6` (0x06) | ☐ | |
| Error          | `15` (0x0F) | ☐ | Hard to trigger deliberately — leave unchecked if you can't reach it |

**Chassis + gearbox variant tested:** _________________

### 2b. `engine_state` — DID `4004` (DME)

Query string in profile TOML: `"did:4004"`
Decoder: `u8_enum`, enum map: 6 entries

| Expected state   | Byte value | Pass / Fail | Notes |
|------------------|-----------:|:-----------:|-------|
| Off              | `0` (0x00) | ☐ | Ignition off / KL30 not active |
| Cranking         | `1` (0x01) | ☐ | Brief — capture during startup |
| Running          | `2` (0x02) | ☐ | Engine running under load |
| Idle             | `3` (0x03) | ☐ | Engine warm, foot off throttle |
| Overrun          | `4` (0x04) | ☐ | Engine braking — foot off, high RPM |
| Shutdown         | `5` (0x05) | ☐ | Brief — capture during ignition-off |

**Notes.** "Cranking" and "Shutdown" are transient — best
captured by recording a session that spans an ignition cycle
and reading back the values.

**Chassis + engine variant tested:** _________________

### 2c. `knock_detect` — DID `401F` (DME)

Query string in profile TOML: `"did:401F"`
Decoder: `u8_enum`, enum map: 4 entries (severity scale)

| Expected state | Byte value | Pass / Fail | Notes |
|----------------|-----------:|:-----------:|-------|
| None            | `0` (0x00) | ☐ | Default state — should be true most of the time |
| Light           | `1` (0x01) | ☐ | Triggered occasionally on low-octane fuel or mild load |
| Moderate        | `2` (0x02) | ☐ | Should never happen on a healthy engine |
| Severe          | `3` (0x03) | ☐ | Should NEVER happen — if you see this, the engine has a real problem |

**Notes.** Knocking severity readings are model- and tune-
specific. BMW's factory tune rarely reports Light or above.
Aftermarket tunes (MHD, Bootmod3) may report Light under
aggressive timing. Don't treat "always None" as a test
failure — it can be the correct reading for a stock car on
premium fuel. Treat "Moderate" or "Severe" under normal
cruise as the actionable finding.

**Chassis + tune variant tested:** _________________

## 3. Results submission

Once you've completed all three per-DID tests:

1. **All pass:** open a PR titled
   `[v0.5.0] u8_enum validation: pass on chassis XYZ` against
   `main`. The PR body should reference this doc and list:
   - Chassis + engine variant tested
   - Date + approximate ambient conditions
   - Confirmation that all checkboxes are ✅
   - Attached screenshots (one per DID, embedded in the PR body)

   The PR edits `community/profiles/b58.toml` and
   `community/profiles/n55.toml` to:
   - Change the `[needs verification]` label suffix to
     `[verified YYYY-MM-DD on chassis XYZ]` for the three
     DIDs.
   - Add a one-line comment per DID citing the test PR.

2. **Some fail:** **don't fake a pass.** Open an issue titled
   `[v0.5.0] u8_enum mismatch: chassis XYZ reports byte Y for
   DID Z` against `main`. The issue should include:
   - The byte value BeeEmUu reported
   - The byte value the car's actual state should have produced
     (per OBDb's expected mapping)
   - A screenshot of the gauge panel
   - Chassis + engine + tune (if non-stock)

   A maintainer will investigate; the matching OBDb mapping
   may be wrong, the DID may have a chassis-specific value, or
   there may be a bug in the decoder.

## 4. What if a byte doesn't match?

This is the most likely failure mode. **It is not a test failure
on your end** — the OBDb mappings are best-effort and may be
wrong for your chassis. Common causes:

- **Chassis-specific values.** Some BMW models use byte values
  outside the OBDb-documented range. Note the actual byte and
  the actual state; file an issue.
- **Tune-specific values.** Aftermarket tunes (MHD, Bootmod3)
  may report different knock thresholds than stock. Don't
  apply OBDb's stock mapping to a tuned car without verifying.
- **Wrong DID.** The `DA0A` / `4004` / `401F` IDs are community-
  sourced. If your chassis responds to a different DID for
  the same channel, file an issue with the actual DID your car
  responded to.
- **Decoder bug.** If the byte matches OBDb but the resolved
  text label is wrong (e.g. byte `0` shows as "Error" instead
  of "P/N"), that's a bug in `src-tauri/src/data/live.rs`'s
  `decode_enum_string` or `community.rs`'s
  `parse_enum_map`. File an issue with the screenshot.

## 5. Reference

- [`docs/DECODE_FUNCTIONS.md`](../DECODE_FUNCTIONS.md) § 8 —
  the `u8_enum` spec.
- [`docs/v0.5.0_plan.md`](../v0.5.0_plan.md) — the v0.5.0
  cycle plan; this harness is PR #1.
- [`docs/hardware/enet-cable-pinout.md`](../hardware/enet-cable-pinout.md)
  — DIY ENET cable build guide (if you don't already have a
  working cable).
- [`community/profiles/b58.toml`](../../community/profiles/b58.toml)
  — file to PR against with `[verified YYYY-MM-DD]` labels.
- [`community/profiles/n55.toml`](../../community/profiles/n55.toml)
  — same, for N55.

## 6. Maintainer note

When a `[verified]` PR lands, the maintainer merges it and the
v0.5.0 cycle's `Real-car u8_enum validation` row in
[`ROADMAP.md`](../../ROADMAP.md) flips from 🟢 Ready to ✅ Done
once at least one chassis has validated each byte. The
`[needs verification]` markers come off at that point, and
PR #2 of the v0.5.0 cycle (real-car fuel-trim readout) can
lean on the now-validated `u8_enum` path for its own
verification.
