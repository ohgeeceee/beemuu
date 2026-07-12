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
service refuses to start without it.** Set it before starting.

The recommended pattern is an env file (mode 600), referenced from the systemd
unit via `EnvironmentFile=`:

```bash
# 1. Generate a random password and save it in /etc/beemuu/beemuu.env
sudo mkdir -p /etc/beemuu
sudo python3 -c 'import secrets; print("BEEMUU_ADMIN_PASSWORD=" + secrets.token_urlsafe(32))' \
  | sudo tee /etc/beemuu/beemuu.env
sudo chmod 600 /etc/beemuu/beemuu.env
sudo chown root:root /etc/beemuu/beemuu.env

# 2. Install the unit and start
sudo cp /root/beemuu/ops/beemuu-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable beemuu-api
sudo systemctl restart beemuu-api
sudo systemctl status beemuu-api
```

**Do not inline the password in `ops/beemuu-api.service`** — the env file pattern
keeps the secret out of any unit-file dumps (`systemctl show`, backups, version
control) and makes rotation a one-line change.

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

For the primary `beemuu.com` deployment:

```bash
sudo cp /root/beemuu/ops/beemuu.com.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/beemuu.com.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

For the legacy `montanablotter.com` deployment (if still in use):

```bash
sudo cp /root/beemuu/ops/beemuu.com.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/beemuu.com.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### TLS via Let's Encrypt

After the HTTP-only config is in place and DNS resolves to the VPS:

```bash
sudo certbot --nginx \
  --non-interactive --agree-tos --no-eff-email \
  --email admin@beemuu.com \
  --domains beemuu.com,www.beemuu.com \
  --redirect
```

Certbot will edit the vhost to add the HTTPS server block, an HTTP→HTTPS redirect,
and obtain/renew certificates automatically (a `certbot.timer` systemd unit is
installed by the `python3-certbot-nginx` package).

## 3. Verify deployment

```bash
# Health check
curl -s https://beemuu.com/api/health | jq

# Stats (live counters)
curl -s https://beemuu.com/api/stats | jq
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
├── frontend/               # Static assets (the hosted dashboard at beemuu.montanablotter.com)
│   ├── index.html
│   ├── app.js
│   └── app.css
├── ops/
│   ├── beemuu-api.service              # systemd unit
│   ├── beemuu.montanablotter.com.conf  # nginx vhost (legacy/montanablotter.com)
│   ├── beemuu.com.conf                 # nginx vhost (beemuu.com apex + www)
│   └── bootstrap.sh                    # DTC seed runner
└── [rest of repo]
```

## Endpoints

- `https://beemuu.com/` and `https://www.beemuu.com/` — production frontend (TLS via Let's Encrypt)
- `https://beemuu.com/api/health` — health check
- `https://beemuu.com/api/dashboard` — JSON metrics
- `https://beemuu.montanablotter.com/...` — legacy/alternate deployment (same code, different host)

- `https://beemuu.com/` — public landing page (HTML)
- `https://beemuu.com/admin/` — admin panel UI
- `https://beemuu.com/api/health` — `{ok, service, version, time}`
- `https://beemuu.com/api/stats` — live counters: users, DTCs, sessions, contact messages, breakdowns by system/status, server time
- `https://beemuu.com/api/landing-content` — landing page content (version, motto, GitHub/Discord URLs, counters)

> Note: the desktop app's "hosted dashboard" panel talks to `/api/stats` and
> `/api/landing-content`. The `/api/dashboard` endpoint from the GitHub-repo
> `backend/app.py` is not the same surface as the production VPS and is not
> exposed publicly; if you need it locally, point the Tauri command at a
> local backend on `127.0.0.1:8765` instead.
## Troubleshooting

- **Port 8765 in use**: `lsof -i :8765` then kill the process
- **nginx reload fails**: `sudo nginx -t` for syntax errors
- **Service won't start**: `journalctl -u beemuu-api -n 20` to see errors
- **Permissions**: Backend service runs as root; change `User=` in systemd unit if needed
