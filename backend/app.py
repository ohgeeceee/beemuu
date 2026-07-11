#!/usr/bin/env python3
"""BeeEmUu VPS web backend.

Stdlib-only HTTP API for the hosted dashboard. Safe defaults: read-only repo
inspection, no vehicle probing, no writes.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from . import bootstrap

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


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
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self._json({"ok": True, "service": "beemuu-api", "time": int(time.time())})
            return
        if parsed.path == "/api/dashboard":
            self._json(build_dashboard())
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
        self._json({"error": "not found"}, status=404)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def _json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
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
