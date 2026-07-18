# BeeEmUu VPS Deployment Guide

This guide describes deploying `backend/app.py` from the repository to a
production VPS. The hosted API runs at `api.beemuu.com` (nginx → systemd unit
→ Python process on `127.0.0.1:8765`).

## Prerequisites

- VPS running Ubuntu 20.04+ with systemd and nginx
- Git repo cloned to `/var/www/beemuu` (owned by the `beemuu` service user)
- Python 3.8+ (stdlib only — no pip dependencies required)
- TLS certificates (Let's Encrypt via certbot)

## 1. Create the service user

The service must **not** run as root. Create a dedicated system account:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin beemuu
sudo mkdir -p /var/www/beemuu
sudo chown beemuu:beemuu /var/www/beemuu
```

Clone the repo as root then fix ownership:

```bash
sudo git clone https://github.com/ohgeeceee/beemuu.git /var/www/beemuu
sudo chown -R beemuu:beemuu /var/www/beemuu
```

## 2. Install systemd service

### Admin password (required for first boot)

The service reads `BEEMUU_ADMIN_PASSWORD` on startup. It exits with a clear
error if the variable is missing — there is no silent-insecure mode.

```bash
# 1. Generate a random password and store it in /etc/beemuu/beemuu.env
sudo mkdir -p /etc/beemuu
sudo python3 -c 'import secrets; print("BEEMUU_ADMIN_PASSWORD=" + secrets.token_urlsafe(32))' \
  | sudo tee /etc/beemuu/beemuu.env
sudo chmod 600 /etc/beemuu/beemuu.env
sudo chown root:root /etc/beemuu/beemuu.env

# 2. Install and start the unit
sudo cp /var/www/beemuu/ops/beemuu-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable beemuu-api
sudo systemctl start beemuu-api
sudo systemctl status beemuu-api
```

**Do not inline the password in `ops/beemuu-api.service`** — the env-file
pattern keeps the secret out of unit-file dumps (`systemctl show`, backups,
version control) and makes rotation a one-line change.

The SQLite database lives at `/var/www/beemuu/backend/data/beemuu.db` by
default; override with `BEEMUU_DB_PATH`.

Verify the service is up:

```bash
curl http://localhost:8765/api/health
```

View logs:

```bash
journalctl -u beemuu-api -f
```

## 3. Install nginx config

```bash
sudo cp /var/www/beemuu/ops/beemuu.com.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/beemuu.com.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### TLS via Let's Encrypt

After the HTTP-only config is in place and DNS points to the VPS:

```bash
sudo certbot --nginx \
  --non-interactive --agree-tos --no-eff-email \
  --email admin@beemuu.com \
  --domains beemuu.com,www.beemuu.com \
  --redirect
```

## 4. Seed the DTC catalog (first deploy)

```bash
cd /var/www/beemuu
sudo -u beemuu python3 -m backend.bootstrap_dtc
```

Output ends with `done in ~0.2s — 236 total DTCs (11 BMW-specific)`.
Re-running is a no-op (every seed is an idempotent UPSERT).

## 5. Verify deployment

```bash
# Health check
curl -s https://beemuu.com/api/health | python3 -m json.tool

# Dashboard metrics
curl -s https://beemuu.com/api/dashboard | python3 -m json.tool

# DTC lookup
curl -s "https://api.beemuu.com/api/dtc/P0171" | python3 -m json.tool
```

## 6. Manage service

```bash
# Restart after pulling new code
cd /var/www/beemuu
sudo git pull
sudo chown -R beemuu:beemuu /var/www/beemuu
sudo systemctl restart beemuu-api

# Logs
sudo journalctl -u beemuu-api -n 50

# Stop
sudo systemctl stop beemuu-api
```

## Layout

```
/var/www/beemuu/
├── backend/app.py              # Main service (stdlib only)
├── backend/bootstrap.py        # First-boot DB + admin-user setup
├── backend/bootstrap_dtc.py    # DTC seed CLI
├── backend/seed*.py            # Seed sources (auto-registered)
├── frontend/                   # Static assets (hosted dashboard)
│   ├── index.html
│   ├── app.js
│   └── app.css
└── ops/
    ├── beemuu-api.service      # systemd unit (User=beemuu, port 8765)
    ├── beemuu.com.conf         # nginx vhost
    └── bootstrap.sh            # DTC seed runner (shell wrapper)
```

## API endpoints

All endpoints are read-only (GET). The backend enforces per-IP rate limiting
(default: 120 requests / 60 s; tune via `BEEMUU_RATE_LIMIT` /
`BEEMUU_RATE_WINDOW` env vars). Excess requests receive `HTTP 429` with a
`Retry-After` header.

| Path | Description |
|------|-------------|
| `GET /api/health` | `{ok, service, time}` — liveness check |
| `GET /api/dashboard` | JSON metrics (repo stats, artifact counts) |
| `GET /api/dtc` | List/search DTC catalog (`?q=`, `?category=`, `?limit=`) |
| `GET /api/dtc/<code>` | Single DTC by code |
| `GET /api/dtc/<code>/schematics` | Wiring diagrams linked to a DTC |
| `GET /api/schematics` | List schematics (`?series=`, `?system=`, `?q=`, `?limit=`) |
| `GET /api/schematics/<slug>` | Single schematic by slug |
| `GET /api/schematics/<slug>/links` | DTCs linked to a schematic |

## Rate limiting

The server enforces a **sliding-window rate limit** in memory (no external
Redis dependency). Default limits:

| Env var | Default | Meaning |
|---------|---------|---------|
| `BEEMUU_RATE_LIMIT` | `120` | Max requests per IP per window |
| `BEEMUU_RATE_WINDOW` | `60` | Window size in seconds |

A blocked request receives `HTTP 429` with `Retry-After: 60` and:

```json
{"error": "rate limit exceeded", "retry_after": 60}
```

## Troubleshooting

- **Port 8765 in use**: `lsof -i :8765` then kill the process
- **nginx reload fails**: `sudo nginx -t` for syntax errors
- **Service won't start**: `journalctl -u beemuu-api -n 20` to see errors
- **Permission errors**: The `beemuu` user needs read access to `/var/www/beemuu`
  and write access to `/var/www/beemuu/backend/data`. Check with
  `sudo -u beemuu ls /var/www/beemuu`.
