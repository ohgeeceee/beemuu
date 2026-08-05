## Summary

Tier A, docs-only PR. Records the actual 4-slice shape shipped via
PRs #228, #229, #234, #235 instead of the original plan's "1 + 2 + 3"
shape. Documents that slice 3 (`update_can_listen` async Tauri
command) was dropped because the frontend converged on main.js
driving `read_live_data` polling directly (the existing async Tauri
command from v0.14.2 / PR #175).

## What this PR amends

- **`docs/v0.15.0_plan.md`** — adds a 2026-08-05 status blockquote
  under the existing 2026-08-02 slice 0 blockquote. The new
  blockquote notes the actual slice shape (1 + 2a + 2b + 2c,
  PRs #229, #234, #235) and documents that the planned Tier B
  slice 3 (`update_can_listen`) was dropped. Updates the Tier
  split table to show shipped slices with their PR numbers + LOC
  counts.

- **`ROADMAP.md`** — flips the v0.15.0 cycle header from
  `(In Progress — slice 0)` to `(Shipped 2026-08-05)`. Replaces
  the "Slices planned" table with a "Slices shipped" table listing
  all 5 shipped slices (with PR numbers) + the dropped slice 3 row.

- **`CHANGELOG.md`** — flips `## [0.15.0] — Unreleased` to
  `## [0.15.0] — 2026-08-05`, promotes the
  `### Planned — Tier A surface (feature cycle)` header to
  `### Added`, rewrites the cycle status blockquote, replaces
  the slice bullets with the actual shipped-slice list (1, 2a,
  2b, 2c, cycle plan, this slice 0.5 doc-amend), and updates the
  "does NOT ship" `commands.rs` note to reflect that v0.15.0 is
  fully frontend (no `commands.rs` exception needed since
  slice 3 was dropped).

## Why this matters

The plan doc, ROADMAP, and CHANGELOG must agree with what's on
`origin/main`. Before this PR they described a 4-slice shape
(1 + 2 + 3 + cycle plan) where the actual shipped shape is
5 Tier A slices (1 + 2a + 2b + 2c + cycle plan). The release-cut
PR follows next; the v0.15.0 CHANGELOG entry should describe
what actually shipped before the tag is pushed.

## Diff stat

3 files, +108 / -61 (no new files, pure doc amend).

## Tier

**Tier A — docs only, no protected paths touched.** Per
`CLAUDE.md` golden rule #1, the auto-merge bot will merge this PR
once CI is green. The release-cut PR (Tier C: version bumps + tag +
`release.yml` + landing-page deploy) follows as the next PR.

## Cycle context

v0.15.0 "Live Gauges from the Bench" — see
[`docs/v0.15.0_plan.md`](../tree/main/docs/v0.15.0_plan.md) for
the full plan. Slices shipped: #228 (slice 0 cycle plan), #229
(slices 1 + 2a bridge + source adapter), #234 (slice 2b wiring
module), #235 (slice 2c caller integration). This PR is the
slice 0.5 doc-amend. The Tier C release cut follows.

## Author note

Commit authored with `ohgeeceee@users.noreply.github.com` to bypass
GH007 (private-email push block). Content unchanged.