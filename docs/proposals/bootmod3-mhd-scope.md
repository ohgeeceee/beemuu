# Bootmod3 / MHD Integration — Scope & Legal Risk Assessment (Draft)

> **Status:** Draft proposal — not on ROADMAP, not scheduled. Per `COMMUNITY_FRAMEWORK.md` "no feature without a Discussion" rule, this doc is a seed for a GitHub Discussion thread, not a commitment to ship. Legal risk is the blocker, not engineering.

## 1. What "integration" would mean

Two distinct surfaces are conflated as "tuning platform integration":

1. **Read-only log import** — user exports a Bootmod3/MHD CSV/log and BeeEmUu ingests it for visualization (histogram, log-diff, math channels). No reverse-engineering of closed firmware, no writing to the DME.
2. **Read/write flash integration** — BeeEmUu talks to the DME's flashing protocol (bootloader, seed/key, flash sectors) or re-uses Bootmod3/MHD's own flashing stack. This is where the legal and safety risk lives.

This draft **only scopes (1) for any near-term work**. (2) is explicitly out of scope until a licensed counsel review and a hardware safety harness exist.

## 2. Why (1) is tractable and (2) is not

| Surface | Engineering | Legal | Safety |
|---------|-------------|-------|--------|
| (1) CSV/log import | Trivial — `LogSession` already ingests CSV (`src/js/csv_log_export.js`), histogram and log-diff are format-agnostic. Adapter is a column-map. | Low — user owns their log file; no proprietary protocol used. Must not redistribute Bootmod3/MHD's file format spec if it's non-public. | None — no car write. |
| (2) Flash read/write | Hard — per-DME bootloader, UDS 0x34/0x36/0x37 or BMW-FAST, anti-brick sequencing, recovery on power loss. | **High** — Bootmod3/MHD's flashing protocol and maps are proprietary; circumventing a technological protection measure may implicate 17 U.S.C. §1201 / EUCD Art. 6. Even documenting the DME's own OEM flashing protocol could be seen as enabling. | **High** — wrong flash = bricked DME, no dealer recovery. The project's current safety story ("offline by default, no writes") would be broken. |

**Conclusion:** (1) could be a doc-only PR (column-map + `LogSession` adapter) and is auto-merge eligible. (2) stays deferred until (a) counsel says the specific OEM flashing path is not a TPM circumvention and (b) a bench harness with power-loss recovery is demonstrated on a spare DME.

## 3. Minimal (1) design (if Discussion approves)

**Files:**
- `src/js/log_import_bootmod3.js` (new) — `parseBootmod3Csv(text) -> LogSession` — header row map: `RPM → rpm`, `Boost (psi) → map`, `Lambda → lambda_1`, etc. Unknown columns kept as raw channels (no drop).
- `src/js/test/log_import_bootmod3.test.cjs` (new) — 3 fixtures (Bootmod3, MHD, stock BeeEmUu) round-trip through `LogSession` and `stats()`/`diffSeries()`.
- `src/index.html` / `src/js/main.js` — add "Import external log" button next to "Load session" in Logging tab; reuses existing histogram/log-diff/math pipeline.
- `docs/validation/external-log-import.md` (new) — 3 anonymized fixtures + expected column-map, so a contributor can verify via `node --test` without owning a tune.

**No Rust change, no transport change, no protocol change.** The adapter is pure JS and the existing `LogSession` shape already supports arbitrary channels.

**Acceptance:** A Bootmod3 CSV and an MHD CSV each load, histogram renders, log-diff vs. a stock BeeEmUu CSV shows `meanΔ` on shared channels (e.g., `rpm`, `boost`). No writes, no flashing.

## 4. What (2) would require before it could be considered

Not a plan — a checklist of preconditions for a future Discussion to even open:

1. **Counsel memo** — outside counsel (not community speculation) on whether the specific OEM UDS flashing path (not Bootmod3's proprietary path) is a TPM under §1201/EUCD. The memo's scope and date must be cited in the PR.
2. **Bench harness** — spare DME on bench power with documented recovery (bootloader re-entry on power loss, verified on video). No real-car flashing without the harness.
3. **Safety gate** — flashing UI is behind an explicit `I UNDERSTAND THIS CAN BRICK MY DME` checkbox, disabled by default, with a link to the harness doc. The project's `SECURITY.md` threat model must be amended.
4. **No proprietary redistribution** — no Bootmod3/MHD binary, map, or protocol dump in the repo, even with permission (provenance impossible to verify for a downstream fork).

Until 1-4 are met, any PR that touches flashing is out of scope and will be closed with a link to this doc.

## 5. Community governance

Per `COMMUNITY_FRAMEWORK.md` and `docs/v0.7.0_plan.md` "no feature without a Discussion":

- Open a Discussion titled "Bootmod3/MHD — read-only log import scope (v0.15.x?)" and link this draft.
- The Discussion must run at least 7 days and have at least one maintainer + one tuner owner comment before a PR opens.
- The PR that implements (1) must be doc-only + pure JS (auto-merge eligible). Any Rust/transport change is out of scope and signals (2) creep.

## 6. Recommendation

Ship **(1) read-only log import** as a single small PR after Discussion concludes. Keep **(2) flash integration** deferred indefinitely — the value (one more way to write a tune) does not justify the legal and safety cost for a community-owned, offline-by-default diagnostic tool.

*Draft saved 2026-08-30 on `feat/v0.15.1-injector-duty` (ahead of `main` `b9179a3`). Not a ROADMAP item until a Discussion thread concludes.*
