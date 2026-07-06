# BeeEmUu Open Source Maintenance Guide

How to keep BeeEmUu alive, growing, and welcoming — without burning out.

---

## 1. Repository Hygiene (do this first)

| Task | Cadence | Why it matters |
|------|---------|-------------|
| `git pull` before you start | Every session | Avoids merge conflicts |
| Commit message style | Every commit | `area: imperative description` — e.g. `community: add N20 DID 4506` |
| One logical change per commit | Every commit | Makes `git bisect` and `git revert` useful |
| Tag releases | Every release | `git tag -a v0.2.0 -m "Add Parameter Explorer, N55 profile"` |
| Push tags | After tagging | `git push origin --tags` |
| Delete stale branches | Monthly | `git branch --merged | xargs git branch -d` |

### Commit message template
```
<area>: <short imperative description>

<body: what changed and why.>

<footer: fixes #123, co-authored-by, etc.>
```

**Areas:** `app`, `backend`, `community`, `docs`, `research`, `ui`, `transport`, `release`

---

## 2. Staying Updated as a Project (the strategy)

### A. Make the repo the single source of truth
- All discussion that needs to be searchable happens in **GitHub Issues**, not DMs.
- Use **GitHub Projects** (or a simple `TODO.md` in the repo) for the roadmap so outsiders can see what's coming.
- Pin a `good first issue` label for newcomers.

### B. Automate the boring stuff
| Automation | Tool | Benefit |
|-----------|------|---------|
| Dependabot alerts | Built-in | Security patches for Rust crates + npm deps |
| CI builds | GitHub Actions | Every PR gets compiled + linted on Windows + Linux |
| Release binaries | GitHub Actions | Push a tag → draft release with `.msi` / `.deb` appears |
| PR templates | `.github/pull_request_template.md` | Contributors explain *what* and *why* |
| Issue templates | `.github/ISSUE_TEMPLATE/` | Bug reports include OS, firmware, cable type |

### C. Documentation that lives with the code
- `README.md` — the elevator pitch; keep it under 300 lines.
- `docs/ARCHITECTURE.md` — how the pieces fit (Tauri ↔ Rust ↔ JS).
- `docs/CONTRIBUTING.md` — how to build, test, and submit a PR.
- `docs/HARDWARE.md` — tested cables, baud quirks, firmware versions.
- `community/README.md` — how to add a new engine profile without coding.

**Rule:** If a user asks you a question twice, the answer becomes a doc.

### D. Community data workflow (your biggest asset)
BeeEmUu's value is the community TOML files. Protect that:

```
Contributor finds a DID on their car
        ↓
Opens GitHub Issue with: ECU, DID, raw bytes, expected value, source
        ↓
Maintainer (or trusted contributor) validates against 2+ sources
        ↓
Add to community/ with confidence label [community | verified | OBDb]
        ↓
Credit contributor in commit message
```

**Never merge proprietary BMW data.** If someone posts ISTA screenshots, thank them and ask for an independent source (OBDb, forum logs, their own CAN dumps).

---

## 3. The Release Rhythm

| Phase | Owner | Frequency |
|-------|-------|-----------|
| **Nightly** | CI | `main` always compiles; no manual work |
| **Beta** | You | When a feature is done but needs real-car testing; tag `v0.x.0-beta.1` |
| **Stable** | You | When beta has been tested on ≥2 real cars; write release notes |

### Release checklist
- [ ] `CHANGELOG.md` updated
- [ ] Version bumped in `Cargo.toml` + `package.json`
- [ ] `git tag -a vX.Y.Z`
- [ ] CI produces signed binaries
- [ ] GitHub Release drafted with notes + assets
- [ ] Post to forums (see `forum_post.md`)
- [ ] Close milestone if using GitHub Projects

---

## 4. Growing Contributors Without Losing Control

### The funnel
1. **User** — downloads release, files an issue
2. **Reporter** — provides logs, screenshots, real-car data
3. **Contributor** — opens a PR with a TOML profile or docs fix
4. **Maintainer** — can merge, tag releases, manage the roadmap

### How to move people up the funnel
- **Respond to issues within 48 hours** — even if it's just "Thanks, will test this weekend."
- **Label issues:** `good first issue`, `help wanted`, `needs real-car test`, `data needed`
- **Public credit:** `CONTRIBUTORS.md` or release notes naming who found a DID or fixed a bug
- **Discord/Forum bridge:** One channel where you hang out; don't fragment across 5 platforms

### Code review rules (keep quality high)
- Every PR needs **one approval** from a maintainer.
- **No force-push to `main`.** Use PRs for everything, even your own changes.
- **Tests:** If it's testable in the simulator, it needs a test. If it's real-car-only, it needs a `#[ignore]` test or a manual checklist in the PR.
- **Security:** Any change to `SecurityAccess` (0x27) or transport layer gets extra scrutiny.

---

## 5. Legal / License Hygiene

- **GPL-3.0** means anyone who distributes binaries must provide source. Keep `LICENSE` in the root.
- **Community data** (`community/`, `research/`) should be marked clearly as derived from OBDb (CC-BY-SA) or forum posts. A `SOURCES.md` in `community/` covers you.
- **No proprietary data:** If someone PRs data that smells like ISTA (exact fault-text wording, internal BMW DID numbers), ask for a community source. Reject if they can't provide one.
- **Trademark:** Keep the disclaimer that "BMW" and "ISTA" are trademarks of BMW AG. Don't use BMW logos.

---

## 6. Quick Command Reference

```bash
# Daily workflow
cd beeemuu
git pull origin main          # sync before you start
# ... edit ...
git add -p                    # review every hunk
git commit
git push origin main

# Release workflow
git checkout main
git pull origin main
# bump version in Cargo.toml + package.json
git add Cargo.toml package.json CHANGELOG.md
git commit -m "release: v0.2.0"
git tag -a v0.2.0 -m "Release v0.2.0 — Parameter Explorer, N55 UDS DIDs"
git push origin main --follow-tags

# Hotfix (never commit directly to main — use PRs)
git checkout -b hotfix/coolant-did
git commit -m "community: fix N55 coolant DID decode"
git push origin hotfix/coolant-did
# open PR, review, merge, tag
```

---

## 7. When Things Break

| Problem | Fix |
|---------|-----|
| Merge conflict on `main` | `git checkout main && git pull && git checkout - && git rebase main` |
| Pushed a secret | Rotate it immediately; use `git-filter-repo` to rewrite history |
| Contributor posts proprietary data | Revert the commit; explain the policy gently; offer to help re-derive from open sources |
| Burnout / no time | Set `main` to protected branch; write a `STATUS.md` explaining the pause; the community can fork and PR |

---

## 8. Forum / Social Rhythm

Post updates when you release, not when you commit. See `forum_post.md` for a template.

**Platforms to watch:**
- BimmerPost (E-series + F-series) — biggest English BMW forum
- BimmerFest — strong DIY community, loves open-source tools
- SpoolStreet — N54/N55 turbo crowd, appreciates real data
- r/BMW + r/cars — reach audience, but keep it non-technical
- GitHub Discussions — for deep technical threads that need permanence

---

*This is a living document. PRs welcome.*
