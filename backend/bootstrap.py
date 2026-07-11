"""First-boot bootstrap for the beemuu admin panel.

Called once at server startup. Responsibilities:
  1. Ensure the SQLite DB file + schema exist.
  2. Ensure an admin user exists, creating one from BEEMUU_ADMIN_PASSWORD if not.

Fails LOUD if BEEMUU_ADMIN_PASSWORD is unset or empty. A flashing-tool backend
without an admin password is a serious security miss; we'd rather crash at
boot than ship silently insecure defaults.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from . import auth, db


def bootstrap_admin(db_path: Path) -> None:
    """Create the first admin user if none exists. Idempotent.

    Reads BEEMUU_ADMIN_PASSWORD (required) and optional BEEMUU_ADMIN_USERNAME
    (defaults to 'admin') from the environment.
    """
    password = os.environ.get("BEEMUU_ADMIN_PASSWORD", "")
    if not password:
        print(
            "FATAL: BEEMUU_ADMIN_PASSWORD is not set. "
            "The admin panel cannot start without an admin password. "
            "Set it via systemd Environment= or export it before starting.",
            file=sys.stderr,
        )
        sys.exit(2)

    username = os.environ.get("BEEMUU_ADMIN_USERNAME", "admin")

    db.init_db(db_path)

    with db.get_conn(db_path) as conn:
        existing = conn.execute("SELECT COUNT(*) FROM admin_user").fetchone()[0]
        if existing > 0:
            return  # Idempotent — first admin already bootstrapped

        conn.execute(
            "INSERT INTO admin_user (username, password_hash, created_at) "
            "VALUES (?, ?, ?)",
            (username, auth.hash_password(password), int(time.time())),
        )
        conn.commit()
        print(
            f"beemuu-api: bootstrapped admin user '{username}' "
            f"(db: {db_path})",
            flush=True,
        )


def bootstrap_for_startup(db_path: Path | None = None) -> Path:
    """Single entry point called from app.py's main().

    Returns the resolved DB path so callers can reuse it without re-reading env.
    """
    resolved = db_path if db_path is not None else db._resolve_path(None)  # noqa: SLF001
    bootstrap_admin(resolved)
    return resolved