# Contributing to BeeEmUu

Thanks for your interest! This project lives or dies by community knowledge of
BMW diagnostic protocols, so contributions of **data** are as valuable as
contributions of code.

## Quick paths

| I want to... | Read this | Skill needed |
|-------------|-----------|-------------|
| Add fault-code text for my engine | [Data contributions](#data-contributions) | None — edit TOML |
| Map a new DID / local identifier on my car | [Data contributions](#data-contributions) + [Parameter Explorer](#reverse-engineering-with-parameter-explorer) | None — edit TOML |
| Add a whole engine profile | [Data contributions](#data-contributions) | None — edit TOML |
| Fix a bug or add a feature | [Code contributions](#code-contributions) | Rust + basic JS |
| Report a real-car bug | [Issue template](../.github/ISSUE_TEMPLATE) | None — just details |
| Build and test locally | [Development setup](#development-setup) | Rust + Node 20+ |

---

## Data contributions (no Rust required)

The most valuable contributions are **data** — DTC fault texts, UDS DIDs, KWP2000
local IDs, freeze-frame layouts, and engine profiles. You can add all of this by
editing the files in [`community/`](../community/README.md) — no compiler needed.
Restart the app and the **Diagnostics** tab shows what loaded.

### What to add where

| File | What goes here | Example |
|------|---------------|---------|
| `community/dtc_texts.toml` | Hex fault-code → human description | `"29CD" = "Misfire cylinder 1"` |
| `community/profiles/<engine>.toml` | Per-engine live-data parameters | Oil temp via `did:4506` on B58 |
| `community/freeze_schemas.toml` | Freeze-frame byte layouts per ECU | DME 9-byte layout with scale/bias |
| `community/profiles.toml` | Minimal examples for the built-in list | E70 N62 reference profile |

### Confidence labels

Every data contribution must carry a confidence label so users know what to trust:

| Label | Meaning | Example source |
|-------|---------|--------------|
| `[community]` | Verified by contributor on their car | Your own Parameter Explorer log |
| `[OBDb]` | Verified from OBDb open database | `github.com/obdb/Vehicle-Parameter` |
| `[forum]` | Reported in a public forum thread you can cite | A SpoolStreet/BimmerFest URL in a comment above the entry |

Confidence labels say **where the data came from**. They live in source
comments and profile `label` strings (e.g. `[community, OBDb-verified DIDs]`).

### Verification labels (a second, separate axis)

Live-data parameters and service routines also carry a **verification
state** in their `label`, so users know whether an entry has ever been
confirmed on a real car:

| Label | Meaning | When to use it |
|-------|---------|----------------|
| *(no marker)* | Verified by design (emissions-mandated OBD-II PIDs) or validated on a real car via a harness report | `obd:0C` rpm, `obd:05` coolant |
| `[needs verification]` | The mapping comes from a credible source but has **not** been confirmed on this chassis/engine | Every new UDS `did:` entry until a real-car check |
| `[needs verification, UDS only]` | Same, plus a protocol caveat (won't answer on KWP2000/E-series) | F-series-only DIDs in a mixed-era profile |
| `[UNVERIFIED placeholder]` | A guess or stand-in with **no** open-source evidence; kept visible so testers know what to probe | `local:10` oil temp on E-series profiles |

Rules that keep this axis honest:

1. **In-repo source or it doesn't ship.** A new `did:`/`local:`/routine
   entry needs a citation in a comment (OBDb, `research/`,
   `TECH_SPECS.md`, your own Parameter Explorer log). Forum-sourced
   guesses get rejected — see the v0.7.0 N20/S55 profiles for the
   pattern, including which planner-expected DIDs were deliberately
   rejected and why.
2. **Labels come off only with evidence.** Run the matching harness in
   [`docs/validation/`](../docs/validation/) on a real car, then open a
   PR that links the harness report. That PR removes the marker — no
   silent upgrades.
3. **Reads and writes are different stakes.** An unverified *read*
   shows a wrong number; an unverified *write* (service routine,
   routineControl) can change ECU state. Write-path entries are gated
   harder: they ship `[UNVERIFIED]` with a confirmation dialog, and
   routine IDs are never invented — see
   `src-tauri/src/data/service_functions.rs`.

### Reverse-engineering with Parameter Explorer

The **Parameter Explorer** tab is the workbench for mapping what your
car actually exposes:

1. Connect (K+DCAN for E-series, ENET/DoIP for F/G-series — see
   [Development setup](#development-setup) to run from source).
2. On **Vehicle Test**, run **Scan OBD-II PIDs** first — it reports the
   standard PIDs your ECU answers, so you don't probe blind.
3. In **Parameter Explorer**, probe a DID range (UDS `0x22`-style) or a
   KWP2000 local-ID range. Responding IDs with plausible values are
   your candidates.
4. Compare against a known quantity (idle rpm ~700, coolant rising
   after a cold start) to pin down scale/offset. The decoder catalog
   is [`docs/DECODE_FUNCTIONS.md`](../docs/DECODE_FUNCTIONS.md).
5. Add the parameter to a profile TOML with a `[needs verification]`
   label and a comment naming your evidence (car, chassis, date).
6. Share it: **Diagnostics → Share profiles → Export .toml**, then open
   a PR dropping the file in `community/profiles/`. See
   [`docs/sharing-profiles.md`](../docs/sharing-profiles.md).

---

## Code contributions

Surfaces: Rust core ([`src-tauri/src`](../src-tauri/src)), web UI
([`src/`](../src)), hosted read-only API ([`backend/`](../backend),
stdlib-only Python).

**Golden rules** (from `CLAUDE.md`, non-negotiable):

- No direct pushes to `main`; everything lands via PR so CI runs.
- Tests green before merge — run locally first:
  - `cargo test` (in `src-tauri/`)
  - `python -m pytest backend/tests/ -q`
  - `node --test "src/js/**/*.test.js" "src/js/**/*.test.cjs"`
- Smallest change that satisfies the task; no drive-by refactors.
- One logical change per commit; never widen a PR's scope after opening.

**Commit style:** `<area>: <imperative description>` — e.g.
`community: add N20 DID 4506`, `docs: complete CONTRIBUTING.md`,
`feat(v0.8.0): …`, `fix: …`. Credit data contributors in the message.

**Protected paths** (transport, protocol parser, command surface,
anything that writes to an ECU) are **Tier B**: open the PR, flag the
protected path at the top of the description, and wait for a human
merge. The full list is in `CLAUDE.md` § "Tier B". Everything else —
docs, tests, UI, community data, backend read-only API — is Tier A.

**PR expectations:** describe what changed and how you verified it
(test output, simulator run), link the issue you're resolving, and call
out protected-path changes up top.

---

## Development setup

Requires **Node 20+**; the Tauri CLI drives the Rust build. Python
3.11+ is only needed for the `backend/` test suite
(`pip install pytest`, nothing else — the backend is stdlib-only).

```bash
git clone https://github.com/ohgeeceee/beemuu
cd beemuu
npm install
npm run dev          # builds the Rust core and opens the app
```

First run: choose **Simulator (virtual E90)** in the connection
dropdown — you don't need a car to explore the UI. Real-car cabling is
covered in the [README](../README.md#real-car-setup).

Useful checks while developing:

```bash
cd src-tauri && cargo test          # Rust unit + integration tests
node scripts/lint-toml.js           # TOML whitespace lint (CI build job)
python -m pytest backend/tests/ -q  # hosted-API tests
```

A cargo unit test also parses every shipped `community/**/*.toml`, so a
malformed data file fails CI even though the whitespace lint passes.

---

## Getting help

- Bugs: [issue tracker](https://github.com/ohgeeceee/beemuu/issues) —
  include your chassis/engine, cable type, and the Diagnostics tab's
  community-load report.
- Feature ideas: open a
  [Discussion](https://github.com/ohgeeceee/beemuu/discussions) first —
  no feature enters the roadmap without a public thread
  ([`COMMUNITY_FRAMEWORK.md`](../COMMUNITY_FRAMEWORK.md)).
- Security: see [`SECURITY.md`](../SECURITY.md) — do not file publicly.