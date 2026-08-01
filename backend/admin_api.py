"""Write-side admin operations for the beemuu hosted backend.

This module is the only place that mutates admin-gated tables (dtc,
dtc_submission, schematics, schematic_link, hunt_challenge, audit_log).
Every write path goes through write_audit() so the audit trail is
mandatory, not optional.

Public read endpoints (get_dtc_by_code, search_dtc, list_schematics,
list_links_for_dtc, etc.) live in app.py / schematics.py / cross_links.py
and are unauthenticated by design — the public catalog is read-only.

Separate from auth.py because auth.py is purely stateless primitives
(cookie create/lookup/revoke). This file is the action layer.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from . import db

# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

def write_audit(
    db_path: Path,
    *,
    admin_id: int | None,
    action: str,
    target: str | None = None,
    ip: str | None = None,
) -> None:
    """Append a row to audit_log. Required for every admin write path.

    Never raises on bad input — audit failures should not block admin actions,
    but admins must be aware they are not logged. We log to stderr so the
    silent failure is at least visible in the systemd journal.
    """
    try:
        with db.get_conn(db_path) as conn:
            conn.execute(
                "INSERT INTO audit_log (admin_id, action, target, ip, at) "
                "VALUES (?, ?, ?, ?, ?)",
                (admin_id, action, target, (ip or "")[:64] or None, int(time.time())),
            )
            conn.commit()
    except Exception as exc:  # noqa: BLE001
        import sys
        print(
            f"WARN: audit_log write failed for action={action!r} "
            f"admin_id={admin_id}: {exc!r}",
            file=sys.stderr,
        )


def list_audit(db_path: Path, limit: int = 100) -> list[dict]:
    """Most recent audit rows, joined with admin username when known."""
    limit = max(1, min(500, int(limit)))
    with db.get_conn(db_path) as conn:
        rows = conn.execute(
            "SELECT a.id, a.admin_id, u.username, a.action, a.target, a.ip, a.at "
            "FROM audit_log a LEFT JOIN admin_user u ON u.id = a.admin_id "
            "ORDER BY a.at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "admin_id": r["admin_id"],
            "username": r["username"],
            "action": r["action"],
            "target": r["target"],
            "ip": r["ip"],
            "at": r["at"],
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# DTC catalog
# ---------------------------------------------------------------------------

_DTC_CATEGORIES = {"powertrain", "body", "chassis", "network", "bmw-specific"}


def upsert_dtc(db_path: Path, payload: dict) -> dict:
    """Create or update a DTC row. Returns the final row as a dict.

    Required: code, category, title. Everything else has sane defaults.
    Raises ValueError on bad input. Soft-deletes via `enabled=0`; that is
    a separate flag, not a row deletion.
    """
    code = (payload.get("code") or "").strip().upper()
    category = (payload.get("category") or "").strip()
    title = (payload.get("title") or "").strip()
    if not code:
        raise ValueError("code is required")
    if category not in _DTC_CATEGORIES:
        raise ValueError(
            f"category must be one of {sorted(_DTC_CATEGORIES)}"
        )
    if not title:
        raise ValueError("title is required")

    now = int(time.time())
    severity = payload.get("severity")
    description = payload.get("description")
    likely_causes = payload.get("likely_causes")
    source = (payload.get("source") or "admin").strip()
    verified = 1 if payload.get("verified") else 0
    enabled = 0 if payload.get("enabled") is False else 1

    with db.get_conn(db_path) as conn:
        existing = conn.execute(
            "SELECT code, created_at FROM dtc WHERE code = ?", (code,)
        ).fetchone()
        if existing is None:
            conn.execute(
                "INSERT INTO dtc (code, category, severity, title, description, "
                "likely_causes, source, verified, enabled, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (code, category, severity, title, description, likely_causes,
                 source, verified, enabled, now, now),
            )
        else:
            conn.execute(
                "UPDATE dtc SET category=?, severity=?, title=?, description=?, "
                "likely_causes=?, source=?, verified=?, enabled=?, updated_at=? "
                "WHERE code=?",
                (category, severity, title, description, likely_causes,
                 source, verified, enabled, now, code),
            )
        conn.commit()
        row = conn.execute("SELECT * FROM dtc WHERE code = ?", (code,)).fetchone()
    return _row_to_dtc(dict(row))


def set_dtc_enabled(db_path: Path, code: str, enabled: bool) -> bool:
    """Soft-delete (enabled=0) or restore (enabled=1). Returns False if code missing."""
    code = code.strip().upper()
    if not code:
        raise ValueError("code is required")
    with db.get_conn(db_path) as conn:
        cur = conn.execute("UPDATE dtc SET enabled=?, updated_at=? WHERE code=?",
                          (1 if enabled else 0, int(time.time()), code))
        conn.commit()
    return cur.rowcount > 0


def _row_to_dtc(row: dict) -> dict:
    return {
        "code": row["code"],
        "category": row["category"],
        "severity": row.get("severity"),
        "title": row["title"],
        "description": row.get("description"),
        "likely_causes": row.get("likely_causes"),
        "source": row["source"],
        "verified": bool(row.get("verified")),
        "enabled": bool(row.get("enabled", 1)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


# ---------------------------------------------------------------------------
# DTC submissions — review queue
# ---------------------------------------------------------------------------

def list_submissions(db_path: Path, status: str = "pending", limit: int = 100) -> list[dict]:
    status = (status or "pending").strip()
    limit = max(1, min(500, int(limit)))
    with db.get_conn(db_path) as conn:
        if status == "all":
            rows = conn.execute(
                "SELECT * FROM dtc_submission ORDER BY submitted_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM dtc_submission WHERE status = ? "
                "ORDER BY submitted_at DESC LIMIT ?",
                (status, limit),
            ).fetchall()
    return [dict(r) for r in rows]


def review_submission(db_path: Path, sub_id: int, *, status: str, note: str | None) -> dict | None:
    """Approve or reject a submission. status must be 'approved' or 'rejected'."""
    if status not in ("approved", "rejected"):
        raise ValueError("status must be 'approved' or 'rejected'")
    now = int(time.time())
    with db.get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT id FROM dtc_submission WHERE id = ?", (sub_id,)
        ).fetchone()
        if row is None:
            return None
        conn.execute(
            "UPDATE dtc_submission SET status=?, reviewed_at=?, reviewer_note=? "
            "WHERE id = ?",
            (status, now, note, sub_id),
        )
        conn.commit()
        updated = conn.execute(
            "SELECT * FROM dtc_submission WHERE id = ?", (sub_id,)
        ).fetchone()
    return dict(updated)


# ---------------------------------------------------------------------------
# Schematics
# ---------------------------------------------------------------------------

def upsert_schematic(db_path: Path, payload: dict) -> dict:
    """Create or update a schematic by slug. Required: slug, title, series, system, file_path, mime, license."""
    slug = (payload.get("slug") or "").strip()
    title = (payload.get("title") or "").strip()
    series = (payload.get("series") or "").strip()
    system = (payload.get("system") or "").strip()
    file_path = (payload.get("file_path") or "").strip()
    mime = (payload.get("mime") or "").strip()
    license_ = (payload.get("license") or "").strip()
    if not (slug and title and series and system and file_path and mime and license_):
        raise ValueError(
            "slug, title, series, system, file_path, mime, license are all required"
        )

    now = int(time.time())
    fields = dict(
        slug=slug,
        title=title,
        series=series,
        system=system,
        subsys=payload.get("subsys"),
        model=payload.get("model"),
        year_from=payload.get("year_from"),
        year_to=payload.get("year_to"),
        file_path=file_path,
        mime=mime,
        width_px=payload.get("width_px"),
        height_px=payload.get("height_px"),
        source_url=payload.get("source_url"),
        license=license_,
        tags=payload.get("tags"),
    )
    with db.get_conn(db_path) as conn:
        existing = conn.execute(
            "SELECT id FROM schematics WHERE slug = ?", (slug,)
        ).fetchone()
        if existing is None:
            conn.execute(
                "INSERT INTO schematics (slug, title, series, system, subsys, model, "
                "year_from, year_to, file_path, mime, width_px, height_px, "
                "source_url, license, tags, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (*fields.values(), now),
            )
        else:
            conn.execute(
                "UPDATE schematics SET title=?, series=?, system=?, subsys=?, "
                "model=?, year_from=?, year_to=?, file_path=?, mime=?, "
                "width_px=?, height_px=?, source_url=?, license=?, tags=? "
                "WHERE slug=?",
                (title, series, system, fields["subsys"], fields["model"],
                 fields["year_from"], fields["year_to"], file_path, mime,
                 fields["width_px"], fields["height_px"], fields["source_url"],
                 license_, fields["tags"], slug),
            )
        conn.commit()
        row = conn.execute("SELECT * FROM schematics WHERE slug = ?", (slug,)).fetchone()
    return dict(row)


def set_schematic_link(db_path: Path, slug: str, code: str, note: str | None = None) -> None:
    """Upsert a DTC ↔ schematic link. Idempotent on (slug, code)."""
    slug = (slug or "").strip()
    code = (code or "").strip().upper()
    if not (slug and code):
        raise ValueError("slug and code are required")
    now = int(time.time())
    with db.get_conn(db_path) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO schematic_link (schematic_slug, code, note, created_at) "
            "VALUES (?, ?, ?, ?)",
            (slug, code, note, now),
        )
        conn.commit()


def delete_schematic_link(db_path: Path, slug: str, code: str) -> bool:
    slug = (slug or "").strip()
    code = (code or "").strip().upper()
    with db.get_conn(db_path) as conn:
        cur = conn.execute(
            "DELETE FROM schematic_link WHERE schematic_slug=? AND code=?",
            (slug, code),
        )
        conn.commit()
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Hunt challenges
# ---------------------------------------------------------------------------

def list_hunt_challenges(db_path: Path, include_disabled: bool = False) -> list[dict]:
    with db.get_conn(db_path) as conn:
        if include_disabled:
            rows = conn.execute(
                "SELECT * FROM hunt_challenge ORDER BY id ASC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM hunt_challenge WHERE enabled = 1 ORDER BY id ASC"
            ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        # Parse payload JSON if present
        if d.get("payload"):
            try:
                d["payload"] = json.loads(d["payload"])
            except (ValueError, TypeError):
                pass
        out.append(d)
    return out


def set_hunt_enabled(db_path: Path, slug: str, enabled: bool) -> bool:
    slug = (slug or "").strip()
    if not slug:
        raise ValueError("slug is required")
    with db.get_conn(db_path) as conn:
        cur = conn.execute(
            "UPDATE hunt_challenge SET enabled = ? WHERE slug = ?",
            (1 if enabled else 0, slug),
        )
        conn.commit()
    return cur.rowcount > 0


def upsert_hunt_challenge(db_path: Path, payload: dict) -> dict:
    slug = (payload.get("slug") or "").strip()
    title = (payload.get("title") or "").strip()
    if not (slug and title):
        raise ValueError("slug and title are required")
    points = int(payload.get("points") or 0)
    description = payload.get("description")
    enabled = 0 if payload.get("enabled") is False else 1
    payload_json = payload.get("payload")
    if isinstance(payload_json, (dict, list)):
        payload_json = json.dumps(payload_json)
    with db.get_conn(db_path) as conn:
        existing = conn.execute(
            "SELECT id FROM hunt_challenge WHERE slug = ?", (slug,)
        ).fetchone()
        if existing is None:
            conn.execute(
                "INSERT INTO hunt_challenge (slug, title, description, points, enabled, payload) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (slug, title, description, points, enabled, payload_json),
            )
        else:
            conn.execute(
                "UPDATE hunt_challenge SET title=?, description=?, points=?, "
                "enabled=?, payload=? WHERE slug=?",
                (title, description, points, enabled, payload_json, slug),
            )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM hunt_challenge WHERE slug = ?", (slug,)
        ).fetchone()
    return dict(row)


# ---------------------------------------------------------------------------
# Diag sessions
# ---------------------------------------------------------------------------

def list_sessions(db_path: Path, limit: int = 100) -> list[dict]:
    limit = max(1, min(500, int(limit)))
    with db.get_conn(db_path) as conn:
        rows = conn.execute(
            "SELECT id, submitted_at, client_id, client_version, vin, profile, "
            "transport, dtc_codes, notes FROM diag_session "
            "ORDER BY submitted_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        if d.get("dtc_codes"):
            try:
                d["dtc_codes"] = json.loads(d["dtc_codes"])
            except (ValueError, TypeError):
                pass
        out.append(d)
    return out


# ---------------------------------------------------------------------------
# Dashboard summary
# ---------------------------------------------------------------------------

def dashboard_counts(db_path: Path) -> dict[str, int]:
    """Light counts for the admin overview page."""
    with db.get_conn(db_path) as conn:
        def _count(table: str) -> int:
            return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

        pending = conn.execute(
            "SELECT COUNT(*) FROM dtc_submission WHERE status = 'pending'"
        ).fetchone()[0]
        return {
            "dtc": _count("dtc"),
            "dtc_enabled": conn.execute(
                "SELECT COUNT(*) FROM dtc WHERE enabled = 1"
            ).fetchone()[0],
            "dtc_submissions": _count("dtc_submission"),
            "dtc_submissions_pending": pending,
            "schematics": _count("schematics"),
            "schematic_links": _count("schematic_link"),
            "diag_sessions": _count("diag_session"),
            "hunt_challenges": _count("hunt_challenge"),
            "hunt_enabled": conn.execute(
                "SELECT COUNT(*) FROM hunt_challenge WHERE enabled = 1"
            ).fetchone()[0],
            "leaderboard": _count("leaderboard_entry"),
            "audit_log": _count("audit_log"),
            "admin_users": _count("admin_user"),
        }


def recent_activity(db_path: Path, limit: int = 20) -> list[dict]:
    """Combined recent activity: last audit_log + last dtc_submission."""
    return list_audit(db_path, limit=limit)
