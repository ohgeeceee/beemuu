# Guided fault-finding test plans

Drop one `[[step]]`-based plan per DTC here — e.g. `2A82.toml`,
`29E0.toml`, `P0171.toml`. The filename must match the plan's `dtc`
code (BMW-style 4/6-hex uppercase). Every file is CI-gated for branch
integrity by `shipped_testplans_branch_integrity` in
`src-tauri/src/community.rs`.

The full schema contract lives in `../../docs/testplans.md` — read it
before authoring. This file is the quick author reference.

## Verification label (plan level)

Every plan ships with a verification state in its `[meta]` block, so
users know whether the plan has been confirmed on a real car:

| `meta.verified` | Meaning |
|---|---|
| `"needs verification"` | Grounded in-repo (opinions / oracle / stories / research) but **not** yet walked start-to-finish on a real car. The default for every new plan. |
| `"verified"` | Walked on a real car via the harness in [`../../docs/validation/testplans.md`](../../docs/validation/testplans.md); the branch path and any conclusions were confirmed. |

Rules that keep this axis honest:

- **New plans ship `verified = "needs verification"`.** No exceptions —
  grounding in an in-repo source is necessary but not sufficient; the
  real-car walk is what retires the marker.
- **The label comes off only with evidence.** Run the harness on a real
  car, then open a PR that links the harness report and flips the marker
  to `"verified"` for exactly that plan. No silent upgrades.
- **`source` citations stay.** Removing the marker never touches a
  step's `source` — the in-repo grounding remains the audit trail.
- The `meta.verified` field is the contract the walkthrough UI will read
  to show a **NEEDS VERIFICATION** badge (UI rendering lands in a
  follow-up; the marker is the data half of that contract).

The harness procedure lives in
[`../../docs/validation/testplans.md`](../../docs/validation/testplans.md).

## Minimal valid plan

```toml
dtc = "2A82"

[meta]
title = "VANOS intake solenoid fault"
engine_family = "n55"

[[step]]
id = "s1"
instruction = "Inspect the intake VANOS solenoid for oil sludge."
measurement = { kind = "manual", question = "Is the solenoid clogged with sludge?" }
on_pass = "s2"
on_fail = "s3"
source = "community/opinions/2A82.toml"

[[step]]
id = "s2"
instruction = "Clean the solenoid and re-fit; re-scan for 2A82."
conclusion = "Likely intermittent VANOS fault from sludge. Clean and re-test."
source = "community/stories/n55.toml"

[[step]]
id = "s3"
instruction = "Replace the intake VANOS solenoid."
conclusion = "Mechanical VANOS solenoid failure. Replace and re-scan."
source = "community/oracle/*.json"
```

## Rules (enforced by the gate)

- Every `on_pass` / `on_fail` / `next` must resolve to a `[[step]].id` in
  the same file.
- At least one `[[step]]` must be a **conclusion** (`conclusion = "…"`),
  reachable from `s1`.
- Every `[[step]]` must carry a `source` pointing at an **in-repo** file.
  No forum paste, no invented procedure.
- `did` measurements use UDS DID hex (`"0x1201"`); `manual` use a yes/no
  `question`.

## Known-missing

DTCs with no in-repo procedure grounding are **not** faked. Mark a
placeholder with only a suppressed meta:

```toml
dtc = "P0128"
[meta]
title = "Coolant thermostat"
[meta.suppressed]
reason = "No in-repo procedure grounding yet"
```

The full known-missing list is maintained in `../../docs/testplans.md`.

> Contribute only original or community-derived knowledge. Do not include
> procedures extracted from ISTA or other proprietary software. Guided
> diagnostics never fires a write on its own — write steps hand off to the
> existing service-function UI with its `[UNVERIFIED]` gating intact.
