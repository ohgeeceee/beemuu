"""Tests for registry integrity (v3.0.0 feature 10).

The theme throughout: a download ecosystem is only as good as its integrity
story. A tampered manifest must not be served, and it must not vanish
silently either — a contributor whose file was edited in place needs to be
told why their package disappeared.
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend import plugins_registry as reg


def _tool(**overrides) -> dict:
    pkg = {
        "schemaVersion": 1,
        "id": "author.example-tool",
        "name": "Example tool",
        "version": "1.0.0",
        "author": "Author Name",
        "description": "A test tool.",
        "license": "GPL-3.0-or-later",
        "kind": "tool",
        "permissions": [],
        "exampleInput": {"x": 1},
        "code": "return input.x;",
    }
    pkg.update(overrides)
    return pkg


class DigestTests(unittest.TestCase):
    def test_digest_is_stable_across_key_order_and_reformatting(self):
        # A contributor reformatting their JSON must not invalidate the
        # recorded digest; that would train people to regenerate it blindly.
        a = _tool()
        b = dict(reversed(list(a.items())))
        self.assertEqual(reg.package_digest(a), reg.package_digest(b))
        self.assertEqual(reg.package_digest(json.loads(json.dumps(a))),
                         reg.package_digest(a))

    def test_digest_changes_when_any_byte_of_any_value_changes(self):
        base = reg.package_digest(_tool())
        for field, value in [("code", "return input.y;"), ("version", "1.0.1"),
                             ("description", "A test tool!"), ("name", "Other")]:
            with self.subTest(field=field):
                self.assertNotEqual(base, reg.package_digest(_tool(**{field: value})))

    def test_digest_is_hex_sha256(self):
        d = reg.package_digest(_tool())
        self.assertEqual(len(d), 64)
        int(d, 16)  # raises if not hex

    def test_verify_digest_tolerates_case_and_whitespace(self):
        # Sidecars are hand-written and `shasum` output format varies.
        pkg = _tool()
        d = reg.package_digest(pkg)
        self.assertTrue(reg.verify_digest(pkg, d))
        self.assertTrue(reg.verify_digest(pkg, d.upper()))
        self.assertTrue(reg.verify_digest(pkg, f"  {d}\n"))

    def test_a_missing_digest_is_not_a_pass(self):
        # Otherwise anyone could add a package by omitting the sidecar file.
        pkg = _tool()
        self.assertFalse(reg.verify_digest(pkg, None))
        self.assertFalse(reg.verify_digest(pkg, ""))
        self.assertFalse(reg.verify_digest(pkg, "   "))

    def test_verify_digest_rejects_a_wrong_digest(self):
        self.assertFalse(reg.verify_digest(_tool(), "0" * 64))


class RegistryIntegrityTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def _write(self, pkg, *, sidecar=None, name=None) -> Path:
        self.dir.mkdir(parents=True, exist_ok=True)
        path = self.dir / (name or f"{pkg['id']}.json")
        path.write_text(json.dumps(pkg), encoding="utf-8")
        if sidecar is not None:
            sidecar_path = path.with_suffix(".sha256")
            digest = sidecar if sidecar != "auto" else reg.package_digest(pkg)
            sidecar_path.write_text(str(digest), encoding="utf-8")
        return path

    def test_a_package_with_a_matching_digest_is_served(self):
        self._write(_tool(), sidecar="auto")
        found = reg.list_plugins(self.dir)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["id"], "author.example-tool")

    def test_a_tampered_package_is_not_served(self):
        path = self._write(_tool(), sidecar="auto")
        # Someone edits the tool code after the digest was recorded.
        tampered = _tool(code="return 'evil';")
        path.write_text(json.dumps(tampered), encoding="utf-8")

        self.assertEqual(reg.list_plugins(self.dir), [])
        self.assertIsNone(reg.get_plugin(self.dir, "author.example-tool"))

    def test_a_rejected_package_is_reported_with_a_reason(self):
        # Serving it silently would mean a contributor whose manifest was
        # edited in place has no idea why their package vanished.
        path = self._write(_tool(), sidecar="auto")
        path.write_text(json.dumps(_tool(code="return 'evil';")), encoding="utf-8")
        errors = reg.registry_errors(self.dir)
        self.assertIn("author.example-tool.json", errors)
        self.assertIn("sha256 mismatch", errors["author.example-tool.json"])

    def test_an_empty_sidecar_rejects_the_package(self):
        self._write(_tool(), sidecar="")
        self.assertEqual(reg.list_plugins(self.dir), [])
        self.assertIn("sha256 mismatch", reg.registry_errors(self.dir)["author.example-tool.json"])

    def test_a_missing_sidecar_is_permissive(self):
        # The shipped registry packages predate sidecars, so a missing one is
        # not a rejection — only a present-and-wrong one is.
        self._write(_tool())
        self.assertEqual(len(reg.list_plugins(self.dir)), 1)

    def test_one_bad_package_does_not_hide_the_good_ones(self):
        self._write(_tool(id="author.good"), sidecar="auto")
        bad = self._write(_tool(id="author.bad", code="return 1;"))
        bad.with_suffix(".sha256").write_text("0" * 64, encoding="utf-8")

        found = reg.list_plugins(self.dir)
        self.assertEqual([p["id"] for p in found], ["author.good"])
        self.assertIn("author.bad.json", reg.registry_errors(self.dir))

    def test_the_digest_travels_with_the_listing(self):
        # So a client can show what it would download before downloading it.
        self._write(_tool(), sidecar="auto")
        card = reg.list_plugins(self.dir)[0]
        self.assertEqual(card["sha256"], reg.package_digest(_tool()))
        # ...and the summary still carries no code.
        self.assertNotIn("code", card)

    def test_listing_still_carries_no_code_or_files(self):
        # The catalog stays small; this is a pre-existing guarantee and the
        # digest addition must not have widened the summary.
        self._write(_tool(), sidecar="auto")
        card = reg.list_plugins(self.dir)[0]
        for banned in ("code", "files", "exampleInput", "content"):
            self.assertNotIn(banned, card)

    def test_a_malformed_package_is_still_reported_as_invalid(self):
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / "broken.json").write_text("{not json", encoding="utf-8")
        self.assertEqual(reg.list_plugins(self.dir), [])
        self.assertIn("broken.json", reg.registry_errors(self.dir))

    def test_a_missing_registry_dir_is_empty_not_an_error(self):
        self.assertEqual(reg.list_plugins(self.dir / "nope"), [])
        self.assertEqual(reg.registry_errors(self.dir / "nope"), {})
        self.assertIsNone(reg.get_plugin(self.dir / "nope", "author.example-tool"))

    def test_get_plugin_still_rejects_a_tampered_package(self):
        path = self._write(_tool(), sidecar="auto")
        self.assertIsNotNone(reg.get_plugin(self.dir, "author.example-tool"))
        path.write_text(json.dumps(_tool(code="return 'evil';")), encoding="utf-8")
        self.assertIsNone(reg.get_plugin(self.dir, "author.example-tool"))


if __name__ == "__main__":
    unittest.main()
