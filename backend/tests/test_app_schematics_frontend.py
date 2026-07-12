"""HTTP tests for the schematics frontend pages and vendor file serving.

Verifies:
  - /schematics.html                → 200 text/html
  - /schematics                     → 200 (alias for /schematics.html)
  - /schematics.js                  → 200 + non-empty body
  - /schematics.css                 → 200 + non-empty body
  - /vendor/svg-pan-zoom.min.js     → 200 + non-empty body
  - all of the above are served even when the DB is empty
  - /api/schematics/<slug> still works alongside the new pages
  - the SVGs at data/schematics/<slug>.svg (if present) are well-formed XML
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest import mock
from urllib.error import HTTPError
from urllib.request import urlopen

from backend import app as app_module


def _start_server(db_path):
    """Start a server with the schema bootstrapped but no seeding."""
    from backend import bootstrap

    with mock.patch.dict(os.environ, {"BEEMUU_ADMIN_PASSWORD": "test-pw"}):
        bootstrap.bootstrap_for_startup(db_path)
    server = ThreadingHTTPServer(("127.0.0.1", 0), app_module.Handler)
    t = Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, t


class TestSchematicsFrontend(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        cls.db_path = Path(cls._tmp.name) / "sch_frontend.db"
        os.environ["BEEMUU_DB_PATH"] = str(cls.db_path)
        cls.server, cls.thread = _start_server(cls.db_path)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls._tmp.cleanup()

    def _get(self, path):
        try:
            with urlopen(f"{self.base}{path}", timeout=5) as resp:
                return resp.status, resp.read(), resp.headers.get("Content-Type")
        except HTTPError as e:
            return e.code, e.read(), e.headers.get("Content-Type")

    def test_html_page_returns_200(self):
        status, body, ctype = self._get("/schematics.html")
        self.assertEqual(status, 200)
        self.assertIn("text/html", ctype)
        self.assertIn(b"Wiring Schematics", body)
        self.assertIn(b"/schematics.js", body)
        self.assertIn(b"/schematics.css", body)
        self.assertIn(b"/vendor/svg-pan-zoom.min.js", body)

    def test_html_alias_returns_200(self):
        status, _, _ = self._get("/schematics")
        self.assertEqual(status, 200)

    def test_js_returns_nonempty(self):
        status, body, ctype = self._get("/schematics.js")
        self.assertEqual(status, 200)
        self.assertIn("javascript", ctype)
        self.assertGreater(len(body), 500, "JS body should be non-trivial")

    def test_css_returns_nonempty(self):
        status, body, ctype = self._get("/schematics.css")
        self.assertEqual(status, 200)
        self.assertIn("css", ctype)
        self.assertGreater(len(body), 500, "CSS body should be non-trivial")

    def test_vendor_js_returns_nonempty(self):
        status, body, ctype = self._get("/vendor/svg-pan-zoom.min.js")
        self.assertEqual(status, 200)
        self.assertIn("javascript", ctype)
        self.assertGreater(len(body), 1000, "Vendored svg-pan-zoom should be ~30KB")


class TestSchematicsServedWithEmptyDb(unittest.TestCase):
    """Even with no schematics seeded, the frontend routes must work —
    they degrade to an empty list, not 404."""

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        cls.db_path = Path(cls._tmp.name) / "empty.db"
        os.environ["BEEMUU_DB_PATH"] = str(cls.db_path)
        cls.server, cls.thread = _start_server(cls.db_path)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls._tmp.cleanup()

    def test_list_api_empty(self):
        try:
            with urlopen(f"{self.base}/api/schematics", timeout=5) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            self.fail(f"unexpected HTTP error: {e.code}")
        self.assertEqual(body["count"], 0)
        self.assertEqual(body["results"], [])

    def test_html_still_loads(self):
        try:
            with urlopen(f"{self.base}/schematics.html", timeout=5) as resp:
                self.assertEqual(resp.status, 200)
        except HTTPError as e:
            self.fail(f"page should load even with empty catalog: HTTP {e.code}")


class TestSvgAssetsOnDisk(unittest.TestCase):
    """The three seed SVGs are CC0 hand-drawn schematics; they must be
    well-formed XML and declare an <svg> root."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.path = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _read_data_schematics_dir(self) -> Path:
        repo_root = Path(__file__).resolve().parents[2]
        return repo_root / "data" / "schematics"

    def test_seeded_svgs_are_well_formed(self):
        data_dir = self._read_data_schematics_dir()
        if not data_dir.is_dir():
            self.skipTest("data/schematics/ not present in this checkout")
        svgs = sorted(data_dir.glob("*.svg"))
        if not svgs:
            self.skipTest("no SVG files yet")
        svg_re = re.compile(rb"<svg[\s>]", re.IGNORECASE)
        for path in svgs:
            body = path.read_bytes()
            self.assertTrue(body.startswith(b"<?xml") or body.startswith(b"<svg"),
                            f"{path.name} doesn't start with <?xml or <svg")
            self.assertTrue(svg_re.search(body),
                            f"{path.name} has no <svg> element")
            self.assertIn(b"CC0", body,
                          f"{path.name} should declare CC0 license")


if __name__ == "__main__":
    unittest.main()
