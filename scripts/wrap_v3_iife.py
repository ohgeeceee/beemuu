#!/usr/bin/env python3
"""Wrap the v3 engines in an IIFE.

Every classic <script> tag shares one global lexical scope, so a top-level
`const api` in one file is a redeclaration error in the next. Ten engines each
declaring `const api` means nine SyntaxErrors and a window that loads none of
them.

The repo already established the fix — cbs_predict.js, plugins.js and
wiring_detect.js all wrap their bodies in `(function (root) { ... })(window)`.
The v3 engines were written as bare top-level consts, which works under
`node --test` (each require() gets its own module scope) and under jsdom
(window.eval scopes each file separately) but not in a real page. The visual
smoke test in a real browser is what caught it.

This wraps the body in a plain IIFE, leaving `module.exports` and the
`window.*` assignments working exactly as before.

Usage:
    python3 scripts/wrap_v3_iife.py            # wrap the listed files
    python3 scripts/wrap_v3_iife.py --check    # fail if any is unwrapped
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FILES = [
    "misfire_patterns.js",
    "adaptation_drift.js",
    "tuning_fingerprint.js",
    "flash_audit.js",
    "cold_start.js",
    "parameter_hunt.js",
    "symptom_index.js",
    "signal_library.js",
    "vehicle_passport.js",
    "plugins_registry_client.js",
    "v3_ui.js",
]

MARKER = "/* v3 IIFE wrapper — see scripts/wrap_v3_iife.py. Every classic"


def wrap(text: str) -> str:
    """Wrap a file body in an IIFE, preserving its leading block comment."""
    if MARKER in text:
        return text

    lines = text.split("\n")

    # Keep the leading comment block outside the wrapper: it documents the
    # module and reads better as a file header than as an indented comment.
    head = []
    i = 0
    while i < len(lines) and (lines[i].startswith("/*") or lines[i].startswith("*")
                              or lines[i].startswith(" */") or lines[i].strip() == ""):
        if lines[i].strip().startswith("*/"):
            head.append(lines[i])
            i += 1
            break
        head.append(lines[i])
        i += 1
    body = "\n".join(lines[i:])

    wrapper = (
        f"{MARKER}\n"
        " * tag shares one global lexical scope, so a bare top-level `const` in\n"
        " * one file is a redeclaration error in the next. */\n"
        "(function () {\n"
        "\"use strict\";\n"
        f"{body.rstrip()}\n"
        "})();\n"
    )
    return "\n".join(head).rstrip("\n") + "\n\n" + wrapper


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    unwrapped = []
    for name in FILES:
        path = ROOT / "src" / "js" / name
        if not path.exists():
            print(f"missing: {name}", file=sys.stderr)
            return 1
        text = path.read_text(encoding="utf-8")
        if args.check:
            if MARKER not in text:
                unwrapped.append(name)
            continue
        new = wrap(text)
        if new != text:
            path.write_text(new, encoding="utf-8")
            print(f"wrapped {name}")

    if args.check:
        if unwrapped:
            print("not wrapped: " + ", ".join(unwrapped), file=sys.stderr)
            print("run python3 scripts/wrap_v3_iife.py", file=sys.stderr)
            return 1
        print(f"all {len(FILES)} v3 scripts are IIFE-wrapped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())