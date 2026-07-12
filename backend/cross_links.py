"""Read-only query helpers for the DTC ↔ schematic cross-link table.

The `schematic_link` table is a many-to-many between DTC codes and
schematics slugs. Each (slug, code) pair is unique; admin curators add
rows via ops tooling or a future community submission UI.

Public API:
  list_links_for_dtc(db_path, code)        -> list[dict]
  list_links_for_schematic(db_path, slug)  -> list[dict]
  schema_table_exists(db_path)             -> bool  (test helper)
  link_one(db_path, slug=..., code=..., note=...) -> None

Row shape returned to API/JSON:
  {
    "schematic_slug": "e90-cas3-pinout",
    "code": "29E0",
    "note": "DME cannot reach CAS over PT-CAN",
    "created_at": 1700000000,
    "schematic": { ...full schematic row... },
    "dtc": { ...full DTC row, or None if missing... },
  }

The `schematic` field is the joined row from the schematics table so the
caller can render a card without a second hop. Same for `dtc` — it's
None if the underlying DTC code has been disabled/deleted from the
catalog (we still return the link, but the front-end can choose to show
a "referenced code is currently disabled" badge).

Indexing note: PRIMARY KEY (slug, code) plus secondary indexes on each
column mean lookups by either side are cheap. Full-text search across
notes is not in MVP scope; if needed, a future tsvector column can be
added without breaking this module's contract.
"""
from __future__ import annotations

import sqlite3
import time
from pathlib import Path

from . import db

# Mapping from schematics.mime to a stable file extension on disk. Kept
# in sync with backend.schematics._MIME_TO_EXT. Do not duplicate this
# mapping when adding new mimes — update the schematics module and copy
# the change here too (a test asserts the values match).
_MIME_TO_EXT: dict[str, str] = {
    "image/svg+xml": "svg",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "application/pdf": "pdf",
}


def _ext_for(mime: str) -> str:
    if mime in _MIME_TO_EXT:
        return _MIME_TO_EXT[mime]
    if "/" in mime:
        return mime.split("/")[-1].split("+")[0] or "bin"
    return "bin"


def _normalize_code(code: str) -> str:
    return code.strip().upper()


# ---- Schematics-side payload ----------------------------------------------------

# Columns selected from the schematics table for join payloads. We project
# the same column list as backend.schematics._row_to_dict so a cross-link
# response and a /api/schematics/<slug> response carry the same shape on
# the `schematic` field.
_SCHEMATIC_COLS = (
    "id", "slug", "title", "series", "system", "subsys", "model",
    "year_from", "year_to", "file_path", "mime",
    "width_px", "height_px", "source_url", "license", "tags",
    "created_at",
)


def _schematic_payload(row: dict) -> dict:
    """Subset of the schematics row we want to expose via cross-link joins.

    Mirrors the relevant fields from backend.schematics._row_to_dict but
    computes the `url` here using our private _ext_for() so we don't
    import schematics.py (which would create an unwanted dependency from
    the join helpers into the seed/list module).
    """
    return {
        "id": row["id"],
        "slug": row["slug"],
        "title": row["title"],
        "series": row["series"],
        "system": row["system"],
        "subsys": row["subsys"],
        "model": row["model"],
        "year_from": row["year_from"],
        "year_to": row["year_to"],
        "file_path": row["file_path"],
        "url": f"/static/schematics/{row['slug']}.{_ext_for(row['mime'])}",
        "mime": row["mime"],
        "width_px": row["width_px"],
        "height_px": row["height_px"],
        "source_url": row["source_url"],
        "license": row["license"],
        "tags": [t for t in (row["tags"] or "").split(",") if t],
        "created_at": row["created_at"],
    }


def _dtc_payload(row: dict) -> dict:
    """Subset of the dtc row — code, title, category, severity.

    We deliberately do not return the full DTC description here. That's
    the job of the existing /api/dtc/<code> endpoint. Cross-link results
    are summary-only so a 200-link response stays small.
    """
    return {
        "code": row["code"],
        "title": row["title"],
        "category": row["category"],
        "severity": row["severity"],
    }


# ---- SQL builders ---------------------------------------------------------------

# We deliberately query schematics via a sub-select (or via a direct
# alias using d.something — but that requires renaming every column).
# A LEFT JOIN keeps it readable. To project the same column names as a
# plain schematics.* select, we alias each column on the joined table.
_SCHEMATIC_ALIAS = ", ".join(f"s.{c} AS {c}" for c in _SCHEMATIC_COLS)


def _sql_for_code() -> str:
    return (
        f"SELECT l.schematic_slug AS schematic_slug, "
        f"l.code AS code, l.note AS note, l.created_at AS created_at, "
        f"{_SCHEMATIC_ALIAS}, "
        f"d.code AS d_code, d.title AS d_title, "
        f"d.category AS d_category, d.severity AS d_severity "
        f"FROM schematic_link l "
        f"JOIN schematics s ON s.slug = l.schematic_slug "
        f"LEFT JOIN dtc d ON d.code = l.code"
    )


def _sql_for_slug() -> str:
    return (
        f"SELECT l.schematic_slug AS schematic_slug, "
        f"l.code AS code, l.note AS note, l.created_at AS created_at, "
        f"{_SCHEMATIC_ALIAS}, "
        f"d.code AS d_code, d.title AS d_title, "
        f"d.category AS d_category, d.severity AS d_severity "
        f"FROM schematic_link l "
        f"JOIN schematics s ON s.slug = l.schematic_slug "
        f"LEFT JOIN dtc d ON d.code = l.code"
    )


def _row_to_dict(row: sqlite3.Row) -> dict:
    """Build a JSON-ready dict for a single cross-link row.

    Pulls schematic and dtc fields out of the JOIN result row. The
    `_schematic_payload` helper accepts a plain mapping rather than a
    sqlite3.Row so we don't need to fake-shape the joined row.
    """
    sch_data = {c: row[c] for c in _SCHEMATIC_COLS}
    dtc_present = row["d_code"] is not None
    dtc_data = (
        {
            "code": row["d_code"],
            "title": row["d_title"],
            "category": row["d_category"],
            "severity": row["d_severity"],
        }
        if dtc_present
        else None
    )
    return {
        "schematic_slug": row["schematic_slug"],
        "code": row["code"],
        "note": row["note"],
        "created_at": row["created_at"],
        "schematic": _schematic_payload(sch_data),
        "dtc": _dtc_payload(dtc_data) if dtc_data is not None else None,
    }


# ---- Public functions -----------------------------------------------------------

def list_links_for_dtc(
    db_path: Path,
    code: str,
    *,
    include_disabled: bool = False,
    limit: int = 500,
) -> list[dict]:
    """Return all cross-links pointing at the given DTC code.

    Joins schematics (always, even if disabled — slugs are immutable) and
    the dtc row (optional via include_disabled). When include_disabled is
    False, links whose dtc reference has been disabled are filtered out
    at the SQL level.
    """
    limit = max(1, min(500, int(limit)))
    code = _normalize_code(code)
    if not code:
        return []
    sql = _sql_for_code() + " WHERE l.code = ?"
    if not include_disabled:
        sql += " AND (d.enabled IS NULL OR d.enabled = 1)"
    sql += " ORDER BY l.schematic_slug ASC LIMIT ?"
    with db.get_conn(db_path) as conn:
        rows = conn.execute(sql, (code, limit)).fetchall()
    return [_row_to_dict(r) for r in rows]


def list_links_for_schematic(
    db_path: Path,
    slug: str,
    *,
    include_disabled: bool = False,
    limit: int = 500,
) -> list[dict]:
    """Return all cross-links pointing at the given schematic slug.

    Symmetric to list_links_for_dtc; same filter semantics.
    """
    limit = max(1, min(500, int(limit)))
    slug = slug.strip()
    if not slug:
        return []
    sql = _sql_for_slug() + " WHERE l.schematic_slug = ?"
    if not include_disabled:
        sql += " AND (d.enabled IS NULL OR d.enabled = 1)"
    sql += " ORDER BY l.code ASC LIMIT ?"
    with db.get_conn(db_path) as conn:
        rows = conn.execute(sql, (slug, limit)).fetchall()
    return [_row_to_dict(r) for r in rows]


def schema_table_exists(db_path: Path) -> bool:
    """Test helper: confirms the migration ran on bootstrap."""
    with db.get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name='schematic_link'"
        ).fetchone()
    return row is not None


def link_one(
    db_path: Path,
    *,
    slug: str,
    code: str,
    note: str | None,
) -> None:
    """Insert or update a single schematic_link row. Idempotent.

    Used by seed_cross_links.py. Public so future admin tooling can reuse
    it without going through SQL.
    """
    slug = slug.strip()
    code = _normalize_code(code)
    if not slug or not code:
        raise ValueError("slug and code are required")
    now = int(time.time())
    with db.get_conn(db_path) as conn:
        existing = conn.execute(
            "SELECT created_at FROM schematic_link "
            "WHERE schematic_slug = ? AND code = ?",
            (slug, code),
        ).fetchone()
        if existing is None:
            conn.execute(
                "INSERT INTO schematic_link "
                "(schematic_slug, code, note, created_at) "
                "VALUES (?, ?, ?, ?)",
                (slug, code, note, now),
            )
        else:
            conn.execute(
                "UPDATE schematic_link SET note = ? "
                "WHERE schematic_slug = ? AND code = ?",
                (note, slug, code),
            )
        conn.commit()
