#!/usr/bin/env python3
"""Generate src/js/signal_index.json from community/profiles/*.toml.

The Signal Library (v3.0.0 feature 8) needs every decodable signal in one
searchable index, with an honest confidence grade per signal. `list_profiles()`
only returns id/label/theme, so the params are not reachable from the webview
without changing `commands.rs` — which is Tier B (one human merge).

So this generates a static index instead, the same shape
`scripts/gen_profile_plugins.py` already produces for the engine profile packs.
It is a build-time artifact: re-run it after editing a community profile, and
the Rust gate `shipped_community_dir()` plus this script's own validation will
catch a malformed profile.

Usage:
    python3 scripts/gen_signal_index.py            # write the index
    python3 scripts/gen_signal_index.py --check    # fail if it is stale
"""
from __future__ import annotations

import argparse
import json
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROFILES = ROOT / "community" / "profiles"
OUTPUT = ROOT / "src" / "js" / "signal_index.json"
# The webview cannot `fetch` a relative asset path under the Tauri asset
# protocol, so index.html loads a plain script that assigns the payload to a
# global instead. Both files are generated from the same object, and --check
# verifies both, so they cannot drift apart.
OUTPUT_DATA = ROOT / "src" / "js" / "signal_index_data.js"


def load_profiles() -> list[dict]:
    """Parse every shipped profile TOML into the shape signal_library.build()
    expects: [{id, label, param: [{id, label, unit, query, target, ...}]}].
    """
    out: list[dict] = []
    for path in sorted(PROFILES.glob("*.toml")):
        try:
            data = tomllib.loads(path.read_text(encoding="utf-8"))
        except tomllib.TOMLDecodeError as exc:
            # A malformed profile must fail loudly here rather than silently
            # dropping signals from the library.
            raise SystemExit(f"{path.name}: {exc}") from exc
        for profile in data.get("profile", []):
            out.append({
                "id": profile.get("id", ""),
                "label": profile.get("label", ""),
                "param": profile.get("param", []) or [],
            })
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="exit non-zero if the committed index is stale")
    args = parser.parse_args()

    profiles = load_profiles()
    params = sum(len(p["param"]) for p in profiles)

    # Keep only the keys signal_library.build() reads. Shipping the whole param
    # record would put every profile's enum tables into the webview for nothing.
    slim = []
    for p in profiles:
        slim.append({
            "id": p["id"],
            "label": p["label"],
            "param": [
                {k: q[k] for k in ("id", "label", "unit", "query", "target",
                                   "decode", "min", "max") if k in q}
                for q in p["param"]
            ],
        })

    payload = {
        "generated_by": "scripts/gen_signal_index.py",
        "source": "community/profiles/*.toml",
        "note": (
            "Generated file — do not edit by hand. Re-run "
            "`python3 scripts/gen_signal_index.py` after changing a community "
            "profile. `src/js/signal_library.js` grades each signal's "
            "confidence from its query form and any [needs verification] note "
            "in its label."
        ),
        "profiles": slim,
    }
    text = json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n"

    # The webview gets the same object as a script-assigned global. JSON is a
    # subset of JavaScript expression syntax, so the payload is embedded
    # directly rather than re-escaped — one less place for the two copies to
    # diverge.
    data_js = (
        "/* GENERATED FILE — do not edit.\n"
        " * Source: community/profiles/*.toml\n"
        " * Regenerate: python3 scripts/gen_signal_index.py\n"
        " *\n"
        " * Loaded by index.html as a plain script because the Tauri webview\n"
        " * cannot fetch a relative asset path. v3_signal_index.js turns this\n"
        " * into the index signal_library.build() consumes.\n"
        " */\n"
        "window.beeemuuSignalIndexData = " + text.rstrip("\n") + ";\n"
    )

    if args.check:
        stale = []
        for path, expected in ((OUTPUT, text), (OUTPUT_DATA, data_js)):
            if not path.exists():
                stale.append(f"{path.name} does not exist")
            elif path.read_text(encoding="utf-8") != expected:
                stale.append(f"{path.name} is stale")
        if stale:
            for s in stale:
                print(f"{s} — run scripts/gen_signal_index.py", file=sys.stderr)
            return 1
        print(f"signal index up to date ({len(slim)} profiles, {params} params)")
        return 0

    OUTPUT.write_text(text, encoding="utf-8")
    OUTPUT_DATA.write_text(data_js, encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)} and {OUTPUT_DATA.relative_to(ROOT)}: "
          f"{len(slim)} profiles, {params} params")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())