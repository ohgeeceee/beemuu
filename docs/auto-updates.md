# Desktop automatic updates

BeeEmUu checks the latest published GitHub release when it starts. It downloads
only Tauri-signed artifacts and installs them automatically. The app waits to
check or restart while a vehicle transport is connected, then resumes when the
client is disconnected. Network or release lookup failures do not interrupt
diagnostics.

## One-time release signing setup

Tauri requires a persistent signing key pair. The public key is embedded in
`src-tauri/tauri.conf.json`; the private key must stay out of Git and be added
to the GitHub repository as Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: the contents of the private key file.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: leave empty for an unencrypted key, or
  provide the password if the key is encrypted.

For this checkout, the private key generated for the configured public key is
available locally at `.tauri-private/beemuu-updater.key`. Treat it as a secret:
copy its contents directly into the GitHub Actions secret and never paste it in
an issue, pull request, or chat. Keep a secure backup; losing it prevents all
existing clients from accepting future updates.

Each published desktop release must use the existing `v*` release workflow.
The workflow signs platform bundles and uploads `latest.json`, which the
installed clients read from the latest published GitHub release. The signing
secrets must be configured before the next release is built.
