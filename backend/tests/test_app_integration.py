"""Integration tests for backend/app.py — existing endpoints survive bootstrap."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest import mock
from urllib.request import Request, urlopen

from backend import app as app_module


def _start_server(db_path: Path) -> tuple[ThreadingHTTPServer, Thread]:
    """Start the Handler on an ephemeral port; return (server, thread)."""
    # Pre-init the DB so bootstrap_for_startup() sees the env and creates admin.
    # Actually bootstrap_for_startup will do it itself; we just need the env set
    # before main() runs. We bypass main() and call bootstrap directly.
    from backend import bootstrap

    with mock.patch.dict(os.environ, {"BEEMUU_ADMIN_PASSWORD": "test-pw"}):
        bootstrap.bootstrap_for_startup(db_path)

    server = ThreadingHTTPServer(("127.0.0.1", 0), app_module.Handler)
    t = Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, t


class TestExistingEndpointsAfterBootstrap(unittest.TestCase):
    """Bootstrap must not break /api/health or /api/dashboard."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self._tmp.name) / "app.db"
        self.server, self.thread = _start_server(self.db_path)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        try:
            self.server.shutdown()
        finally:
            try:
                self.db_path.unlink()
            except OSError:
                pass

    def _get_json(self, path: str) -> dict:
        req = Request(f"{self.base}{path}")
        with urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def test_health_endpoint_works(self) -> None:
        data = self._get_json("/api/health")
        self.assertTrue(data["ok"])
        self.assertEqual(data["service"], "beemuu-api")

    def test_dashboard_endpoint_works(self) -> None:
        data = self._get_json("/api/dashboard")
        self.assertEqual(data["service"], "beemuu-api")
        self.assertIn("counts", data)
        self.assertIn("runtime", data)

    def test_unknown_route_returns_404(self) -> None:
        from urllib.error import HTTPError

        with self.assertRaises(HTTPError) as ctx:
            self._get_json("/api/does-not-exist")
        self.assertEqual(ctx.exception.code, 404)


if __name__ == "__main__":
    unittest.main()