"""Tests for backend/auth.py — scrypt password hashing + cookie sessions."""
from __future__ import annotations

import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from backend import auth, db


def _fresh_db() -> Path:
    tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
    p = Path(tmp.name) / "auth.db"
    db.init_db(p)
    return p


class TestPasswordHashing(unittest.TestCase):
    """scrypt round-trip + timing-safe verify."""

    def test_hash_password_produces_string(self) -> None:
        h = auth.hash_password("hunter2")
        self.assertIsInstance(h, str)
        self.assertTrue(h.startswith("scrypt$"), f"unexpected hash format: {h!r}")

    def test_hash_password_is_random_per_call(self) -> None:
        """Same password → different hashes (salt)."""
        a = auth.hash_password("hunter2")
        b = auth.hash_password("hunter2")
        self.assertNotEqual(a, b)

    def test_verify_password_round_trips(self) -> None:
        h = auth.hash_password("hunter2")
        self.assertTrue(auth.verify_password("hunter2", h))

    def test_verify_password_rejects_wrong_password(self) -> None:
        h = auth.hash_password("hunter2")
        self.assertFalse(auth.verify_password("hunter3", h))

    def test_verify_password_rejects_garbage_hash(self) -> None:
        """Bad hash format must not crash; must return False."""
        self.assertFalse(auth.verify_password("hunter2", "not-a-hash"))
        self.assertFalse(auth.verify_password("hunter2", "scrypt$bad$payload"))
        self.assertFalse(auth.verify_password("hunter2", ""))


class TestCookieSessions(unittest.TestCase):
    """Session create / lookup / revoke / expiry."""

    def setUp(self) -> None:
        self.db_path = _fresh_db()
        # Seed one admin user
        with db.get_conn(self.db_path) as conn:
            conn.execute(
                "INSERT INTO admin_user (username, password_hash, created_at) "
                "VALUES (?, ?, ?)",
                ("admin", auth.hash_password("secret"), int(time.time())),
            )
            conn.commit()
            self.admin_id = conn.execute(
                "SELECT id FROM admin_user WHERE username = ?", ("admin",)
            ).fetchone()[0]

    def tearDown(self) -> None:
        # Best-effort cleanup; sqlite on Windows may hold the file open.
        try:
            self.db_path.unlink()
        except OSError:
            pass

    def test_create_session_returns_32char_token(self) -> None:
        token = auth.create_session(self.db_path, self.admin_id, "127.0.0.1")
        self.assertIsInstance(token, str)
        self.assertGreaterEqual(len(token), 32)

    def test_lookup_session_returns_admin_id_when_valid(self) -> None:
        token = auth.create_session(self.db_path, self.admin_id, "127.0.0.1")
        admin_id = auth.lookup_session(self.db_path, token)
        self.assertEqual(admin_id, self.admin_id)

    def test_lookup_session_returns_none_for_unknown_token(self) -> None:
        admin_id = auth.lookup_session(self.db_path, "does-not-exist")
        self.assertIsNone(admin_id)

    def test_lookup_session_returns_none_when_expired(self) -> None:
        """Manually expire the row and verify it's rejected."""
        token = auth.create_session(self.db_path, self.admin_id, "127.0.0.1")
        # Set expires_at in the past
        with db.get_conn(self.db_path) as conn:
            conn.execute(
                "UPDATE session_cookie SET expires_at = ? WHERE id = ?",
                (int(time.time()) - 1, token),
            )
            conn.commit()
        self.assertIsNone(auth.lookup_session(self.db_path, token))

    def test_revoke_session_deletes_row(self) -> None:
        token = auth.create_session(self.db_path, self.admin_id, "127.0.0.1")
        auth.revoke_session(self.db_path, token)
        self.assertIsNone(auth.lookup_session(self.db_path, token))


if __name__ == "__main__":
    unittest.main()