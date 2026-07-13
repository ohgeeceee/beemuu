# Daily sqlite backup — operator runbook

The admin-panel DB lives on the production host and accumulates user-submitted
diagnostic sessions, community-submitted DTC descriptions, and an audit log.
This is the only thing standing between a host loss and "the community data
is gone", so it's set up to be boring and reliable.

## What's where

| Component | Path |
|---|---|
| Live database | `/var/www/beemuu/backend/data/beemuu.db` (override via `BEEMUU_DB_PATH`) |
| Backup directory | `/var/backups/beemuu/` (override via `BEEMUU_BACKUP_DIR`) |
| Retention | 14 days (override via `BEEMUU_BACKUP_RETAIN_DAYS`) |
| Cron log | `/var/log/beemuu-backup.log` |
| Service that writes the DB | `beemuu-prod-api.service` (runs the same Python code as `backend/app.py`) |

## Install (one-time, on the prod host)

```bash
sudo cp /var/www/beemuu/ops/backup-beemuu-db.sh /usr/local/bin/backup-beemuu-db.sh
sudo chmod +x /usr/local/bin/backup-beemuu-db.sh
sudo crontab -e
# add the following line — runs daily at 03:00 UTC:
0 3 * * * /usr/local/bin/backup-beemuu-db.sh >> /var/log/beemuu-backup.log 2>&1
```

The script uses `sqlite3 .backup`, which is safe to run while the API is
still serving traffic from the same DB file — there's no need to stop
`beemuu-prod-api.service` for the backup.

## Verify

After install, run it once by hand to confirm it produces a file:

```bash
sudo /usr/local/bin/backup-beemuu-db.sh
# expect: "OK backup written: /var/backups/beemuu/beemuu-YYYYMMDD-HHMMSS.db.gz"
ls -lh /var/backups/beemuu/
```

Then check the cron actually fires (or wait until 03:00 UTC the next day):

```bash
tail -n 20 /var/log/beemuu-backup.log
```

## Restore

```bash
# 1. Stop the API so nothing is mid-write when you swap the file
sudo systemctl stop beemuu-prod-api.service

# 2. Replace the live DB with the backup
gunzip -c /var/backups/beemuu/beemuu-YYYYMMDD-HHMMSS.db.gz \
  | sqlite3 /var/www/beemuu/backend/data/beemuu.db

# 3. Start the API
sudo systemctl start beemuu-prod-api.service
sudo systemctl status beemuu-prod-api.service
```

If `sqlite3` complains about a "malformed database" after restore, check that
the backup itself isn't truncated (`gunzip -t file.db.gz` tests the gzip
integrity). Don't blame the script first.

## Why not pg_dump / S3 / etc.

- It's one file. `cp` would work; `sqlite3 .backup` is the safe version
  because it's atomic and consistent under concurrent writers.
- pg_dump would imply a postgres migration, which the admin panel's data
  model explicitly doesn't need (see `.hermes/plans/2026-07-10_211924-admin-panel-bootstrap.md`,
  § "Why SQLite, not Postgres").
- Off-host backup is a separate concern — once the daily cron is reliable,
  the obvious next step is a second cron that `rsync`s `/var/backups/beemuu/`
  off-box. Not done here.

## What this doc is NOT

Not part of the deploy runbook (`DEPLOY.md` is historical reference; the
actual prod operations happen outside this repo for some pieces). This is just
the small piece that *is* in this repo and worth documenting.
