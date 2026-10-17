# Beemuu static site and self-hosted backend

Goal: host the public Beemuu site at `https://beemuu.com` while keeping the
admin API, auth, database, and uploaded files on a self-hosted Beemuu server.
The browser uses one origin for the site and admin API.

This is a staged migration. GitHub Pages can host static HTML, CSS, JavaScript,
and assets, but it cannot run the Python API, admin login service, SQLite
database, or uploaded log/schematic file storage. The backend replacement must
be self-hosted on the same origin as the website for the admin panel to work.

References:

- GitHub Pages overview: <https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages>
- GitHub Pages custom workflows: <https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages>
- GitHub Pages custom domains: <https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site>

## Stage 1: Static site artifact

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

This artifact is static-only. It can preview the public site, but it cannot run
the admin API or SQLite database. Keep production on a same-origin server if
`/admin/` must be usable; do not point the production domain at GitHub Pages
while the API is self-hosted.

Use GitHub's generated Pages URL for static previews. Keep production DNS on
the self-hosted origin so the website and API stay same-origin.

The public landing page no longer depends on `/api/dashboard` or `/api/live`
when `apiBaseUrl` is blank. It shows static Pages status, reads public GitHub
activity from the GitHub REST API, and loads release downloads from the latest
public GitHub release if `_release_info.json` is absent.

The admin panel now uses the same-origin Beemuu Python API and SQLite database;
it does not depend on a separate cloud database, auth provider, or API vendor.
GitHub Pages can publish its static files, but Pages cannot run the API, so the
admin panel is available only when the site routes `/api/*` to the Beemuu
server. See [the admin panel guide](admin-panel.md) for the self-hosted setup.

## Stage 2: Same-origin Beemuu backend

Run the existing Python backend on the same site origin as the static frontend.
It serves the admin UI, the JSON API, schematic assets, and public site files;
SQLite stores admin and catalog records on the Beemuu host. This keeps browser
requests same-origin and avoids third-party runtime services.

The current nginx configuration already routes `/api/*` to the Python service
on the same origin. The static site can remain in its existing document root;
the backend also has a standalone static-file handler for deployments that
serve the site directly from Python. GitHub Pages alone cannot provide this
runtime, so a self-hosted origin is required for admin access.

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
DELETE /api/admin/schematics/:slug/disable
DELETE /api/admin/schematics/:slug/enable
GET    /api/admin/submissions
POST   /api/admin/submissions/review
GET    /api/admin/schematics
POST   /api/admin/schematics
POST   /api/admin/schematic-links
POST   /api/admin/password
GET    /api/admin/sessions
```

Security requirements:

- Admin cookies must be `HttpOnly`, `Secure`, `SameSite=Lax`, and scoped to the
  Beemuu site origin.
- Keep the admin UI and API same-origin; do not configure cross-origin API
  access for the admin panel.
- Preserve audit logging for every admin write.
- Do not expose VINs, uploaded diagnostic sessions, session cookies, or admin
  password hashes in the GitHub Pages artifact or public repository.

## Stage 3: Same-origin self-hosted deployment validation

Before enabling the panel, confirm the website and API are reachable on the
same HTTPS origin:

```bash
curl -s https://beemuu.com/ | head
curl -s https://beemuu.com/site-config.js
curl -s https://beemuu.com/api/health
curl -s https://beemuu.com/api/dtc/P0171
curl -s https://beemuu.com/api/schematics
```

Admin validation:

1. Sign in at `https://beemuu.com/admin/`.
2. Confirm dashboard counts match the exported SQLite database.
3. Upsert a test DTC, disable it, re-enable it, and verify the audit log.
4. Upload and fetch a small diagnostic log.
5. Open a schematic detail page and confirm its local SVG loads.

Keep the SQLite database, uploaded logs, and schematic files backed up on the
same host. The app does not need a separate cloud API or storage vendor.
