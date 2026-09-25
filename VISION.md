# Beemuu Vision & Strategy

*Status: Living strategy document — read alongside ROADMAP.md and TECH_SPECS.md.*

## 1. The Mission

Make Beemuu the **best BMW automotive software in the world**: free, open
source, professional-grade, and built the way a senior product team would
build it — not a solo side-project, but a platform that the community extends
and owns.

Three strategic pillars carry that mission:

1. **An ecosystem, not an app.** A plugin system where the community writes,
   shares, and downloads free plugins — and the app itself becomes the runtime
   they run on.
2. **Features nobody else has.** Diagnostic and ownership tooling that is
   genuinely "never seen before" and benefits every BMW owner, not just the
   tuner crowd.
3. **A custom tuning story.** Read, analyze, and — with explicit consent and
   the right hardware — write calibration data. This is the hardest pillar:
   it writes to ECUs and is safety-critical (see §5).

---

## 2. Where We Are Today (grounded in the repo)

| Area | Current state |
|------|---------------|
| Version | v0.19.0 "Report Clarity" in progress (branch `fix/v0.19-green-suite`). |
| Product | Tauri 2 desktop app (Rust core `src-tauri/`, vanilla JS `src/`) + read-only Python `backend/`. |
| Plugin system | **v1 exists.** `src/plugins/` (catalog.json) + `src/js/plugins.js` (validate/parse/load/save, sandboxed tool code, CSP-isolated runtime), `plugins_ui.js`, `plugins_boot.js`, and a Playwright browser regression suite (`scripts/test-plugins-browser.cjs`). Kinds today: `data` packs and `tool` (pure JS, no host permissions). **Local install only — no sharing/registry.** |
| Unique features | **14 designed, mostly unbuilt.** `TECH_SPECS.md` specs Community Oracle, Diagnostic Story Mode, Tuning Fingerprint Detector, Ghost Mode, Adaptation Drift Tracker, Misfire Pattern Recognition, Parameter Hunt, Virtual Second Opinion, Dyno Mode, Predictive CBS Timeline, Wiring Detective, Cold Start Auto-Logger, Secure Snapshot Share, Flash Counter & History Auditor. Only a subset is implemented. |
| Tuning groundwork | Tuning Fingerprint Detector spec'd (`tuning_detect.rs`); tuner-facing logging/DID decoding shipped in v0.4/v0.6. Read-only analysis is viable; **flashing calibration is not built.** |
| Community layer | `community/` profiles + DTC seeds; COMMUNITY_FRAMEWORK.md (democratic PR-driven contribution model). |
| Safety/governance | AGENTS.md autonomy tiers. **Anything that writes to an ECU is Tier B** (one human merge) and ECU writes on live vehicles are safety-relevant. |

---

## 3. The Plan — Phases

Phases are ordered by value-per-risk. Each is tagged with the autonomy tier it
lands in (A = merge on green CI, B = one human merge, C = propose only).

### Phase 1 — Turn the plugin system into an ecosystem  (Tier A/B)

The v1 plugin runtime already proves the sandbox. Now make plugins **shareable**
and **downloadable for free**, with a trust boundary the community can rely on.

| Slice | Tier | Notes |
|-------|------|-------|
| Package format v2: multi-file plugins (bundled JS + assets + manifest) instead of single JSON | A | Backward-compatible loader; validate + migrate v1. |
| Plugin **registry** in the read-only `backend/` API: list, search, download manifest | A | `backend/` is Tier A. Hosted later (Tier C deploy). |
| Local "install from file" → "install from registry URL/ID" | A | Reuses v1 sandbox + persistence. |
| Plugin **signing + verification** (author key → signature in manifest) | B | Trust is the make-or-break for a download ecosystem. |
| Granular host-permission model (v1 = none) — opt-in read/write access | B | New permission kinds need the Rust command surface. |
| Community contribution flow for the registry (submit → review → publish) | A/C | Follows COMMUNITY_FRAMEWORK.md democracy rules. |

**Outcome:** "Browse plugins → install → enable" works, plugins are portable,
and authors get credit. This is the community flywheel.

### Phase 2 — Ship the "never seen before" features  (Tier A, mostly)

TECH_SPECS already designs 14 differentiating features. Pick the ones that
(1) benefit every BMW owner and (2) are Tier A buildable now.

Suggested first four (by value-for-everyone × buildability):

| Feature | Why it benefits everyone | Tier |
|---------|--------------------------|------|
| **Predictive CBS Timeline** | Condition-based service scheduling becomes a simple "when is my next oil change" instead of a dealer mystery. Pure data + UI. | A |
| **Diagnostic Story Mode** | Turns a raw fault into a plain-language guided walkthrough. Builds on v0.19's beginner guides. | A |
| **Wiring Detective** | Pin-to-pin wiring lookup for common repairs. Community-contributed data. | A |
| **Cold Start Auto-Logger** | One click → automatically capture the cold-start window every morning; catch intermittent cold faults no one can reproduce. | A |

The forensic features (Tuning Fingerprint Detector, Adaptation Drift, Misfire
Pattern, Flash Counter Audit) are Tier B because they read ECU state and need
the Rust protocol surface; sequence them after the first four.

**Outcome:** the app does things no other BMW tool does, using only data the
community already owns. Each is a differentiated "why Beemuu" moment.

### Phase 3 — The custom tuning story  (Tier B/C — hardest, do last)

Be honest about what this is: reading is analysis; **writing calibration to an
ECU is flashing, which is safety-critical and legally sensitive.** It is the
single biggest risk in the project (see §5).

| Stage | What | Tier |
|-------|------|------|
| 3a | **Tuning analysis** (already spec'd): read-only fingerprint/adaptation/misfire reports from logs and live data | B |
| 3b | **Calibration browser**: view maps/tables from a captured flash image, offline, zero risk | B |
| 3c | **Guided write** with hard-safety gate (stable battery, checksum, flash-backup, consent, hardware lock-in) | B/C |
| 3d | Full custom tuning GUI (map editor) | C |

Stage 3a–3b deliver real tuning value with no ECU-write risk and are the
credible path to 3c. **Do not build 3c until 3a/3b prove out and the safety
review is written.**

---

## 4. How we keep the "professional team" bar

- **AGENTS.md autonomy tiers are the discipline.** Tier A lands fast and
  autonomously; Tier B gets one human review with the protected path flagged;
  Tier C is proposed, never executed unilaterally.
- **Everything lands as a PR with tests green.** No direct pushes to main.
- **The community framework is the culture.** Credit is public and permanent;
  roadmaps are public; every issue gets a human response.
- **Security and safety are non-negotiable.** Sandboxed plugin execution,
  signed packages, and hard gates around any ECU write.

---

## 5. Risk register (say it plainly)

| Risk | Severity | Mitigation |
|------|----------|------------|
| ECU flashing bricks a vehicle | **Critical** | Stage tuning behind analysis; battery-maintainer gate; backup before write; hardware lock-in; human merge (Tier B/C). |
| Malicious plugin | High | Sandbox (already v1), package signing (Phase 1), no host permissions by default, review gate on registry. |
| Scope creep — "world's best" is unbounded | High | Phased plan above; every slice ships independently with tests; no giant monolith branches. |
| Tuning content is legally/ToS sensitive (tuner platforms' IP, emissions) | Medium | Ship analysis/browser (read-only) first; get legal review before any write feature. |
| Community never forms | Medium | Plugin ecosystem + free downloads is the flywheel; credit + democracy rules in COMMUNITY_FRAMEWORK.md. |
| Maintainer burnout on a huge vision | Medium | Phase in small slices; Tier A autonomy keeps velocity without review fatigue. |

---

## 6. Proposed sequence and the first concrete step

1. **Phase 1** (plugin ecosystem) — highest leverage for "community-built",
   builds on code that already exists.
2. **Phase 2** (differentiating features) — constant "never seen before" wins,
   mostly Tier A.
3. **Phase 3** (tuning) — analysis first, writes last.

**First concrete step:** start Phase 1 with the package-format-v2 slice
(multi-file plugins, backward compatible) and, in parallel, the
Predictive CBS Timeline as the first "never seen before" feature. Both are
Tier A and land on green CI. This decision point belongs to the maintainer
(Jon) — see ROADMAP next-cycle planning.
