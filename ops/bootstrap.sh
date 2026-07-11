#!/usr/bin/env bash
# Bootstrap beemuu-api data: seed DTC catalog from all registered sources.
#
# Idempotent — safe to run after every deploy.
#
# Usage:
#   ops/bootstrap.sh                     # seed into default DB path
#   ops/bootstrap.sh /path/to/beemuu.db  # seed into a specific DB

set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

DB_PATH="${1:-${BEEMUU_DB_PATH:-}}"
EXTRA=""
if [[ -n "$DB_PATH" ]]; then
    EXTRA="--db-path $DB_PATH"
fi

echo "bootstrapping DTC catalog..."
# Prefer python3 (Linux VPS); fall back to python (Windows dev).
# On Windows the MS Store installs a python3 shim that 404s on run, so we
# test by running `-V` rather than just checking existence.
PY=""
if python3 -V >/dev/null 2>&1; then
    PY=python3
elif python -V >/dev/null 2>&1; then
    PY=python
else
    echo "FATAL: neither python3 nor python found in PATH" >&2
    exit 1
fi
$PY -m backend.bootstrap_dtc $EXTRA

echo "OK"