#!/usr/bin/env python3
"""BeeEmUu VPS web backend.

Stdlib-only HTTP API for the hosted dashboard. Safe defaults: read-only repo
inspection, no vehicle probing, no writes.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sqlite3
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import admin_api, auth, bootstrap, cross_links, db, schematics

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
ADMIN = FRONTEND / "admin"

# Cookie name for the admin session. Limit to safe ASCII; auth.lookup_session
# treats anything it can't find as None, so a hostile cookie value is harmless.
_SESSION_COOKIE = "beemuu_admin"

# ---------------------------------------------------------------------------
# Rate limiting — per-IP sliding-window counter (stdlib only).
# ---------------------------------------------------------------------------

_RATE_LIMIT = int(os.environ.get("BEEMUU_RATE_LIMIT", "120"))   # requests
_RATE_WINDOW = int(os.environ.get("BEEMUU_RATE_WINDOW", "60"))  # seconds

# Login endpoint has a tighter per-IP cap to slow brute-force. 5 attempts
# per minute is enough for a human to typo+retry, painful for a scripted
# attack against a single account.
_LOGIN_LIMIT = int(os.environ.get("BEEMUU_LOGIN_LIMIT", "5"))
_LOGIN_WINDOW = int(os.environ.get("BEEMUU_LOGIN_WINDOW", "60"))


class _RateLimiter:
    """Thread-safe sliding-window rate limiter keyed by client IP.

    Each IP is allowed at most *limit* requests within a rolling *window*-second
    interval. Excess requests receive a 429 response. State is kept entirely in
    memory; a service restart resets all counters.
    """

    def __init__(self, limit: int = 120, window: int = 60) -> None:
        self._limit = limit
        self._window = window
        self._lock = threading.Lock()
        # ip → deque of float timestamps
        self._buckets: dict[str, collections.deque] = {}

    def is_allowed(self, ip: str) -> bool:
        """Return True if the request should be served, False if rate-limited."""
        now = time.monotonic()
        cutoff = now - self._window
        with self._lock:
            bucket = self._buckets.get(ip)
            if bucket is None:
                bucket = collections.deque()
                self._buckets[ip] = bucket
            # Evict timestamps outside the window
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self._limit:
                return False
            bucket.append(now)
            return True


# Module-level singleton; limit / window configurable via env vars so
# tests can override without patching internals.
_rate_limiter = _RateLimiter(limit=_RATE_LIMIT, window=_RATE_WINDOW)
_login_rate_limiter = _RateLimiter(limit=_LOGIN_LIMIT, window=_LOGIN_WINDOW)


def _git(*args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=ROOT,
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() or None


def _count_files(path: Path, suffix: str | None = None) -> int:
    if not path.exists():
        return 0
    total = 0
    for file_path in path.rglob("*"):
        if not file_path.is_file():
            continue
        if suffix and file_path.suffix != suffix:
            continue
        total += 1
    return total


def _row_to_dtc(row: sqlite3.Row) -> dict:
    """Convert a dtc-table row to a JSON-friendly dict."""
    return {
        "code": row["code"],
        "category": row["category"],
        "severity": row["severity"],
        "title": row["title"],
        "description": row["description"],
        "likely_causes": row["likely_causes"],
        "source": row["source"],
        "verified": bool(row["verified"]),
        "enabled": bool(row["enabled"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def get_dtc_by_code(db_path: Path, code: str) -> dict | None:
    """Return one DTC row as a dict, or None if not found / disabled."""
    with db.get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM dtc WHERE code = ? AND enabled = 1", (code.upper(),)
        ).fetchone()
    if row is None:
        return None
    return _row_to_dtc(row)


def search_dtc(
    db_path: Path,
    *,
    category: str | None = None,
    q: str | None = None,
    limit: int = 100,
) -> list[dict]:
    """List DTCs, optionally filtered by category and a case-insensitive
    substring match against code or title. limit is clamped to [1, 500]."""
    limit = max(1, min(500, int(limit)))
    where = ["enabled = 1"]
    params: list[object] = []
    if category:
        where.append("category = ?")
        params.append(category)
    if q:
        where.append("(code LIKE ? OR title LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like])
    sql = (
        "SELECT * FROM dtc WHERE "
        + " AND ".join(where)
        + ' ORDER BY code ASC LIMIT ?'
    )
    params.append(limit)
    with db.get_conn(db_path) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_dtc(r) for r in rows]


def build_dashboard() -> dict:


    profiles_dir = ROOT / "community" / "profiles"
    exports_dir = ROOT / "exports"
    target_dir = ROOT / "src-tauri" / "target" / "release" / "bundle"
    artifacts = []
    if target_dir.exists():
        for suffix in (".deb", ".rpm", ".AppImage"):
            artifacts.extend(str(p.relative_to(ROOT)) for p in target_dir.rglob(f"*{suffix}"))

    status = _git("status", "--short") or ""
    return {
        "service": "beemuu-api",
        "generated_at_secs": int(time.time()),
        "repo": {
            "root": str(ROOT),
            "branch": _git("branch", "--show-current"),
            "commit": _git("rev-parse", "--short", "HEAD"),
            "dirty": bool(status.strip()),
        },
        "counts": {
            "community_profiles": _count_files(profiles_dir, ".toml"),
            "exports": _count_files(exports_dir),
            "bundles": len(artifacts),
        },
        "artifacts": artifacts[:25],
        "runtime": {
            "mode": "vps-web",
            "vehicle_connected": False,
            "note": "Hosted dashboard is read-only; desktop app handles real adapter I/O.",
        },
    }


# ---------------------------------------------------------------------------
# /api/live — recent commits + open/recent PRs.
#
# Designed for the dashboard's 30-second auto-refresh on beemuu.com.
# Fail-soft: any subprocess error returns `None` for the affected field
# (rather than 500ing the whole endpoint) so the dashboard keeps showing
# whatever it has. The hosted dashboard reads VPS-local git; PR data
# comes from the `gh` CLI which may not be installed or may rate-limit.
# ---------------------------------------------------------------------------

_LIVE_CACHE: dict = {"data": None, "ts": 0.0}
_LIVE_CACHE_TTL_SECS = 30.0  # cached for 30s — dashboard polls at the same rate


def _gh_json(*args: str):
    """Run `gh <args> ...` and parse stdout as JSON.

    Returns None on any failure (binary missing, non-zero exit, parse
    error, timeout). All callers must treat None as "unavailable" and
    render a degraded state. The endpoint stays useful even when gh
    is unreachable.
    """
    try:
        result = subprocess.run(
            ["gh", *args],
            cwd=ROOT,
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def _recent_commits(limit: int = 5):
    """Format `git log -n<limit> --format=...` into compact dicts.

    One shell call via --format; we parse the literal separators (%H%x00,
    %s%x00, %an%x00, %aI) so we don't spawn `git` per field. Subject
    is truncated to 120 chars in the formatter (defensive — git itself
    doesn't truncate).
    """
    fmt = "%H%x00%h%x00%s%x00%an%x00%aI"
    raw = _git("log", f"-n{limit}", f"--format={fmt}")
    if not raw:
        return []
    out = []
    for line in raw.split("\n"):
        if not line:
            continue
        parts = line.split("\x00")
        if len(parts) < 5:
            continue
        sha, short, subject, author, iso = parts[:5]
        out.append({
            "sha": sha,
            "short": short,
            "subject": subject[:120],
            "author": author,
            "iso": iso,
        })
    return out


def _open_prs():
    """Return (count, list-of-dicts) for currently open PRs.

    Empty list when gh is unavailable — the dashboard renders "PR data
    unavailable" rather than crashing.
    """
    data = _gh_json(
        "pr", "list", "--state", "open",
        "--json", "number,title,author,createdAt",
        "--limit", "10",
    )
    if not isinstance(data, list):
        return (0, [])
    items = [
        {
            "number": p.get("number"),
            "title": p.get("title", ""),
            "author": (p.get("author") or {}).get("login"),
            "created_at": p.get("createdAt"),
        }
        for p in data
        if isinstance(p, dict)
    ]
    return (len(items), items)


def _recent_merged_prs(limit: int = 3):
    """Most-recently-merged PRs (lightweight: number + title + mergedAt)."""
    data = _gh_json(
        "pr", "list", "--state", "merged",
        "--json", "number,title,mergedAt",
        "--limit", str(limit),
    )
    if not isinstance(data, list):
        return []
    return [
        {
            "number": p.get("number"),
            "title": p.get("title", ""),
            "merged_at": p.get("mergedAt"),
        }
        for p in data
        if isinstance(p, dict)
    ]


def build_live(force: bool = False):
    """Return the /api/live payload.

    Cached for 30s. Pass force=True (only from tests) to bypass the
    cache. The dashboard polls at 30s, so the cache keeps us from
    spawning git+gh on every visitor tab-open.
    """
    now = time.monotonic()
    cached = _LIVE_CACHE.get("data")
    cached_at = _LIVE_CACHE.get("ts", 0.0)
    if not force and cached is not None and (now - cached_at) < _LIVE_CACHE_TTL_SECS:
        return cached

    commits = _recent_commits(5)
    open_count, open_prs = _open_prs()
    recent_merged = _recent_merged_prs(3)

    payload = {
        "ok": True,
        "service": "beemuu-api",
        "generated_at_secs": int(time.time()),
        "repo": {
            "branch": _git("branch", "--show-current"),
            "commit": _git("rev-parse", "--short", "HEAD"),
            "dirty": bool((_git("status", "--short") or "").strip()),
        },
        "commits": commits,
        "pull_requests": {
            "open_count": open_count,
            "open": open_prs,
            "recently_merged": recent_merged,
            "available": bool(open_prs) or bool(recent_merged),
        },
    }
    _LIVE_CACHE["data"] = payload
    _LIVE_CACHE["ts"] = now
    return payload


class Handler(BaseHTTPRequestHandler):
    server_version = "BeeEmUuAPI/0.1"
    # HTTP/1.1 enables persistent connections, which the urllib client uses
    # by default. Without this, the client reuses a connection the server
    # has already closed (HTTP/1.0 default), producing BadStatusLine errors.
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        client_ip = self.client_address[0]
        if not _rate_limiter.is_allowed(client_ip):
            self._json(
                {"error": "rate limit exceeded", "retry_after": _RATE_WINDOW},
                status=429,
                retry_after=_RATE_WINDOW,
            )
            return
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self._json({"ok": True, "service": "beemuu-api", "time": int(time.time())})
            return
        if parsed.path == "/api/dashboard":
            self._json(build_dashboard())
            return
        if parsed.path == "/api/live":
            self._json(build_live())
            return
        # Public DTC catalog endpoints. No auth - read-only by design.
        if parsed.path == "/api/dtc":
            self._handle_dtc_search(parse_qs(parsed.query))
            return
        if parsed.path.startswith("/api/dtc/"):
            # Match /api/dtc/<code>/schematics before the bare
            # /api/dtc/<code> lookup (the bare path is a prefix of
            # the longer one).
            tail = parsed.path[len("/api/dtc/"):]
            if tail.endswith("/schematics"):
                code = tail[: -len("/schematics")].rstrip("/")
                self._handle_dtc_schematics(code, parse_qs(parsed.query))
                return
            code = tail
            self._handle_dtc_by_code(code)
            return
        # Read-only schematics catalog (CC0 wiring diagrams).
        if parsed.path == "/api/schematics":
            self._handle_schematics_list(parse_qs(parsed.query))
            return
        if parsed.path.startswith("/api/schematics/"):
            tail = parsed.path[len("/api/schematics/"):]
            # /api/schematics/<slug>/links  (sub-path before bare slug lookup).
            if tail.endswith("/links"):
                slug = tail[: -len("/links")].rstrip("/")
                self._handle_schematic_links(slug, parse_qs(parsed.query))
                return
            slug = tail
            self._handle_schematic_by_slug(slug)
            return
        if parsed.path in ("/", "/index.html"):
            self._file(FRONTEND / "index.html", "text/html; charset=utf-8")
            return
        if parsed.path == "/app.js":
            self._file(FRONTEND / "app.js", "application/javascript; charset=utf-8")
            return
        if parsed.path == "/app.css":
            self._file(FRONTEND / "app.css", "text/css; charset=utf-8")
            return
        # Live Gauges panel (v0.14.0 public-site bonus, PR #167). The
        # static asset routes mirror the existing /app.{js,css} pattern.
        # Without these the panel would 404 in production even though
        # frontend/index.html references them.
        if parsed.path == "/live_gauges.js":
            self._file(FRONTEND / "live_gauges.js", "application/javascript; charset=utf-8")
            return
        if parsed.path == "/live_gauges.css":
            self._file(FRONTEND / "live_gauges.css", "text/css; charset=utf-8")
            return
        # Schematics viewer (schematic list + per-slug viewer). Hosted at
        # the root to match the admin dashboard pattern; assets vendored
        # under frontend/vendor/ so the page works offline.
        if parsed.path in ("/schematics.html", "/schematics"):
            self._file(FRONTEND / "schematics.html", "text/html; charset=utf-8")
            return
        if parsed.path == "/schematics.js":
            self._file(
                FRONTEND / "schematics.js",
                "application/javascript; charset=utf-8",
            )
            return
        if parsed.path == "/schematics.css":
            self._file(
                FRONTEND / "schematics.css",
                "text/css; charset=utf-8",
            )
            return
        if parsed.path == "/vendor/svg-pan-zoom.min.js":
            self._file(
                FRONTEND / "vendor" / "svg-pan-zoom.min.js",
                "application/javascript; charset=utf-8",
            )
            return
        # Admin SPA — served as static files from frontend/admin/. We exempt
        # /admin/* from the rate limiter (the SPA does many small polls);
        # login attempts have their own per-IP rate limiter below.
        if self._handle_admin_static(parsed.path):
            return
        # Admin data routes (sessions, audit, joins). All read-only and
        # all gated by an admin session cookie.
        if parsed.path.startswith("/api/admin/"):
            self._handle_admin_get(parsed.path, parse_qs(parsed.query))
            return
        self._json({"error": "not found"}, status=404)

    # ------------------------------------------------------------------
    # Admin session helpers
    # ------------------------------------------------------------------

    def _cookie_token(self) -> str:
        """Return the raw session token from the Cookie header, or ""."""
        header = self.headers.get("Cookie", "")
        for chunk in header.split(";"):
            name, _, value = chunk.strip().partition("=")
            if name == _SESSION_COOKIE:
                return value
        return ""

    def _admin_id(self) -> int | None:
        """Return the admin_id for this request, or None if not logged in."""
        token = self._cookie_token()
        if not token:
            return None
        db_path = db._resolve_path(None)  # noqa: SLF001
        return auth.lookup_session(db_path, token)

    def _require_admin(self) -> int | None:
        """401 if not authenticated. Returns admin_id on success."""
        admin_id = self._admin_id()
        if admin_id is None:
            self._json({"error": "unauthorized"}, status=401)
            return None
        return admin_id

    def _set_session_cookie(self, token: str) -> None:
        # 7 days, matching auth._SESSION_TTL_SECS. HttpOnly; SameSite=Lax.
        # Not Secure because the admin panel is served on the same origin
        # as the public API; the systemd unit terminates TLS at nginx.
        self.send_header(
            "Set-Cookie",
            f"{_SESSION_COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800",
        )

    def _clear_session_cookie(self) -> None:
        self.send_header(
            "Set-Cookie",
            f"{_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        )

    def _handle_admin_static(self, path: str) -> bool:
        """Serve /admin/* static files from frontend/admin/. Returns True if handled."""
        if not path.startswith("/admin"):
            return False
        # Map /admin and /admin/ → /admin/index.html
        if path in ("/admin", "/admin/"):
            self._file(ADMIN / "index.html", "text/html; charset=utf-8")
            return True
        rel = path[len("/admin/"):]
        # Disallow path traversal — rel must not contain ..
        if ".." in rel.split("/"):
            self._json({"error": "bad path"}, status=400)
            return True
        # Map common asset paths so a refresh on /admin/something works
        if rel == "":
            self._file(ADMIN / "index.html", "text/html; charset=utf-8")
            return True
        asset = ADMIN / rel
        if not asset.is_file() or not asset.resolve().is_relative_to(ADMIN.resolve()):
            self._json({"error": "not found"}, status=404)
            return True
        # Content-type by extension
        ext = asset.suffix.lower()
        ct = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".ico": "image/x-icon",
        }.get(ext, "application/octet-stream")
        self._file(asset, ct)
        return True

    # ------------------------------------------------------------------
    # Admin GET routes — dashboard, audit, sessions, submissions, hunt
    # ------------------------------------------------------------------

    def _handle_admin_get(self, path: str, query: dict) -> None:
        admin_id = self._require_admin()
        if admin_id is None:
            return
        db_path = db._resolve_path(None)  # noqa: SLF001

        if path == "/api/admin/whoami":
            with db.get_conn(db_path) as conn:
                row = conn.execute(
                    "SELECT id, username, created_at, last_login_at FROM admin_user "
                    "WHERE id = ?", (admin_id,),
                ).fetchone()
            self._json({"id": row["id"], "username": row["username"],
                        "last_login_at": row["last_login_at"]})
            return

        if path == "/api/admin/dashboard":
            self._json({
                "counts": admin_api.dashboard_counts(db_path),
                "recent_audit": admin_api.list_audit(db_path, limit=20),
            })
            return

        if path == "/api/admin/audit":
            limit = int(query.get("limit", ["100"])[0])
            self._json({"results": admin_api.list_audit(db_path, limit=limit)})
            return

        if path == "/api/admin/dtc":
            # Admin can see disabled entries too
            q = query.get("q", [None])[0]
            category = query.get("category", [None])[0]
            limit = int(query.get("limit", ["200"])[0])
            with db.get_conn(db_path) as conn:
                where = ["1=1"]
                params: list[object] = []
                if category:
                    where.append("category = ?")
                    params.append(category)
                if q:
                    where.append("(code LIKE ? OR title LIKE ?)")
                    like = f"%{q}%"
                    params.extend([like, like])
                rows = conn.execute(
                    "SELECT * FROM dtc WHERE " + " AND ".join(where) +
                    " ORDER BY code ASC LIMIT ?",
                    (*params, limit),
                ).fetchall()
            self._json({"results": [dict(r) for r in rows]})
            return

        if path == "/api/admin/submissions":
            status = query.get("status", ["pending"])[0]
            limit = int(query.get("limit", ["100"])[0])
            self._json({"results": admin_api.list_submissions(db_path, status=status, limit=limit)})
            return

        if path == "/api/admin/schematics":
            include_disabled = query.get("include_disabled", ["0"])[0] in ("1", "true", "yes")
            with db.get_conn(db_path) as conn:
                if include_disabled:
                    rows = conn.execute("SELECT * FROM schematics ORDER BY slug ASC").fetchall()
                else:
                    rows = conn.execute(
                        "SELECT * FROM schematics WHERE enabled = 1 ORDER BY slug ASC"
                    ).fetchall()
            self._json({"results": [dict(r) for r in rows]})
            return

        if path == "/api/admin/hunt":
            include_disabled = query.get("include_disabled", ["1"])[0] in ("1", "true", "yes")
            self._json({"results": admin_api.list_hunt_challenges(db_path, include_disabled=include_disabled)})
            return

        if path == "/api/admin/sessions":
            limit = int(query.get("limit", ["100"])[0])
            self._json({"results": admin_api.list_sessions(db_path, limit=limit)})
            return

        self._json({"error": "not found"}, status=404)

    # ------------------------------------------------------------------
    # do_POST — login, admin writes
    # ------------------------------------------------------------------

    def do_POST(self) -> None:
        # Login is not rate-limited by the standard sliding window (the SPA
        # does many small polls); but login itself has a tight per-IP
        # counter to slow brute-force.
        parsed = urlparse(self.path)

        if parsed.path == "/api/admin/login":
            self._handle_admin_login()
            return

        # Only /api/admin/* POSTs require admin auth. Any other POST path
        # is a 404 from this server — that's a parsimonious "method not
        # supported" signal and matches what the public catalog returns.
        if not parsed.path.startswith("/api/admin/"):
            self._json({"error": "not found"}, status=404)
            return

        # All other POSTs require an admin session.
        client_ip = self.client_address[0]
        if not _rate_limiter.is_allowed(client_ip):
            self._json(
                {"error": "rate limit exceeded", "retry_after": _RATE_WINDOW},
                status=429, retry_after=_RATE_WINDOW,
            )
            return
        admin_id = self._require_admin()
        if admin_id is None:
            return

        try:
            body = self._read_json_body()
        except ValueError as exc:
            self._json({"error": str(exc)}, status=400)
            return
        if not isinstance(body, dict):
            self._json({"error": "expected JSON object"}, status=400)
            return

        db_path = db._resolve_path(None)  # noqa: SLF001

        if parsed.path == "/api/admin/dtc":
            try:
                row = admin_api.upsert_dtc(db_path, body)
            except ValueError as exc:
                self._json({"error": str(exc)}, status=400)
                return
            admin_api.write_audit(db_path, admin_id=admin_id,
                                  action="dtc.upsert", target=row["code"],
                                  ip=self.client_address[0])
            self._json(row)
            return

        if parsed.path == "/api/admin/submissions/review":
            try:
                sub_id = int(body.get("id") or 0)
                status = body.get("status") or ""
                note = body.get("note")
                updated = admin_api.review_submission(db_path, sub_id, status=status, note=note)
            except (ValueError, TypeError) as exc:
                self._json({"error": str(exc)}, status=400)
                return
            if updated is None:
                self._json({"error": "submission not found"}, status=404)
                return
            admin_api.write_audit(db_path, admin_id=admin_id,
                                  action=f"submission.{status}",
                                  target=f"id={sub_id}",
                                  ip=self.client_address[0])
            self._json(updated)
            return

        if parsed.path == "/api/admin/schematics":
            try:
                row = admin_api.upsert_schematic(db_path, body)
            except ValueError as exc:
                self._json({"error": str(exc)}, status=400)
                return
            admin_api.write_audit(db_path, admin_id=admin_id,
                                  action="schematic.upsert", target=row["slug"],
                                  ip=self.client_address[0])
            self._json(row)
            return

        if parsed.path == "/api/admin/schematic-links":
            slug = (body.get("slug") or "")
            code = (body.get("code") or "")
            note = body.get("note")
            try:
                admin_api.set_schematic_link(db_path, slug, code, note=note)
            except ValueError as exc:
                self._json({"error": str(exc)}, status=400)
                return
            admin_api.write_audit(db_path, admin_id=admin_id,
                                  action="schematic.link", target=f"{slug}↔{code}",
                                  ip=self.client_address[0])
            self._json({"ok": True})
            return

        if parsed.path == "/api/admin/hunt":
            try:
                row = admin_api.upsert_hunt_challenge(db_path, body)
            except ValueError as exc:
                self._json({"error": str(exc)}, status=400)
                return
            admin_api.write_audit(db_path, admin_id=admin_id,
                                  action="hunt.upsert", target=row["slug"],
                                  ip=self.client_address[0])
            self._json(row)
            return

        if parsed.path == "/api/admin/logout":
            token = self._cookie_token()
            if token:
                auth.revoke_session(db_path, token)
            admin_api.write_audit(db_path, admin_id=admin_id,
                                  action="logout", ip=self.client_address[0])
            # Write the response manually so the Set-Cookie clear runs
            # through the same _headers_buffer as the rest of the headers.
            # Calling _clear_session_cookie() before _json() would otherwise
            # append the Set-Cookie header ahead of the status line that
            # _json() then writes, breaking the HTTP framing.
            body = json.dumps({"ok": True}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.send_header(
                "Set-Cookie",
                f"{_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
            )
            self.end_headers()
            self.wfile.write(body)
            return

        self._json({"error": "not found"}, status=404)

    # ------------------------------------------------------------------
    # do_DELETE — selective remove
    # ------------------------------------------------------------------

    def do_DELETE(self) -> None:
        client_ip = self.client_address[0]
        if not _rate_limiter.is_allowed(client_ip):
            self._json(
                {"error": "rate limit exceeded", "retry_after": _RATE_WINDOW},
                status=429, retry_after=_RATE_WINDOW,
            )
            return
        admin_id = self._require_admin()
        if admin_id is None:
            return

        parsed = urlparse(self.path)
        db_path = db._resolve_path(None)  # noqa: SLF001

        # /api/admin/dtc/<code>/enable and /disable — checked BEFORE the bare
        # /api/admin/dtc/<code> handler since the suffix variants are a
        # subset of the prefix.
        if parsed.path.startswith("/api/admin/dtc/") and (
            parsed.path.endswith("/enable") or parsed.path.endswith("/disable")
        ):
            if parsed.path.endswith("/enable"):
                code = parsed.path[len("/api/admin/dtc/"):-len("/enable")].rstrip("/")
                enable = True
            else:
                code = parsed.path[len("/api/admin/dtc/"):-len("/disable")].rstrip("/")
                enable = False
            try:
                ok = admin_api.set_dtc_enabled(db_path, code, enable)
            except ValueError as exc:
                self._json({"error": str(exc)}, status=400)
                return
            if not ok:
                self._json({"error": "not found"}, status=404)
                return
            admin_api.write_audit(db_path, admin_id=admin_id,
                                  action=f"dtc.{'enable' if enable else 'disable'}",
                                  target=code,
                                  ip=self.client_address[0])
            self._json({"ok": True})
            return

        # /api/admin/dtc/<code> — soft-delete (enabled=0)
        if parsed.path.startswith("/api/admin/dtc/"):
            code = parsed.path[len("/api/admin/dtc/"):].rstrip("/")
            try:
                ok = admin_api.set_dtc_enabled(db_path, code, False)
            except ValueError as exc:
                self._json({"error": str(exc)}, status=400)
                return
            if not ok:
                self._json({"error": "not found"}, status=404)
                return
            admin_api.write_audit(db_path, admin_id=admin_id,
                                  action="dtc.disable", target=code,
                                  ip=self.client_address[0])
            self._json({"ok": True})
            return

        # /api/admin/schematic-links?slug=...&code=...
        if parsed.path == "/api/admin/schematic-links":
            qs = parse_qs(parsed.query)
            slug = (qs.get("slug", [None])[0] or "")
            code = (qs.get("code", [None])[0] or "")
            ok = admin_api.delete_schematic_link(db_path, slug, code)
            if not ok:
                self._json({"error": "not found"}, status=404)
                return
            admin_api.write_audit(db_path, admin_id=admin_id,
                                  action="schematic.unlink", target=f"{slug}↔{code}",
                                  ip=self.client_address[0])
            self._json({"ok": True})
            return

        # /api/admin/hunt/<slug>/enable and /disable
        if parsed.path.startswith("/api/admin/hunt/"):
            tail = parsed.path[len("/api/admin/hunt/"):].rstrip("/")
            if tail.endswith("/enable"):
                slug = tail[: -len("/enable")]
                enabled = True
            elif tail.endswith("/disable"):
                slug = tail[: -len("/disable")]
                enabled = False
            else:
                self._json({"error": "not found"}, status=404)
                return
            try:
                ok = admin_api.set_hunt_enabled(db_path, slug, enabled)
            except ValueError as exc:
                self._json({"error": str(exc)}, status=400)
                return
            if not ok:
                self._json({"error": "not found"}, status=404)
                return
            admin_api.write_audit(db_path, admin_id=admin_id,
                                  action=f"hunt.{'enable' if enabled else 'disable'}",
                                  target=slug,
                                  ip=self.client_address[0])
            self._json({"ok": True})
            return

        self._json({"error": "not found"}, status=404)

    # ------------------------------------------------------------------
    # do_PUT — alias for POST (some SPA stacks standardize on PUT)
    # ------------------------------------------------------------------

    def do_PUT(self) -> None:
        self.do_POST()

    # ------------------------------------------------------------------
    # Login-specific helpers
    # ------------------------------------------------------------------

    def _handle_admin_login(self) -> None:
        """POST /api/admin/login — issue a session cookie."""
        # Per-IP brute-force throttle on the login endpoint itself.
        ip = self.client_address[0]
        if not _login_rate_limiter.is_allowed(ip):
            self._json(
                {"error": "too many login attempts", "retry_after": _LOGIN_WINDOW},
                status=429, retry_after=_LOGIN_WINDOW,
            )
            return

        try:
            body = self._read_json_body()
        except ValueError as exc:
            self._json({"error": str(exc)}, status=400)
            return
        if not isinstance(body, dict):
            self._json({"error": "expected JSON object"}, status=400)
            return
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        if not username or not password:
            self._json({"error": "username and password required"}, status=400)
            return

        db_path = db._resolve_path(None)  # noqa: SLF001
        with db.get_conn(db_path) as conn:
            row = conn.execute(
                "SELECT id, password_hash FROM admin_user WHERE username = ?",
                (username,),
            ).fetchone()
        if row is None or not auth.verify_password(password, row["password_hash"]):
            admin_api.write_audit(db_path, admin_id=None,
                                  action="login.failed", target=username,
                                  ip=ip)
            self._json({"error": "invalid credentials"}, status=401)
            return

        token = auth.create_session(db_path, row["id"], ip)
        admin_api.write_audit(db_path, admin_id=row["id"],
                              action="login.ok", target=username,
                              ip=ip)
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self._set_session_cookie(token)
        body_bytes = json.dumps({"ok": True, "username": username}).encode("utf-8")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)

    def _read_json_body(self) -> object:
        """Read the request body and parse as JSON. Raises ValueError on bad JSON."""
        length_raw = self.headers.get("Content-Length", "0")
        try:
            length = int(length_raw)
        except ValueError:
            raise ValueError("invalid Content-Length")
        if length < 0 or length > 1024 * 1024:
            raise ValueError("body too large")
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError(f"invalid JSON: {exc}")

    def _handle_dtc_by_code(self, code: str) -> None:
        # Accept /api/dtc/P0171 and /api/dtc/P0171?include_disabled=1.
        # urlparse keeps the query out of .path, so re-parse self.path to
        # pick up the flags.
        parsed = urlparse(self.path)
        flags = parse_qs(parsed.query)
        include_disabled = flags.get("include_disabled", ["0"])[0] in ("1", "true", "yes")
        code = code.strip().upper()
        if not code:
            self._json({"error": "code is required"}, status=400)
            return
        db_path = db._resolve_path(None)  # noqa: SLF001
        if include_disabled:
            with db.get_conn(db_path) as conn:
                row = conn.execute(
                    "SELECT * FROM dtc WHERE code = ?", (code,)
                ).fetchone()
            if row is None:
                self._json({"error": "not found", "code": code}, status=404)
                return
            self._json(_row_to_dtc(row))
            return
        result = get_dtc_by_code(db_path, code)
        if result is None:
            self._json({"error": "not found", "code": code}, status=404)
            return
        self._json(result)

    def _handle_dtc_search(self, query: dict) -> None:
        def _first(key: str) -> str | None:
            v = query.get(key)
            return v[0] if v else None

        category = _first("category")
        q = _first("q")
        limit_raw = _first("limit")
        try:
            limit = int(limit_raw) if limit_raw else 100
        except ValueError:
            self._json({"error": "limit must be an integer"}, status=400)
            return
        if category is not None and category not in {
            "powertrain", "body", "chassis", "network", "bmw-specific",
        }:
            self._json({"error": f"unknown category {category!r}"}, status=400)
            return
        db_path = db._resolve_path(None)  # noqa: SLF001
        rows = search_dtc(db_path, category=category, q=q, limit=limit)
        self._json({"count": len(rows), "results": rows})

    def _handle_schematic_by_slug(self, slug: str) -> None:
        # urlparse keeps the query out of .path, so re-parse self.path to
        # pick up any extra flags (none today, but consistent with DTC).
        parsed = urlparse(self.path)
        _ = parse_qs(parsed.query)  # reserved for future flags
        slug = slug.strip()
        if not slug:
            self._json({"error": "slug is required"}, status=400)
            return
        db_path = db._resolve_path(None)  # noqa: SLF001
        result = schematics.get_schematic_by_slug(db_path, slug)
        if result is None:
            self._json({"error": "not found", "slug": slug}, status=404)
            return
        # Verify the file actually exists on disk; otherwise the catalog is
        # lying. Returns 503 (Service Unavailable) since the row exists but
        # the asset is missing — distinct from "not in catalog".
        asset = ROOT / result["file_path"]
        if not asset.is_file():
            self._json(
                {"error": "asset missing", "slug": slug, "path": result["file_path"]},
                status=503,
            )
            return
        self._json(result)

    def _handle_schematics_list(self, query: dict) -> None:
        def _first(key: str) -> str | None:
            v = query.get(key)
            return v[0] if v else None

        series = _first("series")
        system = _first("system")
        q = _first("q")
        limit_raw = _first("limit")
        try:
            limit = int(limit_raw) if limit_raw else 100
        except ValueError:
            self._json({"error": "limit must be an integer"}, status=400)
            return
        db_path = db._resolve_path(None)  # noqa: SLF001
        rows = schematics.list_schematics(
            db_path, series=series, system=system, q=q, limit=limit
        )
        self._json({"count": len(rows), "results": rows})

    def _handle_dtc_schematics(self, code: str, query: dict) -> None:
        # Cross-link lookup: given a DTC code, return every schematic that
        # references it. Optional `?include_disabled=1` to see links to
        # codes that have been soft-deleted in the catalog.
        code = code.strip().upper()
        if not code:
            self._json({"error": "code is required"}, status=400)
            return
        include_disabled = query.get(
            "include_disabled", ["0"]
        )[0] in ("1", "true", "yes")
        db_path = db._resolve_path(None)  # noqa: SLF001
        results = cross_links.list_links_for_dtc(
            db_path, code, include_disabled=include_disabled
        )
        self._json({"code": code, "count": len(results), "results": results})

    def _handle_schematic_links(self, slug: str, query: dict) -> None:
        # Symmetric to _handle_dtc_schematics.
        slug = slug.strip()
        if not slug:
            self._json({"error": "slug is required"}, status=400)
            return
        include_disabled = query.get(
            "include_disabled", ["0"]
        )[0] in ("1", "true", "yes")
        db_path = db._resolve_path(None)  # noqa: SLF001
        results = cross_links.list_links_for_schematic(
            db_path, slug, include_disabled=include_disabled
        )
        self._json({"slug": slug, "count": len(results), "results": results})

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def _json(self, payload: dict, status: int = 200, retry_after: int | None = None) -> None:
        body = json.dumps(payload, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        if retry_after is not None:
            self.send_header("Retry-After", str(retry_after))
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path: Path, content_type: str) -> None:
        try:
            body = path.read_bytes()
        except OSError:
            self._json({"error": "missing frontend asset"}, status=404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser(description="BeeEmUu VPS web backend")
    parser.add_argument("--host", default=os.environ.get("BEEMUU_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("BEEMUU_PORT", "8765")))
    args = parser.parse_args()

    # First-boot bootstrap: ensure DB + schema exist, ensure admin user exists.
    # bootstrap_for_startup() exits(2) with a clear message if
    # BEEMUU_ADMIN_PASSWORD is unset, so we never silently start insecure.
    bootstrap.bootstrap_for_startup()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"beemuu-api listening on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
