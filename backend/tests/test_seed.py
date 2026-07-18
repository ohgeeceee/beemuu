"""Tests for backend/seed.py — idempotent DTC seeding."""
from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from typing import Iterable

from backend import db, seed


def _fresh_db() -> tuple[tempfile.TemporaryDirectory, Path]:
    """Create a temp-dir-backed database.

    The TemporaryDirectory object is returned alongside the path because
    its finalizer deletes the directory as soon as it is garbage-collected
    — callers must keep it alive for as long as they use the path
    (dropping it here let the db file vanish mid-test: flaky on Windows,
    deterministic "unable to open database file" on Linux).
    """
    tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
    p = Path(tmp.name) / "seed.db"
    db.init_db(p)
    return tmp, p


def _count_dtc(db_path: Path) -> int:
    with db.get_conn(db_path) as conn:
        return conn.execute("SELECT COUNT(*) FROM dtc").fetchone()[0]


class TestSeedOne(unittest.TestCase):
    """seed_one() inserts a row, sets correct fields, is idempotent on PK."""

    def setUp(self) -> None:
        # Keep the TemporaryDirectory alive for the whole test (see _fresh_db).
        self._tmp, self.db_path = _fresh_db()
        self.addCleanup(self._tmp.cleanup)

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


class TestValidateCode(unittest.TestCase):
    """Code-shape validation. SAE codes must be 5 chars (letter + 4 hex);
    BMW-specific codes accept 4-6 hex chars (B58 era uses 6-hex groupings
    like '120308' for charging pressure)."""

    def setUp(self) -> None:
        # Keep the TemporaryDirectory alive for the whole test (see _fresh_db).
        self._tmp, self.db_path = _fresh_db()
        self.addCleanup(self._tmp.cleanup)

    def _ok(self, code: str, category: str) -> None:
        seed.seed_one(
            self.db_path,
            code=code,
            category=category,
            title="x",
            description=None,
            likely_causes=None,
            severity=None,
            source="seed:test",
            verified=1,
            now=0,
        )

    def _bad(self, code: str, category: str) -> None:
        with self.assertRaises(ValueError):
            self._ok(code, category)

    def test_sae_codes_5_chars(self) -> None:
        self._ok("P0171", "powertrain")
        self._ok("B0001", "body")
        self._ok("C0035", "chassis")
        self._ok("U0100", "network")

    def test_sae_rejects_wrong_letter(self) -> None:
        self._bad("X0171", "powertrain")

    def test_sae_rejects_short(self) -> None:
        self._bad("P171", "powertrain")

    def test_sae_rejects_long(self) -> None:
        self._bad("P01710", "powertrain")

    def test_bmw_accepts_4_hex(self) -> None:
        self._ok("29E0", "bmw-specific")
        self._ok("2A82", "bmw-specific")

    def test_bmw_accepts_6_hex(self) -> None:
        """B58-era codes use 6-hex groupings (e.g. '120308' for charging
        pressure control: too low). Source: research/bmw_diag_dim01_dtcs.md."""
        self._ok("120308", "bmw-specific")
        self._ok("ABCDEF", "bmw-specific")

    def test_bmw_rejects_too_short(self) -> None:
        self._bad("2A8", "bmw-specific")

    def test_bmw_rejects_too_long(self) -> None:
        self._bad("ABCDEFG", "bmw-specific")

    def test_bmw_rejects_non_hex(self) -> None:
        self._bad("ZZZZ", "bmw-specific")
        self._bad("2A8Z", "bmw-specific")


class TestSeedMany(unittest.TestCase):
    """seed_many() iterates an iterable of dicts, all-or-nothing in a transaction."""

    def setUp(self) -> None:
        # Keep the TemporaryDirectory alive for the whole test (see _fresh_db).
        self._tmp, self.db_path = _fresh_db()
        self.addCleanup(self._tmp.cleanup)

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
        # Keep the TemporaryDirectory alive for the whole test (see _fresh_db).
        self._tmp, self.db_path = _fresh_db()
        self.addCleanup(self._tmp.cleanup)
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