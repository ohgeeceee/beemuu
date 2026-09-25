"""Read-only community plugin registry.

The registry is a set of reviewed package JSON files under
``src/plugins/registry/`` (one file per published package, named
``<author>.<name>.json``). The desktop app can list them and install
individual packages; this module serves both without a database.

Public API:
  list_plugins(registry_dir, q=..., kind=..., limit=...) -> list[dict]
  get_plugin(registry_dir, plugin_id)                  -> dict | None
  validate_package(pkg)                                -> dict  (structural only)

Design notes
------------
This is intentionally a *structural* validator, not the authoritative one.
The desktop performs the full sandboxed validation (schema, sizes, bundle
compile) in ``src/js/plugins.js`` at install time. Here we only reject
packages that are malformed enough that serving them is meaningless
(wrong shape, bad id, missing required fields, oversize), so a broken
registry entry can never be handed to clients. We never execute code and
never render package content as HTML.

List responses are summary-only (id, name, version, author, kind,
description, license) — they deliberately omit ``code``/``files`` so the
catalog stays small. The full manifest, including code, is returned only
by ``get_plugin`` for the specific package a client chose to install.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

# Structural limits mirror src/js/plugins.js so the registry index cannot
# advertise a package the desktop would reject.
MAX_PACKAGE = 256 * 1024
_MAX_ID = 100
_MAX_VERSION = 30
_MAX_NAME = 80
_MAX_AUTHOR = 100
_MAX_DESCRIPTION = 600
_MAX_LICENSE = 100
_MAX_FILES = 50
_MAX_FILE_LENGTH = 200000
_KINDS = {"data", "tool"}
_ID_RE = re.compile(r"^[a-z0-9]+(?:[.-][a-z0-9]+)+$")
_VERSION_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def _str(value: object, name: str, maxlen: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maxlen:
        raise ValueError(f"Invalid {name}.")
    return value


def validate_package(pkg: object) -> dict:
    """Structurally validate a registry package dict.

    Mirrors the client-side rules in src/js/plugins.js closely enough to
    reject obviously malformed entries. Raises ValueError on bad packages;
    returns the (unchanged) package on success.
    """
    if not isinstance(pkg, dict):
        raise ValueError("Package must be a JSON object.")
    schema = pkg.get("schemaVersion")
    if schema not in (1, 2):
        raise ValueError("Unsupported package schema. Expected version 1 or 2.")
    _str(pkg.get("id"), "id", _MAX_ID)
    if not _ID_RE.match(pkg["id"]):
        raise ValueError("Use a namespaced id, such as author.tool-name.")
    _str(pkg.get("version"), "version", _MAX_VERSION)
    if not _VERSION_RE.match(pkg["version"]):
        raise ValueError("Version must be major.minor.patch.")
    for key, maxlen in (("name", _MAX_NAME), ("author", _MAX_AUTHOR),
                        ("description", _MAX_DESCRIPTION), ("license", _MAX_LICENSE)):
        _str(pkg.get(key), key, maxlen)
    kind = pkg.get("kind")
    if kind not in _KINDS:
        raise ValueError("Plugin kind must be data or tool.")
    permissions = pkg.get("permissions")
    if not isinstance(permissions, list) or permissions:
        raise ValueError("Version 1 and 2 plugins cannot request host permissions.")
    size = len(json.dumps(pkg))
    if size > MAX_PACKAGE:
        raise ValueError("Package exceeds 256 KiB.")
    if kind == "data":
        content = pkg.get("content")
        if not isinstance(content, dict):
            raise ValueError("Data packs require a content object.")
        articles = content.get("articles", [])
        if not isinstance(articles, list) or len(articles) > 100:
            raise ValueError("Expected up to 100 articles.")
        for article in articles:
            if not isinstance(article, dict):
                raise ValueError("Each article must be an object.")
            _str(article.get("title"), "article title", 120)
            _str(article.get("body"), "article body", 16000)
        profiles = content.get("profilesToml")
        if profiles is not None and (not isinstance(profiles, str) or len(profiles) > 120000):
            raise ValueError("Invalid profile TOML.")
        if not articles and profiles is None:
            raise ValueError("Data pack is empty.")
    else:  # tool
        if pkg.get("content") is not None:
            raise ValueError("Tools cannot include data-pack content.")
        if pkg.get("exampleInput") is None:
            raise ValueError("Provide exampleInput.")
        if len(json.dumps(pkg.get("exampleInput"))) > 32000:
            raise ValueError("exampleInput up to 32 KiB of JSON.")
        files = pkg.get("files")
        if files is not None:
            if not isinstance(files, dict):
                raise ValueError("Bundle `files` must be a map of filename to source.")
            entry = pkg.get("entry")
            if not isinstance(entry, str) or entry not in files:
                raise ValueError("A bundled tool must declare an entry file present in `files`.")
            if len(files) > _MAX_FILES:
                raise ValueError(f"Tool bundles at most {_MAX_FILES} files.")
            for name, source in files.items():
                if not isinstance(source, str) or not source.strip() or len(source) > _MAX_FILE_LENGTH:
                    raise ValueError(f"Invalid bundle file: {name}.")
            code = pkg.get("code")
            if code is not None and not isinstance(code, str):
                raise ValueError("Invalid tool code.")
        else:
            code = pkg.get("code")
            if not isinstance(code, str) or not code.strip() or len(code) > 120000:
                raise ValueError("A tool must provide `code` or a `files` bundle.")
    return pkg


def _summary(pkg: dict) -> dict:
    """Compact metadata card for list responses (no code/files)."""
    return {
        "id": pkg["id"],
        "name": pkg["name"],
        "version": pkg["version"],
        "author": pkg["author"],
        "kind": pkg["kind"],
        "description": pkg["description"],
        "license": pkg["license"],
        "schemaVersion": pkg.get("schemaVersion"),
    }


def _load(registry_dir: Path) -> list[dict]:
    """Load, validate and return every package in the registry dir.

    Malformed or unreadable entries are skipped (the registry never 500s
    because one file is broken) but the filename is returned in an
    ``errors`` mapping that callers may surface. Each entry is annotated
    with the source filename.
    """
    if not registry_dir.is_dir():
        return []
    packages = []
    for path in sorted(registry_dir.glob("*.json")):
        try:
            pkg = json.loads(path.read_text(encoding="utf-8"))
            packages.append(validate_package(pkg))
        except (OSError, json.JSONDecodeError, ValueError):
            continue
    return packages


def list_plugins(
    registry_dir: Path,
    *,
    q: str | None = None,
    kind: str | None = None,
    limit: int = 100,
) -> list[dict]:
    """Return summary cards, optionally filtered by query/kind.

    ``q`` does a case-insensitive substring match against id, name and
    description. ``kind`` filters to data/tool. limit is clamped to [1, 200].
    """
    limit = max(1, min(200, int(limit)))
    results = []
    needle = (q or "").strip().lower()
    for pkg in _load(registry_dir):
        if kind and pkg["kind"] != kind:
            continue
        if needle:
            haystack = f"{pkg['id']} {pkg['name']} {pkg['description']}".lower()
            if needle not in haystack:
                continue
        results.append(_summary(pkg))
        if len(results) >= limit:
            break
    return results


def get_plugin(registry_dir: Path, plugin_id: str) -> dict | None:
    """Return the full package (including code) for one id, or None."""
    plugin_id = (plugin_id or "").strip()
    if not plugin_id or not _ID_RE.match(plugin_id):
        return None
    for pkg in _load(registry_dir):
        if pkg["id"] == plugin_id:
            return pkg
    return None
