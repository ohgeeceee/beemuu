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

> Contribute only original or community-derived knowledge. Do not include data
> extracted from ISTA or other proprietary software.
