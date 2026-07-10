# Continuous AI agents on Beemuu (GitHub Actions)

This repo is wired for AI agents that keep working on the codebase via GitHub
Actions. Agents run on GitHub's runners, always produce **pull requests** (never
push to `main`), and only **doc-only** PRs are auto-merged. Everything that
touches code — especially the hardware transport/protocol layers — waits for you.

## What's installed

| Workflow | Trigger | What the agent does |
|---|---|---|
| `.github/workflows/claude.yml` | You write `@claude` in an issue / PR comment / review | On-demand help: answer, implement, fix. Human always in the loop. |
| `.github/workflows/claude-review.yml` | Every PR opened / updated | Autonomous review against the invariants in `CLAUDE.md`. Comments only. |
| `.github/workflows/claude-implement-issue.yml` | Add the `agent-ready` label to an issue | Implements the issue on a branch and opens a PR. |
| `.github/workflows/claude-auto-merge.yml` | Every PR | Auto-merges **doc-only** PRs after checks pass; leaves code PRs for you. |
| `CLAUDE.md` | (read by every agent) | The hardware/timing guardrails all agents must obey. |

The pipeline for a backlog item: label issue `agent-ready` → agent opens a PR →
`claude-review.yml` reviews it → your CI (`build.yml`) runs → you merge (or, if
doc-only, it auto-merges).

## One-time setup

1. **Install the Claude GitHub App** on `ohgeeceee/beemuu`:
   run `/install-github-app` inside Claude Code, or install manually from
   <https://github.com/apps/claude>. It needs Contents, Issues, and Pull requests
   (read & write).

2. **Add your API key as a secret.** Repo → Settings → Secrets and variables →
   Actions → New repository secret:
   - Name: `ANTHROPIC_API_KEY`
   - Value: your key from <https://console.anthropic.com>

   (Pro/Max alternative: run `claude setup-token` locally and store it as
   `CLAUDE_CODE_OAUTH_TOKEN`, then swap the `anthropic_api_key:` line in the
   workflows for `claude_code_oauth_token:`.)

3. **Create the `agent-ready` label.** Repo → Issues → Labels → New label →
   name it `agent-ready`.

4. **Enable auto-merge + branch protection** (this is what makes auto-merge safe):
   - Settings → General → Pull Requests → check **Allow auto-merge**.
   - Settings → Branches → add a rule for `main`:
     - Require a pull request before merging.
     - Require status checks to pass, and mark your CI job(s) from `build.yml`
       (e.g. `frontend`, and the Rust build) as **required**.
     - Optionally require 1 approval — then even doc auto-merge waits for a
       thumbs-up.

   Without branch protection, `--auto` has nothing to wait on, so keep this step.

## How you'll actually use it day to day

- **Delegate a task:** open an issue describing it, add `agent-ready`. Come back
  to a PR.
- **Ask a question / request a fix on a PR:** comment `@claude ...`.
- **Let it grind a backlog:** label several issues `agent-ready`; each becomes its
  own PR. Review and merge at your pace.
- **Docs cleanups take care of themselves:** a README/docs PR merges once CI is
  green.

## Safety model (why this won't flash your car by surprise)

- Agents never run on your machine and never touch a real OBD interface — they run
  in GitHub's sandbox on the repo only.
- Agents never push to `main` and never merge code.
- `CLAUDE.md` encodes the timing invariants (async commands, Tester Present
  keep-alive, protocol/UI decoupling, no hardcoded IPs, FTDI latency timer, VIN
  fallback). Both the implementer and reviewer agents are told to obey and enforce
  them.
- Auto-merge is an allowlist: only `*.md`, `*.txt`, `docs/**`, `LICENSE`, and
  images. Any change under `src-tauri/`, `bmw_diag/`, or `src/` is excluded by
  construction.

## Tuning

- **Cost / runaway control:** each workflow has `timeout-minutes` and
  `--max-turns`. Lower them to spend less; raise for bigger tasks.
- **Model:** add `--model claude-sonnet-5` (cheaper/faster) or `--model opus`
  to any `claude_args:` block.
- **Broaden auto-merge:** if you later want test-only PRs to auto-merge, note that
  Rust tests are inline in source files, so isolating them is hard — safer to keep
  the doc-only allowlist and merge code PRs yourself.
- **Turn a piece off:** delete or rename its workflow file.

## Beyond GitHub Actions

Actions is event-driven (fires on issues/PRs/pushes). If you later want a
truly continuous overnight loop, run Claude Code headless (`claude -p`) on a
machine or VPS, driving it from a queue (a `TASKS.md` or the `agent-ready` issue
list), each task in its own git worktree opening a PR. The same `CLAUDE.md`
guardrails apply there unchanged.
