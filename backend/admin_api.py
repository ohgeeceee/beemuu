"""Admin-panel JSON API endpoints.

These endpoints back the dashboard tiles and the recent-activity table on the
admin shell. They require a valid admin session cookie — `require_admin()`
returns the admin_id if the request is authorized, or sends a 401 JSON
response and returns None.

Keeping these handlers in their own module avoids further bloating app.py.
The dispatcher in app.py imports from here.
"""
from __future__ import annotations

import json
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Optional

from . import audit, auth, db


def require_admin(handler: BaseHTTPRequestHandler) -> Optional[int]:
    """Return admin_id if the request is authorized, else send 401 and return None."""
    from .app import _resolve_db_path, _parse_cookies, COOKIE_NAME
    cookies = _parse_cookies(handler.headers.get("Cookie"))
    token = cookies.get(COOKIE_NAME, "")
    if not token:
        handler.send_response(401)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Cache-Control", "no-store")
        handler.end_headers()
        handler.wfile.write(b'{"error":"unauthorized"}')
        return None
    try:
        admin_id = auth.lookup_session(_resolve_db_path(), token)
    except Exception:  # noqa: BLE001
        admin_id = None
    if admin_id is None:
        handler.send_response(401)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Cache-Control", "no-store")
        handler.end_headers()
        handler.wfile.write(b'{"error":"unauthorized"}')
        return None
    return admin_id


def _json(handler: BaseHTTPRequestHandler, payload: dict, status: int = 200) -> None:
    body = json.dumps(payload, sort_keys=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def handle(handler: BaseHTTPRequestHandler, path: str, query: dict[str, list[str]]) -> bool:
    """Dispatch a `/admin/api/...` request.

    Returns True if the path matched an admin API route (handler should not
    fall through to the default 404), False otherwise.
    """
    from .app import _resolve_db_path

    # PR 3: forward DTC + submissions paths to the dedicated router first,
    # so GET/POST /admin/api/dtc and friends work.
    if path.startswith("/admin/api/dtc") or path.startswith("/admin/api/submissions"):
        # Inline dispatch via route_dtc; keep handle_post_route_dtc for callers
        # that want a stand-alone function.
        from . import dtc_api as _dtc_api
        method = handler.command
        if route_dtc(handler, method, path, query):
            return True
        # If route_dtc didn't match (e.g. /admin/api/dtc with method DELETE),
        # fall through to 404 below.
        return False

    if not path.startswith("/admin/api/"):
        return False
    if path == "/admin/api/stats/dtc-submissions":
        admin_id = require_admin(handler)
        if admin_id is None:
            return True
        try:
            with db.get_conn(_resolve_db_path()) as conn:
                count = conn.execute(
                    "SELECT COUNT(*) FROM dtc_submission WHERE status = 'pending'"
                ).fetchone()[0]
            _json(handler, {"value": int(count)})
        except Exception as exc:  # noqa: BLE001
            _json(handler, {"value": 0, "error": str(exc)}, status=500)
        return True

    if path == "/admin/api/stats/diag-sessions":
        admin_id = require_admin(handler)
        if admin_id is None:
            return True
        try:
            cutoff = int(time.time()) - 30 * 24 * 3600
            with db.get_conn(_resolve_db_path()) as conn:
                count = conn.execute(
                    "SELECT COUNT(*) FROM diag_session WHERE submitted_at >= ?",
                    (cutoff,),
                ).fetchone()[0]
            _json(handler, {"value": int(count)})
        except Exception as exc:  # noqa: BLE001
            _json(handler, {"value": 0, "error": str(exc)}, status=500)
        return True

    if path == "/admin/api/stats/community-profiles":
        admin_id = require_admin(handler)
        if admin_id is None:
            return True
        from .app import ROOT
        profiles_dir = ROOT / "community" / "profiles"
        count = 0
        if profiles_dir.exists():
            for p in profiles_dir.rglob("*.toml"):
                if p.is_file():
                    count += 1
        _json(handler, {"value": count})
        return True

    if path == "/admin/api/stats/leaderboard-size":
        admin_id = require_admin(handler)
        if admin_id is None:
            return True
        try:
            with db.get_conn(_resolve_db_path()) as conn:
                count = conn.execute(
                    "SELECT COUNT(*) FROM leaderboard_entry"
                ).fetchone()[0]
            _json(handler, {"value": int(count)})
        except Exception as exc:  # noqa: BLE001
            _json(handler, {"value": 0, "error": str(exc)}, status=500)
        return True

    if path == "/admin/api/audit/recent":
        admin_id = require_admin(handler)
        if admin_id is None:
            return True
        limit_raw = (query.get("limit", ["20"])[0] or "20")
        try:
            limit = max(1, min(200, int(limit_raw)))
        except ValueError:
            limit = 20
        try:
            with db.get_conn(_resolve_db_path()) as conn:
                rows = conn.execute(
                    "SELECT id, admin_id, action, target, ip, at "
                    "FROM audit_log ORDER BY at DESC, id DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            entries = [
                {
                    "id": r["id"],
                    "admin_id": r["admin_id"],
                    "action": r["action"],
                    "target": r["target"],
                    "ip": r["ip"],
                    "at": r["at"],
                }
                for r in rows
            ]
            _json(handler, {"entries": entries})
        except Exception as exc:  # noqa: BLE001
            _json(handler, {"error": str(exc)}, status=500)
        return True

    # No admin API route matched.
    return False


# ---- PR 3: DTC + submissions routing ------------------------------------

import re as _re  # noqa: E402

_DTC_CODE_RE = _re.compile(r"^/admin/api/dtc/([A-Za-z0-9]{1,16})$")
_SUBMISSION_GET_RE = _re.compile(r"^/admin/api/submissions/(\d+)$")
_SUBMISSION_ACTION_RE = _re.compile(r"^/admin/api/submissions/(\d+)/(approve|reject)$")


def _client_ip_for(handler: BaseHTTPRequestHandler) -> str:
    """Pull the originating client IP from X-Forwarded-For / X-Real-IP.

    Mirrors the helper in app.py but lives here too because admin_api is
    imported by app.py and we don't want a circular import.
    """
    fwd = handler.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return handler.headers.get("X-Real-IP", "")


def route_dtc(handler: BaseHTTPRequestHandler, method: str, path: str, query: dict) -> bool:
    """Dispatch /admin/api/dtc* and /admin/api/submissions* requests.

    Returns True if the path matched (handler should not 404), False otherwise.
    Caller is responsible for calling require_admin() for protected routes.
    """
    # Local import keeps this module's import graph shallow and avoids a
    # circular dependency (admin_api is imported by app.py).
    from .app import _resolve_db_path
    db_path = _resolve_db_path()

    # GET /admin/api/dtc
    if path == "/admin/api/dtc" and method == "GET":
        admin_id = require_admin(handler)
        if admin_id is None:
            return True
        from . import dtc_api
        return dtc_api.list_dtc(handler, db_path, query)

    # GET/POST /admin/api/dtc/<code>
    m = _DTC_CODE_RE.match(path)
    if m:
        admin_id = require_admin(handler)
        if admin_id is None:
            return True
        from . import dtc_api
        code = m.group(1)
        if method == "GET":
            return dtc_api.get_dtc(handler, db_path, code)
        if method == "POST":
            return dtc_api.update_dtc(handler, db_path, code, admin_id, _client_ip_for(handler))
        _json(handler, {"error": "method not allowed"}, status=405)
        return True

    # GET /admin/api/submissions
    if path == "/admin/api/submissions" and method == "GET":
        admin_id = require_admin(handler)
        if admin_id is None:
            return True
        from . import dtc_api
        return dtc_api.list_submissions(handler, db_path, query)

    # GET /admin/api/submissions/<id>
    m = _SUBMISSION_GET_RE.match(path)
    if m and method == "GET":
        admin_id = require_admin(handler)
        if admin_id is None:
            return True
        from . import dtc_api
        return dtc_api.get_submission(handler, db_path, int(m.group(1)))

    # POST /admin/api/submissions/<id>/approve|reject
    m = _SUBMISSION_ACTION_RE.match(path)
    if m and method == "POST":
        admin_id = require_admin(handler)
        if admin_id is None:
            return True
        from . import dtc_api
        sub_id = int(m.group(1))
        action = m.group(2)
        if action == "approve":
            return dtc_api.approve_submission(handler, db_path, sub_id, admin_id, _client_ip_for(handler))
        return dtc_api.reject_submission(handler, db_path, sub_id, admin_id, _client_ip_for(handler))

    return False


# ---- PR 3: DTC + submissions routing ------------------------------------
