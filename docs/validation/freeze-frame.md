# Freeze-frame byte-layout validation harness

> **Status:** the v0.14.0 cycle split the legacy
> `community/freeze_schemas.toml` into per-EC `*.toml` files
> (`12.toml` for DME, `29.toml` for DSC, `72.toml` for FRM) —
> PR #170, merged 2026-07-27. Every existing entry is
> **simulator-only** (matches `src-tauri/src/transport/sim.rs::SimEcu.freeze`).
> The DME / DSC / FRM byte-0..2 convention (engine speed u16
> BE + coolant °C = byte - 40) is shared by all three
> simulator fixtures, but the remaining 6 bytes of every
> freeze frame have no open-source documentation.
>
> This doc is the harness for upgrading the schemas to
> real-car data. The procedure mirrors
> [`n62-real-car.md`](n62-real-car.md) (PR #178) and
> [`can-broadcast.md`](can-broadcast.md) (PR #164).

## What this is

A freeze-frame byte-layout schema (in `community/freeze/<addr>.toml`)
maps each `[[field]]` to a `(offset, width, scale, bias)` tuple
so the desktop app's `read_freeze_frame` command can render
the bytes as labelled values. **The schema is wrong for any
field whose scale/width hasn't been confirmed on a real
car** — the simulator emits a specific byte pattern, and
shipping a schema that pretends to know the meaning of those
bytes (without real-car confirmation) is a worse failure mode
than a `[needs verification]` entry because the rendered
value will *look* right.

The harness is the report-back loop. You capture a freeze
frame on a real car, compare the bytes against the simulator's
emitted pattern, and file a single issue with the diff.
Everything below is the recipe for doing that.

## What you need

- A real BMW with a present module matching the address
  in the schema filename. For `12.toml` (DME): any E-series
  with an MSV70 / MSV80 / MSD80 / MSD81 / ME9.2 DME, or
  any F/G-series with a MEVD17.2 DME. For `29.toml` (DSC):
  any BMW with a DSC module. For `72.toml` (FRM): E-series
  cars with the footwell module.
- A cable that can read DTCs + freeze frames. The
  K+DCAN cable + the BeeEmUu desktop app's Diagnostics tab
  work for E-series; an ENET cable (or OBDLink SX with the
  raw-CAN listener, post v0.14.0 Tier B) for F/G-series.
- The `community/freeze/<addr>.toml` schema you want to
  verify — start with `12.toml` (DME) since that's the
  most-tested reference.

## Step 1 — capture the freeze frame

Trigger a DTC on the target module so the ECU records a
freeze frame. The simplest way is to clear a known DTC, then
induce it again (e.g. unplug a sensor, read the DTC, plug
it back in). Alternatively, an existing stored DTC may
already have a freeze frame.

Connect the cable, open the desktop app, click **Connect**,
select the profile, and read the DTCs. The fault table
shows the freeze-frame payload in hex + the schema-decoded
values. **Copy both** — the raw bytes are the truth, the
decoded values are what the schema says the bytes mean.

## Step 2 — sanity-check the existing fields

For each field in `community/freeze/<addr>.toml`, check
that the schema-decoded value matches the physical reality:

| Field | What to check |
|---|---|
| `Engine speed` (offset 0, u16) | At idle (750 ± 50 rpm on a warm engine), the schema should decode to ~750. If it reads 0 or 7500, the width or scale is wrong. |
| `Coolant temp` (offset 2, u8, scale 1.0, bias -40.0) | At cold start (ambient), the schema should decode to ~ambient °C. At operating temp, 88–95 °C. If it reads -40 °C, the byte is 0x00 (the SAE J1979 "unsupported" sentinel) — the DME is not populating this offset on this firmware. |
| Fields past offset 2 | All unverified. **Skip the comparison** — the schema is empty or has `[needs verification]` markers here on purpose. |

If a known-true field decodes wrong, the scale / width /
offset is wrong, and the fix is one constant in the
`.toml` file.

## Step 3 — capture the unverified bytes

For the bytes that the simulator emits but the schema
doesn't decode (offsets 3-8 in the current `12.toml`,
`29.toml`, `72.toml`), the report-back is a per-byte
observation. Pick a known physical state, capture the
freeze frame, record the bytes, and try to correlate:

| Byte | At idle (warm) | At cold start (ambient) | At WOT (3000 rpm) |
|---|---|---|---|
| 3 | 0x00 | 0x00 | 0x00 |
| 4 | 0x14 | 0x00 | 0xFF |
| ... | ... | ... | ... |

If a pattern emerges (e.g. byte 4 increases monotonically
with engine load), the byte is a sensor reading. If it's
all zero or all 0xFF, the DME is not populating that offset
on this firmware. Both observations are useful — the latter
prevents someone from inventing a meaning for an
always-zero offset.

## Step 4 — file the report

Open a GitHub issue at
`github.com/ohgeeceee/beemuu/issues/new` with the template:

```markdown
### v0.x.x freeze-frame verification — <addr> <chassis>

**Hardware:** K+DCAN / ENET / OBDLink SX / PEAK PCAN-USB
**Chassis:** E46 / E9x / E6x / E60 / F30 / G20 / etc
**Firmware:** [DME / DSC / FRM firmware version]
**App version:** [from the about panel]
**Schema file:** `community/freeze/<addr>.toml`

**Captured freeze frame:**
- DTC code: P0123
- Raw bytes: `02 EE 7A 00 14 8B 01 E2 40`
- Schema-decoded: rpm=750, coolant=82°C, [other fields]

**Per-byte observations (Step 3):**

| Byte | Idle (warm) | Cold start | WOT |
|---|---|---|---|
| 3 | _ | _ | _ |
| 4 | _ | _ | _ |
| ... | ... | ... | ... |

**Suggested fix (if obvious):** [the `[[field]]` line to
add or correct in `community/freeze/<addr>.toml`]
```

## Step 5 — what we will do with the report

A passing report (all unverified bytes correlate with a
physical state, no `0xFF` or `0x00` always-zero observations)
**promotes the relevant `[[field]]` entries from simulator-only
to chassis-validated** in the next v0.14.x cycle. The
`# WARNING: this schema matches the byte layout emitted by`
comment in `community/freeze/<addr>.toml` is updated to point
at the confirming issue.

A failing report (bytes are all zero / all 0xFF on a
real car, or a known-true field decodes wrong) **corrects
the schema** in a small follow-up Tier A PR. The `[needs verification]`
marker stays on any field whose real-car confirmation
requires a second chassis.

## Cross-references

- v0.14.0 freeze-frame schema split: PR #170
  (`feat(v0.14.0): freeze-frame schemas — per-ECU split + auto-load`)
- Companion chassis-specific harness: [`n62-real-car.md`](n62-real-car.md)
  (E70 X5 4.8L, K+DCAN cable)
- Companion broadcast harness: [`can-broadcast.md`](can-broadcast.md)
  (raw CAN bus, OBDLink SX)
- Schema format: `community/freeze/README.md`
- Schema source: `community/freeze/<addr>.toml`
- Decoder pipeline: `src-tauri/src/data/freeze.rs`
- Decoded-value render: `src/js/main.js::read_freeze_frame`
