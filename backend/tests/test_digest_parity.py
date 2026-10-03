"""Cross-language digest parity: Python and JavaScript must agree exactly.

The registry serves a sha256 with every listing and the desktop verifies it
before staging a package. That only works if both sides canonicalise a manifest
to byte-identical JSON. They are written in different languages with different
JSON number models, and a silent divergence would mean either:

  - every install fails with a bogus mismatch, or worse,
  - a digest that verifies the wrong thing.

So the expected digest below is a hard-coded constant. If either side's
canonical form changes, this fails — which is the point. It is deliberately
not computed by calling both sides from one test: a shared helper would hide a
divergence inside the helper.
"""
from __future__ import annotations

import unittest

from backend import plugins_registry as reg

# The manifest both languages must canonicalise identically. Deliberately full
# of the shapes that diverge: whole floats (`min = -40.0` is all over the
# community profiles), non-integer floats, nested containers, non-ASCII text,
# booleans, null and empty collections.
CROSS_LANGUAGE_PKG = {
    "schemaVersion": 1,
    "id": "author.example-tool",
    "name": "Example tool",
    "version": "1.0.0",
    "author": "Author Name",
    "description": "A test tool.",
    "license": "GPL-3.0-or-later",
    "kind": "tool",
    "permissions": [],
    "exampleInput": {"x": 1, "nested": {"deep": [1, 2, 3]}},
    "code": "return input.x;",
    "extra": "Oil temp \u00b0C",
    "min": -40.0,
    "max": 7000.0,
    "empty": {},
    "arr": [],
    "t": True,
    "n": None,
}

# Produced by src/js/plugins_registry_client.js `sha256Hex(canonicalize(PKG))`
# with Node 26 WebCrypto, and independently by this module.
EXPECTED_DIGEST = "c99c5784b3385d2e1f702ed91e905181496830b4ccf7b48245d10738ec62c498"

EXPECTED_CANON = (
    '{"arr":[],"author":"Author Name","code":"return input.x;",'
    '"description":"A test tool.","empty":{},'
    '"exampleInput":{"nested":{"deep":[1,2,3]},"x":1},'
    '"extra":"Oil temp \u00b0C","id":"author.example-tool","kind":"tool",'
    '"license":"GPL-3.0-or-later","max":7000,"min":-40,"n":null,'
    '"name":"Example tool","permissions":[],"schemaVersion":1,'
    '"t":true,"version":"1.0.0"}'
)


class CrossLanguageParityTests(unittest.TestCase):
    def test_canonical_form_matches_the_client(self):
        self.assertEqual(reg._canonical_json(CROSS_LANGUAGE_PKG), EXPECTED_CANON)

    def test_digest_matches_the_client(self):
        self.assertEqual(reg.package_digest(CROSS_LANGUAGE_PKG), EXPECTED_DIGEST)

    def test_a_whole_float_is_written_as_an_integer(self):
        # The bug this whole file exists for. Python's json.dumps writes
        # `-40.0`; JavaScript's JSON.stringify writes `-40`. A manifest with
        # `min = -40.0` would hash differently on each side.
        self.assertEqual(reg._canonical_json({"min": -40.0}), '{"min":-40}')
        self.assertEqual(reg._canonical_json({"max": 7000.0}), '{"max":7000}')
        # ...and a genuinely fractional value keeps its fraction.
        self.assertEqual(reg._canonical_json({"x": 1.5}), '{"x":1.5}')

    def test_negative_zero_matches_json_stringify(self):
        self.assertEqual(reg._canonical_json({"z": -0.0}), '{"z":0}')

    def test_non_ascii_stays_utf8_rather_than_escaping(self):
        # ensure_ascii=False on both sides; an escaped °C would hash differently.
        self.assertIn("\u00b0", reg._canonical_json({"u": "\u00b0C"}))
        self.assertNotIn("\\u", reg._canonical_json({"u": "\u00b0C"}))

    def test_a_non_finite_number_is_refused_not_silently_rendered(self):
        # JS would render NaN/Infinity as null, quietly changing the digest.
        for bad in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=bad), self.assertRaises(ValueError):
                reg.package_digest({"x": bad})

    def test_key_order_still_does_not_matter(self):
        reordered = dict(reversed(list(CROSS_LANGUAGE_PKG.items())))
        self.assertEqual(reg.package_digest(reordered), EXPECTED_DIGEST)


if __name__ == "__main__":
    unittest.main()