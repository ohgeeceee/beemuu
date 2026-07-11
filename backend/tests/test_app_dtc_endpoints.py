"""Integration tests for the DTC catalog endpoints in backend/app.py."""
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
from backend import seed_bmw, seed_dtcs


def _start_server(db_path, seed=False):
    from backend import bootstrap
    # The caller MUST have already set os.environ['BEEMUU_DB_PATH'] so that
    # the request handler (running in a thread, outside this mock) resolves
    # the same DB. Inside this function we only mock the admin password.
    # Bootstrap (which creates the schema) MUST run before seeds - seeds
    # assume the dtc table already exists.
    with mock.patch.dict(os.environ, {"BEEMUU_ADMIN_PASSWORD": "test-pw"}):
        bootstrap.bootstrap_for_startup(db_path)
        if seed:
            seed_dtcs.run(db_path)
            seed_bmw.run(db_path)
    server = ThreadingHTTPServer(("127.0.0.1", 0), app_module.Handler)
    t = Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, t


class TestDtcEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        cls.db_path = Path(cls._tmp.name) / "dtc_endpoints.db"
        # Persist BEEMUU_DB_PATH outside the mock so the server thread can
        # resolve the same DB.
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

    def test_lookup_sae_code(self):
        status, body = self._get("/api/dtc/P0171")
        self.assertEqual(status, 200)
        self.assertEqual(body["code"], "P0171")
        self.assertEqual(body["category"], "powertrain")
        self.assertIn("lean", body["title"].lower())

    def test_lookup_bmw_specific_code(self):
        status, body = self._get("/api/dtc/29E0")
        self.assertEqual(status, 200)
        self.assertEqual(body["code"], "29E0")
        self.assertEqual(body["category"], "bmw-specific")

    def test_lookup_case_insensitive(self):
        status, body = self._get("/api/dtc/p0171")
        self.assertEqual(status, 200)
        self.assertEqual(body["code"], "P0171")

    def test_lookup_unknown_returns_404(self):
        status, body = self._get("/api/dtc/NOPE9999")
        self.assertEqual(status, 404)
        self.assertIn("error", body)

    def test_search_returns_count_and_results(self):
        status, body = self._get("/api/dtc?limit=10")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], len(body["results"]))
        self.assertLessEqual(body["count"], 10)

    def test_search_filter_by_category(self):
        status, body = self._get("/api/dtc?category=bmw-specific&limit=50")
        self.assertEqual(status, 200)
        for row in body["results"]:
            self.assertEqual(row["category"], "bmw-specific")
        codes = {r["code"] for r in body["results"]}
        self.assertIn("29E0", codes)

    def test_search_substring_q(self):
        status, body = self._get("/api/dtc?q=misfire&limit=20")
        self.assertEqual(status, 200)
        for row in body["results"]:
            blob = (row["code"] + " " + row["title"]).lower()
            self.assertIn("misfire", blob)

    def test_search_invalid_category_returns_400(self):
        status, body = self._get("/api/dtc?category=bogus")
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_search_invalid_limit_returns_400(self):
        status, body = self._get("/api/dtc?limit=abc")
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_search_limit_clamped_to_500(self):
        status, body = self._get("/api/dtc?limit=99999")
        self.assertEqual(status, 200)
        self.assertLessEqual(body["count"], 500)

    def test_disabled_rows_hidden_by_default(self):
        from backend import db
        with db.get_conn(self.db_path) as conn:
            conn.execute(
                "INSERT INTO dtc (code, category, title, source, verified, "
                "enabled, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, 0, 1, 1)",
                ("HIDDEN", "powertrain", "should not appear", "test", 1),
            )
            conn.commit()
        status, body = self._get("/api/dtc/HIDDEN")
        self.assertEqual(status, 404)
        status, body = self._get("/api/dtc/HIDDEN?include_disabled=1")
        self.assertEqual(status, 200)
        self.assertEqual(body["code"], "HIDDEN")


class TestDtcRouteDispatch(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self._tmp.name) / "dispatch.db"
        os.environ["BEEMUU_DB_PATH"] = str(self.db_path)
        self.server, self.thread = _start_server(self.db_path)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()

    def _get(self, path):
        try:
            with urlopen(f"{self.base}{path}", timeout=5) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            return e.code, json.loads(e.read().decode("utf-8"))

    def test_health_still_works(self):
        status, body = self._get("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])

    def test_dashboard_still_works(self):
        status, _ = self._get("/api/dashboard")
        self.assertEqual(status, 200)

    def test_unknown_route_still_404(self):
        status, _ = self._get("/api/does-not-exist")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
