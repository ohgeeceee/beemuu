"""Unit tests for backend/admin_api.py — write-side admin operations."""
from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from backend import admin_api, auth, db


def _fresh_db() -> tuple[tempfile.TemporaryDirectory, Path]:
    tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
    p = Path(tmp.name) / "admin_api.db"
    db.init_db(p)
    return tmp, p


def _seed_admin(db_path: Path) -> int:
    with db.get_conn(db_path) as conn:
        conn.execute(
            "INSERT INTO admin_user (username, password_hash, created_at) "
            "VALUES (?, ?, ?)",
            ("admin", auth.hash_password("x"), int(time.time())),
        )
        conn.commit()
        return conn.execute(
            "SELECT id FROM admin_user WHERE username = 'admin'"
        ).fetchone()[0]


class TestAuditLog(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp, self.db_path = _fresh_db()
        self.addCleanup(self._tmp.cleanup)
        self.admin_id = _seed_admin(self.db_path)

    def test_write_audit_persists_row(self) -> None:
        admin_api.write_audit(self.db_path, admin_id=self.admin_id,
                              action="test.action", target="P0171")
        rows = admin_api.list_audit(self.db_path, limit=10)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["action"], "test.action")
        self.assertEqual(rows[0]["target"], "P0171")
        self.assertEqual(rows[0]["username"], "admin")

    def test_list_audit_orders_desc(self) -> None:
        for i in range(3):
            admin_api.write_audit(self.db_path, admin_id=self.admin_id,
                                  action=f"a{i}", target=str(i))
            time.sleep(1)  # ensure distinct timestamps
        rows = admin_api.list_audit(self.db_path, limit=10)
        actions = [r["action"] for r in rows]
        self.assertEqual(actions, ["a2", "a1", "a0"])

    def test_audit_survives_null_admin_id(self) -> None:
        admin_api.write_audit(self.db_path, admin_id=None,
                              action="login.failed", target="bob")
        rows = admin_api.list_audit(self.db_path, limit=10)
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["admin_id"])
        self.assertIsNone(rows[0]["username"])


class TestDtcUpsert(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp, self.db_path = _fresh_db()
        self.addCleanup(self._tmp.cleanup)

    def test_insert_new_dtc(self) -> None:
        row = admin_api.upsert_dtc(self.db_path, {
            "code": "P0171", "category": "powertrain", "title": "System too lean (Bank 1)",
        })
        self.assertEqual(row["code"], "P0171")
        self.assertEqual(row["category"], "powertrain")
        self.assertTrue(row["enabled"])

    def test_update_existing_dtc(self) -> None:
        admin_api.upsert_dtc(self.db_path, {
            "code": "P0171", "category": "powertrain", "title": "v1",
        })
        row = admin_api.upsert_dtc(self.db_path, {
            "code": "P0171", "category": "powertrain", "title": "v2",
        })
        self.assertEqual(row["title"], "v2")

    def test_invalid_category_rejected(self) -> None:
        with self.assertRaises(ValueError):
            admin_api.upsert_dtc(self.db_path, {
                "code": "B1001", "category": "made-up", "title": "x",
            })

    def test_missing_code_rejected(self) -> None:
        with self.assertRaises(ValueError):
            admin_api.upsert_dtc(self.db_path, {
                "category": "powertrain", "title": "x",
            })

    def test_soft_delete_and_restore(self) -> None:
        admin_api.upsert_dtc(self.db_path, {
            "code": "P0171", "category": "powertrain", "title": "x",
        })
        self.assertTrue(admin_api.set_dtc_enabled(self.db_path, "P0171", False))
        # The row still exists; enabled is now 0
        with db.get_conn(self.db_path) as conn:
            row = conn.execute("SELECT enabled FROM dtc WHERE code = 'P0171'").fetchone()
        self.assertEqual(row["enabled"], 0)
        self.assertTrue(admin_api.set_dtc_enabled(self.db_path, "P0171", True))
        with db.get_conn(self.db_path) as conn:
            row = conn.execute("SELECT enabled FROM dtc WHERE code = 'P0171'").fetchone()
        self.assertEqual(row["enabled"], 1)

    def test_set_enabled_on_missing_code_returns_false(self) -> None:
        self.assertFalse(admin_api.set_dtc_enabled(self.db_path, "P9999", False))


class TestSubmissions(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp, self.db_path = _fresh_db()
        self.addCleanup(self._tmp.cleanup)
        now = int(time.time())
        with db.get_conn(self.db_path) as conn:
            for i, (code, status) in enumerate([
                ("P0171", "pending"),
                ("P0172", "pending"),
                ("P0299", "approved"),
            ]):
                conn.execute(
                    "INSERT INTO dtc_submission (code, submitter_handle, "
                    "symptoms, status, submitted_at) VALUES (?, ?, ?, ?, ?)",
                    (code, f"user{i}", f"symptom {i}", status, now + i),
                )
            conn.commit()

    def test_list_pending_by_default(self) -> None:
        rows = admin_api.list_submissions(self.db_path, status="pending")
        codes = [r["code"] for r in rows]
        self.assertEqual(codes, ["P0172", "P0171"])

    def test_review_approve(self) -> None:
        row = admin_api.review_submission(self.db_path, 1, status="approved", note="looks good")
        self.assertIsNotNone(row)
        assert row is not None
        self.assertEqual(row["status"], "approved")
        self.assertEqual(row["reviewer_note"], "looks good")
        self.assertIsNotNone(row["reviewed_at"])

    def test_review_rejects_bad_status(self) -> None:
        with self.assertRaises(ValueError):
            admin_api.review_submission(self.db_path, 1, status="bogus", note=None)

    def test_review_missing_returns_none(self) -> None:
        self.assertIsNone(admin_api.review_submission(self.db_path, 9999, status="approved", note=None))


class TestSchematics(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp, self.db_path = _fresh_db()
        self.addCleanup(self._tmp.cleanup)

    def _payload(self, **over) -> dict:
        base = dict(
            slug="n54-injectors", title="N54 injector wiring",
            series="E-series", system="DME",
            file_path="static/schematics/n54-injectors.svg",
            mime="image/svg+xml", license="CC0",
        )
        base.update(over)
        return base

    def test_upsert_required_fields(self) -> None:
        with self.assertRaises(ValueError):
            admin_api.upsert_schematic(self.db_path, {"slug": "x"})

    def test_insert_and_link(self) -> None:
        admin_api.upsert_schematic(self.db_path, self._payload())
        admin_api.set_schematic_link(self.db_path, "n54-injectors", "P0171", note="bank 1")
        with db.get_conn(self.db_path) as conn:
            n = conn.execute(
                "SELECT COUNT(*) FROM schematic_link WHERE schematic_slug = ?",
                ("n54-injectors",),
            ).fetchone()[0]
        self.assertEqual(n, 1)

    def test_link_idempotent(self) -> None:
        admin_api.upsert_schematic(self.db_path, self._payload())
        admin_api.set_schematic_link(self.db_path, "n54-injectors", "P0171")
        admin_api.set_schematic_link(self.db_path, "n54-injectors", "P0171", note="x")
        with db.get_conn(self.db_path) as conn:
            row = conn.execute(
                "SELECT note FROM schematic_link WHERE schematic_slug = ? AND code = ?",
                ("n54-injectors", "P0171"),
            ).fetchone()
        self.assertEqual(row["note"], "x")

    def test_delete_link(self) -> None:
        admin_api.upsert_schematic(self.db_path, self._payload())
        admin_api.set_schematic_link(self.db_path, "n54-injectors", "P0171")
        self.assertTrue(admin_api.delete_schematic_link(self.db_path, "n54-injectors", "P0171"))
        self.assertFalse(admin_api.delete_schematic_link(self.db_path, "n54-injectors", "P0171"))


class TestDashboard(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp, self.db_path = _fresh_db()
        self.addCleanup(self._tmp.cleanup)
        _seed_admin(self.db_path)

    def test_counts_returns_all_keys(self) -> None:
        c = admin_api.dashboard_counts(self.db_path)
        for key in ("dtc", "dtc_enabled", "dtc_submissions", "dtc_submissions_pending",
                    "schematics", "schematic_links", "diag_sessions",
                    "leaderboard", "audit_log", "admin_users"):
            self.assertIn(key, c)
        self.assertEqual(c["admin_users"], 1)
        self.assertEqual(c["dtc"], 0)


if __name__ == "__main__":
    unittest.main()
