"""Idempotent DTC seeding for the beemuu admin panel.

The admin panel ships with a DTC catalog pre-populated so users searching
generic codes (P0171, P0301, etc.) get an immediate answer on day one. This
module provides:

  - `seed_one()`: insert or update a single DTC row (UPSERT on the code PK).
  - `seed_many()`: bulk insert, atomic on failure (one bad row → zero
    committed).
  - `run_bootstrap()`: iterate the registered `SOURCES` list and run each.
  - `SOURCES`: the registry of seed functions the bootstrapper iterates.

Why a registry (and not hardcoded imports)? It keeps `seed.py` decoupled from
the actual seed modules. Adding a new seed source is one append to SOURCES.
Tests can substitute fake sources without monkey-patching imports.

The DTC code format follows the SAE J2012 standard:
  - P0xxx / P1xxx / P2xxx / P3xxx — powertrain
  - B0xxx / B1xxx / B2xxx / B3xxx — body
  - C0xxx / C1xxx / C2xxx / C3xxx — chassis
  - U0xxx / U1xxx / U2xxx / U3xxx — network/communication
BMW-specific codes are 4 hex chars (e.g. "29E0", "2A82") — we accept them
under the "bmw-specific" category with a relaxed 4-char regex.
"""
from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Callable, Iterable

from . import db

# Categories allowed in the dtc.category column.
VALID_CATEGORIES = frozenset({"powertrain", "body", "chassis", "network", "bmw-specific"})

# SAE J2012 standard codes: letter + 4 hex (P0171, B0001, U0100, etc.)
_SAE_CODE = re.compile(r"^[PBCU][0-9A-Fa-f]{4}$")
# BMW-specific hex codes: 29E0, 2A82, etc. The OEM hex length is 4 (most
# common) but B58-era powertrain codes use 6-hex groupings (e.g. "120308"
# for "charging pressure control: too low"), so we accept 4–6 hex chars.
_BMW_CODE = re.compile(r"^[0-9A-Fa-f]{4,6}$")


def _validate_code(code: str, category: str) -> None:
    if not isinstance(code, str) or not code:
        raise ValueError(f"DTC code must be a non-empty string; got {code!r}")
    if category == "bmw-specific":
        if not _BMW_CODE.match(code):
            raise ValueError(
                f"BMW-specific code must be 4–6 hex chars; got {code!r}"
            )
    else:
        if not _SAE_CODE.match(code):
            raise ValueError(
                f"SAE J2012 code must match ^[PBCU][0-9A-F]{{4}}$; got {code!r}"
            )


def _validate_category(category: str) -> None:
    if category not in VALID_CATEGORIES:
        raise ValueError(
            f"unknown category {category!r}; must be one of {sorted(VALID_CATEGORIES)}"
        )


def seed_one(
    db_path: Path,
    *,
    code: str,
    category: str,
    title: str,
    description: str | None,
    likely_causes: str | None,
    severity: str | None,
    source: str,
    verified: int,
    now: int,
) -> None:
    """Insert or update a single DTC row. Idempotent on `code` (PK)."""
    _validate_code(code, category)
    _validate_category(category)
    with db.get_conn(db_path) as conn:
        existing = conn.execute(
            "SELECT created_at FROM dtc WHERE code = ?", (code,)
        ).fetchone()
        if existing is None:
            conn.execute(
                """
                INSERT INTO dtc (code, category, severity, title, description,
                                 likely_causes, source, verified, enabled,
                                 created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    code,
                    category,
                    severity,
                    title,
                    description,
                    likely_causes,
                    source,
                    verified,
                    now,
                    now,
                ),
            )
        else:
            # Update fields; preserve created_at.
            conn.execute(
                """
                UPDATE dtc SET
                    category = ?, severity = ?, title = ?, description = ?,
                    likely_causes = ?, source = ?, verified = ?, updated_at = ?
                WHERE code = ?
                """,
                (
                    category,
                    severity,
                    title,
                    description,
                    likely_causes,
                    source,
                    verified,
                    now,
                    code,
                ),
            )
        conn.commit()


def seed_many(db_path: Path, rows: Iterable[dict]) -> int:
    """Bulk-insert rows. All-or-nothing transaction.

    Each row must have the keys: code, category, title, description,
    likely_causes, severity, source, verified. Uses a single timestamp for
    all rows in the batch.
    """
    rows = list(rows)
    if not rows:
        return 0
    now = int(time.time())
    # Open one connection for the whole batch; we want atomicity.
    with db.get_conn(db_path) as conn:
        try:
            for row in rows:
                _seed_one_with_conn(conn, row, now)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return len(rows)


def _seed_one_with_conn(conn, row: dict, now: int) -> None:
    """Like seed_one but reuses an existing connection (no commit per row)."""
    code = row["code"]
    category = row["category"]
    _validate_code(code, category)
    _validate_category(category)
    existing = conn.execute(
        "SELECT created_at FROM dtc WHERE code = ?", (code,)
    ).fetchone()
    if existing is None:
        conn.execute(
            """
            INSERT INTO dtc (code, category, severity, title, description,
                             likely_causes, source, verified, enabled,
                             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                code,
                category,
                row.get("severity"),
                row["title"],
                row.get("description"),
                row.get("likely_causes"),
                row["source"],
                row["verified"],
                now,
                now,
            ),
        )
    else:
        conn.execute(
            """
            UPDATE dtc SET
                category = ?, severity = ?, title = ?, description = ?,
                likely_causes = ?, source = ?, verified = ?, updated_at = ?
            WHERE code = ?
            """,
            (
                category,
                row.get("severity"),
                row["title"],
                row.get("description"),
                row.get("likely_causes"),
                row["source"],
                row["verified"],
                now,
                code,
            ),
        )


# Registry of seed-source functions. Each takes the db_path. Order matters
# for predictable output but not for correctness (every source is idempotent).
SOURCES: list[Callable[[Path], None]] = []


def register_source(func: Callable[[Path], None]) -> Callable[[Path], None]:
    """Decorator to register a function as a seed source."""
    SOURCES.append(func)
    return func


def run_bootstrap(db_path: Path) -> None:
    """Run every registered seed source. Idempotent."""
    for source in SOURCES:
        source(db_path)