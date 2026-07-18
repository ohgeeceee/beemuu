# Test-plan schema — `community/testplans/<dtc>.toml`

This document is the contract for the v0.9.0 "Guided Fault Finding" cycle
(PR #1). It defines the `[[step]]` data shape that later slices (PR #2
authorship, PR #3 loader, PR #4 UI) build on. Nothing here is
production-changing code — the schema is enforced by a **CI gate** in
`src-tauri/src/community.rs` (`shipped_testplans_branch_integrity`) and the
recursive TOML syntax walker (`shipped_community_tomls_parse`, v0.8.0 PR #1).

## Why a parallel tree, not an extension of `[[opinion]]`

The three shipped knowledge bases (`opinions`, `oracle`, `stories`) are all
**flat**: one lookup in, one static answer out. A branching test plan has a
different shape — a graph of steps with measurement verbs and conditional
branches. Extending the flat `[[opinion]]` schema would corrupt the
perspective-card UI; a parallel `community/testplans/` tree keeps every
existing surface byte-stable. See `docs/v0.9.0_plan.md` survey finding #1.

## File layout

One file per DTC code, named by the BMW-style 4/6-hex uppercase code the read
paths produce (`protocol::Dtc.code`):

```
community/testplans/2A82.toml      # VANOS solenoid
community/testplans/29E0.toml      # fuel rail pressure (low)
community/testplans/P0171.toml     # generic lean
```

A single file holds exactly one plan. Multiple plans are never merged into
one file; if a DTC resolves to more than one procedure, they live in separate
files and the UI presents them as alternatives (PR #4).

## Top-level schema

```toml
# community/testplans/2A82.toml
dtc = "2A82"                       # REQUIRED — must match the filename code

[meta]
title = "VANOS intake solenoid fault"   # human label for the UI
engine_family = "n55"                   # OPTIONAL hint; not a gate target
[suppressed]                            # OPTIONAL — see "Honesty" below
reason = "No in-repo procedure grounding"

[[step]]
id = "s1"
# ... see Step table below
```

| Key | Required | Meaning |
|---|---|---|
| `dtc` | yes | The 4/6-hex uppercase DTC code. Must equal the filename stem. |
| `meta.title` | yes | Short label shown in the walkthrough header. |
| `meta.engine_family` | no | Free-text hint (e.g. `n55`). Informational only. |
| `meta.suppressed` | no | Presence suppresses the plan from the walkthrough (used for the known-missing list). See Honesty. |

## Step table — `[[step]]`

Each `[[step]]` is one node in the walkthrough. A step is either a **task**
(the tech does something) or a **conclusion** (the walkthrough ends).

| Field | Required | Type | Meaning |
|---|---|---|---|
| `id` | yes | string | Unique within the file. Referenced by `on_pass` / `on_fail` / `next`. |
| `instruction` | yes* | string | What the tech does / checks. *Required for task steps; omit on conclusions. |
| `measurement` | no | table | Optional `measurement` block — see Measurement table. |
| `on_pass` | no | string | `id` of the step to jump to when the measurement/check passes. |
| `on_fail` | no | string | `id` of the step to jump to when the measurement/check fails. |
| `next` | no | string | `id` of the linear next step when the step has no pass/fail branch. |
| `conclusion` | no | string | Present ⇒ this step is a **conclusion node**. Text shown on arrival. |
| `source` | yes | string | In-repo citation proving the step (see Source rule). |

### Measurement table — `measurement = { ... }`

A step may carry one measurement, the "measure" verb of a real test plan.
Two kinds:

```toml
# did poll — jump to Live Data with this DID, expected range
measurement = { kind = "did", did = "0x1201", label = "Fuel trim bank 1",
                expected_min = -10.0, expected_max = 10.0 }

# manual observation — a yes/no the tech answers from the car
measurement = { kind = "manual", question = "Is the charge pipe cracked?" }
```

| Field | Required | Meaning |
|---|---|---|
| `kind` | yes | `"did"` or `"manual"`. |
| `did` | when `kind == "did"` | UDS DID hex string, e.g. `"0x1201"` (N55/S55 fuel trim bank 1, `TECH_SPECS.md` § 5). |
| `label` | when `kind == "did"` | Human label for the Live Data deep-link. |
| `expected_min` / `expected_max` | when `kind == "did"` | Expected numeric range; UI flags out-of-range. |
| `question` | when `kind == "manual"` | Yes/no prompt the tech answers from observation. |

A `did` measurement implies `on_pass` / `on_fail` branch targets (or a
single `next` for informational polls). A `manual` measurement always pairs
with `on_pass` / `on_fail`.

## Conclusion nodes

A step with a `conclusion` field is terminal. The walkthrough ends there and
the UI shows the conclusion text plus optional cross-links into the matching
opinion/oracle entries (PR #4). A plan **must** contain at least one
conclusion node reachable from `s1` (enforced by the gate).

## Source rule (the honesty contract)

Every `[[step]]` **must** name a `source` pointing at an in-repo file that
grounds the step. No forum paste, no invented procedure. Accepted sources:

- `community/opinions/*.toml`, `community/oracle/*.json`, `community/stories/*.toml`
- `research/bmw_diag_dim01_dtcs.md` (DTC descriptions)
- `research/bmw_diag_dim04_uds_dids.md`, `research/bmw_diag_dim07_local_ids.md` (DIDs)
- `docs/TECH_SPECS.md` (e.g. § 5 fuel trims)
- `backend/seed_dtcs.py`, `backend/seed_bmw_dim01.py` (seed corpus)

The gate asserts `source` is non-empty on every step; reviewers spot-check it
against the cited file. This is the same discipline as v0.8.0 PR #2's
service-function sourcing.

## Branch-integrity rules (enforced by `shipped_testplans_branch_integrity`)

1. **Resolvable branches.** Every `on_pass` / `on_fail` / `next` value must
   equal the `id` of a `[[step]]` in the same file. A dangling target fails
   the test.
2. **Every plan ends in ≥ 1 conclusion.** At least one step must carry a
   `conclusion` field, and it must be reachable from `s1` by following branch
   edges. (Reachability is checked via BFS over `on_pass`/`on_fail`/`next`.)
3. **Every step names a source.** Non-empty `source` on each `[[step]]`.
4. **`dtc` matches filename.** The top-level `dtc` must equal the file stem.
5. **Acyclic reachable graph.** The gate does **not** forbid DAG shapes
   (diamonds are fine) but forbids cycles that would hang the UI traversal —
   the BFS reachability walk doubles as a cycle guard via visited-set
   bounding (no step is visited more than `step_count` times).

## Honesty / known-missing

DTCs with no in-repo procedure grounding are listed in the **known-missing**
table (appended to this doc by PR #2) rather than faked. A plan file may
carry only `meta.suppressed` to mark a placeholder without a body — the gate
allows a suppressed plan with zero steps. See `docs/v0.9.0_plan.md` § "What we
will NOT do" (emissions tampering, VIN spoofing, imported ISTA plans, and
auto-executing write steps are permanent exclusions).

## Known-missing DTCs (filled in by PR #2)

The first grounded corpus (PR #2) ships plans for the DTCs below, each
step cited to an in-repo source:

| DTC | Title | Grounding |
|---|---|---|
| 2A82 | VANOS intake solenoid fault | opinions/2A82, stories/n55, oracle/n55 |
| 29E0 | Fuel rail pressure / mixture too lean | opinions/29E0, stories/n55, oracle/n55, dim04 DID 0x5AC3 |
| 29E1 | Fuel pressure sensor signal | dim01, dtc_texts, dim04 DID 0x5AC3, opinions/29E0 |
| 29E2 | Fuel injection rail, pressure sensor signal | dim01, dtc_texts, dim04 DID 0x5AC3, opinions/29E0 |
| 30FF | Charge-air pressure too low (underboost) | stories/n55, oracle/n55, dim01 |
| 29CC | Random / multiple cylinder misfire | stories/n55, oracle/n55 |
| 2E81 | Electric coolant pump speed deviation | stories/n55, oracle/n55 |
| 2E82 | Electric coolant pump fault | stories/n55, oracle/n55 |
| P0171 | System too lean (Bank 1) | opinions/P0171, stories/generic, oracle/generic, TECH_SPECS § 5 (DIDs 0x1201/0x1202) |
| P0300 | Random / multiple cylinder misfire | stories/generic, oracle/generic |
| P0420 | Catalyst efficiency below threshold | stories/generic (diagnose-only; monitor-masking permanently excluded) |

**Known-missing** — frequently requested DTCs with **no in-repo
procedure grounding** yet. These are deliberately *not* faked as stub
plans; they wait for a contributor to add grounded content (same honesty
pattern as v0.8.0 PR #2's service-function list):

| DTC | Title | Why not yet |
|---|---|---|
| 2A99 | VANOS exhaust control fault | Only co-mentioned with 2A82 in forum threads; no in-repo procedure source for the exhaust-side branch. |
| 30FF (wastegate branch) | Underboost via wastegate/turbo | The charge-pipe branch is grounded; wastegate adaptation/rattle diagnosis has no in-repo source. |
| P0011 / P0014 | Camshaft timing over-advanced | No in-repo opinion/oracle/story grounding. |
| P0087 | Fuel rail pressure too low (generic) | Generic analogue of 29E0/29E2; no generic-engine in-repo source beyond the BMW-coded family. |
| P0128 | Coolant thermostat below regulating temp | No in-repo procedure grounding. |
| 2C## VANOS timing family | Various | Awaiting grounded sources. |

Contributors: add a grounded plan (every step cited to an in-repo file)
and move the DTC from this list into the corpus. See
`community/testplans/README.md` and `docs/validation/testplans.md`
(PR #5) for the verification path.

