"""DTC catalog + community-submission API for the admin panel (PR 3).

All endpoints are auth-gated; the dispatcher in admin_api.py calls
require_admin() before forwarding here.

Endpoints:
  GET  /admin/api/dtc?prefix=&severity=&enabled=&verified=&page=&page_size=
  GET  /admin/api/dtc/<code>
  POST /admin/api/dtc/<code>         body: {title, description, severity,
                                            enabled, verified} (any subset)
  GET  /admin/api/submissions?status=&page=&page_size=
  GET  /admin/api/submissions/<id>
  POST /admin/api/submissions/<id>/approve  body: {code?, title?, severity?}
                                            overrides the submission text on promote
  POST /admin/api/submissions/<id>/reject   body: {note}

All writes go through audit.record() with the action verb in the audit_log
table so we have a trail of who changed what.
"""
from __future__ import annotations

import json
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

from . import audit, db


# ---- read helpers --------------------------------------------------------

_DTC_LIST_COLUMNS = (
    "code, category, severity, title, enabled, verified, "
    "source, created_at, updated_at"
)


def _dtc_row_to_dict(row) -> dict[str, Any]:
    # The list endpoint selects a subset of columns; missing keys get None so
    # the JSON shape stays stable (the detail endpoint fills them in).
    def g(k):
        try:
            return row[k]
        except (IndexError, KeyError):
            return None
    return {
        "code": g("code"),
        "category": g("category"),
        "severity": g("severity"),
        "title": g("title"),
        "description": g("description"),
        "likely_causes": g("likely_causes"),
        "source": g("source"),
        "enabled": bool(g("enabled")) if g("enabled") is not None else False,
        "verified": bool(g("verified")) if g("verified") is not None else False,
        "created_at": g("created_at"),
        "updated_at": g("updated_at"),
    }


def _submission_row_to_dict(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "code": row["code"],
        "submitter_handle": row["submitter_handle"],
        "submitter_vin": row["submitter_vin"],
        "symptoms": row["symptoms"],
        "proposed_description": row["proposed_description"],
        "status": row["status"],
        "submitted_at": row["submitted_at"],
        "reviewed_at": row["reviewed_at"],
        "reviewer_note": row["reviewer_note"],
    }


def _parse_pagination(query: dict[str, list[str]]) -> tuple[int, int]:
    """Return (page, page_size), both clamped to safe ranges."""
    try:
        page = int((query.get("page", ["1"])[0] or "1"))
    except ValueError:
        page = 1
    try:
        page_size = int((query.get("page_size", ["50"])[0] or "50"))
    except ValueError:
        page_size = 50
    page = max(1, page)
    page_size = max(1, min(200, page_size))
    return page, page_size


def _send_json(handler: BaseHTTPRequestHandler, payload: dict, status: int = 200) -> None:
    body = json.dumps(payload, sort_keys=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _read_json_body(handler: BaseHTTPRequestHandler) -> dict:
    """Read a JSON POST body, max 16KB. Returns {} on parse error or empty body."""
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return {}
    if length > 16 * 1024:
        return {}
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}


# ---- DTC catalog endpoints ----------------------------------------------


def list_dtc(handler: BaseHTTPRequestHandler, db_path: Path, query: dict[str, list[str]]) -> bool:
    page, page_size = _parse_pagination(query)
    prefix = (query.get("prefix", [""])[0] or "").upper().strip()
    severity = (query.get("severity", [""])[0] or "").strip()
    enabled = (query.get("enabled", [""])[0] or "").strip()
    verified = (query.get("verified", [""])[0] or "").strip()

    where = []
    args: list[Any] = []
    if prefix:
        where.append("code LIKE ?")
        args.append(prefix + "%")
    if severity in ("info", "warn", "critical"):
        where.append("severity = ?")
        args.append(severity)
    if enabled in ("0", "1"):
        where.append("enabled = ?")
        args.append(int(enabled))
    if verified in ("0", "1"):
        where.append("verified = ?")
        args.append(int(verified))

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    offset = (page - 1) * page_size

    with db.get_conn(db_path) as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM dtc {where_sql}", args).fetchone()[0]
        rows = conn.execute(
            f"SELECT {_DTC_LIST_COLUMNS} FROM dtc {where_sql} "
            "ORDER BY code ASC LIMIT ? OFFSET ?",
            args + [page_size, offset],
        ).fetchall()

    _send_json(handler, {
        "items": [_dtc_row_to_dict(r) for r in rows],
        "page": page,
        "page_size": page_size,
        "total": int(total),
    })
    return True


def get_dtc(handler: BaseHTTPRequestHandler, db_path: Path, code: str) -> bool:
    code = code.upper().strip()
    if not code or len(code) > 16:
        _send_json(handler, {"error": "bad code"}, status=400)
        return True
    with db.get_conn(db_path) as conn:
        row = conn.execute(f"SELECT * FROM dtc WHERE code = ?", (code,)).fetchone()
    if row is None:
        _send_json(handler, {"error": "not found"}, status=404)
        return True
    _send_json(handler, _dtc_row_to_dict(row))
    return True


def update_dtc(
    handler: BaseHTTPRequestHandler,
    db_path: Path,
    code: str,
    admin_id: int,
    ip: str,
) -> bool:
    code = code.upper().strip()
    if not code or len(code) > 16:
        _send_json(handler, {"error": "bad code"}, status=400)
        return True
    body = _read_json_body(handler)
    if not body:
        _send_json(handler, {"error": "invalid body"}, status=400)
        return True

    # Whitelist of editable columns. Notably absent: `code` (PK), `category`,
    # `created_at`. Source/likely_causes are also immutable — those change
    # through a "re-import from seed" workflow that lives elsewhere.
    editable: dict[str, Any] = {}
    if "title" in body and isinstance(body["title"], str):
        editable["title"] = body["title"].strip()[:512]
    if "description" in body and isinstance(body["description"], str):
        editable["description"] = body["description"].strip()[:4096]
    if "severity" in body and body["severity"] in ("info", "warn", "critical"):
        editable["severity"] = body["severity"]
    if "enabled" in body:
        editable["enabled"] = 1 if body["enabled"] else 0
    if "verified" in body:
        editable["verified"] = 1 if body["verified"] else 0

    if not editable:
        _send_json(handler, {"error": "no editable fields"}, status=400)
        return True

    editable["updated_at"] = int(time.time())
    set_sql = ", ".join(f"{col} = ?" for col in editable)
    args = list(editable.values()) + [code]

    with db.get_conn(db_path) as conn:
        existing = conn.execute("SELECT code FROM dtc WHERE code = ?", (code,)).fetchone()
        if existing is None:
            _send_json(handler, {"error": "not found"}, status=404)
            return True
        conn.execute(f"UPDATE dtc SET {set_sql} WHERE code = ?", args)
        conn.commit()
        row = conn.execute(f"SELECT * FROM dtc WHERE code = ?", (code,)).fetchone()

    audit.record(
        db_path,
        action="dtc.update",
        admin_id=admin_id,
        target=code,
        ip=ip,
    )
    _send_json(handler, _dtc_row_to_dict(row))
    return True


# ---- Submissions endpoints ----------------------------------------------


def list_submissions(
    handler: BaseHTTPRequestHandler, db_path: Path, query: dict[str, list[str]]
) -> bool:
    page, page_size = _parse_pagination(query)
    status_filter = (query.get("status", ["pending"])[0] or "pending").strip()
    if status_filter not in ("pending", "approved", "rejected", "all"):
        status_filter = "pending"

    where = ""
    args: list[Any] = []
    if status_filter != "all":
        where = "WHERE status = ?"
        args = [status_filter]

    offset = (page - 1) * page_size
    with db.get_conn(db_path) as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM dtc_submission {where}", args).fetchone()[0]
        rows = conn.execute(
            "SELECT * FROM dtc_submission " + where +
            " ORDER BY submitted_at DESC, id DESC LIMIT ? OFFSET ?",
            args + [page_size, offset],
        ).fetchall()
    _send_json(handler, {
        "items": [_submission_row_to_dict(r) for r in rows],
        "page": page,
        "page_size": page_size,
        "total": int(total),
        "status_filter": status_filter,
    })
    return True


def get_submission(handler: BaseHTTPRequestHandler, db_path: Path, sub_id: int) -> bool:
    with db.get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM dtc_submission WHERE id = ?", (sub_id,)
        ).fetchone()
    if row is None:
        _send_json(handler, {"error": "not found"}, status=404)
        return True
    _send_json(handler, _submission_row_to_dict(row))
    return True


def approve_submission(
    handler: BaseHTTPRequestHandler,
    db_path: Path,
    sub_id: int,
    admin_id: int,
    ip: str,
) -> bool:
    body = _read_json_body(handler)
    reviewer_note = ""
    if isinstance(body.get("note"), str):
        reviewer_note = body["note"].strip()[:512]

    with db.get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM dtc_submission WHERE id = ?", (sub_id,)
        ).fetchone()
        if row is None:
            _send_json(handler, {"error": "not found"}, status=404)
            return True
        if row["status"] != "pending":
            _send_json(handler, {"error": f"submission already {row['status']}"},
                       status=409)
            return True

        code = row["code"].upper().strip()
        if not code or len(code) > 16:
            _send_json(handler, {"error": "submission has invalid code"}, status=400)
            return True

        # Promote into the dtc catalog. The submission's proposed_description
        # becomes the catalog description; the existing title is kept (or
        # overridden via the body's title if provided); severity defaults to
        # 'warn' unless overridden.
        title = body.get("title") if isinstance(body.get("title"), str) else None
        title = (title.strip()[:512] if title else row["code"] + " — community description")
        severity = body.get("severity") if body.get("severity") in ("info", "warn", "critical") else "warn"

        existing = conn.execute("SELECT code FROM dtc WHERE code = ?", (code,)).fetchone()
        now = int(time.time())
        if existing is None:
            conn.execute(
                "INSERT INTO dtc (code, category, severity, title, description, "
                "likely_causes, source, verified, enabled, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)",
                (
                    code, _category_for(code), severity, title,
                    row["proposed_description"] or "",
                    None, "community", now, now,
                ),
            )
        else:
            # Existing row: refresh description + verify, leave title alone
            # unless the body explicitly overrode it.
            conn.execute(
                "UPDATE dtc SET description = ?, verified = 1, updated_at = ? "
                "WHERE code = ?",
                (row["proposed_description"] or "", now, code),
            )
            if title and title != code + " — community description":
                conn.execute(
                    "UPDATE dtc SET title = ?, severity = ?, updated_at = ? WHERE code = ?",
                    (title, severity, now, code),
                )

        conn.execute(
            "UPDATE dtc_submission SET status = 'approved', reviewed_at = ?, "
            "reviewer_note = ? WHERE id = ?",
            (now, reviewer_note, sub_id),
        )
        conn.commit()

    audit.record(
        db_path,
        action="submission.approve",
        admin_id=admin_id,
        target=f"id={sub_id}, code={code}",
        ip=ip,
    )
    _send_json(handler, {"ok": True, "code": code})
    return True


def reject_submission(
    handler: BaseHTTPRequestHandler,
    db_path: Path,
    sub_id: int,
    admin_id: int,
    ip: str,
) -> bool:
    body = _read_json_body(handler)
    reviewer_note = ""
    if isinstance(body.get("note"), str):
        reviewer_note = body["note"].strip()[:512]
    if not reviewer_note:
        _send_json(handler, {"error": "note required on reject"}, status=400)
        return True

    with db.get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM dtc_submission WHERE id = ?", (sub_id,)
        ).fetchone()
        if row is None:
            _send_json(handler, {"error": "not found"}, status=404)
            return True
        if row["status"] != "pending":
            _send_json(handler, {"error": f"submission already {row['status']}"},
                       status=409)
            return True
        conn.execute(
            "UPDATE dtc_submission SET status = 'rejected', reviewed_at = ?, "
            "reviewer_note = ? WHERE id = ?",
            (int(time.time()), reviewer_note, sub_id),
        )
        conn.commit()

    audit.record(
        db_path,
        action="submission.reject",
        admin_id=admin_id,
        target=f"id={sub_id}",
        ip=ip,
    )
    _send_json(handler, {"ok": True})
    return True


def _category_for(code: str) -> str:
    """SAE J2012 first-letter → category."""
    if not code:
        return "unknown"
    head = code[0].upper()
    return {
        "P": "powertrain",
        "B": "body",
        "C": "chassis",
        "U": "network",
    }.get(head, "unknown")
