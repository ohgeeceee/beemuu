# Deploy: CC0 wiring schematics catalog

This runbook turns on the **wiring schematics** feature on a fresh
`beemuu.com` deploy. It assumes the system is already running the
backend at `127.0.0.1:8765` (see `DEPLOY.md` for first-time setup)
and that you've already pulled the schematics PRs to `main`.

The schema migration (PR #47) and the cross-link join tables (PR #49)
are part of the database bootstrap — `ops/bootstrap.sh` runs them
automatically the next time it executes, and every migration uses
`CREATE TABLE IF NOT EXISTS`.

## What you're turning on

```
+----------------------+      +-------------------+      +---------------+
|  Browser hits        |      |  Backend          |      |  nginx serves |
|  /api/schematics     |  →   |  (python)         |      |  the SVG      |
|                      |      |  returns JSON     |      |  directly     |
|  /api/schematics/    |      |  with `url` field |      |  off disk.    |
|    <slug>            |      |  like:            |  →   |               |
|                      |      |  /static/         |      |  /static/     |
|  GET /static/        |      |  schematics/      |      |  schematics/  |
|  schematics/<slug>.  |      |  <slug>.svg       |      |  <slug>.svg   |
|  svg                 |      |                   |      |               |
+----------------------+      +-------------------+      +---------------+
```

1. The Python backend's `/api/schematics*` endpoints return JSON with
   relative `url` fields.
2. The browser then asks nginx for that URL.
3. Nginx serves the `.svg` from disk directly.

The Python backend never serves the SVG bytes — that path bypasses
Python entirely (single-thread HTTP server in front of the static path
would be a bottleneck; nginx is the right tool).

## Step 1 — install the new vhost

If this is your first deploy following `DEPLOY.md`, the existing
install already completed. From `/root/beemuu`:

```bash
git pull
sudo cp /root/beemuu/ops/beemuu.com.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/beemuu.com.conf /etc/nginx/sites-enabled/
sudo nginx -t
```

You should see `syntax: ... test successful`.

If you've already installed the old vhost and just need to pick up the
schematics location block, the same commands above work — `cp` overwrites
the file, `nginx -t` validates.

If you're already past Let's Encrypt (certbot) and the `certbot --nginx`
step mutated your vhost with an HTTPS server block, **don't blindly
overwrite.** Instead, manually add the new `location /static/schematics/`
block from `ops/beemuu.com.conf` into your **HTTPS** server block
(the HTTP-to-HTTPS redirect is fine to leave alone; the static `location`
block needs to live in the HTTPS block because Let's Encrypt terminates
TLS there). Then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Step 2 — make sure data is there

The three CC0 SVGs at `data/schematics/*.svg` are checked into the
repo. After the `git pull` they're on disk at
`/root/beemuu/data/schematics/`. Verify:

```bash
ls -la /root/beemuu/data/schematics/
# Expect: e60-n54-dme-power.svg  e89-z4-rcd3302-power-can.svg  e90-cas3-pinout.svg
```

If files are missing (e.g. `.gitignore` blocks `data/`), copy them in
manually:

```bash
sudo cp /root/beemuu/data/schematics/*.svg /root/beemuu/data/schematics/   # no-op if already there
```

## Step 3 — run the schema + seed bootstrap (idempotent)

This runs every registered seeder (DTCs, BMW codes, schematics,
**plus** the 11 DTC × schematic cross-links from PR #49):

```bash
cd /root/beemuu
sudo ./ops/bootstrap.sh
```

Expected ending line:

```
done in ~0.2s — 444 total DTCs (220 BMW-specific), 3 schematics, 11 DTC↔schematic links
```

Older runs of `bootstrap.sh` may not include the cross-link counts —
that's normal, run it once now to pick up the additions.

## Step 4 — reload nginx

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Step 5 — smoke test (end-to-end)

Run these from any host, including the VPS itself:

```bash
# 1. The API returns the 3 seeded schematics.
curl -s https://beemuu.com/api/schematics | python -m json.tool | head -40
# Expect:  "count": 3  and three rows (e89, e90, e60).

# 2. The API says /static/schematics/<slug>.svg in each row.
SLUG=$(curl -s https://beemuu.com/api/schematics?series=e90 | python -c \
  'import json,sys; print(json.load(sys.stdin)["results"][0]["slug"])')
echo "Got slug: $SLUG"

# 3. nginx actually serves the SVG (this is the test that catches
#    "I edited the config but didn't reload nginx").
curl -I https://beemuu.com/static/schematics/$SLUG.svg
# Expect:  HTTP/2 200  + Content-Type: image/svg+xml  + Cache-Control

# 4. A DTC → schematic cross-link resolves (uses the new PR #49 endpoint).
curl -s https://beemuu.com/api/dtc/29E0/schematics | python -m json.tool | head -30
# Expect:  2 rows, with schematic.url pointing at /static/schematics/...

# 5. The viewer page itself loads.
curl -I https://beemuu.com/schematics.html
# Expect:  HTTP/2 200 text/html
```

If step 3 returns `404`, nginx isn't reloaded (`sudo systemctl reload
nginx`). If step 3 returns `403`, the file permissions on
`/root/beemuu/data/schematics/` are wrong for the nginx user — check
`ls -la /root/beemuu/data/schematics/`.

## Step 6 — desktop app check

If you also have the desktop Tauri app installed locally:

1. Open the app.
2. Connect to a vehicle (real or sim).
3. Click any fault row.
4. The "Related schematics" panel (cyan accent) should populate
   alongside the existing freeze-frame and second-opinion panels.
5. Click "Open" on a card → browser launches (or the open-URL handler
   fires) showing the SVG.

If the desktop panel stays empty / shows "Schematics unavailable",
the most likely cause is `api.beemuu.com` not yet serving
`/static/schematics/` — repeat Step 5 from your laptop.

## Rollback

Two options, ordered by speed:

**Option 1 (faster, no git involved):**

```bash
sudo rm -f /etc/nginx/sites-enabled/beemuu.com.conf
sudo systemctl reload nginx
# Schematics viewer returns 404s; everything else keeps working.
```

**Option 2 (full revert, also undoes the schema tables — but those
are empty if you don't have new cross-links):**

```bash
git checkout origin/main~1 -- ops/beemuu.com.conf DEPLOY.md
sudo cp ops/beemuu.com.conf /etc/nginx/sites-available/
sudo systemctl reload nginx
```

The DB tables `schematics` and `schematic_link` are left behind. They
take zero space and are not visible via any endpoint other than the
schematics API itself, so there's no cleanup cost.
