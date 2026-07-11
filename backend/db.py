"""SQLite helpers + schema bootstrap for the beemuu admin backend.

Stdlib only. SQLite is the right call for a single-VPS single-admin panel:
backups are a single file, no extra service to manage. When/if multi-writer
analytics demands Postgres, the migration path is small — keep the API surface
in this module thin and the swap is straightforward.
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

# Default DB lives next to the source so the systemd unit can find it without
# extra env wiring. Override with BEEMUU_DB_PATH (used by tests + ops).
DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "beemuu.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS admin_user (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS session_cookie (
    id TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admin_user(id),
    expires_at INTEGER NOT NULL,
    created_ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_cookie_admin ON session_cookie(admin_id);

CREATE TABLE IF NOT EXISTS dtc (
    code TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    severity TEXT,
    title TEXT NOT NULL,
    description TEXT,
    likely_causes TEXT,
    source TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dtc_category ON dtc(category);
CREATE INDEX IF NOT EXISTS idx_dtc_verified ON dtc(verified);
CREATE INDEX IF NOT EXISTS idx_dtc_enabled ON dtc(enabled);

CREATE TABLE IF NOT EXISTS dtc_submission (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    submitter_handle TEXT,
    submitter_vin TEXT,
    symptoms TEXT,
    proposed_description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    submitted_at INTEGER NOT NULL,
    reviewed_at INTEGER,
    reviewer_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_dtc_submission_status ON dtc_submission(status);
CREATE INDEX IF NOT EXISTS idx_dtc_submission_code ON dtc_submission(code);

CREATE TABLE IF NOT EXISTS diag_session (
    id INTEGER PRIMARY KEY,
    submitted_at INTEGER NOT NULL,
    client_id TEXT,
    client_version TEXT,
    vin TEXT,
    profile TEXT,
    transport TEXT,
    dtc_codes TEXT,
    live_data_json TEXT,
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_diag_session_submitted ON diag_session(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_diag_session_vin ON diag_session(vin);

CREATE TABLE IF NOT EXISTS hunt_challenge (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    points INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    payload TEXT
);

CREATE TABLE IF NOT EXISTS leaderboard_entry (
    handle TEXT PRIMARY KEY,
    score INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER,
    meta TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    admin_id INTEGER REFERENCES admin_user(id),
    action TEXT NOT NULL,
    target TEXT,
    ip TEXT,
    at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at DESC);
"""


def _resolve_path(path: Path | None) -> Path:
    """Pick an explicit path, else the env var, else the default."""
    if path is not None:
        return Path(path)
    env = os.environ.get("BEEMUU_DB_PATH")
    if env:
        return Path(env)
    return DEFAULT_DB_PATH


def init_db(path: Path | None = None) -> Path:
    """Create the DB file + tables. Idempotent.

    Returns the resolved path. Creates parent directories.
    """
    resolved = _resolve_path(path)
    resolved.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(resolved) as conn:
        conn.executescript(_SCHEMA)
        conn.commit()
    return resolved


@contextmanager
def get_conn(path: Path | None = None) -> Iterator[sqlite3.Connection]:
    """Context manager yielding a sqlite3 connection with Row factory.

    The connection is opened with check_same_thread=False so the threading
    HTTP server can hand it across requests safely; callers must not share a
    connection across threads concurrently (one connection per request).
    """
    resolved = _resolve_path(path)
    conn = sqlite3.connect(resolved, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()