"""HTTP integration tests for the DTC × schematic cross-link endpoints.

Mirrors test_app_dtc_endpoints.py and test_app_schematics_endpoints.py:
spin up a real ThreadingHTTPServer, hit both new endpoints, verify
status codes, JSON shape, and the critical route-dispatch order
(`/api/dtc/<code>/schematics` must NOT be misrouted to /api/dtc/<code>).
"""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest import mock
from urllib.error import HTTPError
from urllib.request import urlopen

from backend import app as app_module
from backend import seed_bmw_dim01, seed_cross_links, seed_dtcs, seed_schematics


def _start_server(db_path):
    from backend import bootstrap

    with mock.patch.dict(os.environ, {"BEEMUU_ADMIN_PASSWORD": "test-pw"}):
        bootstrap.bootstrap_for_startup(db_path)
        # Seed everything needed for a representative response:
        # SAE codes (P/U-prefix), BMW hex codes (29E0 etc.), the three
        # CC0 schematics, and the curated cross-links.
        seed_dtcs.run(db_path)
        seed_bmw_dim01.run(db_path)
        seed_schematics.run(db_path)
        seed_cross_links.run(db_path)
    server = ThreadingHTTPServer(("127.0.0.1", 0), app_module.Handler)
    t = Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, t


class TestCrossLinkEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        cls.db_path = Path(cls._tmp.name) / "cross_endpoints.db"
        os.environ["BEEMUU_DB_PATH"] = str(cls.db_path)
        cls.server, cls.thread = _start_server(cls.db_path)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def _get(self, path):
        try:
            with urlopen(f"{self.base}{path}", timeout=5) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            try:
                body = json.loads(e.read().decode("utf-8"))
            except Exception:
                body = {}
            return e.code, body

    def test_dtc_to_schematics_returns_links(self):
        status, body = self._get("/api/dtc/29E0/schematics")
        self.assertEqual(status, 200)
        self.assertEqual(body["code"], "29E0")
        self.assertGreaterEqual(body["count"], 1)
        slugs = sorted(r["schematic_slug"] for r in body["results"])
        # 29E0 is curated on both e60 and e90 schematics.
        self.assertIn("e90-cas3-pinout", slugs)
        self.assertIn("e60-n54-dme-power", slugs)

    def test_schematic_to_dtc_returns_links(self):
        status, body = self._get("/api/schematics/e90-cas3-pinout/links")
        self.assertEqual(status, 200)
        self.assertEqual(body["slug"], "e90-cas3-pinout")
        codes = sorted(r["code"] for r in body["results"])
        self.assertEqual(codes, ["29E0", "29E2", "A105", "U0100"])

    def test_dtc_to_schematics_unknown_code_empty(self):
        status, body = self._get("/api/dtc/ZZZZZZ/schematics")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 0)
        self.assertEqual(body["results"], [])

    def test_schematic_to_dtc_unknown_slug_empty(self):
        status, body = self._get("/api/schematics/no-such-thing/links")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 0)

    def test_bare_dtc_endpoint_still_works(self):
        """Critical regression check: /api/dtc/P0171 must NOT be misrouted
        to the cross-link handler just because we added a sub-path."""
        status, body = self._get("/api/dtc/P0171")
        self.assertEqual(status, 200)
        self.assertEqual(body["code"], "P0171")
        # Must NOT be the cross-link response shape (no 'count' / 'results' list).
        self.assertNotIn("count", body)
        self.assertNotIn("results", body)

    def test_bare_schematic_endpoint_still_works(self):
        """Sibling regression: /api/schematics/<slug> must not be confused
        with the /links sub-path."""
        status, body = self._get("/api/schematics/e89-z4-rcd3302-power-can")
        self.assertEqual(status, 200)
        self.assertEqual(body["slug"], "e89-z4-rcd3302-power-can")
        self.assertNotIn("count", body)
        self.assertNotIn("code", body)

    def test_row_shape_includes_full_join(self):
        status, body = self._get("/api/dtc/U0100/schematics")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(body["count"], 1)
        row = body["results"][0]
        # Joined fields present.
        self.assertIn("schematic", row)
        self.assertIn("dtc", row)
        self.assertEqual(row["code"], "U0100")
        self.assertIsNotNone(row["schematic"])
        self.assertIsNotNone(row["dtc"])
        # Schematic payload includes url/license/tags so the front-end
        # can render a card without a second hop.
        sch = row["schematic"]
        self.assertEqual(sch["license"], "CC0")
        self.assertTrue(sch["url"].startswith("/static/schematics/"))
        self.assertTrue(sch["url"].endswith(".svg"))

    def test_bad_limit_does_not_break(self):
        # Cross-link endpoints have a hardcoded limit (500), but include
        # sanity-check that bad query strings don't 500.
        status, body = self._get("/api/dtc/29E0/schematics?limit=abc")
        # We don't honor `limit` on this route — should still 200.
        self.assertEqual(status, 200)


if __name__ == "__main__":
    unittest.main()
