#!/usr/bin/env python3
"""BeeEmUu VPS web backend.

Stdlib-only HTTP API for the hosted dashboard and admin panel. Safe defaults:
read-only repo inspection for the public surface; admin panel behind scrypt
cookie sessions with a 7-day TTL.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
ADMIN_UI = ROOT / "backend" / "admin_ui"
COOKIE_NAME = "beemuu_admin_session"


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


def _resolve_db_path() -> Path:
    """Mirror backend.db._resolve_path but avoid a circular import at module load."""
    from . import db
    return db._resolve_path(None)  # noqa: SLF001


def _parse_cookies(header: str | None) -> dict[str, str]:
    if not header:
        return {}
    out: dict[str, str] = {}
    for chunk in header.split(";"):
        chunk = chunk.strip()
        if "=" not in chunk:
            continue
        k, v = chunk.split("=", 1)
        out[k] = urllib.parse.unquote(v)
    return out


def _client_ip(headers) -> str:
    fwd = headers.get("X-Forwarded-For", "")
    if fwd:
        # First entry is the originating client; nginx appends the proxy chain.
        return fwd.split(",")[0].strip()
    return headers.get("X-Real-IP", "")


class Handler(BaseHTTPRequestHandler):
    server_version = "BeeEmUuAPI/0.2"

    # ----- request dispatch -----

    def do_GET(self) -> None:  # noqa: N802 - stdlib name
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802 - stdlib name
        self._dispatch("POST")

    def _dispatch(self, method: str) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        # Public API
        if path == "/api/health" and method == "GET":
            self._json({"ok": True, "service": "beemuu-api", "time": int(time.time())})
            return
        if path == "/api/dashboard" and method == "GET":
            self._json(build_dashboard())
            return
        # Public frontend
        if path in ("/", "/index.html") and method == "GET":
            self._file(FRONTEND / "index.html", "text/html; charset=utf-8")
            return
        if path == "/app.js" and method == "GET":
            self._file(FRONTEND / "app.js", "application/javascript; charset=utf-8")
            return
        if path == "/app.css" and method == "GET":
            self._file(FRONTEND / "app.css", "text/css; charset=utf-8")
            return
        # Admin shell pages — every section gets its own page rendered through
        # the shared _layout.html template. Auth-gated; the dispatcher in
        # _dispatch_authed_admin_page handles the 302 to /admin/login.
        admin_sections = {
            "/admin/": ("dashboard", "Dashboard"),
            "/admin/dtc/": ("dtc", "DTC"),
            "/admin/submissions/": ("submissions", "Submissions"),
            "/admin/community/": ("community", "Community"),
            "/admin/hunts/": ("hunts", "Hunts"),
            "/admin/leaderboard/": ("leaderboard", "Leaderboard"),
            "/admin/audit/": ("audit", "Audit log"),
        }
        if path in admin_sections and method == "GET":
            section_key, breadcrumb = admin_sections[path]
            if self._current_admin_id() is None:
                self._redirect(f"/admin/login?next={urllib.parse.quote(path)}")
                return
            self._render_page(section_key, breadcrumb)
            return
        if path == "/admin/login" and method == "GET":
            # If already signed in, skip the form.
            if self._current_admin_id() is not None:
                self._redirect("/admin/")
                return
            next_path = urllib.parse.unquote(parsed.query.split("next=", 1)[1]) \
                if "next=" in parsed.query else "/admin/"
            # Only honor same-origin admin paths.
            if not next_path.startswith("/admin") or next_path.startswith("//"):
                next_path = "/admin/"
            try:
                template = (ADMIN_UI / "login.html").read_text(encoding="utf-8")
            except OSError:
                self._json({"error": "missing admin asset"}, status=500)
                return
            body = template.replace("{{NEXT}}", urllib.parse.quote(next_path, safe="")).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/admin/logout" and method == "POST":
            self._handle_logout()
            return
        # Admin JSON API (tiles, audit log, DTC, submissions). Lives under
        # /admin/api/* and is always auth-gated. PR 3 added POST endpoints
        # (dtc.update, submissions.approve/reject); auth still gated the same
        # way via require_admin() inside each route.
        if path.startswith("/admin/api/") and method in ("GET", "POST"):
            from . import admin_api
            query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
            if not admin_api.handle(self, path, query):
                self._json({"error": "not found"}, status=404)
            return
        # Admin static assets (CSS/JS for the admin shell) — guarded by auth.
        if path.startswith("/admin/static/") and method == "GET":
            if self._current_admin_id() is None:
                self._redirect("/admin/login?next=" + urllib.parse.quote(path))
                return
            rel = path[len("/admin/static/"):]
            # Reject path traversal — only allow flat filenames inside admin_ui/static/.
            if "/" in rel or ".." in rel:
                self._json({"error": "bad path"}, status=400)
                return
            self._file(ADMIN_UI / "static" / rel, self._content_type_for(rel))
            return
        self._json({"error": "not found"}, status=404)

    # ----- auth helpers -----

    def _current_admin_id(self) -> int | None:
        """Return admin_id if the request carries a valid session cookie, else None."""
        from . import auth
        cookies = _parse_cookies(self.headers.get("Cookie"))
        token = cookies.get(COOKIE_NAME, "")
        if not token:
            return None
        try:
            return auth.lookup_session(_resolve_db_path(), token)
        except Exception:  # noqa: BLE001 - any DB hiccup means "not signed in"
            return None

    def _handle_logout(self) -> None:
        from . import audit, auth
        cookies = _parse_cookies(self.headers.get("Cookie"))
        token = cookies.get(COOKIE_NAME, "")
        if token:
            try:
                auth.revoke_session(_resolve_db_path(), token)
                ip = _client_ip(self.headers)
                audit.record(
                    _resolve_db_path(),
                    action="admin.logout",
                    target=token[:8],
                    ip=ip,
                )
            except Exception:  # noqa: BLE001
                pass
        # Always clear the cookie and bounce to login.
        self.send_response(302)
        self.send_header("Location", "/admin/login")
        self.send_header(
            "Set-Cookie",
            f"{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
        )
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    # ----- response helpers -----

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def _redirect(self, location: str, status: int = 302) -> None:
        self.send_response(status)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    # Mapping of section key → (CSS class for `aria-current`, content file).
    # Kept here (not in admin_sections dict) so content files aren't repeated
    # in two places — the dispatcher above only needs the URL→key map.
    _SECTION_CONTENT = {
        "dashboard": "dashboard",
        "dtc": "dtc",
        "submissions": "submissions",
        "community": "community",
        "hunts": "hunts",
        "leaderboard": "leaderboard",
        "audit": "audit",
    }

    def _render_page(self, section_key: str, breadcrumb: str) -> None:
        """Render an admin shell page from _layout.html + a content fragment.

        Substitutes {{TITLE}}, {{BREADCRUMB}}, {{CONTENT}}, and one
        {{ACTIVE_<SECTION>}} per nav link (which becomes ` aria-current="page"`
        on the matching <a>). All other placeholders are left empty so we
        don't ship a partial template by accident.
        """
        try:
            layout = (ADMIN_UI / "_layout.html").read_text(encoding="utf-8")
            content_name = self._SECTION_CONTENT.get(section_key, section_key)
            content = (ADMIN_UI / f"_{content_name}.html").read_text(encoding="utf-8")
        except OSError:
            self._json({"error": "missing admin asset"}, status=500)
            return

        active_marker = ' aria-current="page"'
        replacements = {
            "{{TITLE}}": f"Beemuu Admin — {breadcrumb}",
            "{{BREADCRUMB}}": breadcrumb,
            "{{CONTENT}}": content,
            "{{ACTIVE_DASHBOARD}}": active_marker if section_key == "dashboard" else "",
            "{{ACTIVE_DTC}}": active_marker if section_key == "dtc" else "",
            "{{ACTIVE_SUBMISSIONS}}": active_marker if section_key == "submissions" else "",
            "{{ACTIVE_COMMUNITY}}": active_marker if section_key == "community" else "",
            "{{ACTIVE_HUNTS}}": active_marker if section_key == "hunts" else "",
            "{{ACTIVE_LEADERBOARD}}": active_marker if section_key == "leaderboard" else "",
            "{{ACTIVE_AUDIT}}": active_marker if section_key == "audit" else "",
        }
        for key, value in replacements.items():
            layout = layout.replace(key, value)
        body = layout.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
            self._json({"error": "missing asset"}, status=404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    @staticmethod
    def _content_type_for(filename: str) -> str:
        if filename.endswith(".css"):
            return "text/css; charset=utf-8"
        if filename.endswith(".js"):
            return "application/javascript; charset=utf-8"
        if filename.endswith(".svg"):
            return "image/svg+xml"
        if filename.endswith(".png"):
            return "image/png"
        return "application/octet-stream"


def _handle_login_post(handler: Handler) -> None:
    """Process the admin login form submission.

    Reads a small urlencoded form with `username`, `password`, and optional
    `next`. Verifies credentials via auth.verify_password against the
    admin_user row, creates a session row, and sets the session cookie.

    Failure modes:
      - Missing fields → 400, re-render login with a generic error.
      - Wrong username or password → 401, re-render with the same generic error
        (don't leak which one was wrong).
      - DB hiccup → 500 with a generic message; do NOT echo stack traces to
        the browser.

    On success: 302 to `next` (if it's a same-origin path) or `/admin/`.
    """
    from . import audit, auth, db

    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0 or length > 4096:
        _render_login_error(handler, "Invalid form submission.")
        return
    raw = handler.rfile.read(length).decode("utf-8", errors="replace")
    try:
        form = urllib.parse.parse_qs(raw, keep_blank_values=True)
    except ValueError:
        _render_login_error(handler, "Invalid form submission.")
        return
    username = (form.get("username", [""])[0] or "").strip()
    password = form.get("password", [""])[0] or ""
    next_path = (form.get("next", [""])[0] or "/admin/").strip() or "/admin/"

    if not username or not password:
        _render_login_error(handler, "Username and password are required.")
        return

    # Same-origin guard: only redirect to relative paths beginning with /admin/.
    if not next_path.startswith("/admin") or next_path.startswith("//"):
        next_path = "/admin/"

    db_path = _resolve_db_path()
    try:
        with db.get_conn(db_path) as conn:
            row = conn.execute(
                "SELECT id, password_hash FROM admin_user WHERE username = ?",
                (username,),
            ).fetchone()
    except Exception:  # noqa: BLE001
        _render_login_error(handler, "Service unavailable.", status=500)
        return

    if row is None or not auth.verify_password(password, row["password_hash"]):
        ip = _client_ip(handler.headers)
        audit.record(
            db_path,
            action="admin.login.failed",
            target=username[:64],
            ip=ip,
        )
        # Constant-ish response time: still do a verify against a dummy hash
        # when the username is unknown, so timing leaks are minimized.
        if row is None:
            auth.verify_password(password, "scrypt$00$00")
        _render_login_error(handler, "Invalid username or password.", status=401)
        return

    admin_id = row["id"]
    ip = _client_ip(handler.headers)
    try:
        token = auth.create_session(db_path, admin_id, ip)
    except Exception:  # noqa: BLE001
        _render_login_error(handler, "Service unavailable.", status=500)
        return
    audit.record(db_path, action="admin.login.ok", admin_id=admin_id, ip=ip)

    handler.send_response(302)
    handler.send_header("Location", next_path)
    handler.send_header(
        "Set-Cookie",
        f"{COOKIE_NAME}={urllib.parse.quote(token)}; Path=/; HttpOnly; "
        "SameSite=Lax; Secure; Max-Age=604800",
    )
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()


def _render_login_error(handler: Handler, message: str, status: int = 400) -> None:
    """Re-render the login page with an error message inline.

    We escape the message to keep HTML injection out of the rendered page.
    """
    safe = (
        message.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
    try:
        template = (ADMIN_UI / "login.html").read_text(encoding="utf-8")
    except OSError:
        handler._json({"error": message}, status=status)  # noqa: SLF001
        return
    # Inject the error into the placeholder if present, else append a banner.
    if "{{ERROR}}" in template:
        body = template.replace("{{ERROR}}", safe).encode("utf-8")
    else:
        body = template.replace(
            "</form>",
            f'<p class="login-error" role="alert">{safe}</p></form>',
            1,
        ).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


# Patch the dispatcher: POST /admin/login is handled by a separate function so
# we don't pollute the GET dispatcher with form-handling code.
_original_dispatch = Handler._dispatch


def _patched_dispatch(self, method: str) -> None:  # type: ignore[no-redef]
    parsed = urlparse(self.path)
    if parsed.path == "/admin/login" and method == "POST":
        _handle_login_post(self)
        return
    _original_dispatch(self, method)


Handler._dispatch = _patched_dispatch  # type: ignore[assignment]


def main() -> None:
    from . import bootstrap
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
