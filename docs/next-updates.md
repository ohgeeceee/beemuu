# Next ten updates

Proposed sequence approved for development on 2026-10-19. Each cycle should
produce a focused PR with relevant regression checks and accurate limitations.
Version assignment and release publication are separate maintainer decisions.

| Order | Update | Acceptance target | Dependencies / review |
|---|---|---|---|
| 1 | Establish the v5 baseline | Reconcile release claims, feature status, plugin boundaries and installer availability. | Documentation; Tier A. |
| 2 | Connection health and recovery | Explain connection failures, prevent duplicate connection attempts and distinguish stale readings. | Extend existing UI; transport/command changes require Tier B review. |
| 3 | Hardware validation and coverage | Evidence records identify chassis, firmware, adapter, parameter, units and result; unverified coverage stays explicit. | Vehicle/capture access; data/UI Tier A, protocol changes Tier B. |
| 4 | Diagnostic case workspace | Resume a vehicle investigation with faults, checks, snapshots and notes. | Existing Garage/snapshot tools; storage design first. |
| 5 | Explain analysis results | Trace results to sessions, channels, time windows and missing evidence. | Existing v3/v4 engines; Tier A. |
| 6 | Repeatable repair verification | Compare before/after evidence and expose mismatched operating conditions. | Existing repair verification; Tier A where no command changes are needed. |
| 7 | Backup and restore | Versioned workspace export, restore preview and conflict handling; invalid imports preserve records. | Inventory storage surfaces; native command changes Tier B. |
| 8 | Read-only plugin integration | Installed sample plugin completes a consented host read; denial, revocation and stop/disable cleanup tested end to end. | Audit existing runtime and bridge; Tier B if Rust boundary changes. |
| 9 | Publisher trust | Verify signatures, reject tampering and review changed publisher keys or permissions. | Author-key threat model; Rust verification Tier B. |
| 10 | Evidence-backed contributions | Templates and fixtures make data and plugin submissions reproducible and traceable. | Existing PR/registry review flow; deployment remains separate. |

Hardware evidence collection for update 3 can run alongside application work.
Do not label a cycle complete until its acceptance target is verified. Use
[feature status](feature-status.md) to avoid rebuilding existing modules.

## Development progress

- Update 1: baseline documentation merged in PR #374.
- Update 2: first connection-recovery slice documented in
  [connection-recovery.md](connection-recovery.md). The cycle remains open
  until the other polling paths and real-cable recovery behavior are checked.
- Updates 3–10: acceptance targets above remain outstanding.

Follow-up baseline finding: the About modal in `src/index.html` still carries
an old version string and repository spelling. Correct its displayed metadata
in a separate focused change; do not treat that as a release version bump.

GitHub Issues is disabled in this repository as of 2026-10-19, so this document
and focused PRs carry the development status instead of a separate issue tracker.
