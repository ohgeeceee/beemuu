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
from urllib.error import HTTPError
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
        with self.assertRaises(HTTPError) as ctx:
            self._get_json("/api/does-not-exist")
        self.assertEqual(ctx.exception.code, 404)


class TestRateLimiter(unittest.TestCase):
    """Unit tests for _RateLimiter — sliding-window enforcement."""

    def _make(self, limit: int = 5, window: int = 60) -> app_module._RateLimiter:
        return app_module._RateLimiter(limit=limit, window=window)

    def test_allows_requests_below_limit(self) -> None:
        rl = self._make(limit=5)
        for _ in range(5):
            self.assertTrue(rl.is_allowed("1.2.3.4"))

    def test_blocks_when_limit_exceeded(self) -> None:
        rl = self._make(limit=3)
        for _ in range(3):
            rl.is_allowed("1.2.3.4")
        self.assertFalse(rl.is_allowed("1.2.3.4"))

    def test_different_ips_are_independent(self) -> None:
        rl = self._make(limit=2)
        rl.is_allowed("10.0.0.1")
        rl.is_allowed("10.0.0.1")
        # First IP is now at limit; second IP should still be allowed.
        self.assertFalse(rl.is_allowed("10.0.0.1"))
        self.assertTrue(rl.is_allowed("10.0.0.2"))

    def test_old_timestamps_expire_from_window(self) -> None:
        """Requests older than the window should no longer count."""
        import time as _time

        rl = self._make(limit=2, window=1)
        rl.is_allowed("5.5.5.5")
        rl.is_allowed("5.5.5.5")
        self.assertFalse(rl.is_allowed("5.5.5.5"))  # at limit

        # Advance time past the window so old timestamps expire.
        future = _time.monotonic() + 2
        with mock.patch("time.monotonic", return_value=future):
            self.assertTrue(rl.is_allowed("5.5.5.5"))


class TestRateLimitingHTTP(unittest.TestCase):
    """HTTP-level: exhausting the rate limit returns 429 with Retry-After."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self._tmp.name) / "rl.db"
        # Install a very tight (1-request) rate limiter for the test.
        self._orig_rl = app_module._rate_limiter
        app_module._rate_limiter = app_module._RateLimiter(limit=1, window=60)
        self.server, self.thread = _start_server(self.db_path)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        app_module._rate_limiter = self._orig_rl
        try:
            self.server.shutdown()
        finally:
            try:
                self.db_path.unlink()
            except OSError:
                pass

    def _get(self, path: str) -> tuple[int, dict, dict]:
        """Return (status_code, headers_dict, body_dict)."""
        req = Request(f"{self.base}{path}")
        try:
            with urlopen(req, timeout=5) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                return resp.status, dict(resp.headers), body
        except HTTPError as exc:
            body = json.loads(exc.read().decode("utf-8"))
            return exc.code, dict(exc.headers), body

    def test_first_request_succeeds(self) -> None:
        status, _, body = self._get("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])

    def test_second_request_is_rate_limited(self) -> None:
        self._get("/api/health")  # consume the one allowed slot
        status, headers, body = self._get("/api/health")
        self.assertEqual(status, 429)
        self.assertEqual(body["error"], "rate limit exceeded")
        self.assertIn("retry_after", body)
        self.assertIn("Retry-After", headers)

    def test_retry_after_header_matches_body(self) -> None:
        self._get("/api/health")
        status, headers, body = self._get("/api/health")
        self.assertEqual(status, 429)
        self.assertEqual(int(headers["Retry-After"]), body["retry_after"])


if __name__ == "__main__":
    unittest.main()
