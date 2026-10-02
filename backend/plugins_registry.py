"""Read-only community plugin registry.

The registry is a set of reviewed package JSON files under
``src/plugins/registry/`` (one file per published package, named
``<author>.<name>.json``). The desktop app can list them and install
individual packages; this module serves both without a database.

Public API:
  list_plugins(registry_dir, q=..., kind=..., limit=...) -> list[dict]
  get_plugin(registry_dir, plugin_id)                  -> dict | None
  validate_package(pkg)                                -> dict  (structural only)
  package_digest(pkg)                                  -> str   (sha256, hex)
  verify_digest(pkg, expected)                         -> bool

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

Integrity
---------
A download ecosystem is only as good as its integrity story, so every
package carries a sha256 of its canonical serialisation. ``_load`` checks
each entry against a sidecar ``<name>.sha256`` when one exists and *skips*
the package on mismatch — a corrupted or tampered file must never be served,
and silently serving it "with a warning" is the same as serving it.

The digest covers the canonical JSON (sorted keys, no insignificant
whitespace), so it is stable across key reordering and reformatting while
still changing if any byte of any value changes. It is an *integrity*
digest, not a signature: it detects corruption and casual tampering, and it
does not prove authorship. Author signing is still the open Tier B item.
"""
from __future__ import annotations

import hashlib
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


def package_digest(pkg: object) -> str:
    """Return the sha256 of a package's canonical serialisation, as hex.

    Canonical means sorted keys, no insignificant whitespace, and numbers
    rendered in JavaScript's form. The number detail is load-bearing and is the
    whole reason this function exists rather than a one-liner:

    JSON does not distinguish 1 from 1.0 — ``json.loads("1")`` gives an
    ``int`` and ``json.loads("1.0")`` gives a ``float``, and ``json.dumps``
    writes each back the way it arrived. JavaScript has no such distinction:
    ``JSON.parse("1")`` and ``JSON.parse("1.0")`` are the same Number, and
    ``JSON.stringify`` writes back whatever form it chooses. So a manifest
    containing ``min = -40.0`` — which the community profiles are full of —
    would hash differently on the two sides and every install would fail.

    The fix is to normalise on this side, to the form the client can actually
    reproduce. The int/float distinction is **lost**, not preserved: once the
    manifest reaches JavaScript it is gone, so a digest that depended on it
    could never be verified by the only party that needs to verify it. Whole
    floats are therefore written as integers. See ``canonicalNumber`` in
    ``src/js/plugins_registry_client.js``, which mirrors this exactly.
    """
    canonical = _canonical_json(pkg)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _canonical_json(value: object) -> str:
    """Serialise to canonical JSON, in the form JavaScript reproduces exactly."""
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, int):
        # bool is an int subclass; handled above.
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            # NaN/Infinity are not valid JSON and JS would render them as null,
            # which would silently change the digest. Refuse instead.
            raise ValueError("Cannot canonicalise a non-finite number.")
        if value.is_integer() and abs(value) < 1e21:
            # A whole float loses its ".0" so it matches what the client emits.
            # -0.0 is normalised to 0, again matching JSON.stringify.
            return str(int(value))
        return repr(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_canonical_json(v) for v in value) + "]"
    if isinstance(value, dict):
        parts = []
        for key in sorted(value):
            # Keys are always str here because they came from json.loads.
            parts.append(json.dumps(key, ensure_ascii=False) + ":" +
                         _canonical_json(value[key]))
        return "{" + ",".join(parts) + "}"
    raise ValueError(f"Cannot canonicalise value of type {type(value).__name__}.")


def verify_digest(pkg: object, expected: str | None) -> bool:
    """Check a package against a recorded digest.

    A missing expected digest is *not* a pass: an entry with no sidecar has
    nothing to verify against, and treating that as verified would let anyone
    add a package by simply omitting the file. Callers that want the permissive
    behaviour must ask for it explicitly (see `_load`).
    """
    if not isinstance(expected, str) or not expected.strip():
        return False
    # Compare case-insensitively and ignore surrounding whitespace: sidecars are
    # hand-written and `shasum` output format varies.
    return package_digest(pkg).lower() == expected.strip().lower()


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
        # The digest travels with the summary so a client can show what it
        # would download before deciding to download it.
        "sha256": package_digest(pkg),
    }


def _load(registry_dir: Path) -> tuple[list[dict], dict[str, str]]:
    """Load, validate and digest-check every package in the registry dir.

    Returns ``(packages, errors)``. A malformed entry, an unreadable file or a
    **digest mismatch** all cause the package to be skipped — a corrupted or
    tampered file must never be served, and serving it with a warning is the
    same as serving it. The filename is recorded in ``errors`` so a caller can
    surface exactly what was rejected and why, rather than the registry simply
    appearing to have fewer packages than expected.
    """
    if not registry_dir.is_dir():
        return [], {}
    packages: list[dict] = []
    errors: dict[str, str] = {}
    for path in sorted(registry_dir.glob("*.json")):
        try:
            pkg = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors[path.name] = f"unreadable: {exc}"
            continue
        try:
            validate_package(pkg)
        except ValueError as exc:
            errors[path.name] = f"invalid: {exc}"
            continue

        # A sidecar is optional for the existing shipped packages, so a missing
        # one is not a rejection — but a *present and wrong* one always is.
        # `verify_digest` treats a missing expectation as a failure, so the
        # presence check happens here and the failure check is delegated.
        sidecar = path.with_suffix(".sha256")
        if sidecar.exists():
            try:
                expected = sidecar.read_text(encoding="utf-8").strip()
            except OSError as exc:
                errors[path.name] = f"unreadable digest: {exc}"
                continue
            if not verify_digest(pkg, expected):
                errors[path.name] = (
                    f"sha256 mismatch: manifest is {package_digest(pkg)[:12]}…, "
                    f"recorded {expected[:12] if expected else '(empty)'}…"
                )
                continue

        packages.append(pkg)
    return packages, errors


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
    packages, _errors = _load(registry_dir)
    for pkg in packages:
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


def registry_errors(registry_dir: Path) -> dict[str, str]:
    """Return ``{filename: reason}`` for every entry `_load` rejected.

    A tampered or corrupt package is not served *and* not silently dropped:
    without this the registry just appears to have fewer packages, and a
    contributor whose manifest was edited in place would have no idea why it
    vanished.
    """
    _packages, errors = _load(registry_dir)
    return errors


def get_plugin(registry_dir: Path, plugin_id: str) -> dict | None:
    """Return the full package (including code) for one id, or None."""
    plugin_id = (plugin_id or "").strip()
    if not plugin_id or not _ID_RE.match(plugin_id):
        return None
    packages, _errors = _load(registry_dir)
    for pkg in packages:
        if pkg["id"] == plugin_id:
            return pkg
    return None
