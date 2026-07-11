"""Tests for backend/seed.py — idempotent DTC seeding."""
from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from typing import Iterable

from backend import db, seed


def _fresh_db() -> Path:
    tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
    p = Path(tmp.name) / "seed.db"
    db.init_db(p)
    return p


def _count_dtc(db_path: Path) -> int:
    with db.get_conn(db_path) as conn:
        return conn.execute("SELECT COUNT(*) FROM dtc").fetchone()[0]


class TestSeedOne(unittest.TestCase):
    """seed_one() inserts a row, sets correct fields, is idempotent on PK."""

    def setUp(self) -> None:
        self.db_path = _fresh_db()

    def test_seed_one_inserts_row(self) -> None:
        now = int(time.time())
        seed.seed_one(
            self.db_path,
            code="P0171",
            category="powertrain",
            title="System Too Lean (Bank 1)",
            description="Fuel trim indicates lean condition on bank 1.",
            likely_causes="vacuum leak; MAF sensor; fuel pressure low; O2 sensor",
            severity="warn",
            source="seed:generic",
            verified=1,
            now=now,
        )
        self.assertEqual(_count_dtc(self.db_path), 1)
        with db.get_conn(self.db_path) as conn:
            row = conn.execute("SELECT * FROM dtc WHERE code = ?", ("P0171",)).fetchone()
        assert row is not None
        self.assertEqual(row["title"], "System Too Lean (Bank 1)")
        self.assertEqual(row["severity"], "warn")
        self.assertEqual(row["source"], "seed:generic")
        self.assertEqual(row["verified"], 1)
        self.assertEqual(row["enabled"], 1)

    def test_seed_one_is_idempotent_on_primary_key(self) -> None:
        """Re-seeding the same code does not create a duplicate row."""
        seed.seed_one(
            self.db_path,
            code="P0171",
            category="powertrain",
            title="v1 title",
            description="v1 desc",
            likely_causes=None,
            severity=None,
            source="seed:generic",
            verified=1,
            now=1000,
        )
        seed.seed_one(
            self.db_path,
            code="P0171",
            category="powertrain",
            title="v2 title (updated)",
            description="v2 desc",
            likely_causes=None,
            severity=None,
            source="seed:generic",
            verified=1,
            now=2000,
        )
        self.assertEqual(_count_dtc(self.db_path), 1)
        with db.get_conn(self.db_path) as conn:
            row = conn.execute(
                "SELECT title, updated_at FROM dtc WHERE code = ?", ("P0171",)
            ).fetchone()
        # Title updated, updated_at bumped
        self.assertEqual(row["title"], "v2 title (updated)")
        self.assertEqual(row["updated_at"], 2000)

    def test_seed_one_rejects_malformed_code(self) -> None:
        with self.assertRaises(ValueError):
            seed.seed_one(
                self.db_path,
                code="lol-not-a-dtc",
                category="powertrain",
                title="x",
                description=None,
                likely_causes=None,
                severity=None,
                source="seed:generic",
                verified=1,
                now=0,
            )

    def test_seed_one_rejects_unknown_category(self) -> None:
        with self.assertRaises(ValueError):
            seed.seed_one(
                self.db_path,
                code="P0171",
                category="made-up",
                title="x",
                description=None,
                likely_causes=None,
                severity=None,
                source="seed:generic",
                verified=1,
                now=0,
            )


class TestSeedMany(unittest.TestCase):
    """seed_many() iterates an iterable of dicts, all-or-nothing in a transaction."""

    def setUp(self) -> None:
        self.db_path = _fresh_db()

    def _sample(self) -> Iterable[dict]:
        return [
            {
                "code": "P0171",
                "category": "powertrain",
                "title": "System Too Lean (Bank 1)",
                "description": None,
                "likely_causes": None,
                "severity": "warn",
                "source": "seed:generic",
                "verified": 1,
            },
            {
                "code": "P0301",
                "category": "powertrain",
                "title": "Cylinder 1 Misfire Detected",
                "description": None,
                "likely_causes": None,
                "severity": "warn",
                "source": "seed:generic",
                "verified": 1,
            },
        ]

    def test_seed_many_inserts_all_rows(self) -> None:
        n = seed.seed_many(self.db_path, self._sample())
        self.assertEqual(n, 2)
        self.assertEqual(_count_dtc(self.db_path), 2)

    def test_seed_many_atomic_on_failure(self) -> None:
        """One bad row in the batch → zero rows committed."""
        rows = list(self._sample())
        rows.append(
            {
                "code": "BAD-CODE",
                "category": "powertrain",
                "title": "x",
                "description": None,
                "likely_causes": None,
                "severity": None,
                "source": "seed:generic",
                "verified": 1,
            }
        )
        with self.assertRaises(ValueError):
            seed.seed_many(self.db_path, rows)
        self.assertEqual(_count_dtc(self.db_path), 0)


class TestRunBootstrap(unittest.TestCase):
    """run_bootstrap() runs every registered seed source."""

    def setUp(self) -> None:
        self.db_path = _fresh_db()
        self._original_sources = seed.SOURCES.copy()
        self.addCleanup(self._restore_sources)

    def _restore_sources(self) -> None:
        seed.SOURCES[:] = self._original_sources

    def test_run_bootstrap_calls_every_source(self) -> None:
        calls = []

        def fake_a(path):
            calls.append("a")

        def fake_b(path):
            calls.append("b")

        seed.SOURCES[:] = [fake_a, fake_b]
        seed.run_bootstrap(self.db_path)
        self.assertEqual(calls, ["a", "b"])

    def test_run_bootstrap_is_idempotent(self) -> None:
        """Running bootstrap twice doesn't double-count anything."""

        def add_two(path):
            seed.seed_one(
                path,
                code="P0171",
                category="powertrain",
                title="x",
                description=None,
                likely_causes=None,
                severity=None,
                source="seed:test",
                verified=1,
                now=0,
            )
            seed.seed_one(
                path,
                code="P0301",
                category="powertrain",
                title="y",
                description=None,
                likely_causes=None,
                severity=None,
                source="seed:test",
                verified=1,
                now=0,
            )

        seed.SOURCES[:] = [add_two]
        seed.run_bootstrap(self.db_path)
        seed.run_bootstrap(self.db_path)
        seed.run_bootstrap(self.db_path)
        self.assertEqual(_count_dtc(self.db_path), 2)


if __name__ == "__main__":
    unittest.main()