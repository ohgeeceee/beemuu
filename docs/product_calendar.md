# BeeEmUu product calendar

> **Status:** Planning horizon, not a promise. This calendar sequences the ten
> approved updates from [next-updates.md](next-updates.md) and the version
> themes from [v0.19_to_v0.30_roadmap.md](v0.19_to_v0.30_roadmap.md) onto
> calendar time. Release cuts, tags, and installer publication are Tier C —
> the maintainer's call — so every "release" row below means "candidate for a
> release decision", not a committed ship date.
>
> Baseline: source version **v5.0.1**, calendar written **2026-11-27**.
> Update 1 (v5 baseline) is done; update 2 (connection health and recovery)
> is mid-cycle.

## How to read this

- Each month has one **cycle spine** (the update being worked) and at most one
  **supporting beat** (docs audit, validation push, site content). Two spines
  in one month has never held; don't plan it.
- **Gate** is what must be true before the cycle closes. A cycle that misses
  its gate slips as a whole — the calendar re-baselines, the scope does not
  silently shrink.
- Tier B work (transport, protocol, command surface) always lands behind a
  human merge; the calendar holds a review buffer week for it.
- Historical cadence: the v0.14.x–v5.0.0 arc held roughly one cycle per
  1–2 weeks for Tier A work. The calendar below plans *slower* than that on
  purpose — updates 2–10 carry hardware and review dependencies the arc did
  not.

## December 2026 — close update 2, open update 3

| Week | Focus | Gate |
|---|---|---|
| Nov 30 – Dec 6 | Update 2 close-out: physical adapter health probe design note; real-cable recovery checklist (K+DCAN on E70, ENET on F/G) | Every polling path has a stated freshness story in `docs/connection-recovery.md` |
| Dec 7 – 13 | Update 2 real-cable recovery pass on the bench car | Reconnect after cable pull recovers without app restart, or the failure is documented and surfaced |
| Dec 14 – 20 | Update 3 open: hardware validation and coverage — evidence-record schema (chassis, firmware, adapter, parameter, units, result) | Schema reviewed against the existing `docs/evidence/` skeleton; no unverified coverage promoted |
| Dec 21 – Jan 4 | Holiday pause. Community call for N52/N54/N62 bench reports (`docs/validation/n5x-real-car.md`, `n62-real-car.md`) | At least the call posted; reports are opportunistic, not gated |

**Release candidate:** none. Update 2 closes into whatever version the
maintainer cuts next; no version-surface work this month.

## January 2027 — update 3 (evidence) + site content backlog

| Week | Focus | Gate |
|---|---|---|
| Jan 4 – 10 | Update 3: wire evidence records into the profile `[needs verification]` markers; unverified coverage stays explicit | Every marker in `community/profiles/*.toml` maps to an evidence record or a named gap |
| Jan 11 – 17 | Update 3: validation-pack templates per chassis family (E9x N52/N54, E70 N62, F/G B58/N55) | A new owner can run a pack cold from the doc alone |
| Jan 18 – 24 | Supporting beat: fault-code content depth. The generator + all 220 grounded code pages shipped Nov 2026 (PR #355 closed the link backlog; the Nov expansion widened 13 → 220 pages); what is thin now is repair-path depth — 6 of 220 codes have community opinions files, 10 have schematic cross-links | Opinions coverage doubles; every new opinions file carries a source URL |
| Jan 25 – 31 | Buffer / Tier B review window for anything update 2 or 3 surfaced | — |

**Release candidate:** end of January, if update 2 is closed and the site
generator landed. Theme per the planning map: **profile confidence / evidence
program** (v0.22/v0.24-shaped).

## February 2027 — update 4 (diagnostic case workspace)

| Week | Focus | Gate |
|---|---|---|
| Feb 1 – 7 | Storage design first (per the approved sequence): workspace record shape, versioning, conflict behavior | Design note reviewed before any code |
| Feb 8 – 21 | Case workspace implementation: resume an investigation with faults, checks, snapshots, notes — built on the existing Garage/snapshot tools | Close and reopen the app mid-investigation; everything restores |
| Feb 22 – 28 | Failure states: corrupt workspace file, partial restore, downgrade | Invalid imports preserve existing records |

**Release candidate:** end of February, update 3 + update 4. Tier A
throughout unless the workspace needs a native command (then Tier B and the
review buffer applies).

## March 2027 — updates 5 + 6 (explainability and repair verification)

| Week | Focus | Gate |
|---|---|---|
| Mar 1 – 14 | Update 5: trace any v3/v4 engine result to its source sessions, channels, time windows, and missing evidence | Every verdict a panel shows can be opened to its evidence; a result built on a stale channel says so |
| Mar 15 – 28 | Update 6: before/after repair comparison with operating-condition mismatch surfaced | A repair "verified" across mismatched conditions (cold vs warm) is flagged, not crowned |

**Release candidate:** end of March. Both are Tier A over existing engines.

## April 2027 — update 7 (backup and restore)

| Week | Focus | Gate |
|---|---|---|
| Apr 5 – 18 | Versioned workspace export, restore preview, conflict handling | Restore preview shows exactly what changes before anything writes |
| Apr 19 – 30 | Soak + failure injection: truncated exports, future-version files, concurrent writes | No data loss path found, or found-and-fixed with a regression test |

**Release candidate:** end of April. Native command changes, if any, are
Tier B — hold the last week as review buffer.

## May–June 2027 — updates 8–9 (plugin trust)

| Week | Focus | Gate |
|---|---|---|
| May 3 – 23 | Update 8: read-only plugin integration end-to-end — installed sample plugin completes a consented host read; denial, revocation, stop/disable cleanup tested | The §8 security review in `docs/plugin_capability_bridge_plan.md` is done before any `network` + `read-dtc` combination |
| May 24 – Jun 6 | Update 9: publisher trust — signature verification, tamper rejection, changed-key review | A tampered package is refused and reported, never served |
| Jun 7 – 27 | Buffer. These two updates carry the most Tier B surface on the calendar; the buffer is deliberate | — |

**Release candidate:** mid/late June, only after both security gates pass.

## July 2027 — update 10 + quality floor

| Week | Focus | Gate |
|---|---|---|
| Jul 5 – 18 | Update 10: evidence-backed contribution templates and fixtures | A data or plugin submission is reproducible from its fixture alone |
| Jul 19 – 31 | Quality-gate beat (v0.29-shaped): release-candidate regression fixtures, compatibility matrix, contributor validation workflow | The RC checklist runs unattended in CI |

## Standing beats (every cycle, any month)

- **Close-of-cycle doc audit** — ROADMAP, forward-roadmap, public
  `frontend/roadmap/*.html` and version surfaces agree before the cycle
  closes (the v0.14.4 / v0.14.6 pattern).
- **Real-car validation** — B58/N55 F/G DID validation remains the hardest
  cross-cycle blocker; every release notes draft names which markers cleared.
- **Test-floor check** — the JS / Rust / Python suites stay green on the CI
  glob before any release cut; the Windows-only skips stay named, never
  silently absorbed.

## What this calendar deliberately excludes

- BLE/WiFi adapter support (v0.28-shaped): research deliverable only, no
  implementation date until the compatibility contract exists.
- Cloud sync, shared-log hosting: needs the privacy + ops story first.
- Service writes, flashing, FSC/AOS: out of scope per the v0.8.0 "what we
  will NOT do" list.

*Written 2026-11-27. Re-baseline after every cycle close; delete rows, don't
let them rot.*
