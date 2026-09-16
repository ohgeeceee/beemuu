# Landing plan — v0.19.0

> **This branch is a scratchpad, not a change to ship.** Read it, copy what you
> need into GitHub, then close this branch without merging. It exists because
> the release cut is Tier C (propose only) and the PR bodies are easier to copy
> from a file than from chat.

Nine branches are staged in the repo. All nine were verified to **merge cleanly
into current `main` (`dccab143`)** — no rebase, no conflicts.

**The integrated result was also verified**: I merged all nine into `main` in a
scratch branch and ran everything against the combined tree —

| Check | Result |
|---|---|
| JS suite | **440 tests, 439 pass, 0 fail**, 1 skipped |
| Python backend | **219 passed** |
| Rust harness (`rust-harness`) | **104 passed** |
| Plugin browser suite (headless Chromium, shipping CSP) | **PASS** |

So the branches do not just pass individually; the merged whole does.

**One thing to expect:** merging them one PR at a time **conflicts on
`CHANGELOG.md`**. Each branch appends its entry at the same anchor, so the
second and later PRs will report a conflict in that file only. Resolution is
"keep both entries" — delete the `<<<<<<<` / `=======` / `>>>>>>>` markers and
leave the text from both sides. No code file conflicts. (If you would rather
avoid the six resolutions entirely, merge the branches in one go with a local
`git merge` and push the result — your call, but the per-PR route is what your
AGENTS.md prescribes.)

---

## 0. Preconditions — both are yours, not mine

### a. GitHub Actions is locked for billing

Every workflow fails in ~3 seconds with `steps=0`, `runner=(none)` — no runner
is ever assigned. The check-run annotation says it exactly:

> The job was not started because your account is locked due to a billing issue.

Confirmed still active: the #281 merge to `main` at 2026-09-16T01:21 produced
three failing runs (`Tests`, `CI`, `CI & Autonomous Merge`).

**Fix:** GitHub → Settings → Billing (or the org's) — resolve the lock. Until
then: no CI verification, no auto-merge, and `release.yml` cannot build an
installer. This is the gate on everything, including the F36 build a user has
been asking for since August.

### b. Two branches need a human merge by your own rules

`AGENTS.md`: Tier B (`src-tauri/src/transport/**`) = do the work, request **one
human merge**. Releases — version bumps, tags, publishing installers — are
Tier C: **propose only, never execute**. Nothing below is applied anywhere;
branch 1 in particular was left untouched by this plan.

---

## 1. Push the branches

```bash
cd ~/Desktop/beemuu
for b in fix/v0.19-green-suite fix/live-gauges-data-path fix/live-gauges-panel-exposure fix/ci-full-js-suite fix/did-bridge-speed-mapping fix/plugins-storage-recovery fix/rust-verification-harness fix/248-enet-zgw-diagnostics fix/248-enet-hsfz-wakeup-retry; do git push -u origin "$b"; done
```

## 2. Merge order

1. **`fix/v0.19-green-suite`** — Tier A. **Merge this first**: it greens the JS
   suite and every other branch is based on it. Closes issue #268.
2. **Independent Tier A** (any order, after 1): `fix/live-gauges-data-path` →
   `fix/live-gauges-panel-exposure`, `fix/ci-full-js-suite`,
   `fix/did-bridge-speed-mapping`, `fix/plugins-storage-recovery`,
   `fix/rust-verification-harness`.
3. **Tier B** — `fix/248-enet-zgw-diagnostics` (rejection surfacing + the F36
   harness doc). Your merge.
4. **Optional** — `fix/248-enet-hsfz-wakeup-retry` is experimental (ALIVE_CHECK
   wake-up + `0xF4`→`0xF5` retry, unverified on hardware). Hold it unless you
   want it in the build you send to the F36 tester; it is two extra commits on
   top of branch 3 and can be dropped independently.

## 3. PR bodies

Branches with a **single commit** (`fix/ci-full-js-suite`,
`fix/did-bridge-speed-mapping`, `fix/rust-verification-harness`,
`fix/plugins-storage-recovery`) auto-fill their PR body from that commit
message — nothing to paste. For the multi-commit ones:

### fix/v0.19-green-suite (Tier A — merge first, closes #268)

```
Greens the JS suite, which was red on main (420 pass / 5 fail).

Resolves all three items in #268:
- community/dtc_texts.toml was invalid TOML (duplicate keys 2A9C / 2E87), so
  the Rust gate shipped_dtc_texts_parse_and_nonempty could not pass. Removed
  the stale duplicates; the file now parses (verified with a TOML 1.0 parser
  and by the Rust gate itself).
- The v0.19 CAN slice registered 15 simulator frames and 17 declared keys but
  never added DECODERS entries, so decodeFor() returned null for every new ID.
  Registered 14 decoders; a simulator tick now fills 17 gauge keys (was 7).
- frontend/live_gauges.js was 15 frames behind the desktop simulator. Added
  them byte-identically.
Also: removed a stale duplicate health-report test whose expectations
contradicted the shipped implementation, and reverted a stray
dependencies.tauri entry in package.json (an unrelated deprecated package,
imported nowhere) with its package-lock churn.

Verification: node --test "src/js/**/*.test.js" "src/js/**/*.test.cjs"
"frontend/**/*.test.js" → 425 tests, 0 fail. pytest backend/tests/ → 219
passed. The previously hanging live_kdcan_source.test.js now exits in 38 ms.

Tier A. No protected paths.
```

### fix/248-enet-zgw-diagnostics (Tier B — flag the protected path)

```
**Protected path: src-tauri/src/transport/** — Tier B, needs a human merge.**

Fixes the diagnosability half of #248. The HSFZ request loop recognised only
CTRL_DIAG and CTRL_ACK, so every ZGW rejection control word (0x0040-0x0045,
0x00FF) fell into the same `continue` as keep-alive traffic and was
discarded. A refused request then waited out the 3 s read timeout and
surfaced as a bare Timeout — which is why an F36/N55 whose gateway answered
ping and TCP 6801 reported "0 control units found" with no reason.

- TransportError gains Rejected(String); rejections name the control word,
  the target ECU, and which knob to turn.
- A read that times out after the gateway sent only skipped control words now
  names them, so "the car is quiet" and "the car answered and we ignored it"
  stop looking identical.
- Adds docs/validation/enet-hsfz.md: what each rejection code means, how to
  build a test installer, and what to file back on #248.

No wire format, timeout, or success path changed — the change can only turn an
opaque failure into an explained one.

Verification (no Tauri system libraries in this environment, so the full crate
can't be built locally; CI compiles it): scratch harnesses compiling the real
enet.rs (20 tests) and the real transport/mod.rs + enet + record + sim (31
tests) all pass, and a mutation check that reverts only the request() loop
fails exactly the new behaviour tests.
```

### fix/248-enet-hsfz-wakeup-retry (Tier B — experimental, optional)

```
**Protected path: src-tauri/src/transport/** — Tier B. Built on
fix/248-enet-zgw-diagnostics.**

Experimental additions from the #248 draft, each its own commit so either can
be dropped:
- ALIVE_CHECK (0x0012) wake-up sent right after connect — some F-series ZGWs
  won't route diagnostics until they've seen one.
- One-shot 0xF4 -> 0xF5 tester-address retry on control 0x0040.

**Neither is verified on hardware.** The wake-up adds a frame to the wire on
every connect (a success-path change), which is why it is deliberately not
part of the merged-anytime rejection fix. If you have an F36/N55 to test with,
build this and see whether discovery succeeds; if not, drop the wake-up.

Verified in the same harnesses: 20 + 31 tests pass.
```

### fix/live-gauges-data-path (Tier A)

```
Fixes the real UI bug behind the greened suite path: three of the eight Live
Gauges dials never moved. can_decoders.js returned a bare number for 0x545
oil temp, 0x130 vehicle speed and 0x316 battery voltage, while the
live-values cache merges by reading `decoded[key]` — so those values were
dropped every tick, on real cars as much as the simulator (both sources share
the merge). Three tests asserted the primitive shape, which is why it
survived; the v0.16.0 decoders and the public-site mirror already returned
maps.

Also: KNOWN_GAUGE_KEYS gained the two decoded keys it lacked (`ambient`,
`fuelRail_kPa` — the 0x1D0 and 0x0F4 values were dropped too), and the cache
now keeps the four declared boolean flag keys.

Adds src/js/test/can_data_surface.test.cjs — a guard that pins every simulated
frame to a decoder, every declared key to a producer, every panel gauge to a
decoder, and index.html's markup to GAUGE_DEFINITIONS. Verified it fails 4/8
against the pre-fix file.

Tier A. Suite: 432 pass / 0 fail.
```

### fix/live-gauges-panel-exposure (Tier A)

```
Built on fix/live-gauges-data-path.

Two things the panel was decoding but not showing:
- Six more dials (intake air temp, engine load, manifold pressure, oil
  pressure, outside temp, engine torque) — the values the v0.19 decoders
  produce. Panel goes 8 -> 14 dials; the 3-column grid wraps.
- A status readout under the grid for the non-dial values: gear and the flag
  keys ("Gear 3 · Cruise on · A/C on · ABS active · A/C request").

`gear` stays an enum rather than a dial, and the public beemuu.com demo keeps
its six core gauges.

Tier A. Suite: 436 pass / 0 fail.
```

---

## 4. The release cut (Tier C — yours; nothing here is applied)

### Why this is blocked on more than billing

The version surface is inconsistent and three documented releases were never
cut:

| Surface | Says | Note |
|---|---|---|
| `package.json` | 0.16.0 | |
| `src-tauri/tauri.conf.json` | 0.16.0 | |
| `src-tauri/Cargo.toml` | 0.16.0 | |
| `src-tauri/Cargo.lock` (own entry) | 0.16.0 | |
| `README.md` badge (line 18) | v0.16.0 | |
| `package-lock.json` | **0.5.1 / 0.6.0** | **duplicate `"version"` keys** (lines 3-4, 10-11) — malformed; never regenerated since v0.6.0 |
| `CHANGELOG.md` | sections up to **0.18.0** (dated 2026-09-03) | 0.16.1, 0.17.0 and 0.18.0 are documented as released |
| git tags | newest is **v0.16.0** | **no tag exists for 0.16.1, 0.17.0 or 0.18.0** |

So the changelog claims three releases that were never tagged or built, and the
lock file disagrees with `package.json`. Per the AGENTS.md release checklist,
the version surface must be brought into sync before a release PR.

### The edits (proposal — do not apply blind)

```diff
--- a/package.json
+++ b/package.json
@@
-  "version": "0.16.0",
+  "version": "0.19.0",

--- a/src-tauri/tauri.conf.json
+++ b/src-tauri/tauri.conf.json
@@
-  "version": "0.16.0",
+  "version": "0.19.0",

--- a/src-tauri/Cargo.toml
+++ b/src-tauri/Cargo.toml
@@
 name = "beeemuu"
-version = "0.16.0"
+version = "0.19.0"

--- a/src-tauri/Cargo.lock
+++ b/src-tauri/Cargo.lock
@@
 [[package]]
 name = "beeemuu"
-version = "0.16.0"
+version = "0.19.0"

--- a/README.md   (line 18)
+++ b/README.md
@@
-[![v0.16.0](https://img.shields.io/badge/release-v0.16.0-blue.svg)](CHANGELOG.md)
+[![v0.19.0](https://img.shields.io/badge/release-v0.19.0-blue.svg)](CHANGELOG.md)
```

**Regenerate the npm lock instead of hand-editing it** — it also removes the
duplicate keys:

```bash
cd ~/Desktop/beemuu && npm install --package-lock-only
```

**CHANGELOG:** rename the `## [Unreleased]` heading to the release heading, so
everything currently under Unreleased (this session's work plus the v0.19
slices) ships as 0.19.0:

```diff
-# ## [Unreleased]
+# ## [0.19.0] — <release date>
```

### Then, and only then

```bash
git tag -a v0.19.0 -m "v0.19.0"
git push origin v0.19.0        # release.yml builds the installers
```

`release.yml` creates the GitHub release as a **draft** — publish it after you
have checked the installer assets exist. That has been the failure mode since
Aug 30: releases exist with **zero assets**, and the last one that actually
shipped an installer is **v0.15.0 (2026-08-05)**.

### After the merge — what to spot-check

- CI green on `main` (needs the unlock first).
- `node --test "src/js/**/*.test.js" "src/js/**/*.test.cjs" "frontend/**/*.test.js"`
  → **440 tests, 0 fail**.
- `cd rust-harness && cargo test` → **104 pass** (no Tauri libs needed).
- `pytest backend/tests/ -q` → 219 passed.
- The installer release has `.exe` / `.msi` assets attached before you publish.
