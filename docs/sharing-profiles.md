# Sharing profiles

A "profile" is a named set of live-data parameters for one engine/vehicle
variant. Once you've mapped your car, here's how to share it — and how to use
one someone shared with you.

## Export your profile

1. Map the parameters in the **Parameter Explorer** and add them to a profile
   (either edit a `community/` TOML file, or import an existing one to extend).
2. Go to **Diagnostics → Share profiles**, pick your profile, click
   **Export .toml**. The file is written to your `beeemuu-exports` folder.
3. Rename it descriptively — chassis + engine, e.g. `e70_x5_n62.toml`.

## Share it — two ways

**Send it directly (helps one person now).** Give the `.toml` file (or paste
its text) to anyone. They open **Diagnostics → Share profiles**, choose the
file or paste the text, and click **Import**. It loads immediately and is
selectable in the Live Data and Logging tabs. To keep it permanently, they drop
the file into their `community/profiles/` folder.

**Open a pull request (helps everyone, forever).** Add your file under
[`community/profiles/`](../community/profiles/) and open a PR. Once merged it
ships with the next release, so every user gets your profile automatically.
Each car is its own file, so PRs don't conflict. Fill in the PR template
(vehicle, how you verified, the "not from ISTA" confirmation).

Not comfortable with Git? Open a
[profile submission issue](../.github/ISSUE_TEMPLATE/profile_submission.md)
and paste your TOML — a maintainer can add it for you.

## Import a shared profile

- **In-app:** Diagnostics → Share profiles → choose file or paste → **Import**.
  Loads live; nothing is overwritten unless a profile `id` matches.
- **Permanent:** drop the `.toml` into `community/profiles/` and restart. The
  Diagnostics tab confirms it loaded and flags any errors.

## Quality notes

- Standard OBD-II parameters (`query = "obd:.."`) work on any 2007+ car and are
  safe to share as-is.
- Anything read via `did:` or `local:` is model-specific — **verify it on the
  real car** (watch it change in the Explorer, cross-check against a known
  gauge) before sharing, and note any unverified entries in the label.
- Never include data extracted from ISTA or other proprietary software.
