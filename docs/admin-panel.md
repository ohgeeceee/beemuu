# Beemuu admin panel

The admin panel is part of the Beemuu application at `/admin/`. It uses the
same Python standard-library server and same-origin JSON routes as the public
site. Admin records live in SQLite; no hosted database, auth provider, API
gateway, or frontend service is required at runtime.

## Start the Beemuu server

Python 3.10 or newer is the only runtime requirement. Set an initial admin
password in the server environment, then start the app from the repository
root:

```sh
export BEEMUU_ADMIN_PASSWORD='use-a-long-unique-password'
python -m backend.app --host 127.0.0.1 --port 8765
```

Open `http://127.0.0.1:8765/admin/`. For local HTTP development only, set
`BEEMUU_COOKIE_SECURE=0` before starting the server so the browser accepts the
session cookie. Public deployments must use HTTPS and keep the secure-cookie
default enabled. Keep the initial password in the host's protected environment
file; it is used only when the database has no admin account yet.

The default database is `backend/data/beemuu.db`. Set `BEEMUU_DB_PATH` to move
it to another location on the same host. Uploaded diagnostic logs are stored
under `shared_logs/`; schematic assets remain in the Beemuu repository data
directory and are served by the app using their database records. Back up the
database and these files together.

## What the panel manages

- Dashboard counts and recent admin activity
- Full DTC catalog edits, verification, source details, and enable/disable
- Community DTC submission review and private submission details
- Schematic metadata, visibility, DTC links, and unlinking
- Recent diagnostic submissions and the append-only audit trail
- Admin password changes, which revoke all existing login sessions

All admin writes require a signed-in session and are recorded in the audit
log. Catalog entries are disabled instead of being deleted so links and
history remain available. The browser panel uses only local Beemuu assets and
same-origin requests; it does not call third-party runtime services.
