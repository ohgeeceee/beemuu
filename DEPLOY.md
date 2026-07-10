# BeeEmUu VPS Deployment Guide

## Prerequisites
- VPS running Ubuntu 20.04+ with systemd and nginx
- Git repo cloned to `/root/beemuu`
- Python 3.8+
- TLS certificates (Let's Encrypt via certbot)

## 1. Install systemd service

```bash
sudo cp /root/beemuu/ops/beemuu-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable beemuu-api
sudo systemctl start beemuu-api
sudo systemctl status beemuu-api
```

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

## Layout

```
/root/beemuu/
├── backend/app.py          # Main service
├── frontend/               # Static assets
│   ├── index.html
│   ├── app.js
│   └── app.css
├── ops/
│   ├── beemuu-api.service  # systemd unit
│   └── beemuu.montanablotter.com.conf  # nginx config
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
