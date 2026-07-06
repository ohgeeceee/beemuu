# Community data

Drop-in data files loaded at startup — **no recompile needed**. Edit these,
restart the app, and your additions appear. This is the easiest way to
contribute: you don't need to know Rust.

The app looks for this folder in order: `$BEEEMUU_COMMUNITY`, `./community`,
`../community`, then next to the executable. The **Diagnostics** tab shows
what loaded and reports any file errors.

> **Do not paste text extracted from ISTA or other proprietary BMW software.**
> Contribute only original or community-derived knowledge (observed on your
> own car, forum threads you can cite, etc.).

## `dtc_texts.toml` — fault-code descriptions

Codes are hex, case-insensitive. Overlay entries override the built-in table.

```toml
[dtc]
"2A82" = "VANOS intake: control fault, camshaft stuck"
"5DF0" = "DSC: hydraulic pump, mechanical fault"
```

## `profiles.toml` — live-data parameter sets

Each profile is one engine/vehicle variant. `query` is `did:HHHH`, `obd:HH`,
or `local:HH` (hex). `decode` is one of: `temp_u8` (raw−40 °C), `u8`,
`u8_tenths` (raw/10), `u16`, `u16_quarter` (raw/4, OBD rpm),
`u16_milli` (raw/1000), `u16_times10` (raw·10, OBD fuel rail pressure kPa),
`percent_a` (raw·100/255).

```toml
[[profile]]
id = "e70_n62"
label = "E70 X5 4.8i (N62B48)"

  [[profile.param]]
  id = "rpm"
  label = "Engine speed"
  unit = "rpm"
  target = 0x12
  query = "obd:0C"
  decode = "u16_quarter"
  min = 0.0
  max = 7000.0

  [[profile.param]]
  id = "oil"
  label = "Oil temperature"
  unit = "°C"
  target = 0x12
  query = "local:10"
  decode = "temp_u8"
  min = -40.0
  max = 160.0
```

## `freeze_schemas.toml` — freeze-frame byte layouts

Map byte offsets in a fault's environmental snapshot to values. `width` is
`u8`/`i8`/`u16`/`i16`/`u24` (multi-byte = big-endian). Value =
`raw * scale + bias`, shown with `decimals` places.

```toml
[[schema]]
address = 0x12   # DME

  [[schema.field]]
  label = "Engine speed"
  unit = "rpm"
  offset = 0
  width = "u16"
  scale = 1.0
  bias = 0.0
  decimals = 0

  [[schema.field]]
  label = "Coolant temp"
  unit = "°C"
  offset = 2
  width = "u8"
  scale = 1.0
  bias = -40.0
  decimals = 0
```

## How to find these values

Use the **Parameter Explorer** tab on a real car: scan a module's identifiers,
watch one live, and note which byte offsets track RPM, temperature, etc. as you
rev the engine. Then write them up here and open a pull request — include your
chassis and engine so others know what it applies to.
