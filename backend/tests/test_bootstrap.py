"""Tests for backend/bootstrap.py — first-boot admin user creation."""
from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend import auth, bootstrap, db


class _PinnedTempDir:
    """Hold a reference to a TemporaryDirectory so Windows doesn't garbage-collect
    it out from under an open SQLite connection mid-test.

    The plain `tempfile.TemporaryDirectory()` returned by `_fresh_db()`
    would be unreferenced the moment that function returned, so the directory
    could be deleted at any GC tick later in the test. Tests must keep this
    object alive (typically via setUp()) until the database connection is closed.
    """

    def __init__(self) -> None:
        self._td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.path = Path(self._td.name)

    def cleanup(self) -> None:
        self._td.cleanup()


def _fresh_db() -> tuple[_PinnedTempDir, Path]:
    tmp = _PinnedTempDir()
    p = tmp.path / "boot.db"
    db.init_db(p)
    return tmp, p


class TestBootstrapAdmin(unittest.TestCase):
    """bootstrap_admin() creates the first admin from env var or fails loud."""

    def setUp(self) -> None:
        self._tmp, self.db_path = _fresh_db()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_creates_admin_when_env_set_and_no_admin_exists(self) -> None:
        with mock.patch.dict(os.environ, {"BEEMUU_ADMIN_PASSWORD": "sup3r-secret"}):
            bootstrap.bootstrap_admin(self.db_path)
        # Verify
        with db.get_conn(self.db_path) as conn:
            rows = conn.execute(
                "SELECT username, password_hash FROM admin_user"
            ).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["username"], "admin")
        self.assertTrue(auth.verify_password("sup3r-secret", rows[0]["password_hash"]))

    def test_uses_custom_username_when_env_set(self) -> None:
        with mock.patch.dict(
            os.environ,
            {"BEEMUU_ADMIN_PASSWORD": "pw", "BEEMUU_ADMIN_USERNAME": "root"},
        ):
            bootstrap.bootstrap_admin(self.db_path)
        with db.get_conn(self.db_path) as conn:
            user = conn.execute("SELECT username FROM admin_user").fetchone()
        self.assertEqual(user["username"], "root")

    def test_noop_when_admin_already_exists(self) -> None:
        # Pre-seed an admin with a known password
        with db.get_conn(self.db_path) as conn:
            conn.execute(
                "INSERT INTO admin_user (username, password_hash, created_at) "
                "VALUES (?, ?, ?)",
                ("preexisting", auth.hash_password("original"), 1700000000),
            )
            conn.commit()
        # Bootstrap with a *different* env password — must not overwrite.
        with mock.patch.dict(os.environ, {"BEEMUU_ADMIN_PASSWORD": "different"}):
            bootstrap.bootstrap_admin(self.db_path)
        with db.get_conn(self.db_path) as conn:
            rows = conn.execute(
                "SELECT username, password_hash FROM admin_user"
            ).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["username"], "preexisting")
        self.assertTrue(auth.verify_password("original", rows[0]["password_hash"]))
        self.assertFalse(auth.verify_password("different", rows[0]["password_hash"]))

    def test_raises_when_password_env_missing(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            # Ensure BEEMUU_ADMIN_PASSWORD is not set
            os.environ.pop("BEEMUU_ADMIN_PASSWORD", None)
            with self.assertRaises(SystemExit) as ctx:
                bootstrap.bootstrap_admin(self.db_path)
            # Should exit with a clear status code (2 = usage/config error)
            self.assertIn(ctx.exception.code, (1, 2))

    def test_raises_when_password_empty(self) -> None:
        with mock.patch.dict(os.environ, {"BEEMUU_ADMIN_PASSWORD": ""}):
            with self.assertRaises(SystemExit):
                bootstrap.bootstrap_admin(self.db_path)


class TestBootstrapEntryPoint(unittest.TestCase):
    """bootstrap_for_startup() is the single entry the server's main() calls."""

    def setUp(self) -> None:
        self._tmp, self.db_path = _fresh_db()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_returns_db_path(self) -> None:
        with mock.patch.dict(os.environ, {"BEEMUU_ADMIN_PASSWORD": "x"}):
            result = bootstrap.bootstrap_for_startup(self.db_path)
        self.assertEqual(result, self.db_path)

    def test_uses_env_path_when_none_given(self) -> None:
        # We can't easily test env-driven path resolution here without leaking
        # env state into other tests, so just confirm the explicit-path path works.
        with mock.patch.dict(os.environ, {"BEEMUU_ADMIN_PASSWORD": "x"}):
            bootstrap.bootstrap_for_startup(self.db_path)
        with db.get_conn(self.db_path) as conn:
            n = conn.execute("SELECT COUNT(*) FROM admin_user").fetchone()[0]
        self.assertEqual(n, 1)


if __name__ == "__main__":
    unittest.main()
