# Landing + release — v0.19.0

> **Scratchpad branch.** Read this file, use it, then close the branch without
> merging it. Nothing in it runs.

## State: one branch, ready to merge

`release/v0.19.0` contains everything — the greened suite, the data-path and UI
fixes, the CI-gate fix, the plugins recovery, the Rust harness, the ENET/HSFZ
transport work (including the two experimental commits), the beemuu.com
public-site fixes, and the release prep. There is nothing split out and nothing
held back.

**Verified on that branch (not on the parts):**

| Check | Result |
|---|---|
| JS suite | **446 tests, 0 fail** (1 skipped) |
| Python backend | **219 passed** |
| Rust harness (`rust-harness`) | **104 passed** |
| Plugin browser suite (headless Chromium, shipping CSP) | **PASS** |
| Pages artifact (`scripts/test-github-pages-build.cjs`) | **PASS** — 338 local references, all assets resolve |
| Public-site sweep (headless Chromium, 22 pages) | **0 failed requests, 0 console errors** |
| Internal link check (every link on every page, resolved) | 48 links checked, 20 resolving, **28 broken — all 28 are the content backlog below** |

**Release surface already synced** (it was inconsistent — see below):

- `0.19.0` in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
  the `Cargo.lock` own entry, and the README release badge.
- `package-lock.json`: the two duplicated `"version"` keys are gone and it now
  agrees with `package.json`. The dependency tree is untouched, so the diff is
  6 files / +7 / −9.
- `CHANGELOG.md`: `[Unreleased]` is cut as `## [0.19.0] — 2026-09-16`.

## What's left, and it needs your machine

I have no GitHub credentials in the environment I run in — verified by
attempting the push, not assumed:

    fatal: could not read Username for 'https://github.com'

**1. Unlock GitHub Actions (billing).** Every workflow fails in ~3 s with
`steps=0, runner=(none)`; the check-run annotation reads *"The job was not
started because your account is locked due to a billing issue."* Confirmed still
active on the 2026-09-16 01:21 runs of `main`. Fix at Settings → Billing.
Without it: no CI can go green, and `release.yml` cannot build an installer.

**2. Push the branch.**

    cd ~/Desktop/beemuu
    git push -u origin release/v0.19.0

**3. Open the PR and merge it.** Body to paste:

```
Lands the v0.19.0 work as one reviewed merge, with the changelog sections and
the version surface already brought into sync.

Fixes: the JS suite was red on main (invalid dtc_texts.toml, the v0.19 CAN
decoders that were never registered in DECODERS, public-site simulator drift,
a stale contradictory test, a stray `tauri` npm dependency) — closes #268.
Three Live Gauges dials that never moved, plus the decoded keys and boolean
flags the cache was dropping, plus a data-surface guard test. Six more dials
and a gear/flag status readout, now also on the K+DCAN DID path (labels were
being discarded). The K+DCAN vehicle-speed dial. The CI job that gates
auto-merge now runs the full suite instead of a subset. The Plugins tab can
recover from corrupt storage. ENET/HSFZ gateway rejections now name their
cause instead of timing out silently (issue #248), with a test harness doc.

Adds rust-harness/, which runs ~104 non-Tauri Rust tests with plain cargo —
deliberate, since CI is blocked.

Also fixes beemuu.com, which was shipping broken: 16 pages linked /guide.css,
a stylesheet that has never existed in the repository, and carry no inline
styles — so the FAQ, glossary, protocols, hardware, community, press, OEM,
verify, schematics, tools, roadmap and engine pages rendered as unstyled HTML.
404.html had the same problem with /landing.css. Both stylesheets now exist.
The shared header nav had three of four items dead on all 21 pages (K+DCAN,
ENET, Fault codes), and the site linked 43 targets that do not exist; 215 links
now point at pages that exist, and the Pages build fails on a missing asset so
this class of bug cannot ship again.

Verified on this branch: JS 446 tests / 0 fail, pytest 219 passed,
rust-harness 104 passed, plugin browser suite PASS, Pages artifact PASS,
22-page browser sweep with 0 failed requests and 0 console errors.
```

**4. Tag the release** — this is the step that actually builds installers:

    git tag -a v0.19.0 -m "v0.19.0"
    git push origin v0.19.0

`release.yml` creates the GitHub release as a **draft**. Publish it only once
the `.exe` / `.msi` assets are attached — the failure mode since 2026-08-30 has
been releases with **zero assets**. The last release that shipped an installer
is **v0.15.0 (2026-08-05)**, which is why the F36 tester has had nothing new to
try.

## Site content backlog (a content decision, not a code one)

The remaining 28 broken links on beemuu.com are links to pages that were never
written. They are per-record pages — one page per fault code, one per engine —
so retargeting them would produce self-links on the pages that list them, and
writing them means generating content. I left them alone deliberately. The
Pages build reports the count on every run.

    /dtc/  and  /dtc/<code>.html   (29 codes linked: 29E0, 29E1, 29E2, 2A82,
                                    2A99, 30FF, P0171, P0300, P0301, P0306,
                                    P0420, U0100, 120308, by-engine/n54, ...)
    /engines.html  and  /engines/<engine>.html   (n54, n55, n52, n57, n62,
                                    n20, b48, b58, s55, s58, compare)

Both are data the repo already has: `community/dtc_texts.toml` carries the code
texts and the vehicle profiles carry the engine parameter sets. A generator
that renders one page per record from that data — the same shape as
`scripts/build-github-pages.cjs` — would close all 28 links at once. That is a
build, not copy-writing, and it is the single biggest remaining piece of the
public site.

## Notes

- **The two experimental ENET commits are included**: the `ALIVE_CHECK`
  wake-up and the `0xF4`→`0xF5` tester-address retry. Neither is verified on
  hardware. Each is its own commit, so `git revert` on either one is clean if
  the F36 result says to drop it.
- **Why the version surface mattered**: `CHANGELOG.md` documents 0.16.1, 0.17.0
  and 0.18.0 as released, but no tags exist for any of them and the version
  files all still said 0.16.0, with `package-lock.json` malformed at 0.6.0.
  Three documented releases were never actually cut.
- **Cleanup after merging** (optional — every one of these is fully contained
  in `release/v0.19.0`, so nothing is lost): the per-fix branches
  `fix/v0.19-green-suite`, `fix/live-gauges-data-path`,
  `fix/live-gauges-panel-exposure`, `fix/ci-full-js-suite`,
  `fix/did-bridge-speed-mapping`, `fix/plugins-storage-recovery`,
  `fix/rust-verification-harness`, `fix/248-enet-zgw-diagnostics`,
  `fix/248-enet-hsfz-wakeup-retry`.

    for b in fix/v0.19-green-suite fix/live-gauges-data-path fix/live-gauges-panel-exposure fix/ci-full-js-suite fix/did-bridge-speed-mapping fix/plugins-storage-recovery fix/rust-verification-harness fix/248-enet-zgw-diagnostics fix/248-enet-hsfz-wakeup-retry; do git branch -D "$b"; done

- **Spot-check after the merge**: JS 446 / 0 fail, `cd rust-harness && cargo test`
  104 pass, `pytest backend/tests/ -q` 219 passed, `node scripts/test-github-pages-build.cjs`
  passes, and installer assets present on the draft release before publishing it.
