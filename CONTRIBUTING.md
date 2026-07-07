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
| `[forum]` | C