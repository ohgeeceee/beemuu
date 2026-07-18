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

from . import bootstrap, cross_links, db, schematics

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"

# ---------------------------------------------------------------------------
# Rate limiting — per-IP sliding-window counter (stdlib only).
# ---------------------------------------------------------------------------

_RATE_LIMIT = int(os.environ.get("BEEMUU_RATE_LIMIT", "120"))   # requests
_RATE_WINDOW = int(os.environ.get("BEEMUU_RATE_WINDOW", "60"))  # seconds


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


class Handler(BaseHTTPRequestHandler):
    server_version = "BeeEmUuAPI/0.1"

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
        self._json({"error": "not found"}, status=404)

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
