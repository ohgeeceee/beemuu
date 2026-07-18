# Per-car profile files

Drop one `.toml` file per vehicle here — e.g. `e70_x5_n62.toml`,
`e46_m54.toml`. Everything in this folder is loaded in addition to the
top-level `community/profiles.toml`, so each contributor gets their own file
and pull requests don't collide.

Fastest way to create one: open the app, map your car in the **Parameter
Explorer**, then use **Diagnostics → Share profiles → Export .toml**. Rename
the exported file descriptively (chassis + engine) and drop it here.

Format is identical to `profiles.toml` (see `../README.md`). One file can hold
multiple `[[profile]]` blocks. Name the profile `id` uniquely (a later profile
with the same `id` replaces an earlier one).

## Shipping profiles

| Engine | File | Status |
|---|---|---|
| B58 (F/G-series x40i) | `b58.toml` | OBDb-verified DIDs; reference `[profile.theme]` example |
| N55 (E/F-series 35i) | `n55.toml` | F-series UDS DIDs + fuel-trim adaptations; oil temp unverified |
| N52 (E-series) | `n52.toml` | KWP2000 |
| N54 (E-series twin-turbo) | `n54.toml` | KWP2000 |
| N62 (E-series V8) | `n62.toml` / `example_e70_n62.toml` | KWP2000 |
| N20 / N26 (F-series 2.0 turbo I4) | `n20.toml` | Community, all UDS entries `[needs verification]` |
| S55 (F80/F82/F87 M) | `s55.toml` | Community, all UDS entries `[needs verification]`; BMW M tricolor `[profile.theme]` |

> Contribute only original or community-derived knowledge. Do not include data
> extracted from ISTA or other proprietary software.
