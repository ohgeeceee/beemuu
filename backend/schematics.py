"""Read-only query helpers for the schematics catalog.

The catalog is populated by `backend/seed_schematics.py` at bootstrap time.
Files are stored under `data/schematics/` and served by nginx over
`/static/schematics/<slug>.<ext>` to avoid streaming through Python.

This module is intentionally append-only: it does not expose write endpoints.
Ingestion happens via the seed script (idempotent upserts) and (future) the
community contribution pipeline.

Indexing note: queries use simple LIKE filters. When the catalog grows past
~10k rows we'll want either a generated tsvector column or a sidecar JSON
search index, but that's out of scope for MVP.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from . import db

# Mapping from a schematics.mime value to a stable on-disk extension. The
# API returns `url` of the form `/static/schematics/<slug>.<ext>` so the
# frontend can hand it straight to <img src>. We can't naively split on "/"
# here because image/svg+xml's suffix is "svg+xml", not "svg". Keep this
# table explicit so adding a new mime later is one obvious edit.
_MIME_TO_EXT: dict[str, str] = {
    "image/svg+xml": "svg",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "application/pdf": "pdf",
}


def _extension_for(mime: str) -> str:
    """Stable on-disk extension for a schematics.mime value.

    Falls back to the substring after the last '/' (e.g. 'pdf' for an
    unrecognised application/pdf) so we never return a broken URL.
    """
    if mime in _MIME_TO_EXT:
        return _MIME_TO_EXT[mime]
    # Fallback: best-effort suffix so the URL still serves the file.
    if "/" in mime:
        return mime.split("/")[-1].split("+")[0] or "bin"
    return "bin"

# Allowed values for the schematics.series column. Keep in sync with the
# series taxonomy used elsewhere (community profiles, seed_bmw_dim01).
VALID_SERIES = frozenset({
    "e30", "e31", "e32", "e34", "e36", "e38", "e39", "e46", "e53", "e60",
    "e61", "e63", "e64", "e70", "e71", "e83", "e84", "e85", "e86", "e87",
    "e89", "e90", "e91", "e92", "e93", "f01", "f02", "f06", "f07", "f10",
    "f11", "f12", "f13", "f15", "f16", "f20", "f21", "f22", "f23", "f25",
    "f26", "f30", "f31", "f32", "f33", "f34", "f36", "f39", "f45", "f46",
    "f48", "f80", "f82", "f83", "f85", "f86", "f87", "f90", "f91", "f92",
    "f93", "f95", "f97", "f98", "g01", "g02", "g05", "g06", "g07", "g11",
    "g12", "g14", "g15", "g16", "g20", "g21", "g22", "g23", "g26", "g28",
    "g29", "g30", "g31", "g32", "g42", "g60", "g70", "g80", "g82", "i01",
    "i03", "i04", "i12", "i15", "i20", "iX1", "iX3", "i4", "i5", "i7",
    "i8", "X3", "X4", "X5", "X6", "X7", "Z3", "Z4",
})

VALID_SYSTEMS = frozenset({
    "DME", "DDE", "EGS", "CAS", "FRM", "IHKA", "IHKR", "NBT", "CIC", "CCC",
    "MOST", "K-CAN", "K-CAN2", "PT-CAN", "PT-CAN2", "FlexRay", "Ethernet",
    "diagnosis", "body", "chassis", "drivetrain", "infotainment",
    "lighting", "comfort", "powertrain",
})


def _row_to_dict(row: sqlite3.Row) -> dict:
    """Convert a schematics-table row to a JSON-friendly dict."""
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
        "url": f"/static/schematics/{row['slug']}.{_extension_for(row['mime'])}",
        "mime": row["mime"],
        "width_px": row["width_px"],
        "height_px": row["height_px"],
        "source_url": row["source_url"],
        "license": row["license"],
        "tags": [t for t in (row["tags"] or "").split(",") if t],
        "created_at": row["created_at"],
    }


def get_schematic_by_slug(db_path: Path, slug: str) -> dict | None:
    """Return one schematic row as a dict, or None if not found."""
    slug = slug.strip()
    if not slug:
        return None
    with db.get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM schematics WHERE slug = ?", (slug,)
        ).fetchone()
    if row is None:
        return None
    return _row_to_dict(row)


def list_schematics(
    db_path: Path,
    *,
    series: str | None = None,
    system: str | None = None,
    q: str | None = None,
    limit: int = 100,
) -> list[dict]:
    """List schematics, optionally filtered by series, system, and a
    case-insensitive substring match against title or tags.

    limit is clamped to [1, 500]. Series and system, if provided, must be in
    the allow-lists (case-insensitive on series).
    """
    limit = max(1, min(500, int(limit)))
    where: list[str] = []
    params: list[object] = []
    if series:
        if series.lower() not in {s.lower() for s in VALID_SERIES}:
            # Unknown series → return empty result rather than 500. Callers
            # do their own validation; this is a defensive belt.
            return []
        where.append("LOWER(series) = ?")
        params.append(series.lower())
    if system:
        if system not in VALID_SYSTEMS:
            return []
        where.append("system = ?")
        params.append(system)
    if q:
        where.append("(LOWER(title) LIKE ? OR LOWER(COALESCE(tags, '')) LIKE ?)")
        like = f"%{q.lower()}%"
        params.extend([like, like])
    sql = "SELECT * FROM schematics"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY series ASC, system ASC, title ASC LIMIT ?"
    params.append(limit)
    with db.get_conn(db_path) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def schema_table_exists(db_path: Path) -> bool:
    """Test helper: returns True iff the schematics table has been created.

    Used by unit tests to confirm the migration runs at bootstrap.
    """
    with db.get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name='schematics'"
        ).fetchone()
    return row is not None
