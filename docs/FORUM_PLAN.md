# Forum & Config Sharing — Plan

**Status:** Decision document. No code yet.
**Author:** Repo planning (2026-07-11).
**Goal:** Decide where and how users post for help, share results, and
exchange diagnostic profiles — without bolting on a heavyweight platform
the project can't sustain.

## Constraints (read these first)

These come from the existing codebase and `community/README.md`. They
constrain the choice more than any feature wishlist:

1. **No new pip deps in the backend.** `backend/app.py` is stdlib-only
   (`http.server`, `sqlite3`). Adding FastAPI / Django / Discourse
   dependencies is a deliberate cost the project has refused so far.
2. **Offline-first, ship-via-PR.** `community/hunt/leaderboard.json`,
   `community/profiles/*.toml`, `community/oracle/*.json` are all
   static files committed to git. Users contribute via pull request,
   not via web form. The forum needs to fit this pattern or justify
   breaking it.
3. **Hosted dashboard already runs on the VPS.** `beemuu-prod-api.service`
   serves `/api/health`, `/api/stats`, `/api/landing-content` from
   stdlib Python. The forum's surface should be a vhost on the same
   box (or a service on a different port), not a new machine.
4. **AGPL-3.0.** Any third-party forum software we ship must be
   AGPL-compatible (so Discourse is fine; vanilla phpBB / MyBB / NodeBB
   need license review).

## What "share configs" already means

Most of it is built. See `community/README.md`:

- `community/profiles/*.toml` — engine-specific live-data parameter
  sets (N52, N54, N55, N62, B58 today). This *is* "share a config" for
  the live-data side: a user publishes a TOML, others drop it in and
  restart the app.
- `community/dtc_texts.toml` — fault-code description overlays.
- `community/freeze_schemas.toml` — freeze-frame byte layouts.
- `community/oracle/*.json` — DTC pattern fingerprints.
- `community/hunt/leaderboard.json`, `challenges.json` — gamified points
  ledger.

What's missing is **discovery and Q&A**: a user has a DTC, they want
to search "has anyone seen P0301 on N54 E92 with stage 2 tune?" and
read replies. That's the forum.

## Three options

### Option A — Static markdown on GitHub

**Mechanic:** A `community/forum/` folder with one `.md` per thread
(frontmatter for title, author, date, tags, related DIDs). Threads are
rendered by a small static site generator or by GitHub's own UI.
Search via `git grep` or a pre-built search index committed to the
repo.

| Axis | Verdict |
|---|---|
| Operational cost | **Zero.** No new infra, no DB, no service. |
| Auth model | GitHub account. Already required to file issues. |
| Spam resistance | Moderate — spam PRs get closed, but a wave of low-effort PRs is possible. |
| Search | Weak for >200 threads. Pre-built index helps. |
| Visibility | Mixed — discoverable in Google via `github.com/ohgeeceee/beemuu/...` but not a "real" forum UI. |
| Reply threading | Awkward on GitHub — issues work OK, but multi-author back-and-forth on a `.md` PR gets noisy. |
| Mobile UX | OK if rendered with a static-site template. |
| Time-to-first-thread | Immediate. `mkdir community/forum/threads/$(slug)` + PR. |

**Best when:** the community stays <500 threads and most contributors
are already filing issues.

### Option B — Lightweight FastAPI + SQLite forum on the VPS

**Mechanic:** A second systemd service (`beemuu-forum.service`) on
the VPS using FastAPI + SQLite (no Postgres, no Redis). Threads +
replies in a single SQLite file at `/var/www/beemuu/forum.db`.
Fronted by nginx on a subdomain (`forum.beemuu.com`) or path
(`/forum`). Accounts via GitHub OAuth (single-click, no password
storage on our side). Markdown rendering via Python stdlib + a
small whitelisted HTML sanitizer.

| Axis | Verdict |
|---|---|
| Operational cost | **Low.** ~50MB RAM, ~10MB disk. One service, one DB file, one nginx vhost. |
| Auth model | GitHub OAuth only. We never see a password. |
| Spam resistance | Good — GitHub OAuth means spam is at least rate-limited to GitHub account creation. |
| Search | Good — SQLite FTS5 is built in, no extra service. |
| Visibility | Strong — a real URL, indexed by Google, linkable from the landing page. |
| Reply threading | Excellent — proper nested replies, edit history, upvotes. |
| Mobile UX | Whatever we build. Likely very good. |
| Time-to-first-thread | ~2-3 weeks of focused build. Auth integration, thread UI, markdown rendering, moderation queue. |

**Best when:** the community grows past where GitHub PRs are comfortable
and the user wants a "real forum" experience with proper threading.

### Option C — Self-hosted Discourse

**Mechanic:** Run Discourse (Rails app, official Docker image) on the
VPS. Discourse handles auth (email, GitHub, Google), moderation,
threading, search, plugins, everything. AGPL-3.0, so license-compatible.

| Axis | Verdict |
|---|---|
| Operational cost | **High.** Discourse wants ≥2GB RAM minimum (4GB recommended), Postgres, Redis, SMTP relay for email confirmations. On a 2GB VPS this is uncomfortable; on the existing 1GB it's impossible without an upgrade. |
| Auth model | Email + GitHub + Google. |
| Spam resistance | Best-in-class (Discourse's whole brand is anti-spam). |
| Search | Excellent (Postgres full-text). |
| Visibility | Excellent — Discourse URLs are well-indexed. |
| Reply threading | Best in class. |
| Mobile UX | Excellent. |
| Time-to-first-thread | ~1 day to install. Then days-weeks to theme + integrate SSO. |

**Best when:** the community is large enough that "we need a real
forum product" is true. Beemuu's current contributor base (a few
hundred stars, ~150 DTC codes, single primary maintainer per memory)
does not seem to be there yet.

## Content model — "share a config"

Whichever forum option is chosen, the configs themselves should keep
the existing TOML / JSON shape and live in `community/`. The forum
should *link to* config files, not duplicate their storage.

A thread about a config looks like:

```markdown
---
title: "B48 stage 1 — boost curve and knock margins"
author: ohgeeceee
date: 2026-07-11
tags: [b48, stage-1, knock, boost]
config:
  path: community/profiles/b48_stage1.toml
  checksum: sha256:abc123...
related_dtcs: [P0301, P0420, P0171]
---

[body text, markdown, can include images and gists]

## Tune log

| run | boost_cmd | AFR | knock_ret | notes |
|-----|-----------|-----|-----------|-------|
| 1   | 14.5 psi  | 1.02| 0.0°      | clean |
| 2   | 15.0 psi  | 1.01| 0.4°      | one knock event at 4500 rpm |
```

This keeps the **content** in the forum and the **data** in the
existing `community/` git tree. A user reading the thread can `curl`
the linked TOML, verify its checksum, and use it offline. This is the
"share a config" half of the goal.

The other half — *"show me your actual log so we can see what's
happening"* — needs a log viewer. The repo already has
`src-tauri/src/session.rs` (Session Recorder per `AGENT_SPEC.md`) and
CSV export, so a future "attach a log to a thread" feature is
plausible but out of scope for this decision.

## Deployment decision

**Recommended:** Start with **Option A** (static markdown on GitHub).
Escalate to **Option B** (FastAPI + SQLite) when either:
- The repo crosses **~200 forum threads**, OR
- A single thread has **>20 replies** that need proper threading, OR
- Search starts being a real complaint in 3+ separate threads.

**Do not start with Option C** (Discourse). The VPS isn't sized for
it, and the community isn't sized for it. Revisit in 6 months.

### Why Option A first

1. **It reuses what already works.** The `community/` folder pattern
   is the project's most successful contribution channel (DTC texts,
   profiles, oracle fingerprints, hunt scores). Forum threads slot in
   next to them with zero new infra.
2. **It costs nothing.** No DB, no service, no backup story, no
   CVE-monitoring surface.
3. **It defers the auth decision.** FastAPI+OAuth is a real choice
   (GitHub? Google? email-only?) and there's no way to make it well
   without user feedback. Option A buys time.
4. **It doesn't paint us into a corner.** When we eventually move to
   Option B, we can write a one-time importer that walks
   `community/forum/threads/*.md` and seeds the SQLite tables. The
   data shape (title, author, date, body, tags) is the same.

### Concrete first step (Option A)

Add this to the repo:

```
community/forum/
├── README.md              # how to file a thread (template below)
├── threads/
│   └── <slug>.md          # one file per thread
└── index.json             # {threads: [{slug, title, author, date, tags, replies}]}
                            # updated by a script when a PR adds/changes threads
```

Thread template (`community/forum/README.md`):

````markdown
# Filing a thread

1. Fork the repo.
2. Copy `community/forum/threads/TEMPLATE.md` to
   `community/forum/threads/<your-slug>.md`.
3. Fill in the frontmatter and body. Markdown is fine, including
   images via GitHub raw URLs.
4. Run `python scripts/forum_index.py` to regenerate
   `community/forum/index.json`. (CI will run this and fail the PR
   if it's out of date.)
5. Open a PR titled `forum: <your-slug>`.

## Thread template

```markdown
---
title: "..."
author: <github-username>
date: YYYY-MM-DD
tags: [<comma-separated>]
related_dtcs: [<hex codes if any>]
config:
  path: community/profiles/...
  checksum: sha256:...
---

<your post>
```
````

### Anti-features (what we are NOT building)

- **No upvotes / karma / badges for forum posts.** The Parameter Hunt
  game already covers the "gamification" use case. Forum posts are
  for help and sharing, not status.
- **No private messages.** If it's worth saying, say it on a thread.
- **No email notifications.** Subscribers watch the repo.
- **No bot / AI replies.** Replies are from humans with cars.
- **No attachments larger than a markdown image.** Big logs and
  configs go in git, not in the forum.

## Open questions for the user

These are decisions only you can make. Once I know the answers, this
plan becomes a buildable backlog:

1. **GitHub-only contribution, or do you want a public web form
   someday?** Affects whether Option B is the right escalation
   target.
2. **Do you want to require GitHub account for posting** when/if we
   move to Option B? (Default yes — that's why OAuth via GitHub is in
   the spec.)
3. **Forum on `forum.beemuu.com` (subdomain) or `beemuu.com/forum`
   (path)?** Subdomain is cleaner for cookies, CORS, and future
   de-coupling. Path is simpler DNS-wise (no new A record) but
   couples forum lifetime to landing-page lifetime.
4. **Moderation model.** For Option A today: just PR review by
   maintainers. For Option B later: do you want a moderator role
   separate from the GitHub owner, or stay single-maintainer?

## What this plan does NOT cover

- **Config format versioning.** When someone publishes a
  `b48_stage1.toml` and the profile schema changes, do we version
  them, deprecate old ones, or just live with breakage? Out of scope
  for the forum decision, but a real follow-up.
- **Log viewer.** Mentioned above; needs a separate plan.
- **Migration to a real DB.** If/when we move to Option B, we need
  the importer + cutover plan. Documented in §"Why Option A first".
- **Spam at scale.** Even Option A will see some. A
  `community/forum/MODERATION.md` is a separate doc.

---

*Last updated: 2026-07-11. Open a PR to suggest changes.*