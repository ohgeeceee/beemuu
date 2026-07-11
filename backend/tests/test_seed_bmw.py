"""Tests for backend/seed_bmw.py — BMW-specific DTC seed."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend import db, seed, seed_bmw


def _fresh_db() -> Path:
    tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
    p = Path(tmp.name) / "bmw_seed.db"
    db.init_db(p)
    return p


class TestBmwSeed(unittest.TestCase):
    def setUp(self) -> None:
        self.db_path = _fresh_db()

    def test_seed_bmw_runs_without_error(self) -> None:
        seed_bmw.run(self.db_path)

    def test_seed_bmw_inserts_at_least_the_three_known_codes(self) -> None:
        """29E0, 2A82, P0171 are the codes the repo already has opinions on.
        They MUST be in the seeded set with matching titles."""
        seed_bmw.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            rows = conn.execute(
                "SELECT code, title FROM dtc WHERE code IN (?, ?, ?)",
                ("29E0", "2A82", "P0171"),
            ).fetchall()
        by_code = {r["code"]: r["title"] for r in rows}
        self.assertEqual(len(by_code), 3, f"missing codes; got {by_code}")
        # Titles come from your community/opinions/*.toml files
        self.assertIn("lean", by_code["29E0"].lower())
        self.assertIn("vanos", by_code["2A82"].lower())
        self.assertIn("lean", by_code["P0171"].lower())

    def test_seed_bmw_is_idempotent(self) -> None:
        seed_bmw.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            n_first = conn.execute("SELECT COUNT(*) FROM dtc").fetchone()[0]
        seed_bmw.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            n_second = conn.execute("SELECT COUNT(*) FROM dtc").fetchone()[0]
        self.assertEqual(n_first, n_second)
        self.assertGreater(n_first, 3)  # sanity: more than just the 3 must-exist ones

    def test_seed_bmw_registers_with_source_registry(self) -> None:
        """Adding seed_bmw.run to SOURCES lets run_bootstrap pick it up."""
        seed.SOURCES[:] = [seed_bmw.run]
        seed.run_bootstrap(self.db_path)
        with db.get_conn(self.db_path) as conn:
            n = conn.execute("SELECT COUNT(*) FROM dtc").fetchone()[0]
        self.assertGreater(n, 0)


if __name__ == "__main__":
    unittest.main()