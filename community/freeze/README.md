# Per-ECU freeze-frame schemas

Each file in this directory is a freeze-frame byte-layout schema for
one ECU address. The filename (without extension) is the ECU address
as hex — `12.toml` is the DME (0x12), `29.toml` is the DSC (0x29), etc.

## Format

```toml
[[field]]
label = "Engine speed"
unit = "rpm"
offset = 0
width = "u16"      # one of: u8 | i8 | u16 | i16 | u24 (big-endian)
scale = 1.0
bias = 0.0
decimals = 0
```

- `offset` and `width` are byte positions in the freeze-frame payload.
- `width` is one of `u8` / `i8` / `u16` / `i16` / `u24` — big-endian for multi-byte.
- `scale` and `bias` apply after the raw read: `value = raw * scale + bias`.
- `decimals` is the rounding precision for display.

The schema is fed `&resp[3..]` from the KWP `12 hi lo -> 52 hi lo <env>`
response, so offsets count from the first env byte (not the SID).

## Loading

Two paths populate the runtime registry:

1. `tauri::command::load_freeze_schemas` (called from the
   schema-builder "Reload" button in the desktop app) reads every
   `*.toml` in this directory and registers by filename-stem-as-hex.
2. `community::load_freeze_per_ecu` (called from the bulk
   `community::load()` on startup) does the same so schemas are
   populated automatically when the app boots — no manual reload
   needed.

The legacy `community/freeze_schemas.toml` file (which held the
single DME schema as an array-of-arrays under `[[schema]]`) is no
longer read. Its data was ported into `12.toml` (plus DSC and FRM
for the simulator).

## SIMULATOR ONLY — extends with real-car data

Every schema in this directory today matches the byte layout emitted
by `src-tauri/src/transport/sim.rs::SimEcu.freeze`, NOT any real
BMW ECU. The DME byte-0..2 / DSC byte-0..2 / FRM byte-0..2
convention (engine speed u16 big-endian + coolant °C = byte - 40)
is shared by all three simulator fixtures, but the remaining 6 bytes
of every freeze frame have no open-source documentation.

**Do not invent meaning for unverified offsets.** Each
schema fields-list should only contain fields whose scale/width
have been confirmed by real-car capture.

Adding a field:

1. Capture the freeze frame from a real car
   (OBDLink SX + `STN Term`, or PEAK PCAN-USB + `PCAN-View`).
2. Add the field below the existing `[[field]]` entries.
3. Comment with `[needs verification]` until you have
   cross-checked against a second chassis or the project owner
   has reviewed the capture.
4. Once verified, drop the `[needs verification]` marker.

The `docs/validation/freeze-frame.md` harness (planned v0.14.1)
will document the report-back loop and how to compare your schema
against a real capture.