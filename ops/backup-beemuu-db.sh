#!/usr/bin/env bash
# Daily sqlite backup of the beemuu admin DB.
#
# Used to be lost during the deploy-md audit / montanotter→beemuu.com migration;
# recovered here against the current production layout
# (/var/www/beemuu, port 8766, beemuu-prod-api.service).
#
# Install on the production host:
#
#   sudo cp ops/backup-beemuu-db.sh /usr/local/bin/backup-beemuu-db.sh
#   sudo chmod +x /usr/local/bin/backup-beemuu-db.sh
#   sudo crontab -e
#   # add:
#   0 3 * * * /usr/local/bin/backup-beemuu-db.sh >> /var/log/beemuu-backup.log 2>&1
#
# Uses sqlite3's atomic .backup command — safe to run while the DB is being
# written by the running API. Backups land in /var/backups/beemuu/, gzip'd, and
# are retained for 14 days. Override any default via env var.
#
# Restore a backup:
#   gunzip -c /var/backups/beemuu/beemuu-YYYYMMDD-HHMMSS.db.gz \
#     | sqlite3 /var/www/beemuu/backend/data/beemuu.db

set -euo pipefail

# Defaults match the actual production layout (see DEPLOY.md "historical
# reference" banner and ops/beemuu-api.service notes).
DB_PATH="${BEEMUU_DB_PATH:-/var/www/beemuu/backend/data/beemuu.db}"
BACKUP_DIR="${BEEMUU_BACKUP_DIR:-/var/backups/beemuu}"
RETAIN_DAYS="${BEEMUU_BACKUP_RETAIN_DAYS:-14}"

if [[ ! -f "$DB_PATH" ]]; then
    echo "FATAL: DB not found at $DB_PATH" >&2
    echo "       Override with BEEMUU_DB_PATH=/path/to/beemuu.db" >&2
    exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "FATAL: sqlite3 CLI not found in PATH" >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"

stamp="$(date -u +%Y%m%d-%H%M%S)"
dest="$BACKUP_DIR/beemuu-${stamp}.db"

# If anything between .backup and gzip fails, drop the half-written .db so
# the retention sweep doesn't try to operate on a partial file. Cron runs
# this unattended, so silent leaks here would be annoying.
trap 'rm -f "$dest"' ERR

# .backup is atomic and safe under concurrent writes — the live API can keep
# reading from the DB while this runs. Plain `cp` is NOT.
# Note: single-quotes are intentional — the SQLite CLI strips them when parsing
# the .backup argument as a SQL string literal. If a future sqlite3 build stops
# doing that, switch to: sqlite3 "$DB_PATH" ".backup \"$dest\"".
sqlite3 "$DB_PATH" ".backup '$dest'"

# Compress (~80% saving on a typical admin DB). `gzip -9 <name>` writes the
# .gz and removes the input on success, so on success the `trap` is a no-op.
# On failure (disk full, ENOSPC), the .db stays in place — trap cleans it up.
gzip -9 "$dest"
trap - ERR

# Retention.
find "$BACKUP_DIR" -name "beemuu-*.db.gz" -mtime "+${RETAIN_DAYS}" -delete

echo "OK backup written: ${dest}.gz"
ls -lh "${dest}.gz"
