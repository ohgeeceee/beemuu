#!/usr/bin/env python3
"""Stamp a BeeEmUu release version across every published surface.

Given a release tag (``v3.8.0``), rewrite the beemuu.com pages, the generated
roadmap/changelog hubs, the version guard, the README badge and the app
manifests so the whole project agrees on one release number. This is the step a
human used to do by hand -- and forget, which is why the homepage advertised
v3.0.0 for six minor releases while ``frontend/version_surface.test.js`` kept
looking the other way.

Run by ``.github/workflows/update-on-release.yml`` whenever a GitHub release is
published, and runnable by hand:

    python3 scripts/stamp-release.py v3.8.0               # from a tag
    python3 scripts/stamp-release.py v3.8.0 --dry-run     # show the diff set
    python3 scripts/stamp-release.py --latest             # newest GitHub release

The script is idempotent: re-running it for the version already stamped changes
nothing and exits 0, so the workflow can call it on every release without
producing empty commits. It self-verifies at the end -- if any surface it owns
does not name the new release it exits non-zero *before* anything is committed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")
TAG_RE = re.compile(r"^\d+\.\d+\.\d+$")

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

# Files that carry the *published* release number as `vX.Y.Z` (site copy and the
# generator that owns roadmap.html/changelog.html). Historical mentions of older
# releases are never touched because only the previous-release string is
# rewritten.
SITE_FILES = [
    "frontend/index.html",
    "frontend/press.html",
    "frontend/dashboard.html",
    "frontend/version_surface.test.js",
    "scripts/gen-content-pages.py",
]


class StampError(Exception):
    pass


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf8")


def write(rel: str, text: str, changed: list[str]) -> None:
    path = ROOT / rel
    old = path.read_text(encoding="utf8")
    if old == text:
        return
    path.write_text(text, encoding="utf8")
    changed.append(rel)


def site_version() -> str:
    """The release currently published on the site, as `vX.Y.Z`."""
    m = re.search(r"releases/tag/v(\d+\.\d+\.\d+)", read("frontend/index.html"))
    if not m:
        raise StampError("frontend/index.html has no releases/tag/vX.Y.Z link to key off")
    return "v" + m.group(1)


def app_version() -> str:
    return json.loads(read("package.json"))["version"]


def swap(text: str, old_tag: str, new_tag: str) -> str:
    """Replace the outgoing release tag, leaving older release numbers alone."""
    return re.sub(re.escape(old_tag) + r"(?![\d.])", new_tag, text)


def swap_first(text: str, pattern: str, replacement: str, limit: int = 1) -> str:
    return re.sub(pattern, replacement, text, count=limit)


def stamp_site(new_tag: str, date: "str | None", changed: list[str]) -> None:
    old_tag = site_version()
    if old_tag == new_tag:
        return
    for rel in SITE_FILES:
        text = swap(read(rel), old_tag, new_tag)
        if rel == "scripts/gen-content-pages.py" and date:
            # The generated pages stamp "Updated <Month> <Year>"; keep it honest.
            month = MONTHS[int(date[5:7]) - 1]
            text = re.sub(r"Updated [A-Z][a-z]+ \d{4}", f"Updated {month} {date[:4]}", text)
        write(rel, text, changed)


def stamp_manifests(new_tag: str, changed: list[str]) -> None:
    old = app_version()
    new = new_tag.lstrip("v")
    if old == new:
        return
    spec = [
        ("package.json", r'("version"\s*:\s*")' + re.escape(old) + r'(")', 1),
        ("package-lock.json", r'("version"\s*:\s*")' + re.escape(old) + r'(")', 2),
        ("src-tauri/tauri.conf.json", r'("version"\s*:\s*")' + re.escape(old) + r'(")', 1),
        ("src-tauri/Cargo.toml", r'(?m)^(version\s*=\s*")' + re.escape(old) + r'(")', 1),
    ]
    for rel, pattern, count in spec:
        text = swap_first(read(rel), pattern, r"\g<1>" + new + r"\g<2>", count)
        write(rel, text, changed)

    lock = read("src-tauri/Cargo.lock")
    lock = swap_first(
        lock,
        r'(name = "beeemuu"\nversion = ")' + re.escape(old) + r'(")',
        r"\g<1>" + new + r"\g<2>",
    )
    write("src-tauri/Cargo.lock", lock, changed)

    write("README.md", swap(read("README.md"), "v" + old, new_tag), changed)


BOILERPLATE = "Packages in this release are built from the source commit"


def stamp_changelog(new_tag: str, date: "str | None", notes: str, changed: list[str]) -> None:
    semver = new_tag.lstrip("v")
    text = read("CHANGELOG.md")
    if re.search(r"^## \[" + re.escape(semver) + r"\]", text, re.M):
        return
    stamp = f"## [{semver}]"
    if date:
        stamp += f" — {date}"
    body = (notes or "").strip()
    if not body or BOILERPLATE in body:
        body = f"Packages and release notes: https://github.com/ohgeeceee/beemuu/releases/tag/{new_tag}"
    section = f"{stamp}\n\n{body}\n\n"
    anchor = "## [Unreleased]\n\n"
    if anchor in text:
        text = text.replace(anchor, anchor + section, 1)
    else:
        text = text.replace("\n## [", "\n" + section + "## [", 1)
    write("CHANGELOG.md", text, changed)


def run_generator(changed: list[str]) -> None:
    gen = ROOT / "scripts" / "gen-content-pages.py"
    before = {
        str(p.relative_to(ROOT)): p.read_text(encoding="utf8")
        for p in sorted((ROOT / "frontend").rglob("*.html"))
    }
    proc = subprocess.run([sys.executable, str(gen)], cwd=ROOT, capture_output=True, text=True)
    if proc.returncode != 0:
        raise StampError(f"gen-content-pages.py failed:\n{proc.stdout}\n{proc.stderr}")
    for rel, old in before.items():
        if (ROOT / rel).read_text(encoding="utf8") != old:
            changed.append(rel)
    for path in sorted((ROOT / "frontend").rglob("*.html")):
        rel = str(path.relative_to(ROOT))
        if rel not in before:
            changed.append(rel)


def fetch_release(repo: str, tag: "str | None") -> dict:
    """Read one public release (no auth needed for a public repo; token if set)."""
    path = f"/releases/tags/{tag}" if tag else "/releases/latest"
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}{path}",
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "beemuu-stamp-release",
            **({"Authorization": f"Bearer {os.environ['GH_TOKEN']}"} if os.environ.get("GH_TOKEN") else {}),
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def verify(new_tag: str) -> list[str]:
    """Every surface this script owns must name the release before we commit."""
    semver = new_tag.lstrip("v")
    tag_link = f"releases/tag/{new_tag}"
    checks = [
        ("frontend/index.html", f"BeeEmUu {new_tag} is here"),
        ("frontend/index.html", f'class="banner-tag">{new_tag}<'),
        ("frontend/index.html", f"Download {new_tag}"),
        ("frontend/index.html", tag_link),
        ("frontend/press.html", f"BeeEmUu {new_tag} &mdash; what's new"),
        ("frontend/press.html", tag_link),
        ("frontend/version_surface.test.js", f'BEEMUU_TEST_RELEASE || "{new_tag}"'),
        ("frontend/dashboard.html", f'id="dash-version">{new_tag}</span>'),
        ("frontend/roadmap.html", f"desktop app is at <strong>{new_tag}</strong>"),
        ("frontend/changelog.html", f"The latest release is <strong>{new_tag}</strong>"),
        ("CHANGELOG.md", f"## [{semver}]"),
        ("README.md", f"release-{new_tag}-"),
        ("src-tauri/Cargo.lock", f'name = "beeemuu"\nversion = "{semver}"'),
        ("src-tauri/Cargo.toml", f'version = "{semver}"'),
    ]
    missing = [f"{rel}: {needle!r}" for rel, needle in checks if needle not in read(rel)]
    gen = read("scripts/gen-content-pages.py")
    hits = len(re.findall(re.escape(new_tag), gen))
    if hits < 3:
        missing.append(f"scripts/gen-content-pages.py: only {hits} of >=3 release surfaces")
    if json.loads(read("package.json"))["version"] != semver:
        missing.append(f"package.json: version != {semver}")
    if json.loads(read("src-tauri/tauri.conf.json"))["version"] != semver:
        missing.append(f"src-tauri/tauri.conf.json: version != {semver}")
    return missing


def main() -> int:
    ap = argparse.ArgumentParser(description="Stamp a release version across the BeeEmUu site and manifests.")
    ap.add_argument("tag", nargs="?", help="release tag, e.g. v3.8.0 (omit with --latest)")
    ap.add_argument("--latest", action="store_true", help="use the newest published GitHub release")
    ap.add_argument("--repo", default="ohgeeceee/beemuu")
    ap.add_argument("--notes-file", help="markdown release notes for the CHANGELOG section")
    ap.add_argument("--date", help="release date YYYY-MM-DD for the CHANGELOG section")
    ap.add_argument("--no-notes", action="store_true", help="do not fetch release notes")
    ap.add_argument("--dry-run", action="store_true", help="report what would change, write nothing")
    args = ap.parse_args()

    notes = ""
    date = args.date
    tag = args.tag

    if args.latest or not tag:
        if not args.latest:
            ap.error("give a tag or --latest")
        try:
            rel = fetch_release(args.repo, None)
        except urllib.error.HTTPError as exc:
            raise StampError(f"could not read the latest release: {exc}") from exc
        tag = rel["tag_name"]
        date = date or (rel.get("published_at") or "")[:10]
        notes = notes or (rel.get("body") or "")

    if args.notes_file:
        notes = Path(args.notes_file).read_text(encoding="utf8")
    if not args.no_notes and not notes and date is None:
        try:
            rel = fetch_release(args.repo, tag)
            date = (rel.get("published_at") or "")[:10]
            notes = rel.get("body") or ""
        except Exception:  # offline / rate limited: the section gets a link instead
            pass

    tag = tag.strip()
    tag = re.sub(r"^refs/tags/", "", tag)
    if not tag.startswith("v"):
        tag = "v" + tag
    if not TAG_RE.match(tag[1:]):
        print(
            f"::notice::refusing to stamp {tag!r}: the site only accepts semver release tags "
            "(vX.Y.Z). Nothing was changed.",
            file=sys.stderr,
        )
        return 2

    date = date or None
    old_site, old_app = site_version(), app_version()

    if args.dry_run:
        print(f"dry-run: site {old_site} -> {tag}, app {old_app} -> {tag.lstrip('v')}, date={date}")
        return 0

    changed: list[str] = []
    stamp_site(tag, date, changed)
    stamp_manifests(tag, changed)
    stamp_changelog(tag, date, notes, changed)
    if changed:
        run_generator(changed)
        changed = sorted(set(changed))

    missing = verify(tag)
    if missing:
        print("stamp-release: the tree does not fully name this release:", file=sys.stderr)
        for item in missing:
            print(f"  missing {item}", file=sys.stderr)
        return 1

    if changed:
        print(f"stamp-release: {tag} (from site {old_site}, app {old_app})")
        for rel in changed:
            print(f"  changed {rel}")
    else:
        print(f"stamp-release: {tag} already stamped everywhere; nothing to change")
    print(f"VERSION={tag[1:]}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except StampError as exc:
        print(f"stamp-release: {exc}", file=sys.stderr)
        sys.exit(1)
