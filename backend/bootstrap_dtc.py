"""CLI entry point for the seed bootstrap. Run with:

    python -m backend.bootstrap_dtc [--db-path PATH]

Runs every registered seed source (DTC seeds + schematics seeds). Idempotent.
Intended to be called from ops/bootstrap.sh or directly after a fresh deploy.
"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

from . import db, seed

# Importing the seed modules is what registers their run() functions in the
# SOURCES registry. Without this, --list shows nothing and the bootstrap
# is a no-op. Centralize the import here so callers don't have to remember.
# Import order matters: generic SAE seeds first, then BMW-specific seeds
# last so that on any code collision the BMW-specific row wins (it carries
# richer provenance and overrides the generic fallback).
from . import seed_dtcs  # noqa: F401 — registers via @register_source
from . import seed_bmw  # noqa: F401 — registers via @register_source
from . import seed_bmw_dim01  # noqa: F401 — registers via @register_source
from . import seed_schematics  # noqa: F401 — registers via @register_source


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap DTC seed data")
    parser.add_argument(
        "--db-path",
        default=None,
        help="Path to sqlite DB (default: $BEEMUU_DB_PATH or backend/data/beemuu.db)",
    )
    parser.add_argument(
        "--list", action="store_true", help="List registered seed sources and exit"
    )
    args = parser.parse_args()

    if args.list:
        for i, fn in enumerate(seed.SOURCES, 1):
            print(f"{i}. {fn.__module__}.{fn.__qualname__}")
        return

    t0 = time.time()
    db_path_arg = Path(args.db_path) if args.db_path else None
    resolved = db._resolve_path(db_path_arg)  # noqa: SLF001
    db.init_db(resolved)
    print(f"bootstrapping seed data into {resolved}")
    seed.run_bootstrap(resolved)
    with db.get_conn(resolved) as conn:
        n_dtc = conn.execute("SELECT COUNT(*) FROM dtc").fetchone()[0]
        n_bmw = conn.execute(
            "SELECT COUNT(*) FROM dtc WHERE category = 'bmw-specific'"
        ).fetchone()[0]
        n_schematics = conn.execute(
            "SELECT COUNT(*) FROM schematics"
        ).fetchone()[0]
    elapsed = time.time() - t0
    print(
        f"done in {elapsed:.2f}s — {n_dtc} total DTCs "
        f"({n_bmw} BMW-specific), {n_schematics} schematics"
    )


if __name__ == "__main__":
    main()