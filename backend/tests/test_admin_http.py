"""HTTP-level tests for the admin SPA + JSON API in backend/app.py."""
from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest import mock
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from backend import app as app_module
from backend import auth, db


def _start_server(db_path: Path) -> tuple[ThreadingHTTPServer, Thread]:
    """Start the Handler on an ephemeral port; return (server, thread).

    BEEMUU_DB_PATH is set in the real process env (not via mock.patch.dict)
    so the Handler keeps resolving to the test DB for the lifetime of the
    server. The server's request threads re-read os.environ on every call,
    so a context-manager patch that exits before request handling would
    silently switch back to the production DB.
    """
    from backend import bootstrap

    os.environ["BEEMUU_DB_PATH"] = str(db_path)
    os.environ["BEEMUU_ADMIN_PASSWORD"] = "test-pw"
    bootstrap.bootstrap_for_startup(db_path)

    # Reset per-test rate-limiters so the test suite doesn't trip the
    # brute-force throttle on /api/admin/login across many tests.
    app_module._rate_limiter = app_module._RateLimiter(
        limit=app_module._RATE_LIMIT, window=app_module._RATE_WINDOW,
    )
    app_module._login_rate_limiter = app_module._RateLimiter(
        limit=app_module._LOGIN_LIMIT, window=app_module._LOGIN_WINDOW,
    )

    server = ThreadingHTTPServer(("127.0.0.1", 0), app_module.Handler)
    t = Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, t


def _cookies_from_response(resp) -> dict[str, str]:
    """Parse Set-Cookie headers into a cookie jar dict."""
    jar: dict[str, str] = {}
    for header in resp.headers.get_all("Set-Cookie") or []:
        name_value = header.split(";", 1)[0]
        if "=" in name_value:
            k, v = name_value.split("=", 1)
            jar[k.strip()] = v.strip()
    return jar


def _as_dict(body: object) -> dict:
    """Coerce a parsed JSON body to a dict. Tests only call this on endpoints
    that always return JSON objects; non-dict bodies route through separate
    checks (e.g. raw read for the static-asset tests)."""
    if isinstance(body, dict):
        return body
    raise AssertionError(f"expected JSON object, got {type(body).__name__}: {body!r}")


class _AdminClient:
    """Tiny HTTP client that maintains cookies across requests."""

    def __init__(self, base: str) -> None:
        self.base = base
        self.cookies: dict[str, str] = {}

    def _request(self, method: str, path: str, body: object | None = None) -> tuple[int, dict, dict | str]:
        url = f"{self.base}{path}"
        headers = {"Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if self.cookies:
            headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        req = Request(url, data=data, method=method, headers=headers)
        try:
            with urlopen(req, timeout=5) as resp:
                resp_cookies = _cookies_from_response(resp)
                self.cookies.update(resp_cookies)
                raw = resp.read().decode("utf-8") or "{}"
                parsed: dict | str = json.loads(raw) if raw.strip().startswith(("{", "[")) else raw
                return resp.status, dict(resp.headers), parsed
        except HTTPError as exc:
            resp_cookies = _cookies_from_response(exc)
            self.cookies.update(resp_cookies)
            raw = exc.read().decode("utf-8") or "{}"
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = raw
            return exc.code, dict(exc.headers), parsed

    def get(self, path: str) -> tuple[int, dict, dict | str]:
        return self._request("GET", path)

    def post(self, path: str, body: object) -> tuple[int, dict, dict | str]:
        return self._request("POST", path, body)

    def delete(self, path: str) -> tuple[int, dict, dict | str]:
        return self._request("DELETE", path)


class TestAdminAuth(unittest.TestCase):
    def setUp(self) -> None:
        self._prev_db_path = os.environ.pop("BEEMUU_DB_PATH", None)
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self._tmp.name) / "admin_http.db"
        self.server, self.thread = _start_server(self.db_path)
        self.client = _AdminClient(f"http://127.0.0.1:{self.server.server_address[1]}")

    def tearDown(self) -> None:
        try:
            self.server.shutdown()
        finally:
            if self._prev_db_path is None:
                os.environ.pop("BEEMUU_DB_PATH", None)
            else:
                os.environ["BEEMUU_DB_PATH"] = self._prev_db_path
            try:
                self.db_path.unlink()
            except OSError:
                pass

    def test_login_with_correct_password_sets_cookie(self) -> None:
        status, _, body = self.client.post("/api/admin/login", {
            "username": "admin", "password": "test-pw",
        })
        self.assertEqual(status, 200)
        self.assertIn("beemuu_admin", self.client.cookies)
        self.assertTrue(_as_dict(body)["ok"])

    def test_login_with_wrong_password_401(self) -> None:
        status, _, body = self.client.post("/api/admin/login", {
            "username": "admin", "password": "wrong",
        })
        self.assertEqual(status, 401)
        self.assertEqual(_as_dict(body)["error"], "invalid credentials")

    def test_login_missing_fields_400(self) -> None:
        status, _, body = self.client.post("/api/admin/login", {})
        self.assertEqual(status, 400)
        self.assertIn("required", _as_dict(body)["error"])

    def test_whoami_requires_session(self) -> None:
        status, _, body = self.client.get("/api/admin/whoami")
        self.assertEqual(status, 401)

    def test_whoami_after_login(self) -> None:
        self.client.post("/api/admin/login", {"username": "admin", "password": "test-pw"})
        status, _, body = self.client.get("/api/admin/whoami")
        self.assertEqual(status, 200)
        self.assertEqual(_as_dict(body)["username"], "admin")

    def test_admin_endpoint_requires_auth(self) -> None:
        status, _, body = self.client.get("/api/admin/dashboard")
        self.assertEqual(status, 401)

    def test_logout_revokes_session(self) -> None:
        self.client.post("/api/admin/login", {"username": "admin", "password": "test-pw"})
        status, _, _ = self.client.post("/api/admin/logout", {})
        self.assertEqual(status, 200)
        # Subsequent /whoami should 401
        status, _, _ = self.client.get("/api/admin/whoami")
        self.assertEqual(status, 401)


class TestAdminStatic(unittest.TestCase):
    """Admin SPA is served from /admin/*. Verifies content-type + traversal guard."""

    def setUp(self) -> None:
        self._prev_db_path = os.environ.pop("BEEMUU_DB_PATH", None)
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self._tmp.name) / "admin_static.db"
        self.server, self.thread = _start_server(self.db_path)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        try:
            self.server.shutdown()
        finally:
            if self._prev_db_path is None:
                os.environ.pop("BEEMUU_DB_PATH", None)
            else:
                os.environ["BEEMUU_DB_PATH"] = self._prev_db_path
            try:
                self.db_path.unlink()
            except OSError:
                pass

    def _get_raw(self, path: str) -> tuple[int, dict, bytes]:
        req = Request(f"{self.base}{path}")
        try:
            with urlopen(req, timeout=5) as resp:
                return resp.status, dict(resp.headers), resp.read()
        except HTTPError as exc:
            return exc.code, dict(exc.headers), exc.read()

    def test_admin_index_served(self) -> None:
        status, headers, body = self._get_raw("/admin/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers["Content-Type"])
        self.assertIn(b"Sign in", body)

    def test_admin_css_served(self) -> None:
        status, _, body = self._get_raw("/admin/admin.css")
        self.assertEqual(status, 200)
        self.assertIn(b"--bg", body)

    def test_admin_js_served(self) -> None:
        status, _, body = self._get_raw("/admin/admin.js")
        self.assertEqual(status, 200)
        self.assertIn(b"login", body)

    def test_admin_path_traversal_blocked(self) -> None:
        # %2e%2e is the URL-encoded ".."
        status, _, body = self._get_raw("/admin/%2e%2e/app.py")
        # Either 400 (bad path) or 404 (not found) — both are acceptable.
        self.assertIn(status, (400, 404))


class TestAdminWrites(unittest.TestCase):
    def setUp(self) -> None:
        self._prev_db_path = os.environ.pop("BEEMUU_DB_PATH", None)
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self._tmp.name) / "admin_writes.db"
        self.server, self.thread = _start_server(self.db_path)
        self.client = _AdminClient(f"http://127.0.0.1:{self.server.server_address[1]}")
        self.client.post("/api/admin/login", {"username": "admin", "password": "test-pw"})

    def tearDown(self) -> None:
        try:
            self.server.shutdown()
        finally:
            if self._prev_db_path is None:
                os.environ.pop("BEEMUU_DB_PATH", None)
            else:
                os.environ["BEEMUU_DB_PATH"] = self._prev_db_path
            try:
                self.db_path.unlink()
            except OSError:
                pass

    def test_dtc_upsert_creates_row(self) -> None:
        status, _, body = self.client.post("/api/admin/dtc", {
            "code": "p0171", "category": "powertrain", "title": "System too lean",
        })
        self.assertEqual(status, 200)
        self.assertEqual(_as_dict(body)["code"], "P0171")  # uppercased
        self.assertEqual(_as_dict(body)["title"], "System too lean")

    def test_dtc_upsert_validates_category(self) -> None:
        status, _, body = self.client.post("/api/admin/dtc", {
            "code": "B1001", "category": "bogus", "title": "x",
        })
        self.assertEqual(status, 400)
        self.assertIn("category", _as_dict(body)["error"])

    def test_dtc_disable_soft_deletes(self) -> None:
        self.client.post("/api/admin/dtc", {
            "code": "P0171", "category": "powertrain", "title": "x",
        })
        status, _, _ = self.client.delete("/api/admin/dtc/P0171")
        self.assertEqual(status, 200)
        # Now disabled — public endpoint should 404
        status, _, body = self.client.get("/api/dtc/P0171")
        self.assertEqual(status, 404)

    def test_dtc_re_enable_restores(self) -> None:
        self.client.post("/api/admin/dtc", {
            "code": "P0171", "category": "powertrain", "title": "x",
        })
        self.client.delete("/api/admin/dtc/P0171")
        status, _, _ = self.client.delete("/api/admin/dtc/P0171/enable")
        self.assertEqual(status, 200)
        status, _, body = self.client.get("/api/dtc/P0171")
        self.assertEqual(status, 200)
        self.assertEqual(_as_dict(body)["code"], "P0171")

    def test_submission_review(self) -> None:
        # Insert a submission directly
        with db.get_conn(self.db_path) as conn:
            conn.execute(
                "INSERT INTO dtc_submission (code, submitter_handle, symptoms, "
                "status, submitted_at) VALUES (?, ?, ?, 'pending', ?)",
                ("P0171", "alice", "rough idle", int(time.time())),
            )
            sid = conn.execute(
                "SELECT id FROM dtc_submission ORDER BY id DESC LIMIT 1"
            ).fetchone()[0]
            conn.commit()
        status, _, body = self.client.post("/api/admin/submissions/review", {
            "id": sid, "status": "approved", "note": "verified in shop",
        })
        self.assertEqual(status, 200)
        self.assertEqual(_as_dict(body)["status"], "approved")
        self.assertEqual(_as_dict(body)["reviewer_note"], "verified in shop")

    def test_submission_review_rejects_bad_status(self) -> None:
        status, _, body = self.client.post("/api/admin/submissions/review", {
            "id": 1, "status": "bogus",
        })
        self.assertEqual(status, 400)

    def test_schematic_upsert_and_link(self) -> None:
        status, _, body = self.client.post("/api/admin/schematics", {
            "slug": "n54-inj", "title": "N54 injectors",
            "series": "E-series", "system": "DME",
            "file_path": "static/schematics/n54-inj.svg",
            "mime": "image/svg+xml", "license": "CC0",
        })
        self.assertEqual(status, 200)
        self.assertEqual(_as_dict(body)["slug"], "n54-inj")
        status, _, _ = self.client.post("/api/admin/schematic-links", {
            "slug": "n54-inj", "code": "P0171",
        })
        self.assertEqual(status, 200)
        # Cross-link endpoint should now find it
        status, _, body = self.client.get("/api/dtc/P0171/schematics")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(_as_dict(body)["count"], 1)

    def test_audit_log_records_writes(self) -> None:
        self.client.post("/api/admin/dtc", {
            "code": "P0171", "category": "powertrain", "title": "x",
        })
        self.client.delete("/api/admin/dtc/P0171")
        status, _, body = self.client.get("/api/admin/audit?limit=20")
        self.assertEqual(status, 200)
        actions = [r["action"] for r in _as_dict(body)["results"]]
        self.assertIn("dtc.upsert", actions)
        self.assertIn("dtc.disable", actions)

    def test_post_without_session_401(self) -> None:
        # New client with no cookies
        client = _AdminClient(f"http://127.0.0.1:{self.server.server_address[1]}")
        status, _, _ = client.post("/api/admin/dtc", {
            "code": "P0171", "category": "powertrain", "title": "x",
        })
        self.assertEqual(status, 401)


class TestExistingRoutesStillWork(unittest.TestCase):
    """Make sure the new admin code didn't break anything public."""

    def setUp(self) -> None:
        self._prev_db_path = os.environ.pop("BEEMUU_DB_PATH", None)
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self._tmp.name) / "existing.db"
        self.server, self.thread = _start_server(self.db_path)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        try:
            self.server.shutdown()
        finally:
            if self._prev_db_path is None:
                os.environ.pop("BEEMUU_DB_PATH", None)
            else:
                os.environ["BEEMUU_DB_PATH"] = self._prev_db_path
            try:
                self.db_path.unlink()
            except OSError:
                pass

    def test_health(self) -> None:
        with urlopen(f"{self.base}/api/health", timeout=5) as resp:
            data = json.loads(resp.read())
        self.assertTrue(data["ok"])

    def test_dashboard(self) -> None:
        with urlopen(f"{self.base}/api/dashboard", timeout=5) as resp:
            data = json.loads(resp.read())
        self.assertIn("counts", data)

    def test_dtc_search(self) -> None:
        with urlopen(f"{self.base}/api/dtc?limit=5", timeout=5) as resp:
            data = json.loads(resp.read())
        self.assertIn("results", data)

    def test_post_to_public_endpoint_returns_4xx(self) -> None:
        # Regression: previously /api/anything returned 501 from stdlib.
        # Now POST routes are handled by do_POST. For a public (non-admin)
        # route that doesn't accept POST, the handler responds with 405.
        # /api/health is a real GET endpoint; POST to it lands in do_POST
        # which only handles /api/admin/* — so we get 404 (not found).
        req = Request(f"{self.base}/api/health", data=b"{}", method="POST",
                      headers={"Content-Type": "application/json"})
        with self.assertRaises(HTTPError) as ctx:
            urlopen(req, timeout=5)
        self.assertIn(ctx.exception.code, (404, 405))


if __name__ == "__main__":
    unittest.main()
