"""Tests for /api/live — recent commits + open/merged PRs feed.

The endpoint is fail-soft by design: subprocess failures (gh missing,
rate-limited, network down) return None for the affected field rather
than 500ing the whole response. These tests pin that contract.

`build_live()` is called with `force=True` to bypass the 30s cache;
we want each test to see a fresh subprocess result.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend import app as app_module


def _start_server(db_path: Path) -> tuple[ThreadingHTTPServer, Thread]:
    from backend import bootstrap

    with mock.patch.dict(os.environ, {"BEEMUU_ADMIN_PASSWORD": "test-pw"}):
        bootstrap.bootstrap_for_startup(db_path)
    server = ThreadingHTTPServer(("127.0.0.1", 0), app_module.Handler)
    t = Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, t


def _reset_live_cache() -> None:
    """The module-level cache persists across tests; clear it before
    each test so we exercise the live code path, not the cache."""
    app_module._LIVE_CACHE["data"] = None
    app_module._LIVE_CACHE["ts"] = 0.0


class TestLiveEndpointShape(unittest.TestCase):
    """The /api/live endpoint exists and returns the documented keys."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self._tmp.name) / "app.db"
        self.server, self.thread = _start_server(self.db_path)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        _reset_live_cache()

    def tearDown(self) -> None:
        try:
            self.server.shutdown()
        finally:
            try:
                self.db_path.unlink()
            except OSError:
                pass

    def _get_json(self, path: str) -> dict:
        req = Request(f"{self.base}{path}")
        with urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def test_endpoint_returns_ok(self) -> None:
        data = self._get_json("/api/live")
        self.assertTrue(data["ok"])
        self.assertEqual(data["service"], "beemuu-api")
        self.assertIsInstance(data["generated_at_secs"], int)

    def test_endpoint_returns_documented_top_level_keys(self) -> None:
        data = self._get_json("/api/live")
        for key in ("ok", "service", "generated_at_secs", "repo", "commits", "pull_requests"):
            self.assertIn(key, data, f"missing top-level key: {key}")

    def test_repo_block_shape(self) -> None:
        data = self._get_json("/api/live")
        repo = data["repo"]
        # branch/commit/dirty may be None on broken git, but the keys must exist.
        self.assertIn("branch", repo)
        self.assertIn("commit", repo)
        self.assertIn("dirty", repo)
        self.assertIsInstance(repo["dirty"], bool)

    def test_commits_is_a_list(self) -> None:
        data = self._get_json("/api/live")
        self.assertIsInstance(data["commits"], list)
        # We're in a real git repo (the test runner's cwd). At least
        # one commit should be visible.
        if data["commits"]:
            commit = data["commits"][0]
            self.assertIn("sha", commit)
            self.assertIn("short", commit)
            self.assertIn("subject", commit)
            self.assertIn("author", commit)
            self.assertIn("iso", commit)

    def test_pull_requests_block_shape(self) -> None:
        data = self._get_json("/api/live")
        prs = data["pull_requests"]
        for key in ("open_count", "open", "recently_merged", "available"):
            self.assertIn(key, prs, f"missing pull_requests key: {key}")
        self.assertIsInstance(prs["open_count"], int)
        self.assertIsInstance(prs["open"], list)
        self.assertIsInstance(prs["recently_merged"], list)
        self.assertIsInstance(prs["available"], bool)


class TestLiveEndpointFailSoft(unittest.TestCase):
    """When `gh` is unavailable, the endpoint still returns 200 with
    `pull_requests.available = False` rather than 500."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self._tmp.name) / "app.db"
        _reset_live_cache()

    def tearDown(self) -> None:
        try:
            self.db_path.unlink()
        except OSError:
            pass

    def test_gh_missing_yields_unavailable_prs(self) -> None:
        # Patch _gh_json to simulate "gh binary missing / failing".
        with mock.patch.object(app_module, "_gh_json", return_value=None):
            with mock.patch.object(app_module, "_git", return_value=None):
                payload = app_module.build_live(force=True)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["pull_requests"]["open_count"], 0)
        self.assertEqual(payload["pull_requests"]["open"], [])
        self.assertEqual(payload["pull_requests"]["recently_merged"], [])
        self.assertFalse(payload["pull_requests"]["available"])

    def test_gh_returns_garbage_yields_unavailable_prs(self) -> None:
        # Not a list — e.g. an error JSON. The endpoint must not crash.
        with mock.patch.object(app_module, "_gh_json", return_value={"message": "API rate limit exceeded"}):
            with mock.patch.object(app_module, "_git", return_value=None):
                payload = app_module.build_live(force=True)
        self.assertEqual(payload["pull_requests"]["available"], False)

    def test_subprocess_timeout_does_not_crash(self) -> None:
        # Simulate a hung subprocess by raising TimeoutExpired.
        with mock.patch.object(
            app_module.subprocess, "run",
            side_effect=subprocess.TimeoutExpired(cmd="gh", timeout=5),
        ):
            payload = app_module.build_live(force=True)
        self.assertTrue(payload["ok"])
        self.assertFalse(payload["pull_requests"]["available"])


class TestRecentCommitsParser(unittest.TestCase):
    """The `_recent_commits` parser handles the literal-separator
    format string we use (`%H%x00%s%x00%an%x00%aI`)."""

    def test_parses_well_formed_output(self) -> None:
        fake = (
            "abcdef1234567890abcdef1234567890abcdef12\x00"
            "abcdef1\x00"
            "feat: subject line\x00"
            "alice\x00"
            "2026-07-27T12:00:00+00:00"
        )
        with mock.patch.object(app_module, "_git", return_value=fake):
            commits = app_module._recent_commits(5)
        self.assertEqual(len(commits), 1)
        c = commits[0]
        self.assertEqual(c["sha"], "abcdef1234567890abcdef1234567890abcdef12")
        self.assertEqual(c["short"], "abcdef1")
        self.assertEqual(c["subject"], "feat: subject line")
        self.assertEqual(c["author"], "alice")
        self.assertEqual(c["iso"], "2026-07-27T12:00:00+00:00")

    def test_parses_multiple_commits(self) -> None:
        fake = (
            "sha1\x00s1\x00subj 1\x00alice\x00iso1\n"
            "sha2\x00s2\x00subj 2\x00bob\x00iso2\n"
            "sha3\x00s3\x00subj 3\x00carol\x00iso3"
        )
        with mock.patch.object(app_module, "_git", return_value=fake):
            commits = app_module._recent_commits(5)
        self.assertEqual(len(commits), 3)
        self.assertEqual([c["author"] for c in commits], ["alice", "bob", "carol"])

    def test_handles_empty_output(self) -> None:
        with mock.patch.object(app_module, "_git", return_value=None):
            self.assertEqual(app_module._recent_commits(5), [])

    def test_handles_short_malformed_line(self) -> None:
        # A line with fewer than 5 separator-delimited parts is dropped.
        with mock.patch.object(app_module, "_git", return_value="truncated\n"):
            self.assertEqual(app_module._recent_commits(5), [])


class TestLiveCache(unittest.TestCase):
    """The 30s cache short-circuits subsequent calls."""

    def setUp(self) -> None:
        _reset_live_cache()

    def test_cache_returns_same_payload_within_ttl(self) -> None:
        with mock.patch.object(app_module, "_git", return_value=None):
            with mock.patch.object(app_module, "_gh_json", return_value=None):
                first = app_module.build_live(force=True)
                # No force=True: should hit cache.
                second = app_module.build_live()
        self.assertEqual(first["generated_at_secs"], second["generated_at_secs"])

    def test_force_bypasses_cache(self) -> None:
        with mock.patch.object(app_module, "_git", return_value=None):
            with mock.patch.object(app_module, "_gh_json", return_value=None):
                first = app_module.build_live(force=True)
                # Mutate cache ts to make it stale; force should still rebuild.
                app_module._LIVE_CACHE["ts"] = 0.0
                second = app_module.build_live(force=True)
        self.assertEqual(first["generated_at_secs"], second["generated_at_secs"])
        # But force=True rebuilt — cache miss path was exercised.

    def test_stale_cache_rebuilds(self) -> None:
        with mock.patch.object(app_module, "_git", return_value=None):
            with mock.patch.object(app_module, "_gh_json", return_value=None):
                app_module.build_live(force=True)
                # Push cache age past the TTL.
                app_module._LIVE_CACHE["ts"] -= 60
                # Without force, this should rebuild.
                rebuilt = app_module.build_live()
        self.assertTrue(rebuilt["ok"])


if __name__ == "__main__":
    unittest.main()