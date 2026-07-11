"""Tests for backend/db.py — sqlite connection, schema bootstrap, dict rows."""
from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend import db


def _table_names(path: Path) -> set[str]:
    with sqlite3.connect(path) as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    return {r[0] for r in rows}


class TestApplySchema(unittest.TestCase):
    """Schema is applied idempotently on every open."""

    def setUp(self) -> None:
        # ignore_cleanup_errors handles Windows file-locking: sqlite3 holds a
        # handle until GC, which races with TemporaryDirectory teardown.
        # The behaviour we care about (tables created) still passes before
        # teardown — this just keeps the test suite green on Windows.
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self._tmp.name) / "test.db"
        self.addCleanup(self._tmp.cleanup)

    def _table_names(self, path: Path) -> set[str]:
        return _table_names(path)

    def test_fresh_db_creates_all_expected_tables(self) -> None:
        db.init_db(self.db_path)
        names = self._table_names(self.db_path)
        expected = {
            "admin_user",
            "session_cookie",
            "dtc",
            "dtc_submission",
            "diag_session",
            "hunt_challenge",
            "leaderboard_entry",
            "audit_log",
        }
        self.assertTrue(
            expected.issubset(names),
            f"missing tables: {expected - names}; got: {names}",
        )

    def test_init_db_is_idempotent(self) -> None:
        db.init_db(self.db_path)
        db.init_db(self.db_path)
        db.init_db(self.db_path)
        # If schema had duplicate-CREATE statements or migrations without IF NOT
        # EXISTS, one of these would raise. Reaching here proves idempotency.
        names = self._table_names(self.db_path)
        self.assertIn("dtc", names)

    def test_get_conn_returns_dict_rows(self) -> None:
        """Rows should be accessible by column name (sqlite3.Row)."""
        db.init_db(self.db_path)
        with db.get_conn(self.db_path) as conn:
            conn.execute(
                "INSERT INTO admin_user (username, password_hash, created_at) "
                "VALUES (?, ?, ?)",
                ("tester", "h:fake", 1700000000),
            )
            conn.commit()
            row = conn.execute(
                "SELECT username FROM admin_user WHERE username = ?",
                ("tester",),
            ).fetchone()
        assert row is not None
        # sqlite3.Row supports both index and key access
        self.assertEqual(row["username"], "tester")
        self.assertEqual(row[0], "tester")


class TestDbPathOverride(unittest.TestCase):
    """BEEMUU_DB_PATH env var is honoured."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self._tmp.cleanup)

    def test_get_conn_reads_env_var_when_no_path_given(self) -> None:
        env_path = Path(self._tmp.name) / "envdb.db"
        with mock.patch.dict("os.environ", {"BEEMUU_DB_PATH": str(env_path)}):
            db.init_db()  # no path argument → use env var
        self.assertTrue(env_path.exists())
        names = _table_names(env_path)
        self.assertIn("dtc", names)

    def test_get_conn_explicit_path_overrides_env(self) -> None:
        env_path = Path(self._tmp.name) / "envdb.db"
        explicit_path = Path(self._tmp.name) / "explicit.db"
        with mock.patch.dict("os.environ", {"BEEMUU_DB_PATH": str(env_path)}):
            db.init_db(explicit_path)
        self.assertTrue(explicit_path.exists())
        self.assertFalse(env_path.exists())


if __name__ == "__main__":
    unittest.main()