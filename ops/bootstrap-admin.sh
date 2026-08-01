#!/usr/bin/env bash
# Bootstrap the beemuu-api admin schema + first admin user.
#
# The systemd unit (`ops/beemuu-api.service`) calls
# `backend.bootstrap.bootstrap_for_startup()` automatically when it starts,
# so this script is a belt-and-suspenders manual path for:
#
#   - hot reloads / `systemctl reload` (which may not re-run main())
#   - manual DB setup on a fresh VPS before the unit is installed
#   - CI / staging environments that don't run the systemd unit
#
# Idempotent: safe to run after every deploy.
#
# Requirements:
#   - BEEMUU_ADMIN_PASSWORD must be exported (e.g. via
#     `set -a; source /etc/beemuu/beemuu.env; set +a`). This matches what
#     systemd injects via EnvironmentFile=.
#   - python3 (Linux VPS) or python (Windows dev) on PATH.
#
# Usage:
#   ops/bootstrap-admin.sh                     # default DB path
#   ops/bootstrap-admin.sh /path/to/beemuu.db  # explicit DB path

set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

DB_PATH="${1:-${BEEMUU_DB_PATH:-}}"
EXTRA=""
if [[ -n "$DB_PATH" ]]; then
    EXTRA="--db-path $DB_PATH"
fi

# Pick a Python. Prefer python3 (Linux VPS); fall back to python (Windows
# dev). On Windows the MS Store installs a python3 shim that 404s on run,
# so we test by running `-V` rather than just checking existence.
PY=""
if python3 -V >/dev/null 2>&1; then
    PY=python3
elif python -V >/dev/null 2>&1; then
    PY=python
else
    echo "FATAL: neither python3 nor python found in PATH" >&2
    exit 1
fi

if [[ -z "${BEEMUU_ADMIN_PASSWORD:-}" ]]; then
    echo "FATAL: BEEMUU_ADMIN_PASSWORD is not set." >&2
    echo "       export it (e.g. 'set -a; source /etc/beemuu/beemuu.env; set +a') and retry." >&2
    exit 2
fi

echo "bootstrapping admin schema + first admin user..."
$PY -m backend.bootstrap $EXTRA
echo "OK"
