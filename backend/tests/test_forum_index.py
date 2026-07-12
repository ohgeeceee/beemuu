"""Tests for scripts/forum_index.py.

These tests import the script as a module and exercise the parts
that previously caused spurious CI diffs (file-mtime-based
`last_modified` field that varied across OS / checkout style).
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "forum_index.py"


@pytest.fixture(scope="module")
def forum_index():
    """Load scripts/forum_index.py as a module without executing main()."""
    spec = importlib.util.spec_from_file_location("forum_index", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def _make_git_repo(tmp: Path) -> Path:
    """Create a tiny git repo with one committed thread file.

    Returns the repo root path. The thread file's mtime is set to
    `2099-01-15 12:00:00` BEFORE `git add && git commit`, so the
    mtime differs from the commit timestamp. This isolates the test
    from filesystem behavior — only the commit time matters.
    """
    repo = tmp / "repo"
    repo.mkdir()
    threads_dir = repo / "community" / "forum" / "threads"
    threads_dir.mkdir(parents=True)
    (threads_dir / "TEMPLATE.md").write_text(
        "---\ntitle: TEMPLATE\nauthor: x\n---\n", encoding="utf-8"
    )
    thread = threads_dir / "welcome.md"
    thread.write_text(
        "---\n"
        "title: \"Welcome\"\n"
        "author: tester\n"
        "date: 2026-07-11\n"
        "tags: [meta]\n"
        "related_dtcs: []\n"
        "---\n"
        "\n# Welcome\n\nbody\n",
        encoding="utf-8",
    )

    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(
        ["git", "config", "user.email", "t@e"], cwd=repo, check=True
    )
    subprocess.run(["git", "config", "user.name", "t"], cwd=repo, check=True)
    # Set a known commit timestamp; mtime of the file is independent
    # and we leave it at "now" — that's how a Linux checkout behaves.
    fixed_commit_time = "2026-07-11 18:58:39 +0000"
    env = os.environ.copy()
    env["GIT_AUTHOR_DATE"] = fixed_commit_time
    env["GIT_COMMITTER_DATE"] = fixed_commit_time
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True, env=env)
    subprocess.run(
        ["git", "commit", "-q", "-m", "init"],
        cwd=repo,
        check=True,
        env=env,
    )
    # Now bork the file's mtime to a wildly different date. With the
    # old mtime-based logic this would change `last_modified`; with
    # the git-based logic it must not.
    borked = time.mktime(time.strptime("2099-01-15 12:00:00", "%Y-%m-%d %H:%M:%S"))
    os.utime(thread, (borked, borked))
    return repo


def test_last_modified_uses_git_not_mtime(forum_index, tmp_path):
    """Regression: `last_modified` must come from git, not st_mtime.

    The old code used `path.stat().st_mtime`, which on the CI runner
    (Ubuntu) gets set to "checkout time" and differs from Windows
    checkout mtime, causing the generated index.json to diff vs the
    committed version. Fix is to read the commit timestamp via
    `git log -1 --format=%cI`.
    """
    repo = _make_git_repo(tmp_path)
    thread = repo / "community" / "forum" / "threads" / "welcome.md"

    date = forum_index._git_last_commit_date(repo, thread)
    assert date == "2026-07-11", (
        f"expected git commit date 2026-07-11, got {date!r}; "
        f"the helper is reading from filesystem mtime, not git"
    )


def test_regenerated_index_is_byte_stable_under_mtime_change(forum_index, tmp_path, monkeypatch):
    """End-to-end: regenerating index.json twice with a different
    file mtime in between must produce identical output. This is the
    property CI needs (the runner checks out files with a different
    mtime than Windows).
    """
    repo = _make_git_repo(tmp_path)
    threads_dir = repo / "community" / "forum" / "threads"
    index_path = repo / "community" / "forum" / "index.json"

    # Monkey-patch the module's resolved paths so the script operates
    # on the throwaway test repo, not the real one.
    monkeypatch.setattr(forum_index, "ROOT", repo)
    monkeypatch.setattr(forum_index, "THREADS_DIR", threads_dir)
    monkeypatch.setattr(forum_index, "INDEX_PATH", index_path)
    monkeypatch.setattr(forum_index, "TEMPLATE_PATH", threads_dir / "TEMPLATE.md")

    # First generation
    rc = forum_index.main()
    assert rc == 0
    first = index_path.read_bytes()

    # Force a wildly different mtime on the thread file
    borked = time.mktime(time.strptime("1985-06-03 09:00:00", "%Y-%m-%d %H:%M:%S"))
    os.utime(threads_dir / "welcome.md", (borked, borked))

    # Second generation — must produce identical bytes
    rc = forum_index.main()
    assert rc == 0
    second = index_path.read_bytes()

    assert first == second, (
        "regenerating index.json with a different filesystem mtime "
        "must not change its content — this is the cross-platform "
        "determinism CI depends on"
    )


def test_git_last_commit_date_falls_back_to_mtime(forum_index, tmp_path):
    """If git is unavailable or the file isn't in the index, fall back
    to filesystem mtime. The fallback is less deterministic than the
    git path (the mtime depends on checkout behavior) but still
    correct on a single host, and lets the script work outside a
    git checkout, e.g. during initial scaffolding.
    """
    fake_file = tmp_path / "nope.md"
    fake_file.write_text("x", encoding="utf-8")
    # The file is in /tmp, which is not a git repo. The helper should
    # fall through to the mtime path.
    date = forum_index._git_last_commit_date(tmp_path, fake_file)
    today = time.strftime("%Y-%m-%d")
    assert date == today, (
        f"expected fallback to mtime (today={today}), got {date!r}"
    )


def test_handles_unusual_git_output_gracefully(forum_index, tmp_path, monkeypatch):
    """Regression: the helper must not depend on `datetime.fromisoformat`
    parsing git's full ISO output. Older git versions and some Python
    versions disagree on what counts as strict ISO 8601. The fix is
    to extract just the YYYY-MM-DD prefix and let the rest fall on
    the floor. This test simulates git returning garbage / non-strict
    output and asserts the helper still returns a sane date.
    """
    # Monkeypatch subprocess.run to return a non-strict ISO timestamp
    import subprocess
    def fake_run(*args, **kwargs):
        r = subprocess.CompletedProcess(
            args=args[0] if args else kwargs.get('args', []),
            returncode=0,
            stdout="2026-07-11 11:59:32 -0700\n",   # space, not T
            stderr="",
        )
        return r
    monkeypatch.setattr(subprocess, "run", fake_run)

    fake_file = tmp_path / "welcome.md"
    fake_file.write_text("x", encoding="utf-8")
    date = forum_index._git_last_commit_date(tmp_path, fake_file)
    assert date == "2026-07-11", (
        f"expected to extract YYYY-MM-DD prefix from non-strict ISO "
        f"output, got {date!r}"
    )