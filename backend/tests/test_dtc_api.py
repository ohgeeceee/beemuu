"""Tests for PR 3: DTC catalog + community-submission API.

Covers: list filtering, single-fetch, update with whitelist, approve/reject
transitions, double-action protection, and audit_log entries on writes.
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
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request

from backend import app as app_module
from backend import auth, db

# Re-use the PR 1 test infra for shared server bootstrap.
from backend.tests.test_admin_routes import _OPENER, _post, _get


def _start_server(db_path: Path) -> tuple[ThreadingHTTPServer, Thread, str]:
    for key in ("BEEMUU_DB_PATH", "BEEMUU_ADMIN_PASSWORD"):
        os.environ.pop(key, None)
    os.environ["BEEMUU_DB_PATH"] = str(db_path)
    os.environ["BEEMUU_ADMIN_PASSWORD"] = "test-pw"
    from backend import bootstrap
    bootstrap.bootstrap_for_startup(db_path)

    # Seed a couple of DTC rows + a submission so list/filter tests have data.
    now = int(time.time())
    with db.get_conn(db_path) as conn:
        # exec/insertmany because sqlite3's executescript doesn't bind params.
        conn.executemany(
            "INSERT INTO dtc (code, category, severity, title, description, "
            "likely_causes, source, verified, enabled, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)",
            [
                ("P0011", "powertrain", "warn",
                 "Camshaft position A timing over-advanced (Bank 1)",
                 "OEM-defined", "seed", 1, 1, now, now),
                ("P0125", "powertrain", "info",
                 "Insufficient coolant temp for closed-loop fuel control",
                 "OEM-defined", "seed", 1, 1, now, now),
                ("B1000", "body", "critical",
                 "Test body code", "For tests", "seed", 0, 0, now, now),
            ],
        )
        conn.executemany(
            "INSERT INTO dtc_submission (code, submitter_handle, submitter_vin, "
            "symptoms, proposed_description, status, submitted_at, reviewed_at, "
            "reviewer_note) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)",
            [
                ("P2999", "tester@example.com", "CEL on cold start",
                 "OEM-defined pending review", "pending", now, None, None),
                ("C0123", "tester@example.com", "ABS cycling",
                 "Already approved", "approved", now, now, "looks fine"),
                ("U9999", "spammer@example.com", "?",
                 "Already rejected", "rejected", now, now, "duplicate"),
            ],
        )
        conn.commit()

    server = ThreadingHTTPServer(("127.0.0.1", 0), app_module.Handler)
    t = Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, t, f"http://127.0.0.1:{server.server_address[1]}"


class DtcApiBase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self._tmp.name) / "dtc_api.db"
        self.server, self.thread, self.base = _start_server(self.db_path)

    def tearDown(self) -> None:
        try:
            self.server.shutdown()
        finally:
            try:
                self.db_path.unlink()
            except OSError:
                pass

    def _login_token(self) -> str:
        data = urlencode({"username": "admin", "password": "test-pw"}).encode()
        try:
            resp = _post(f"{self.base}/admin/login", data=data)
            return resp.headers.get("Set-Cookie", "").split(";", 1)[0].split("=", 1)[1]
        except HTTPError as e:
            self.assertEqual(e.code, 302)
            return e.headers.get("Set-Cookie", "").split(";", 1)[0].split("=", 1)[1]

    def _auth_headers(self, token: str | None = None) -> dict[str, str] | None:
        if token is None:
            return None
        return {"Cookie": f"beemuu_admin_session={token}"}

    def _get_json(self, path: str, token: str | None = None):
        headers = self._auth_headers(token)
        try:
            with _get(f"{self.base}{path}", headers=headers) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            return e.code, json.loads(e.read().decode("utf-8"))

    def _post_json(self, path: str, body: dict, token: str | None = None):
        headers = self._auth_headers(token) or {}
        headers["Content-Type"] = "application/json"
        try:
            with _OPENER.open(
                Request(f"{self.base}{path}", data=json.dumps(body).encode(),
                        method="POST", headers=headers),
                timeout=5,
            ) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            return e.code, json.loads(e.read().decode("utf-8"))


class TestDtcListEndpoint(DtcApiBase):
    def test_requires_auth(self) -> None:
        status, _ = self._get_json("/admin/api/dtc")
        self.assertEqual(status, 401)

    def test_returns_seeded_rows(self) -> None:
        token = self._login_token()
        status, body = self._get_json("/admin/api/dtc", token)
        self.assertEqual(status, 200)
        self.assertEqual(body["total"], 3)
        codes = [r["code"] for r in body["items"]]
        self.assertEqual(codes, ["B1000", "P0011", "P0125"])  # sorted by code

    def test_filter_by_prefix(self) -> None:
        token = self._login_token()
        status, body = self._get_json("/admin/api/dtc?prefix=P0", token)
        self.assertEqual(status, 200)
        self.assertEqual(body["total"], 2)
        self.assertEqual([r["code"] for r in body["items"]], ["P0011", "P0125"])

    def test_filter_by_severity(self) -> None:
        token = self._login_token()
        status, body = self._get_json("/admin/api/dtc?severity=critical", token)
        self.assertEqual(status, 200)
        self.assertEqual(body["total"], 1)
        self.assertEqual(body["items"][0]["code"], "B1000")

    def test_filter_by_enabled(self) -> None:
        token = self._login_token()
        status, body = self._get_json("/admin/api/dtc?enabled=0", token)
        self.assertEqual(status, 200)
        self.assertEqual(body["total"], 1)
        self.assertEqual(body["items"][0]["code"], "B1000")


class TestDtcGetEndpoint(DtcApiBase):
    def test_get_existing(self) -> None:
        token = self._login_token()
        status, body = self._get_json("/admin/api/dtc/P0011", token)
        self.assertEqual(status, 200)
        self.assertEqual(body["code"], "P0011")
        self.assertEqual(body["severity"], "warn")
        self.assertTrue(body["enabled"])

    def test_get_missing_returns_404(self) -> None:
        token = self._login_token()
        status, _ = self._get_json("/admin/api/dtc/Z9999", token)
        self.assertEqual(status, 404)


class TestDtcUpdateEndpoint(DtcApiBase):
    def test_update_writes_audit_row(self) -> None:
        token = self._login_token()
        status, body = self._post_json(
            "/admin/api/dtc/P0011",
            {"title": "Updated title", "severity": "critical", "enabled": False},
            token,
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(body["title"], "Updated title")
        self.assertEqual(body["severity"], "critical")
        self.assertFalse(body["enabled"])

        with db.get_conn(self.db_path) as conn:
            rows = conn.execute(
                "SELECT action, target, admin_id FROM audit_log WHERE action='dtc.update'"
            ).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["target"], "P0011")
        self.assertEqual(rows[0]["admin_id"], 1)

    def test_update_rejects_unknown_fields(self) -> None:
        token = self._login_token()
        status, body = self._post_json(
            "/admin/api/dtc/P0011",
            {"title": "ok", "code": "P0012", "category": "hax"},
            token,
        )
        self.assertEqual(status, 200, body)
        # Only `title` is editable; the others are ignored. Verify code unchanged.
        status, body = self._get_json("/admin/api/dtc/P0011", token)
        self.assertEqual(body["code"], "P0011")
        self.assertEqual(body["title"], "ok")

    def test_update_rejects_bad_severity(self) -> None:
        token = self._login_token()
        status, body = self._post_json(
            "/admin/api/dtc/P0011", {"severity": "yikes"}, token,
        )
        self.assertEqual(status, 400)
        self.assertIn("no editable", body["error"])

    def test_update_missing_returns_404(self) -> None:
        token = self._login_token()
        status, _ = self._post_json("/admin/api/dtc/Z9999", {"title": "x"}, token)
        self.assertEqual(status, 404)

    def test_update_requires_auth(self) -> None:
        status, _ = self._post_json("/admin/api/dtc/P0011", {"title": "x"})
        self.assertEqual(status, 401)


class TestSubmissionsList(DtcApiBase):
    def test_default_filter_is_pending(self) -> None:
        token = self._login_token()
        status, body = self._get_json("/admin/api/submissions", token)
        self.assertEqual(status, 200)
        self.assertEqual(body["total"], 1)
        self.assertEqual(body["items"][0]["code"], "P2999")

    def test_filter_approved(self) -> None:
        token = self._login_token()
        status, body = self._get_json("/admin/api/submissions?status=approved", token)
        self.assertEqual(status, 200)
        self.assertEqual(body["total"], 1)
        self.assertEqual(body["items"][0]["code"], "C0123")

    def test_filter_all(self) -> None:
        token = self._login_token()
        status, body = self._get_json("/admin/api/submissions?status=all", token)
        self.assertEqual(status, 200)
        self.assertEqual(body["total"], 3)

    def test_invalid_status_falls_back_to_pending(self) -> None:
        token = self._login_token()
        status, body = self._get_json("/admin/api/submissions?status=hax", token)
        self.assertEqual(status, 200)
        self.assertEqual(body["status_filter"], "pending")


class TestSubmissionApprove(DtcApiBase):
    def test_approve_inserts_into_dtc(self) -> None:
        token = self._login_token()
        # Confirm not in dtc yet.
        status, _ = self._get_json("/admin/api/dtc/P2999", token)
        self.assertEqual(status, 404)

        status, body = self._post_json(
            "/admin/api/submissions/1/approve",
            {"title": "P2999 — community title", "severity": "info", "note": "looks accurate"},
            token,
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(body["code"], "P2999")

        # Now in dtc.
        status, dtc = self._get_json("/admin/api/dtc/P2999", token)
        self.assertEqual(status, 200)
        self.assertEqual(dtc["title"], "P2999 — community title")
        self.assertEqual(dtc["severity"], "info")
        self.assertTrue(dtc["verified"])

        # Submission status updated.
        status, sub = self._get_json("/admin/api/submissions/1", token)
        self.assertEqual(sub["status"], "approved")
        self.assertEqual(sub["reviewer_note"], "looks accurate")

        # Audit log has the action.
        with db.get_conn(self.db_path) as conn:
            rows = conn.execute(
                "SELECT action, target FROM audit_log WHERE action='submission.approve'"
            ).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertIn("P2999", rows[0]["target"])

    def test_double_approve_returns_409(self) -> None:
        token = self._login_token()
        self._post_json("/admin/api/submissions/1/approve", {"note": "first"}, token)
        status, body = self._post_json("/admin/api/submissions/1/approve", {}, token)
        self.assertEqual(status, 409)
        self.assertIn("approved", body["error"])

    def test_cannot_reapprove_already_approved(self) -> None:
        token = self._login_token()
        # Submission 2 is already approved by seed.
        status, body = self._post_json("/admin/api/submissions/2/approve", {}, token)
        self.assertEqual(status, 409)

    def test_approve_requires_auth(self) -> None:
        status, _ = self._post_json("/admin/api/submissions/1/approve", {})
        self.assertEqual(status, 401)


class TestSubmissionReject(DtcApiBase):
    def test_reject_requires_note(self) -> None:
        token = self._login_token()
        status, body = self._post_json("/admin/api/submissions/1/reject", {}, token)
        self.assertEqual(status, 400)
        self.assertIn("note", body["error"])

    def test_reject_with_note(self) -> None:
        token = self._login_token()
        status, body = self._post_json(
            "/admin/api/submissions/1/reject",
            {"note": "duplicate of P2998"},
            token,
        )
        self.assertEqual(status, 200, body)

        status, sub = self._get_json("/admin/api/submissions/1", token)
        self.assertEqual(sub["status"], "rejected")
        self.assertEqual(sub["reviewer_note"], "duplicate of P2998")

        with db.get_conn(self.db_path) as conn:
            rows = conn.execute(
                "SELECT action FROM audit_log WHERE action='submission.reject'"
            ).fetchall()
        self.assertEqual(len(rows), 1)

    def test_double_reject_returns_409(self) -> None:
        token = self._login_token()
        self._post_json("/admin/api/submissions/1/reject", {"note": "first"}, token)
        status, body = self._post_json(
            "/admin/api/submissions/1/reject", {"note": "second"}, token,
        )
        self.assertEqual(status, 409)


if __name__ == "__main__":
    unittest.main()
