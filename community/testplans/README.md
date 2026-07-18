# Guided fault-finding test plans

Drop one `[[step]]`-based plan per DTC here — e.g. `2A82.toml`,
`29E0.toml`, `P0171.toml`. The filename must match the plan's `dtc`
code (BMW-style 4/6-hex uppercase). Every file is CI-gated for branch
integrity by `shipped_testplans_branch_integrity` in
`src-tauri/src/community.rs`.

The full schema contract lives in `../../docs/testplans.md` — read it
before authoring. This file is the quick author reference.

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
