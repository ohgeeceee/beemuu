# Real-car Guided Test-Plan Validation Harness

> **Purpose.** Every plan in
> [`community/testplans/`](../../community/testplans/) ships with
> `verified = "needs verification"` in its `[meta]` block — rendered in
> the walkthrough header as **NEEDS VERIFICATION**. The plans are
> *hypotheses grounded in-repo* (opinions / oracle / stories / research
> docs), not procedures confirmed on a specific chassis. They were
> authored by following the `source`-citation rule, not by walking a real
> car start to finish. **This harness is the path that upgrades a plan
> from `[needs verification]` to `[verified]` — per CONTRIBUTING.md,
> labels come off only via a `docs/validation/` harness report, never
> silently.**
>
> **Time required.** 20–90 minutes per plan, depending on how many
> branch steps need a real-car check. You only have to follow the branch
> (or branches) you can actually reach on your car.
>
> **Risk honesty.** A test plan is *read-and-look* guidance; it never
> fires a write on its own (v0.9.0 plan, "What we will NOT do"). If a
> step hands off to the service-function UI for a write (clear-DTC,
> routineControl), that hand-off inherits the service routine's
> `[UNVERIFIED]` gating — see
> [`service-functions.md`](service-functions.md). Do not run writes you
> cannot verify.

## 1. Pre-flight checklist

- [ ] **Battery maintainer connected** if any step actuates hardware
      (pump test, bleed) or runs the car for more than a few minutes.
- [ ] **Cable + transport working.** K+DCAN (E-series) or ENET
      (F/G-series, see
      [`docs/hardware/enet-cable-pinout.md`](../hardware/enet-cable-pinout.md)).
      Status bar shows your VIN.
- [ ] **Simulator NOT connected.** The sim will happily walk any plan to
      any conclusion — a "pass" against the sim proves nothing about the
      real car. This is exactly the trap this harness exists to close.
- [ ] **Traffic recording on** for any `did:` measurement step you poll
      (Live Data tab). The request/response bytes are the evidence you
      file for `did:`-range checks.
- [ ] **A way to clear and re-scan the DTC** after the repair branch, so
      you can confirm the conclusion actually resolved the fault.

## 2. Walk the plan on the real car

Open the fault in the DTC-detail view; the walkthrough panel shows the
plan. For each reachable step, do what the step says and record:

- (a) **the branch you took** — which answer (Pass / Fail / Continue)
      the real car produced,
- (b) **the measured value** for any `did:` step (the DID you polled and
      the reading, in-range or out),
- (c) **the observable vehicle behavior** for any manual step,
- (d) **chassis / engine / gearbox / date / transport used.**

A plan **passes** only if:

1. Every branch you reached resolves the way the plan predicts, **and**
2. Every `did:` measurement falls in the plan's `expected_min` /
   `expected_max` when the car is in the stated condition, **and**
3. The conclusion branch you land on matches what the car actually did
   (the fault cleared, or the flagged component was the real cause).

### 2a. `did:` measurement steps

When a step says *measure* with a `did:` (e.g. N55/S55 fuel trim
`0x1201` / `0x1202`), poll it in Live Data and compare against the
`expected_min` / `expected_max` in the plan file. Record the raw value
and whether it was in range. A wrong range here is a *finding* — file it
per § 4 step 3, do not silently "fix" the plan.

### 2b. `manual` measurement steps

When a step asks a yes/no from observation (e.g. *is the VANOS solenoid
screen clogged with sludge?*), answer from the actual car. Photograph or
note the condition. The manual step is the heart of the hypothesis — a
plan that predicts "clean → fault clears" but you find a clean solenoid
and the fault persists is a *mismatch*, not a failure of the harness.

### 2c. Reaching a conclusion

The walkthrough ends at a `conclusion` node. Confirm the conclusion
against the car: after the repair branch, clear the DTC and re-scan. If
the conclusion says "replace the solenoid" and a new solenoid clears
2A82, the conclusion is confirmed. If the fault returns, the plan's
branch was wrong for your chassis — record it.

## 3. What a negative result looks like

All of these are *findings*, not failures of the harness:

- **A branch dead-ends differently than the plan predicts** — e.g. the
  plan's `on_pass` step doesn't exist on your chassis variant, or a
  `manual` check answers neither cleanly. Record the step ids and your
  actual observation.
- **A `did:` value is out of the plan's expected range** in the stated
  condition — record the DID, the reading, and the condition (idle /
  load / temp). The expected range may be wrong, or your car may differ.
- **The conclusion doesn't resolve the fault** — you followed the plan
  to its conclusion and the DTC returns. The plan's hypothesis is
  incomplete for your chassis. Record the full path taken.
- **No in-repo grounding surfaces for your variant** — the plan cites
  sources that don't cover your engine. Don't improvise; file it.

## 4. Filing the report (label removal)

1. **All reachable branches pass and the conclusion resolves the
   fault:** open a PR titled
   `[v0.9.0] test-plan validation: <dtc> verified on chassis XYZ`.
   Include chassis/engine/gearbox, date, transport used, the branch path
   taken with the measured values per step, and the re-scan result. The
   PR flips `verified = "needs verification"` → `"verified"` for exactly
   that plan file, adds a comment citing the report, and leaves every
   `source` citation intact. If some branches were *not* reachable on
   your car, say so in the PR — the label upgrade covers the validated
   path only.
2. **Any step misbehaves, a branch mismatches, or a `did:` range is
   wrong:** open an issue titled
   `[v0.9.0] test-plan mismatch: <dtc> on chassis XYZ` with the path,
   values, and behavior from § 3. Do **not** open a label-removal PR.
   Propose a corrected plan in a separate PR with the harness evidence.
3. **You found a *real* procedure from an in-repo-citable source** (your
   own traffic capture / Parameter Explorer log counts once documented):
   propose it in a PR with the capture as evidence. Forum paste-ins
   without captures get rejected — see CONTRIBUTING.md rule 1
   ("in-repo source or it doesn't ship").

## 5. Known-missing plans

DTCs with no in-repo procedure grounding are **not** faked — they ship
as suppressed placeholders (`[meta.suppressed]`, empty body) and never
reach the walkthrough. The full known-missing list is maintained in
[`docs/testplans.md`](../testplans.md). To add a plan for one, ground it
first (PR #2 pattern) and it enters the corpus already carrying
`verified = "needs verification"`, then upgrades through this same
harness.

## 6. Reference

- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — two-axis label system;
  labels come off only via a harness report.
- [`docs/testplans.md`](../testplans.md) — the plan schema contract and
  the known-missing list.
- [`community/testplans/README.md`](../../community/testplans/README.md)
  — author reference; the `[needs verification]` rule for new plans.
- [`service-functions.md`](service-functions.md) — the write-path
  harness this doc mirrors; any plan step that hands off to a service
  routine inherits its `[UNVERIFIED]` gating.
- [`docs/hardware/addressing-model.md`](../hardware/addressing-model.md)
  — chassis-variant module addresses for `did:` polls.
