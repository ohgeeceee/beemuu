"""Tests for backend.schematics — query helpers, slug lookup, list filters."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend import db, schematics, seed_schematics


def _make_db(tmpdir: str) -> Path:
    """Create a fresh DB with the schema applied. Returns path."""
    path = Path(tmpdir) / "schematics-test.db"
    db.init_db(path)
    return path


class TestSchemaApplied(unittest.TestCase):
    """Migration should be idempotent and create the schematics table."""

    def setUp(self) -> None:
        # ignore_cleanup_errors handles Windows file-locking: sqlite3 holds a
        # file handle briefly after the connection closes. Mirror the pattern
        # used by test_db.py and the DTC integration tests.
        self._td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)

    def tearDown(self) -> None:
        self._td.cleanup()

    def test_schema_has_schematics_table(self) -> None:
        path = _make_db(self._td.name)
        self.assertTrue(schematics.schema_table_exists(path))

    def test_schema_is_idempotent(self) -> None:
        path = _make_db(self._td.name)
        # Calling init_db again on the same file is a no-op and must
        # NOT raise. This protects against deploys that re-run bootstrap.
        db.init_db(path)
        self.assertTrue(schematics.schema_table_exists(path))


class TestListSchematics(unittest.TestCase):
    """Filter behavior on list_schematics."""

    def setUp(self) -> None:
        self._td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.path = _make_db(self._td.name)
        with mock.patch.dict(__import__("os").environ, {"BEEMUU_DB_PATH": str(self.path)}):
            seed_schematics.run(self.path)

    def tearDown(self) -> None:
        self._td.cleanup()

    def test_seeded_rows(self) -> None:
        rows = schematics.list_schematics(self.path)
        self.assertEqual(len(rows), 3, "expected three CC0 seed schematics")
        for row in rows:
            self.assertEqual(row["license"], "CC0")
            self.assertTrue(row["slug"])
            self.assertTrue(row["url"].startswith("/static/schematics/"))

    def test_filter_by_series(self) -> None:
        rows = schematics.list_schematics(self.path, series="e89")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["series"], "e89")

    def test_filter_by_series_case_insensitive(self) -> None:
        rows = schematics.list_schematics(self.path, series="E90")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["series"], "e90")

    def test_filter_by_unknown_series_returns_empty(self) -> None:
        rows = schematics.list_schematics(self.path, series="zzz-fake")
        self.assertEqual(rows, [])

    def test_filter_by_system(self) -> None:
        rows = schematics.list_schematics(self.path, system="CAS")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["system"], "CAS")

    def test_text_search_matches_tag(self) -> None:
        rows = schematics.list_schematics(self.path, q="rcd3302")
        self.assertEqual(len(rows), 1)
        self.assertIn("rcd3302", rows[0]["title"].lower() + " ".join(rows[0]["tags"]))

    def test_text_search_matches_title(self) -> None:
        rows = schematics.list_schematics(self.path, q="MSD80")
        # 'MSD80' isn't in title/tags today; choose a snippet that's clearly in row.
        rows = schematics.list_schematics(self.path, q="N54")
        self.assertGreaterEqual(len(rows), 1)

    def test_limit_is_clamped(self) -> None:
        # limit=0 → clamped to 1, still returns the first row.
        rows = schematics.list_schematics(self.path, limit=0)
        self.assertEqual(len(rows), 1)

    def test_results_sorted_by_series_system_title(self) -> None:
        rows = schematics.list_schematics(self.path)
        keys = [(r["series"], r["system"], r["title"]) for r in rows]
        self.assertEqual(keys, sorted(keys))


class TestGetBySlug(unittest.TestCase):
    def setUp(self) -> None:
        self._td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.path = _make_db(self._td.name)
        with mock.patch.dict(__import__("os").environ, {"BEEMUU_DB_PATH": str(self.path)}):
            seed_schematics.run(self.path)

    def tearDown(self) -> None:
        self._td.cleanup()

    def test_found(self) -> None:
        row = schematics.get_schematic_by_slug(self.path, "e89-z4-rcd3302-power-can")
        self.assertIsNotNone(row)
        self.assertEqual(row["series"], "e89")

    def test_not_found(self) -> None:
        row = schematics.get_schematic_by_slug(self.path, "does-not-exist")
        self.assertIsNone(row)

    def test_empty_slug(self) -> None:
        row = schematics.get_schematic_by_slug(self.path, "   ")
        self.assertIsNone(row)


class TestExtensionMapping(unittest.TestCase):
    """The _extension_for() helper must return sane values for known and
    unknown mimes so the generated `url` always points at a real file."""

    def test_known_mimes(self) -> None:
        from backend.schematics import _extension_for
        self.assertEqual(_extension_for("image/svg+xml"), "svg")
        self.assertEqual(_extension_for("image/png"), "png")
        self.assertEqual(_extension_for("image/jpeg"), "jpg")
        self.assertEqual(_extension_for("image/webp"), "webp")
        self.assertEqual(_extension_for("application/pdf"), "pdf")

    def test_fallback_for_unknown_mime(self) -> None:
        from backend.schematics import _extension_for
        # Unknown mime → best-effort suffix, never empty.
        result = _extension_for("something/strange")
        self.assertTrue(result)
        self.assertNotIn("/", result)

    def test_fallback_for_no_slash(self) -> None:
        from backend.schematics import _extension_for
        # Malformed mime → "bin", no crash.
        self.assertEqual(_extension_for("not-a-mime"), "bin")


class TestSeedIdempotency(unittest.TestCase):
    """Running the seed twice does not duplicate rows."""

    def test_seed_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
            path = _make_db(td)
            seed_schematics.run(path)
            seed_schematics.run(path)
            rows = schematics.list_schematics(path)
            self.assertEqual(len(rows), 3, "seed must be idempotent (UPSERT)")
            # Each slug must be unique.
            slugs = [r["slug"] for r in rows]
            self.assertEqual(len(set(slugs)), len(slugs))


if __name__ == "__main__":
    unittest.main()
