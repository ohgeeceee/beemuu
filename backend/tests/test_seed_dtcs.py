"""Tests for backend/seed_dtcs.py — generic OBD-II SAE J2012 seed."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend import db, seed, seed_dtcs


def _fresh_db() -> Path:
    tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
    p = Path(tmp.name) / "dtc_seed.db"
    db.init_db(p)
    return p


# These are the codes you hit on day one fixing cars. Coverage test asserts
# the generic seed includes all of them with sensible titles.
MUST_HAVE = {
    "P0011": "cam",
    "P0100": "air",
    "P0101": "air",
    "P0171": "lean",
    "P0172": "rich",
    "P0300": "misfire",
    "P0301": "misfire",
    "P0420": "catalyst",
    "P0440": "evap",
    "P0442": "evap",
    "P0500": "speed",
    "U0100": "communication",
}


class TestGenericSeed(unittest.TestCase):
    def setUp(self) -> None:
        self.db_path = _fresh_db()

    def test_runs_without_error(self) -> None:
        seed_dtcs.run(self.db_path)

    def test_seeds_at_least_200_codes(self) -> None:
        """Coverage test. 200+ curated generic codes is plenty for day-one
        coverage of the codes any DIYer or indie shop will actually see.
        The long tail is filled in by community submissions (Phase 2.5)."""
        seed_dtcs.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            n = conn.execute("SELECT COUNT(*) FROM dtc").fetchone()[0]
        self.assertGreaterEqual(
            n, 200, f"only seeded {n} codes; expected >=200 for day-one coverage"
        )

    def test_seeds_codes_across_all_four_categories(self) -> None:
        """Generic seed must cover powertrain, body, chassis, and network."""
        seed_dtcs.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            cats = {
                r["category"]
                for r in conn.execute(
                    "SELECT DISTINCT category FROM dtc"
                ).fetchall()
            }
        self.assertEqual(
            cats,
            {"powertrain", "body", "chassis", "network"},
            f"missing categories; got {cats}",
        )

    def test_seeds_every_must_have_code(self) -> None:
        seed_dtcs.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            rows = conn.execute(
                f"SELECT code, title FROM dtc WHERE code IN ({','.join('?' * len(MUST_HAVE))})",
                tuple(MUST_HAVE.keys()),
            ).fetchall()
        by_code = {r["code"]: r["title"].lower() for r in rows}
        missing = set(MUST_HAVE.keys()) - set(by_code.keys())
        self.assertFalse(missing, f"missing must-have codes: {missing}")
        # Spot-check the title actually mentions the right concept.
        for code, keyword in MUST_HAVE.items():
            self.assertIn(
                keyword,
                by_code[code],
                f"{code} title {by_code[code]!r} doesn't mention {keyword!r}",
            )

    def test_is_idempotent(self) -> None:
        seed_dtcs.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            n_first = conn.execute("SELECT COUNT(*) FROM dtc").fetchone()[0]
        seed_dtcs.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            n_second = conn.execute("SELECT COUNT(*) FROM dtc").fetchone()[0]
        self.assertEqual(n_first, n_second)

    def test_source_is_seed_generic(self) -> None:
        seed_dtcs.run(self.db_path)
        with db.get_conn(self.db_path) as conn:
            row = conn.execute(
                "SELECT source FROM dtc WHERE code = ?", ("P0171",)
            ).fetchone()
        self.assertEqual(row["source"], "seed:generic")

    def test_registered_with_source_registry(self) -> None:
        seed.SOURCES[:] = [seed_dtcs.run]
        seed.run_bootstrap(self.db_path)
        with db.get_conn(self.db_path) as conn:
            n = conn.execute("SELECT COUNT(*) FROM dtc").fetchone()[0]
        self.assertGreater(n, 0)


if __name__ == "__main__":
    unittest.main()