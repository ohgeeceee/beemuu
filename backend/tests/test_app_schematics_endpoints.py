"""Integration tests for the schematics catalog endpoints in backend/app.py.

Mirrors test_app_dtc_endpoints.py: spin up a real ThreadingHTTPServer bound
to 127.0.0.1, seed the schema + 3 CC0 SVGs, hit endpoints over HTTP.
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
from backend import seed_schematics


def _start_server(db_path, seed=False):
    from backend import bootstrap

    with mock.patch.dict(os.environ, {"BEEMUU_ADMIN_PASSWORD": "test-pw"}):
        bootstrap.bootstrap_for_startup(db_path)
        if seed:
            seed_schematics.run(db_path)
    server = ThreadingHTTPServer(("127.0.0.1", 0), app_module.Handler)
    t = Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, t


class TestSchematicsEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        cls.db_path = Path(cls._tmp.name) / "schematics_endpoints.db"
        os.environ["BEEMUU_DB_PATH"] = str(cls.db_path)
        cls.server, cls.thread = _start_server(cls.db_path, seed=True)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def _get(self, path):
        try:
            with urlopen(f"{self.base}{path}", timeout=5) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            return e.code, json.loads(e.read().decode("utf-8"))

    def test_list_returns_three_seeds(self):
        status, body = self._get("/api/schematics")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 3)
        self.assertEqual(len(body["results"]), 3)

    def test_list_filter_by_series(self):
        status, body = self._get("/api/schematics?series=e60")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["series"], "e60")

    def test_list_filter_by_system(self):
        status, body = self._get("/api/schematics?system=DME")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["slug"], "e60-n54-dme-power")

    def test_list_substring_q(self):
        status, body = self._get("/api/schematics?q=CAS")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(body["count"], 1)

    def test_list_unknown_series_empty(self):
        status, body = self._get("/api/schematics?series=zzz-fake")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 0)

    def test_list_bad_limit_400(self):
        status, body = self._get("/api/schematics?limit=notanumber")
        self.assertEqual(status, 400)
        self.assertIn("limit", body["error"])

    def test_by_slug_found(self):
        status, body = self._get("/api/schematics/e89-z4-rcd3302-power-can")
        self.assertEqual(status, 200)
        self.assertEqual(body["slug"], "e89-z4-rcd3302-power-can")
        self.assertEqual(body["license"], "CC0")
        self.assertTrue(body["url"].startswith("/static/schematics/"))

    def test_by_slug_not_found(self):
        status, body = self._get("/api/schematics/does-not-exist")
        self.assertEqual(status, 404)
        self.assertIn("error", body)


if __name__ == "__main__":
    unittest.main()
