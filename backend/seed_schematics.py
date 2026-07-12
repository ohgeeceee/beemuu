"""Seed three CC0 schematic SVGs into the schematics catalog.

All three are hand-drawn by the project owner and released as CC0
(public-domain dedication). They are deliberately minimal so the catalog
ingestion and API plumbing are exercised end-to-end without leaning on
copyrighted OEM material.

Actual SVG files live at `data/schematics/<slug>.svg` and are served as-is
by nginx at `/static/schematics/...`. The `file_path` column here is
relative to the repo root, used by ops to verify on-disk presence.

Future seeders will pull from a community-curated `data/schematics/`
directory — when community contributions land, this module becomes the
canonical ingest point.
"""
from __future__ import annotations

from pathlib import Path

from . import seed

# (slug, title, series, system, subsys, model, year_from, year_to,
#  file_path, mime, width_px, height_px, source_url, license, tags)
_ROWS: list[tuple] = [
    (
        "e89-z4-rcd3302-power-can",
        "RCD 3302 head-unit: power + K-CAN tap",
        "e89",
        "infotainment",
        "head-unit",
        "Z4 (e89)",
        2009,
        2016,
        "data/schematics/e89-z4-rcd3302-power-can.svg",
        "image/svg+xml",
        800,
        500,
        None,
        "CC0",
        "rcd3302,k-can,power,e89,z4",
    ),
    (
        "e90-cas3-pinout",
        "CAS3/CAS4 connector pinout (e90 reference)",
        "e90",
        "CAS",
        "cas3",
        "3 Series (e90)",
        2005,
        2013,
        "data/schematics/e90-cas3-pinout.svg",
        "image/svg+xml",
        800,
        500,
        None,
        "CC0",
        "cas,cas3,cas4,pinout,e90,3-series,ignition,key",
    ),
    (
        "e60-n54-dme-power",
        "N54 DME main relay + power distribution (e60 reference)",
        "e60",
        "DME",
        "n54-main-relay",
        "5 Series (e60)",
        2003,
        2010,
        "data/schematics/e60-n54-dme-power.svg",
        "image/svg+xml",
        800,
        600,
        None,
        "CC0",
        "dme,msd80,msv70,n54,main-relay,power,e60,5-series",
    ),
]


def _row_to_dict(row: tuple) -> dict:
    (slug, title, series, system, subsys, model, year_from, year_to,
     file_path, mime, width_px, height_px, source_url, license, tags) = row
    return {
        "slug": slug,
        "title": title,
        "series": series,
        "system": system,
        "subsys": subsys,
        "model": model,
        "year_from": year_from,
        "year_to": year_to,
        "file_path": file_path,
        "mime": mime,
        "width_px": width_px,
        "height_px": height_px,
        "source_url": source_url,
        "license": license,
        "tags": tags,
    }


def run(db_path: Path) -> int:
    """Idempotent upsert of the schematics rows. Returns count seeded.

    Uses raw SQL rather than `seed.seed_many()` because the schematics
    table has its own column set and a different PK (auto-increment `id`
    vs. the DTC `code` PK).
    """
    import time
    from . import db

    count = 0
    now = int(time.time())
    with db.get_conn(db_path) as conn:
        for row in _ROWS:
            d = _row_to_dict(row)
            existing = conn.execute(
                "SELECT id FROM schematics WHERE slug = ?", (d["slug"],)
            ).fetchone()
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO schematics (
                        slug, title, series, system, subsys, model,
                        year_from, year_to, file_path, mime,
                        width_px, height_px, source_url, license, tags,
                        created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        d["slug"], d["title"], d["series"], d["system"],
                        d["subsys"], d["model"], d["year_from"], d["year_to"],
                        d["file_path"], d["mime"], d["width_px"],
                        d["height_px"], d["source_url"], d["license"],
                        d["tags"], now,
                    ),
                )
            else:
                conn.execute(
                    """
                    UPDATE schematics SET
                        title = ?, series = ?, system = ?, subsys = ?,
                        model = ?, year_from = ?, year_to = ?,
                        file_path = ?, mime = ?, width_px = ?,
                        height_px = ?, source_url = ?, license = ?,
                        tags = ?
                    WHERE slug = ?
                    """,
                    (
                        d["title"], d["series"], d["system"], d["subsys"],
                        d["model"], d["year_from"], d["year_to"],
                        d["file_path"], d["mime"], d["width_px"],
                        d["height_px"], d["source_url"], d["license"],
                        d["tags"], d["slug"],
                    ),
                )
            count += 1
        conn.commit()
    return count


# Auto-register with the bootstrap registry so a fresh server pre-seeds.
seed.register_source(run)
