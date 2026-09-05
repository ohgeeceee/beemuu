# Beemuu GitHub Pages and serverless backend migration

Goal: host the public Beemuu site and static admin shell on GitHub Pages at
`https://beemuu.com`, then remove the VPS after the API, admin auth, database,
and uploaded files have moved to a serverless backend.

This is a staged migration. GitHub Pages can host static HTML, CSS, JavaScript,
and assets, but it cannot run the Python API, admin login service, SQLite
database, or uploaded log/schematic file storage. The backend replacement must
be live before the VPS can be shut down.

References:

- GitHub Pages overview: <https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages>
- GitHub Pages custom workflows: <https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages>
- GitHub Pages custom domains: <https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site>
- Cloudflare Workers: <https://developers.cloudflare.com/workers/>
- Cloudflare D1: <https://developers.cloudflare.com/d1/>
- Cloudflare R2: <https://developers.cloudflare.com/r2/>

## Stage 1: Static site on GitHub Pages

The repository now has a GitHub Pages workflow at
`.github/workflows/pages.yml`. It builds `_site` from `frontend/`, writes
`CNAME` with `beemuu.com`, writes `.nojekyll`, and uploads the result with the
official Pages artifact action.

The static artifact is built by:

```bash
node scripts/build-github-pages.cjs
```

The artifact test is:

```bash
node scripts/test-github-pages-build.cjs
```

Before merging the Pages PR, enable GitHub Pages for the repository:

1. Open repository Settings -> Pages.
2. Set the build and deployment source to GitHub Actions.
3. Keep the custom domain as `beemuu.com`.
4. Verify the domain in the GitHub account or organization before DNS points at
   Pages.

Current DNS is managed at DreamHost:

```text
ns1.dreamhost.com
ns2.dreamhost.com
ns3.dreamhost.com
```

After the Pages workflow is merged and the first deployment succeeds, configure
DreamHost DNS:

```text
beemuu.com.      A      185.199.108.153
beemuu.com.      A      185.199.109.153
beemuu.com.      A      185.199.110.153
beemuu.com.      A      185.199.111.153
beemuu.com.      AAAA   2606:50c0:8000::153
beemuu.com.      AAAA   2606:50c0:8001::153
beemuu.com.      AAAA   2606:50c0:8002::153
beemuu.com.      AAAA   2606:50c0:8003::153
www.beemuu.com.  CNAME  ohgeeceee.github.io.
```

Leave the old VPS DNS records in place until the Pages deployment is visible
through GitHub's temporary URL and the domain is verified. Then lower DNS TTLs,
apply the records above, and verify:

```bash
dig +short A beemuu.com
dig +short AAAA beemuu.com
dig +short CNAME www.beemuu.com
```

The public landing page no longer depends on `/api/dashboard` or `/api/live`
when `apiBaseUrl` is blank. It shows static Pages status, reads public GitHub
activity from the GitHub REST API, and loads release downloads from the latest
public GitHub release if `_release_info.json` is absent.

The admin shell is included at `/admin/`, but it is intentionally read-only
until `adminApiBaseUrl` is configured in `/site-config.js`.

## Stage 2: Serverless backend replacement

Recommended backend: Cloudflare Workers + D1 + R2.

Reasons:

- D1 is SQLite-shaped, so the current `backend/db.py` schema maps cleanly.
- Workers can serve the same `/api/*` routes currently handled by the Python
  server.
- R2 can hold uploaded logs and schematic SVG files without a persistent VPS
  disk.
- Cloudflare can host `api.beemuu.com` separately from the GitHub Pages apex.

Alternative: Supabase Auth + Postgres + Storage + Edge Functions. That gives a
larger managed application platform, but it turns the SQLite schema into a
Postgres migration and changes more of the backend shape.

Use `api.beemuu.com` for the replacement API. Keeping that hostname avoids
shipping a desktop-app update just to find the new backend.

Required route parity:

```text
GET    /api/health
GET    /api/dashboard
GET    /api/live
GET    /api/dtc
GET    /api/dtc/:code
GET    /api/dtc/:code/schematics
GET    /api/schematics
GET    /api/schematics/:slug
GET    /api/schematics/:slug/links
GET    /api/logs
GET    /api/logs/:id
POST   /api/logs
GET    /api/admin/whoami
POST   /api/admin/login
POST   /api/admin/logout
GET    /api/admin/dashboard
GET    /api/admin/audit
GET    /api/admin/dtc
POST   /api/admin/dtc
DELETE /api/admin/dtc/:code
DELETE /api/admin/dtc/:code/enable
GET    /api/admin/submissions
POST   /api/admin/submissions/review
GET    /api/admin/schematics
POST   /api/admin/schematics
POST   /api/admin/schematic-links
GET    /api/admin/sessions
```

Data to migrate from the VPS before shutdown:

- `backend/data/beemuu.db` and any WAL/SHM files after stopping the API service.
- uploaded diagnostic logs currently served by `/api/logs/:id`.
- schematic SVG files and metadata currently referenced by the `schematics`
  table.
- current admin account list, excluding expired `session_cookie` rows.

Security requirements for the replacement backend:

- Admin cookies must be `HttpOnly`, `Secure`, `SameSite=Lax`, and scoped to the
  API hostname.
- If the admin API is cross-origin from `beemuu.com`, return CORS headers only
  for `https://beemuu.com` and require credentials on admin routes.
- Preserve audit logging for every admin write.
- Do not expose VINs, uploaded diagnostic sessions, session cookies, or admin
  password hashes in the GitHub Pages artifact or public repository.

## Stage 3: Cutover and VPS retirement

Do not shut down the VPS until all checks pass:

```bash
curl -s https://beemuu.com/ | head
curl -s https://beemuu.com/site-config.js
curl -s https://api.beemuu.com/api/health
curl -s https://api.beemuu.com/api/dtc/P0171
curl -s https://api.beemuu.com/api/schematics
```

Admin validation:

1. Sign in at `https://beemuu.com/admin/`.
2. Confirm dashboard counts match the exported SQLite database.
3. Upsert a test DTC, disable it, re-enable it, and verify the audit log.
4. Upload and fetch a small diagnostic log.
5. Open a schematic detail page and confirm the SVG loads from object storage.

Only after those checks pass:

1. Take a final VPS backup.
2. Stop the Python API service.
3. Confirm no DNS records still point at the VPS IP.
4. Remove unused VPS deploy secrets from GitHub.
5. Archive the VPS deployment guide or mark it retired.
6. Shut down the VPS.
