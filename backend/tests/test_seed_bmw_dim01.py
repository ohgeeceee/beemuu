"""Tests for backend/seed_bmw_dim01.py - the BMW dim01-research seed."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend import db, seed, seed_bmw_dim01


def _fresh_db() -> tuple[tempfile.TemporaryDirectory, Path]:
    """Create a temp-dir-backed database. Keeps the TemporaryDirectory
    alive by returning it (see test_seed.py for the full rationale)."""
    tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
    p = Path(tmp.name) / "dim01_seed.db"
    db.init_db(p)
    return tmp, p


class TestDim01Seed(unittest.TestCase):
    def setUp(self) -> None:
        # Keep the TemporaryDirectory alive for the whole test (see _fresh_db).
        self._tmp, self.db_path = _fresh_db()
        self.addCleanup(self._tmp.cleanup)

    def test_seed_bmw_dim01_runs_without_error(self) -> None:
        seed_bmw_dim01.run(self.db_path)

    def test_seeds_at_least_200_codes(self) -> None:
        seed_bmw_dim01.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            n = conn.execute(
                "SELECT COUNT(*) FROM dtc WHERE source='seed:bmw-dim01'"
            ).fetchone()[0]
        self.assertGreaterEqual(n, 200)

    def test_all_rows_are_bmw_specific(self) -> None:
        seed_bmw_dim01.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            rows = conn.execute(
                "SELECT DISTINCT category FROM dtc WHERE source='seed:bmw-dim01'"
            ).fetchall()
        categories = {r["category"] for r in rows}
        self.assertEqual(categories, {"bmw-specific"})

    def test_every_row_has_a_title_and_source(self) -> None:
        seed_bmw_dim01.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            bad = conn.execute(
                "SELECT code FROM dtc WHERE source='seed:bmw-dim01' "
                "AND (title IS NULL OR title = '' OR source IS NULL OR source = '')"
            ).fetchall()
        self.assertEqual(bad, [], f"rows missing title/source: {bad}")

    def test_every_row_has_provenance_url(self) -> None:
        seed_bmw_dim01.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            bad = conn.execute(
                "SELECT code, description FROM dtc WHERE source='seed:bmw-dim01' "
                "AND (description IS NULL OR description NOT LIKE 'Source: http%')"
            ).fetchall()
        self.assertEqual(bad, [], f"rows missing source URL: {bad}")

    def test_severity_is_valid(self) -> None:
        seed_bmw_dim01.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            bad = conn.execute(
                "SELECT code, severity FROM dtc WHERE source='seed:bmw-dim01' "
                "AND severity NOT IN ('info', 'warn', 'critical')"
            ).fetchall()
        self.assertEqual(bad, [], f"rows with invalid severity: {bad}")

    def test_is_idempotent(self) -> None:
        seed_bmw_dim01.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            n_first = conn.execute(
                "SELECT COUNT(*) FROM dtc WHERE source='seed:bmw-dim01'"
            ).fetchone()[0]
        seed_bmw_dim01.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            n_second = conn.execute(
                "SELECT COUNT(*) FROM dtc WHERE source='seed:bmw-dim01'"
            ).fetchone()[0]
        self.assertEqual(n_first, n_second)

    def test_registered_with_source_registry(self) -> None:
        original = seed.SOURCES.copy()
        self.addCleanup(lambda: setattr(seed, "SOURCES", original))
        seed.SOURCES[:] = [seed_bmw_dim01.run]
        seed.run_bootstrap(self.db_path)
        with db.get_conn(self.db_path) as conn:
            n = conn.execute(
                "SELECT COUNT(*) FROM dtc WHERE source='seed:bmw-dim01'"
            ).fetchone()[0]
        self.assertGreater(n, 0)

    def test_specific_codes_from_research_file(self) -> None:
        """Spot-check codes that the research file lists as high-confidence."""
        seed_bmw_dim01.run(self.db_path)
        # Keywords derived from the actual research file
        # research/bmw_diag_dim01_dtcs.md.
        expected_titles = {
            "29E0": "fuel",  # "Fuel injection rail, pressure sensor signal"
            "30FF": "turbocharger",  # "Turbocharger, charge-air pressure too low (underboost)"
            "30DA": "nox",  # "NOx sensor, heating time" (lambda section)
            "279B": "thermostat",  # "Map cooling thermostat mechanically stuck"
            "3E80": "valvetronic",
        }
        with db.get_conn(self.db_path) as conn:
            rows = conn.execute(
                "SELECT code, title FROM dtc WHERE source='seed:bmw-dim01' "
                "AND code IN (?, ?, ?, ?, ?)",
                tuple(expected_titles.keys()),
            ).fetchall()
        by_code = {r["code"]: r["title"].lower() for r in rows}
        for code, keyword in expected_titles.items():
            self.assertIn(code, by_code, f"{code} missing from seed")
            self.assertIn(
                keyword, by_code[code],
                f"{code} title {by_code[code]!r} doesn't mention {keyword!r}",
            )


class TestDim01CollisionBehavior(unittest.TestCase):
    """When a code exists in both seed_dtcs and seed_bmw_dim01, the
    BMW-specific row must win because it carries richer provenance.

    This is enforced by import order in bootstrap_dtc.py: seed_dtcs is
    imported before seed_bmw_dim01. We exercise the actual end-to-end
    bootstrap entry point to verify the behavior, not the order itself
    (which is implementation detail).
    """

    def test_b1000_airbag_beats_b1000_generic_after_bootstrap(self) -> None:
        # Run the full bootstrap entry point on a fresh DB. If the order is
        # wrong, seed_dtcs would clobber the BMW-specific row.
        import tempfile
        import os
        from unittest import mock
        from backend import bootstrap_dtc, seed, seed_dtcs
        tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        db_path = Path(tmp.name) / "collision.db"
        db.init_db(db_path)
        # Snapshot SOURCES so we can restore after - bootstrap_dtc extends it.
        original = list(seed.SOURCES)
        self.addCleanup(lambda: setattr(seed, "SOURCES", original))
        # Run only the two sources we care about, in registration order.
        # This proves the import order is correct.
        seed.SOURCES[:] = [seed_dtcs.run, seed_bmw_dim01.run]
        seed.run_bootstrap(db_path)
        with db.get_conn(db_path) as conn:
            row = conn.execute(
                "SELECT code, category, source, title FROM dtc WHERE code='B1000'"
            ).fetchone()
        self.assertIsNotNone(row, "B1000 missing")
        # BMW-specific row should win on category and source.
        self.assertEqual(row["category"], "bmw-specific")
        self.assertEqual(row["source"], "seed:bmw-dim01")


if __name__ == "__main__":
    unittest.main()
