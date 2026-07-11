# feat(forum): community/forum scaffolding (Option A)

Implements the static-markdown forum option recommended in
`docs/FORUM_PLAN.md`.

## What ships

| File | Purpose |
|---|---|
| `community/forum/README.md` | How to file / reply to threads (git-PR workflow) |
| `community/forum/threads/TEMPLATE.md` | Copy-paste template for new threads |
| `community/forum/threads/welcome.md` | Seed thread (so README has something to point at) |
| `community/forum/index.json` | Auto-generated index, do not edit by hand |
| `scripts/forum_index.py` | Regenerates `index.json` from `threads/*.md` |
| `.github/workflows/build.yml` | New CI step: fail if `index.json` is stale |

## Forum model (per FORUM_PLAN.md)

- Threads are markdown files in `community/forum/threads/`.
- Frontmatter is YAML-style (title, author, date, tags, related_dtcs,
  config_path, config_checksum). Parsed by Python's stdlib `tomllib`
  via a minimal `:` → `=` conversion in `forum_index.py` — keeps
  the project stdlib-only (no PyYAML dep).
- Each thread has one `## Replies` section; replies are appended
  in chronological order using `> **<handle> at <date>:** <body>`
  prefix. The git log is the timeline.
- The index sorts threads by `last_modified` desc.
- Config sharing: link to existing `community/` files by path +
  sha256 checksum. Don't paste configs inline.

## Anti-features (per FORUM_PLAN.md)

- No upvotes / karma / badges (Parameter Hunt covers gamification).
- No private messages.
- No email notifications.
- No bot / AI replies.
- No attachments > a markdown image.

## How I verified it

```
$ python scripts/forum_index.py
index.json already up to date (1 threads)     # idempotent, no diff

$ python scripts/forum_index.py
index.json already up to date (1 threads)     # 2nd run still clean

$ git diff community/forum/index.json
                                          # empty diff confirmed

$ python -c "import yaml; yaml.safe_load(open('.github/workflows/build.yml'))"
                                          # YAML parse OK

$ python -c "import ast; ast.parse(open('scripts/forum_index.py').read())"
                                          # AST parse OK

$ cargo test --lib
test result: ok. 25 passed; 0 failed; 0 ignored
                                          # no regressions in decode work from PR #34
```

The CI step on this PR will be the **first real-world run** of the
new forum-index job. If `index.json` is committed and matches what
`scripts/forum_index.py` would generate, CI passes. If a contributor
forgets to run the script, CI fails with a clear `::error::` and
the diff so they can fix and re-push.

## Protected paths

None. This PR touches:
- `community/forum/**` (new files, doc-only)
- `scripts/forum_index.py` (new, Python)
- `.github/workflows/build.yml` (CI YAML)

No Rust code, no `src-tauri/src/protocol/**`, no
`src-tauri/src/transport/**`, no `bmw_diag/core/**`, no
`src-tauri/src/commands.rs`.

## Open questions deferred to FORUM_PLAN.md

The four "Open questions for the user" in `docs/FORUM_PLAN.md`
(subdomain vs. path, auth model, moderation, future web form) are
intentionally **not decided here**. They only matter when we
escalate from Option A → Option B (FastAPI + SQLite). Option A
needs none of them. Per CLAUDE.md "smallest change that satisfies
the task."

---

*Per CLAUDE.md: requesting human review. Doc-only PR with one
trivial Python script — could auto-merge, but flagging because
the new CI step is a behavioral change for any future PR that
touches `community/forum/threads/`.*