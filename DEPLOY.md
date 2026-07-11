# BeeEmUu VPS Deployment Guide

## Prerequisites
- VPS running Ubuntu 20.04+ with systemd and nginx
- Git repo cloned to `/root/beemuu`
- Python 3.8+ (stdlib only — no pip dependencies required for the admin panel;
  password hashing uses `hashlib.scrypt` from the standard library)
- TLS certificates (Let's Encrypt via certbot)

## 1. Install systemd service

```bash
sudo cp /root/beemuu/ops/beemuu-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable beemuu-api
sudo systemctl start beemuu-api
sudo systemctl status beemuu-api
```

### Admin password (required for first boot)

The admin panel uses a single shared admin account. On first boot, the service
creates the account from the `BEEMUU_ADMIN_PASSWORD` environment variable. **The
service refuses to start without it.** Set it before starting:

```bash
# Generate a random password
export BEEMUU_ADMIN_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
echo "Save this: $BEEMUU_ADMIN_PASSWORD"

# Persist it for systemd
sudo systemctl edit beemuu-api
# Add:
# [Service]
# Environment=BEEMUU_ADMIN_PASSWORD=<paste password>
sudo systemctl daemon-reload
sudo systemctl restart beemuu-api
```

The SQLite database lives at `/root/beemuu/backend/data/beemuu.db` by default;
override with `BEEMUU_DB_PATH`.

Verify:
```bash
curl http://localhost:8765/api/health
```

View logs:
```bash
journalctl -u beemuu-api -f
```

## 2. Install nginx config

```bash
sudo cp /root/beemuu/ops/beemuu.montanablotter.com.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/beemuu.montanablotter.com.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 3. Verify deployment

```bash
# Health check
curl -s https://beemuu.montanablotter.com/api/health | jq

# Dashboard
curl -s https://beemuu.montanablotter.com/api/dashboard | jq
```

## 4. Manage service

```bash
# Restart after pulling new code
cd /root/beemuu
git pull
sudo systemctl restart beemuu-api

# Logs
sudo journalctl -u beemuu-api -n 50

# Stop
sudo systemctl stop beemuu-api
```

## 5. Seed the DTC catalog (first deploy)

After first boot, the admin panel needs DTC data to be useful. The bootstrap
seeds ~236 generic SAE J2012 codes plus 11 BMW-specific codes drawn from the
project's own `community/opinions/*.toml` docs:

```bash
cd /root/beemuu
sudo ./ops/bootstrap.sh
```

Output should end with `done in ~0.2s — 236 total DTCs (11 BMW-specific)`.
Re-running is a no-op — every seed is idempotent (UPSERT on the code PK).

## Layout

```
/root/beemuu/
├── backend/app.py          # Main service
├── backend/bootstrap_dtc.py # DTC seed CLI (`python -m backend.bootstrap_dtc`)
├── backend/seed*.py        # Seed sources (auto-registered)
├── frontend/               # Static assets
│   ├── index.html
│   ├── app.js
│   └── app.css
├── ops/
│   ├── beemuu-api.service  # systemd unit
│   ├── beemuu.montanablotter.com.conf  # nginx config
│   └── bootstrap.sh        # DTC seed runner
└── [rest of repo]
```

## Endpoints

- `https://beemuu.montanablotter.com/` — frontend
- `https://beemuu.montanablotter.com/api/health` — health check
- `https://beemuu.montanablotter.com/api/dashboard` — JSON metrics

## Troubleshooting

- **Port 8765 in use**: `lsof -i :8765` then kill the process
- **nginx reload fails**: `sudo nginx -t` for syntax errors
- **Service won't start**: `journalctl -u beemuu-api -n 20` to see errors
- **Permissions**: Backend service runs as root; change `User=` in systemd unit if needed
