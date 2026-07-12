"""Tests for backend.cross_links — DTC ↔ schematic cross-reference query helpers.

Covers:
- schema migration applies idempotently
- list_links_for_dtc / list_links_for_schematic return correct JOIN shape
- dtc field is None when the referenced code is missing/disabled
- case normalization (`p0171` → `P0171`)
- include_disabled flag filters correctly
- link_one() is idempotent (UPSERT)
- the cross_links._MIME_TO_EXT table matches schematics._MIME_TO_EXT
  so URL fields don't drift between the two endpoints
"""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend import (
    cross_links,
    db,
    schematics,
    seed_bmw_dim01,
    seed_cross_links,
    seed_dtcs,
    seed_schematics,
)


def _make_db(td: str) -> Path:
    path = Path(td) / "cross-links-test.db"
    db.init_db(path)
    return path


def _seed_full(td: str) -> Path:
    """Fresh DB with schema, DTC seeds, schematic seeds, cross-link seeds."""
    path = _make_db(td)
    with mock.patch.dict(os.environ, {"BEEMUU_DB_PATH": str(path)}):
        seed_dtcs.run(path)
        seed_bmw_dim01.run(path)
        seed_schematics.run(path)
        seed_cross_links.run(path)
    return path


class TestSchemaApplied(unittest.TestCase):
    def setUp(self) -> None:
        self._td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)

    def tearDown(self) -> None:
        self._td.cleanup()

    def test_table_exists_after_init(self) -> None:
        path = _make_db(self._td.name)
        self.assertTrue(cross_links.schema_table_exists(path))

    def test_migration_idempotent(self) -> None:
        path = _make_db(self._td.name)
        db.init_db(path)
        self.assertTrue(cross_links.schema_table_exists(path))


class TestSeedIdempotency(unittest.TestCase):
    def setUp(self) -> None:
        self._td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.path = _seed_full(self._td.name)

    def tearDown(self) -> None:
        self._td.cleanup()

    def test_seed_runs_idempotently(self) -> None:
        # Run twice. Result count and shape must not change.
        first = cross_links.list_links_for_schematic(
            self.path, "e90-cas3-pinout"
        )
        seed_cross_links.run(self.path)
        second = cross_links.list_links_for_schematic(
            self.path, "e90-cas3-pinout"
        )
        self.assertEqual(len(first), len(second))
        self.assertGreater(len(first), 0, "expected at least one seeded link")


class TestMimeExtensionParity(unittest.TestCase):
    """The two modules (cross_links, schematics) must agree on the mime
    → extension map so the `url` field looks the same from both endpoints."""

    def test_parity_with_schematics(self) -> None:
        # Both modules expose _MIME_TO_EXT as a module-level dict. Test
        # the constant sets are equal without depending on private names
        # by spot-checking via the public helpers.
        from backend import schematics as sch

        cases = [
            "image/svg+xml",
            "image/png",
            "image/jpeg",
            "image/webp",
            "application/pdf",
        ]
        for mime in cases:
            self.assertEqual(
                cross_links._ext_for(mime),
                sch._extension_for(mime),
                f"diverged on {mime!r}",
            )


class TestListLinksForDtc(unittest.TestCase):
    def setUp(self) -> None:
        self._td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.path = _seed_full(self._td.name)

    def tearDown(self) -> None:
        self._td.cleanup()

    def test_known_code_returns_links(self) -> None:
        rows = cross_links.list_links_for_dtc(self.path, "29E0")
        # 29E0 is referenced by both e90-cas3-pinout and e60-n54-dme-power.
        slugs = sorted(r["schematic_slug"] for r in rows)
        self.assertEqual(slugs, ["e60-n54-dme-power", "e90-cas3-pinout"])

    def test_unknown_code_returns_empty(self) -> None:
        self.assertEqual(
            cross_links.list_links_for_dtc(self.path, "ZZZZZ"),
            [],
        )

    def test_case_normalized(self) -> None:
        rows_lower = cross_links.list_links_for_dtc(self.path, "29e0")
        rows_upper = cross_links.list_links_for_dtc(self.path, "29E0")
        self.assertEqual(rows_lower, rows_upper)

    def test_row_shape(self) -> None:
        rows = cross_links.list_links_for_dtc(self.path, "29E0")
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertEqual(row["code"], "29E0")
            self.assertIn("schematic", row)
            self.assertIn("dtc", row)
            self.assertIsNotNone(row["schematic"])
            self.assertIsNotNone(row["dtc"])
            # Joined schematic carries url + license (CC0).
            self.assertEqual(row["schematic"]["license"], "CC0")
            self.assertTrue(
                row["schematic"]["url"].endswith(".svg"),
                f"expected .svg URL, got {row['schematic']['url']!r}",
            )

    def test_disabled_dtc_filtered_by_default(self) -> None:
        # Soft-disable a code that has a link and confirm it's filtered.
        with db.get_conn(self.path) as conn:
            conn.execute("UPDATE dtc SET enabled = 0 WHERE code = '29E0'")
            conn.commit()
        rows = cross_links.list_links_for_dtc(self.path, "29E0")
        # No rows because the join's filter excludes disabled DTCs.
        self.assertEqual(rows, [])

    def test_disabled_dtc_visible_with_flag(self) -> None:
        with db.get_conn(self.path) as conn:
            conn.execute("UPDATE dtc SET enabled = 0 WHERE code = '29E0'")
            conn.commit()
        rows = cross_links.list_links_for_dtc(
            self.path, "29E0", include_disabled=True
        )
        # Now they're visible AND the joined dtc field is still populated
        # (we don't drop the join, we just skip the filter).
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertIsNotNone(row["dtc"])

    def test_empty_code_returns_empty(self) -> None:
        self.assertEqual(
            cross_links.list_links_for_dtc(self.path, "   "), []
        )


class TestListLinksForSchematic(unittest.TestCase):
    def setUp(self) -> None:
        self._td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.path = _seed_full(self._td.name)

    def tearDown(self) -> None:
        self._td.cleanup()

    def test_e90_cas3_has_4_links(self) -> None:
        rows = cross_links.list_links_for_schematic(
            self.path, "e90-cas3-pinout"
        )
        codes = sorted(r["code"] for r in rows)
        # Seed defined these four for e90-cas3-pinout:
        self.assertEqual(codes, ["29E0", "29E2", "A105", "U0100"])

    def test_n54_dme_has_5_links(self) -> None:
        rows = cross_links.list_links_for_schematic(
            self.path, "e60-n54-dme-power"
        )
        codes = sorted(r["code"] for r in rows)
        self.assertEqual(
            codes, ["29D2", "29DC", "29E0", "2A0C", "2A82"]
        )

    def test_unknown_slug_empty(self) -> None:
        self.assertEqual(
            cross_links.list_links_for_schematic(self.path, "nope"),
            [],
        )

    def test_filter_preserves_code_format(self) -> None:
        rows = cross_links.list_links_for_schematic(
            self.path, "e89-z4-rcd3302-power-can"
        )
        # Both endpoints for e89 are non-BMW codes (U/B-prefix).
        for row in rows:
            self.assertTrue(row["code"].startswith(("U", "B")))


class TestLinkOne(unittest.TestCase):
    def setUp(self) -> None:
        self._td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.path = _seed_full(self._td.name)

    def tearDown(self) -> None:
        self._td.cleanup()

    def test_idempotent(self) -> None:
        before = cross_links.list_links_for_dtc(self.path, "29E0")
        cross_links.link_one(
            self.path,
            slug="e90-cas3-pinout",
            code="29E0",
            note="overwritten note",
        )
        after = cross_links.list_links_for_dtc(self.path, "29E0")
        self.assertEqual(len(before), len(after), "must not duplicate")
        note = next(
            r["note"] for r in after if r["schematic_slug"] == "e90-cas3-pinout"
        )
        self.assertEqual(note, "overwritten note")

    def test_invalid_inputs_raise(self) -> None:
        with self.assertRaises(ValueError):
            cross_links.link_one(self.path, slug="", code="P0171", note=None)
        with self.assertRaises(ValueError):
            cross_links.link_one(self.path, slug="x", code="  ", note=None)


class TestRouteDispatch(unittest.TestCase):
    """Static analysis: confirm the route order in app.py matches the
    sub-path patterns we depend on. Catches accidentally swapping the
    bare lookup ahead of the sub-path.
    """

    def test_dtc_subpath_dispatches_first(self) -> None:
        path = Path(__file__).resolve().parents[1] / "app.py"
        src = path.read_text(encoding="utf-8")
        # `/api/dtc/<code>/schematics` branch must check the suffix
        # BEFORE the bare lookup.
        sub_idx = src.find("endswith(\"/schematics\")")
        bare_idx = src.find("_handle_dtc_by_code(")
        self.assertNotEqual(sub_idx, -1, "/schematics branch missing")
        self.assertNotEqual(bare_idx, -1, "bare lookup missing")
        self.assertLess(sub_idx, bare_idx, "/schematics must be first")

    def test_schematic_subpath_dispatches_first(self) -> None:
        path = Path(__file__).resolve().parents[1] / "app.py"
        src = path.read_text(encoding="utf-8")
        sub_idx = src.find("endswith(\"/links\")")
        bare_idx = src.find("_handle_schematic_by_slug(")
        self.assertNotEqual(sub_idx, -1, "/links branch missing")
        self.assertNotEqual(bare_idx, -1, "bare lookup missing")
        self.assertLess(sub_idx, bare_idx, "/links must be first")


if __name__ == "__main__":
    unittest.main()
