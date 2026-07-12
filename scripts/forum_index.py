#!/usr/bin/env python3
"""Regenerate community/forum/index.json from the threads/ folder.

Walks every *.md in community/forum/threads/, parses the YAML
frontmatter, and writes community/forum/index.json with one entry
per thread. CI runs this on every PR and fails the build if the
committed index.json doesn't match what this script produces.

Run manually before opening a thread PR:
    python scripts/forum_index.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def _git_last_commit_date(repo_root: Path, rel_path: Path) -> str:
    """Return YYYY-MM-DD of the last commit touching rel_path.

    Uses `git log -1 --format=%cI` so the result is the same on every
    OS and every checkout, regardless of filesystem mtime behavior.
    Falls back to the file's mtime (UTC date) if git is unavailable
    or the file has never been committed.
    """
    try:
        r = subprocess.run(
            ["git", "log", "-1", "--format=%cI", "--", str(rel_path)],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=10,
        )
        iso = r.stdout.strip()
        if iso and r.returncode == 0:
            return datetime.fromisoformat(iso).strftime("%Y-%m-%d")
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError):
        pass
    # Fallback: filesystem mtime, UTC. Still correct on a single host,
    # just not reproducible across machines / checkout styles.
    return datetime.fromtimestamp(
        rel_path.stat().st_mtime, tz=timezone.utc
    ).strftime("%Y-%m-%d")

try:
    import tomllib  # py3.11+
except ModuleNotFoundError:  # pragma: no cover
    print("forum_index.py requires Python 3.11+ for tomllib.", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parents[1]
THREADS_DIR = ROOT / "community" / "forum" / "threads"
INDEX_PATH = ROOT / "community" / "forum" / "index.json"
TEMPLATE_PATH = THREADS_DIR / "TEMPLATE.md"

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.DOTALL)


def parse_thread(path: Path) -> dict | None:
    """Return {slug, title, author, date, tags, related_dtcs, config_*,
    replies, last_modified} or None if the file is the template /
    has no frontmatter / fails to parse."""
    text = path.read_text(encoding="utf-8")
    m = FRONTMATTER_RE.match(text)
    if not m:
        # No frontmatter — could be the template itself or a draft
        return None
    # Convert YAML-style "key: value" frontmatter to TOML. Each
    # non-empty, non-comment, non-indented line should be `key = value`,
    # and bare string/number values need to be wrapped in quotes. We do
    # the quoting heuristically: if the value is unquoted and isn't
    # obviously a number/bool/array, wrap it in double quotes.
    def toml_quote(v: str) -> str:
        v = v.rstrip()
        # Already quoted? leave it.
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            return v
        # Inline array `[a, b]` -> quote each element: `["a", "b"]`.
        if v.startswith("[") and v.endswith("]"):
            inner = v[1:-1].strip()
            if not inner:
                return "[]"
            parts = [p.strip() for p in inner.split(",")]
            quoted = []
            for p in parts:
                if not p:
                    continue
                if p in ("true", "false") or p.replace(".", "").replace("-", "").isdigit():
                    quoted.append(p)
                else:
                    quoted.append(f'"{p}"')
            return "[" + ", ".join(quoted) + "]"
        # Booleans and numbers pass through.
        if v in ("true", "false") or v.replace(".", "").replace("-", "").isdigit():
            return v
        # Default: quote as a string, escaping internal double-quotes.
        return '"' + v.replace('"', '\\"') + '"'

    toml_lines = []
    for raw_line in m.group(1).splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            toml_lines.append(raw_line)
            continue
        if raw_line[:1] in (" ", "\t"):
            toml_lines.append(raw_line)
            continue
        if ": " in raw_line:
            key, _, value = raw_line.partition(": ")
            toml_lines.append(f"{key} = {toml_quote(value)}")
        else:
            toml_lines.append(raw_line)
    toml_doc = "\n".join(toml_lines)
    try:
        meta = tomllib.loads(toml_doc)
    except tomllib.TOMLDecodeError as e:
        print(f"  ! {path.name}: frontmatter parse error: {e}", file=sys.stderr)
        print(f"    frontmatter was:\n{toml_doc}", file=sys.stderr)
        return None
    if not meta.get("title") or not meta.get("author"):
        return None
    body = m.group(2)
    # Count reply markers: "> **<handle> at <date>:** <body>"
    # The bold span includes the trailing colon, so the pattern is
    # "**...:**" — anything starting with ** and ending with :**.
    reply_count = len(
        re.findall(
            r"^>\s*\*\*[^*\n]+:\*\*",
            body,
            flags=re.MULTILINE,
        )
    )
    # Coerce all scalar values to strings (TOML parses bare dates as
    # datetime.date and bare ints as int; we want everything JSON-friendly
    # because the index is consumed as JSON, not TOML).
    return {
        "slug": path.stem,
        "title": str(meta["title"]),
        "author": str(meta["author"]),
        "date": str(meta.get("date", "") or ""),
        "tags": [str(t) for t in (meta.get("tags", []) or [])],
        "related_dtcs": [
            str(d) for d in (meta.get("related_dtcs", []) or [])
        ],
        "config_path": str(meta.get("config_path", "") or ""),
        "config_checksum": str(meta.get("config_checksum", "") or ""),
        "replies": reply_count,
        "last_modified": _git_last_commit_date(ROOT, path),
    }


def main() -> int:
    if not THREADS_DIR.is_dir():
        print(f"ERROR: {THREADS_DIR} does not exist", file=sys.stderr)
        return 1

    threads: list[dict] = []
    skipped: list[str] = []
    for path in sorted(THREADS_DIR.glob("*.md")):
        # Skip the template
        if path.resolve() == TEMPLATE_PATH.resolve():
            continue
        entry = parse_thread(path)
        if entry is None:
            skipped.append(path.name)
            continue
        threads.append(entry)

    # Sort: most recently modified first, then by date desc
    threads.sort(key=lambda t: (t["last_modified"], t["date"]), reverse=True)

    # If a prior index.json exists, preserve its `updated` timestamp
    # whenever the thread list is unchanged. This makes the script
    # idempotent in CI (no spurious diffs on every PR).
    prior_updated = None
    if INDEX_PATH.exists():
        try:
            prior = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
            prior_updated = prior.get("updated")
            prior_threads = prior.get("threads", [])
        except (json.JSONDecodeError, OSError):
            prior_threads = []
    else:
        prior_threads = []

    threads_changed = prior_threads != threads

    payload = {
        "updated": (
            prior_updated
            if (prior_updated and not threads_changed)
            else datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        ),
        "thread_count": len(threads),
        "threads": threads,
    }

    new_text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    existing = INDEX_PATH.read_text(encoding="utf-8") if INDEX_PATH.exists() else ""
    if new_text == existing:
        print(f"index.json already up to date ({len(threads)} threads)")
        return 0

    INDEX_PATH.write_text(new_text, encoding="utf-8")
    print(
        f"Wrote {INDEX_PATH} with {len(threads)} thread(s)"
        + (f" (skipped: {', '.join(skipped)})" if skipped else "")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())