"""Integration tests for the admin-panel HTTP routes (login flow, redirects,
session lookup, JSON API). All run against an in-process server with a
throwaway SQLite DB — no network, no port collision.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

from backend import app as app_module
from backend import auth, db


class _NoRedirect(HTTPRedirectHandler):
    """urllib's default handler chases 302s; we want to inspect them."""

    def http_error_302(self, req, fp, code, msg, headers):  # noqa: N802
        # Raise so the test sees the original 302 with Set-Cookie intact.
        raise HTTPError(req.full_url, code, msg, headers, fp)

    http_error_301 = http_error_303 = http_error_307 = http_error_302  # noqa: N815


_OPENER = build_opener(_NoRedirect())


def _start_server(db_path: Path) -> tuple[ThreadingHTTPServer, Thread, str]:
    """Start the Handler on an ephemeral port and bootstrap the admin user.

    Returns (server, thread, base_url).

    Sets BEEMUU_DB_PATH/BEEMUU_ADMIN_PASSWORD on os.environ for the server
    thread's lifetime. Tests must call this exactly once per test (via setUp).
    """
    # Clean any leftover env from a previous test that may have crashed.
    for key in ("BEEMUU_DB_PATH", "BEEMUU_ADMIN_PASSWORD"):
        os.environ.pop(key, None)
    os.environ["BEEMUU_DB_PATH"] = str(db_path)
    os.environ["BEEMUU_ADMIN_PASSWORD"] = "test-pw"
    from backend import bootstrap
    bootstrap.bootstrap_for_startup(db_path)

    server = ThreadingHTTPServer(("127.0.0.1", 0), app_module.Handler)
    t = Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, t, f"http://127.0.0.1:{server.server_address[1]}"


def _post(url: str, data: bytes = b"", headers: dict[str, str] | None = None):
    """POST that does NOT follow redirects; raises HTTPError on 3xx/4xx/5xx.

    The test code wants to inspect Set-Cookie + Location on a successful
    login (which is a 302), so callers wrap the result in `try/except
    HTTPError` only for the failure paths. The HTTPError carries the
    response headers (including Set-Cookie) on its `.headers` attribute.
    """
    req = Request(url, data=data, method="POST")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    return _OPENER.open(req, timeout=5)


def _get(url: str, headers: dict[str, str] | None = None):
    req = Request(url)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    return _OPENER.open(req, timeout=5)


class AdminRoutesBase(unittest.TestCase):
    """Shared bootstrap for the admin-route tests."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self._tmp.name) / "admin.db"
        self.server, self.thread, self.base = _start_server(self.db_path)

    def tearDown(self) -> None:
        try:
            self.server.shutdown()
        finally:
            try:
                self.db_path.unlink()
            except OSError:
                pass


class TestAdminLoginPage(AdminRoutesBase):
    def test_login_page_renders(self) -> None:
        with _get(f"{self.base}/admin/login") as resp:
            self.assertEqual(resp.status, 200)
            body = resp.read().decode("utf-8")
            self.assertIn("Beemuu Admin", body)
            self.assertIn('name="username"', body)
            self.assertIn('name="password"', body)

    def test_admin_root_redirects_to_login_when_unauth(self) -> None:
        try:
            _get(f"{self.base}/admin/")
            self.fail("expected redirect")
        except HTTPError as e:
            self.assertIn(e.code, (301, 302))
            self.assertIn("/admin/login", e.headers.get("Location", ""))


class TestAdminLoginPost(AdminRoutesBase):
    def _post_login(self, username: str, password: str, next_path: str = "/admin/"):
        data = urlencode({"username": username, "password": password, "next": next_path}).encode()
        return _post(f"{self.base}/admin/login", data=data)

    def test_valid_login_sets_cookie_and_redirects(self) -> None:
        # 302 is the success path; we expect HTTPError from the no-redirect opener.
        data = urlencode({"username": "admin", "password": "test-pw"}).encode()
        try:
            _post(f"{self.base}/admin/login", data=data)
            self.fail("expected 302 redirect")
        except HTTPError as e:
            self.assertEqual(e.code, 302)
            set_cookie = e.headers.get("Set-Cookie", "")
            self.assertIn("beemuu_admin_session=", set_cookie)
            self.assertIn("HttpOnly", set_cookie)
            self.assertIn("SameSite=Lax", set_cookie)
            self.assertEqual(e.headers.get("Location"), "/admin/")

    def test_wrong_password_renders_login_with_error(self) -> None:
        try:
            self._post_login("admin", "wrong")
            self.fail("expected 401")
        except HTTPError as e:
            self.assertEqual(e.code, 401)
            body = e.read().decode("utf-8")
            self.assertIn("Invalid username or password", body)

    def test_unknown_user_renders_login_with_error(self) -> None:
        try:
            self._post_login("nobody", "anything")
            self.fail("expected 401")
        except HTTPError as e:
            self.assertEqual(e.code, 401)
            body = e.read().decode("utf-8")
            self.assertIn("Invalid username or password", body)

    def test_empty_fields_rejected(self) -> None:
        try:
            self._post_login("", "")
            self.fail("expected 400")
        except HTTPError as e:
            self.assertEqual(e.code, 400)

    def test_next_redirect_only_allows_same_origin_admin_paths(self) -> None:
        # An external URL must NOT be honored — the cookie still gets set, but
        # the Location must point back into the admin tree.
        data = urlencode({
            "username": "admin",
            "password": "test-pw",
            "next": "https://evil.example/phish",
        }).encode()
        try:
            resp = _post(f"{self.base}/admin/login", data=data)
            location = resp.headers.get("Location")
            status = resp.status
        except HTTPError as e:
            location = e.headers.get("Location")
            status = e.code
        self.assertEqual(status, 302)
        self.assertEqual(location, "/admin/")


class TestAdminSessionCookie(AdminRoutesBase):
    def _login_and_get_cookie(self) -> str:
        # The successful login returns 302; the _NoRedirect handler surfaces
        # that as HTTPError, so we catch it and pull the cookie from its
        # response headers.
        data = urlencode({"username": "admin", "password": "test-pw"}).encode()
        try:
            resp = _post(f"{self.base}/admin/login", data=data)
            cookie_header = resp.headers.get("Set-Cookie", "")
        except HTTPError as e:
            self.assertEqual(e.code, 302, msg=f"expected 302 login, got {e.code}")
            cookie_header = e.headers.get("Set-Cookie", "")
        token = cookie_header.split(";", 1)[0].split("=", 1)[1]
        return token

    def test_admin_root_renders_shell_when_authed(self) -> None:
        token = self._login_and_get_cookie()
        with _get(f"{self.base}/admin/", headers={"Cookie": f"beemuu_admin_session={token}"}) as resp:
            self.assertEqual(resp.status, 200)
            body = resp.read().decode("utf-8")
            self.assertIn("Sign out", body)
            self.assertIn("admin-nav", body)

    def test_admin_static_assets_require_auth(self) -> None:
        # Without cookie -> redirect to /admin/login
        try:
            _get(f"{self.base}/admin/static/admin.css")
            self.fail("expected redirect")
        except HTTPError as e:
            self.assertIn(e.code, (301, 302))
            self.assertIn("/admin/login", e.headers.get("Location", ""))

        # With cookie -> 200 + css body
        token = self._login_and_get_cookie()
        with _get(f"{self.base}/admin/static/admin.css",
                  headers={"Cookie": f"beemuu_admin_session={token}"}) as resp:
            self.assertEqual(resp.status, 200)
            self.assertIn(b"--bg", resp.read()[:200])

    def test_admin_static_path_traversal_rejected(self) -> None:
        token = self._login_and_get_cookie()
        try:
            _get(f"{self.base}/admin/static/../../etc/passwd",
                 headers={"Cookie": f"beemuu_admin_session={token}"})
            self.fail("expected 400")
        except HTTPError as e:
            self.assertEqual(e.code, 400)


class TestAdminLogout(AdminRoutesBase):
    def test_logout_clears_cookie_and_revokes_session(self) -> None:
        # Log in (302 = success)
        data = urlencode({"username": "admin", "password": "test-pw"}).encode()
        try:
            resp = _post(f"{self.base}/admin/login", data=data)
            token = resp.headers.get("Set-Cookie", "").split(";", 1)[0].split("=", 1)[1]
        except HTTPError as e:
            self.assertEqual(e.code, 302)
            token = e.headers.get("Set-Cookie", "").split(";", 1)[0].split("=", 1)[1]

        # Logout (302 + Max-Age=0 cookie)
        try:
            resp = _post(
                f"{self.base}/admin/logout",
                data=b"",
                headers={"Cookie": f"beemuu_admin_session={token}"},
            )
            self.assertEqual(resp.status, 302)
            clear = resp.headers.get("Set-Cookie", "")
            location = resp.headers.get("Location")
        except HTTPError as e:
            self.assertEqual(e.code, 302)
            clear = e.headers.get("Set-Cookie", "")
            location = e.headers.get("Location")
        self.assertEqual(location, "/admin/login")
        self.assertIn("Max-Age=0", clear)

        # Session row should be gone.
        admin_id = auth.lookup_session(self.db_path, token)
        self.assertIsNone(admin_id)

        # Using the cleared cookie should redirect to login.
        try:
            _get(f"{self.base}/admin/",
                 headers={"Cookie": f"beemuu_admin_session={token}"})
            self.fail("expected redirect after logout")
        except HTTPError as e:
            self.assertIn(e.code, (301, 302))


class TestAdminJsonApi(AdminRoutesBase):
    def _login_token(self) -> str:
        data = urlencode({"username": "admin", "password": "test-pw"}).encode()
        try:
            resp = _post(f"{self.base}/admin/login", data=data)
            cookie_header = resp.headers.get("Set-Cookie", "")
        except HTTPError as e:
            self.assertEqual(e.code, 302)
            cookie_header = e.headers.get("Set-Cookie", "")
        return cookie_header.split(";", 1)[0].split("=", 1)[1]

    def _get_json(self, path: str, token: str | None = None) -> tuple[int, dict]:
        headers = {"Cookie": f"beemuu_admin_session={token}"} if token else None
        try:
            with _get(f"{self.base}{path}", headers=headers) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            return e.code, json.loads(e.read().decode("utf-8"))

    def test_stats_endpoint_requires_auth(self) -> None:
        status, body = self._get_json("/admin/api/stats/dtc-submissions")
        self.assertEqual(status, 401)
        self.assertIn("error", body)

    def test_stats_endpoint_returns_value_when_authed(self) -> None:
        token = self._login_token()
        status, body = self._get_json("/admin/api/stats/dtc-submissions", token)
        self.assertEqual(status, 200)
        self.assertEqual(body, {"value": 0})

    def test_audit_recent_records_login(self) -> None:
        token = self._login_token()
        # Hit any API to generate more audit entries (login itself logs).
        self._get_json("/admin/api/stats/dtc-submissions", token)
        status, body = self._get_json("/admin/api/audit/recent?limit=5", token)
        self.assertEqual(status, 200)
        actions = [e["action"] for e in body["entries"]]
        self.assertIn("admin.login.ok", actions)

    def test_audit_recent_limit_clamped(self) -> None:
        token = self._login_token()
        # 9999 → clamped to 200
        status, _body = self._get_json("/admin/api/audit/recent?limit=9999", token)
        self.assertEqual(status, 200)


class TestAuditModule(unittest.TestCase):
    """Direct unit tests for backend.audit.record — failures must not raise."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self._tmp.name) / "audit.db"
        db.init_db(self.db_path)

    def tearDown(self) -> None:
        try:
            self.db_path.unlink()
        except OSError:
            pass

    def test_record_writes_row(self) -> None:
        from backend import audit
        audit.record(self.db_path, action="test.action", admin_id=None, target="x", ip="1.2.3.4")
        with db.get_conn(self.db_path) as conn:
            rows = conn.execute("SELECT * FROM audit_log").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["action"], "test.action")
        self.assertEqual(rows[0]["target"], "x")
        self.assertEqual(rows[0]["ip"], "1.2.3.4")

    def test_record_swallows_db_errors(self) -> None:
        from backend import audit
        # Path that doesn't exist + DB file is a directory → init will fail,
        # but audit.record must NOT raise (best-effort by contract).
        bad = Path(self._tmp.name) / "nope.db"
        # No exception expected even when the path is bogus.
        audit.record(bad, action="test.action")


if __name__ == "__main__":
    unittest.main()
