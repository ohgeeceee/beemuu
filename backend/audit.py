"""Tiny audit-log helper for the beemuu admin panel.

Stdlib only. Every privileged action should call `record()` so we have a trail
of who did what. Failures to record must NOT break the operation being logged —
audit is best-effort, never blocking.
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

from . import db


def record(
    db_path: Path,
    *,
    action: str,
    admin_id: Optional[int] = None,
    target: Optional[str] = None,
    ip: Optional[str] = None,
) -> None:
    """Write a row to the audit_log table. Never raises.

    A failure here would mean we lose a log line, not that we lose the user's
    action. The caller has already done the work; we just want breadcrumbs.
    """
    try:
        with db.get_conn(db_path) as conn:
            conn.execute(
                "INSERT INTO audit_log (admin_id, action, target, ip, at) "
                "VALUES (?, ?, ?, ?, ?)",
                (admin_id, action, target, ip[:64] if ip else None, int(time.time())),
            )
            conn.commit()
    except Exception as exc:  # noqa: BLE001 - audit must not break callers
        # Use stderr; we don't have a logger and import-time side-effects on
        # logging would be more code than this single line is worth.
        import sys
        print(f"audit.record failed for action={action!r}: {exc}", file=sys.stderr)
