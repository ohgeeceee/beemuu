# BeeEmUu v0.3.0 Release Notes

> **Community Intelligence.** Surface the patterns. Tell the story. This
> release turns the v0.2.0 data layer into something you can play with —
> Oracle-driven pattern matching, opinionated DTC explainers, and a Story
> generator that turns a session into a mechanic's narrative — and ships a
> complete hosted backend so you can run it on your own VPS.

## What's New

### 🔮 Community Oracle
Opt-in pattern matching across anonymized community data. When you read a
DTC set on your N55, the Oracle can surface: *"42 other N55 owners saw this
exact combination — 80% fixed it by replacing the HPFP."* Pure local
lookups against shipped JSON; no telemetry, no server round-trip.

Ships with `community/oracle/generic.json` and a starter N55 set. Anyone
can add an engine-specific JSON file via PR.

### 💬 DTC Opinions
Not every fault code demands the same response. Opinions attach an
opinionated, sourced explainer to specific DTCs: when to fix immediately,
when to monitor, when it's safe to ignore.

Ships with starter opinions on the three most-misdiagnosed N55 codes:
`29E0` (VANOS), `2A82` (intake VANOS position), `P0171` (system too lean,
Bank 1). New module: `src-tauri/src/opinions.rs`,
`community/opinions/{29E0,2A82,P0171}.toml`.

### 📖 Diagnostic Story
Turn a session snapshot into a mechanic's narrative report — local model,
no cloud. *"N55 + 8% fuel trim at idle → smoke-test the intake tract,
$80–150 at an indie shop."* Stories are TOML-defined so they're easy to
contribute and easy to review.

New module: `src-tauri/src/story.rs`, `community/stories/{generic,n55}.toml`.

### 🖥️ Hosted Backend (VPS-Ready)
A complete stdlib-only Python backend so anyone can stand up a read-only
BeeEmUu deployment on their own VPS. **Zero new pip dependencies** —
password hashing uses `hashlib.scrypt` from the standard library (OWASP
2024 parameters, `maxmem=128MB` to bypass OpenSSL's 32MB default).

- **Read-only hosted API**: `/api/health`, `/api/landing-content`,
  `/api/stats` — consumed by the hosted dashboard panel.
- **Admin panel (Phase 1)**: sqlite-backed auth, cookie sessions.
- **DTC bootstrap (Phase 2)**: idempotent CLI + ops wrapper that seeds
  generic OBD-II SAE J2012 codes and BMW-specific codes from
  `community/` into the backend database.
- **44-test backend suite** — integration tests for app, auth, bootstrap,
  db, and all three seeders.

Deployment artifacts: `ops/beemuu-api.service` (systemd unit, module mode,
env-file admin password), `ops/beemuu.montanablotter.com.conf` (nginx
config: serves frontend on `/`, proxies `/api/*` to beemuu-api),
`ops/bootstrap.sh` (first-boot installer). See `DEPLOY.md` for the full
walkthrough.

### 🧪 Standalone Python Core — `bmw_diag/`
Extracted the diagnostic core into a standalone library you can use from
any Python 3.11+ project — no Tauri dependency, same transport layer.
Includes KWP2000 and UDS protocol modules, an FTDI interface, a DTC
parser, and a logger.

### 🛡️ Security & Protocol Improvements
- **Per-ECU security unlock state** — tracks unlock state per ECU with
  NRC-aware UI and retry countdown
  (`src-tauri/src/protocol/security.rs`).
- **Anonymization helper** (`src-tauri/src/anonymize.rs`) — share logs
  and DTC sets without leaking VIN.
- **KWP2000 slow-module timeout fix** — CIC and other slow modules no
  longer time out on sequential block reads (latency-timer detection per
  the hardware-not-software rule).
- **ENET/DoIP adapter detection on Windows 11** — broadcast discovery
  now enumerates all active interfaces.
- **Hosted dashboard panel endpoint fix** — frontend now talks to
  production endpoints `/api/stats` + `/api/landing-content`.

### 📚 Documentation Overhaul
- **README.md** rewrite — leads with what BeeEmUu actually does,
  corrects the license badge (GPL-3.0-or-later), and links to the
  contributor docs.
- **CONTRIBUTING.md** rewrite — data vs. code paths, confidence labels,
  Parameter Explorer workflow, commit style, PR checklist.
- **CONTRIBUTORS.md** updated for v0.2.0 credits.
- **SECURITY.md** policy published — coordinated disclosure, threat
  model, scope.
- **COMMUNITY_FRAMEWORK.md** — governance commitments (48-hour
  reply SLA, public roadmap, no-feature-without-Discussion).
- **TECH_SPECS.md** — byte-level protocol reference.
- **ROADMAP.md** — v0.3.0 and v0.4.0 plans, item-by-item status.
- **CODE_OF_CONDUCT.md** — community standards.
- **docs/DECODE_FUNCTIONS.md** — spec for the next decode-function work.
- **docs/AGENTS_SETUP.md** — Claude Code / Codex / OpenCode setup.

## Known Limitations (still)

These are structural, not bugs — see `ROADMAP.md` for the path forward.

- E-series KWP2000 local identifiers remain unmapped in open sources.
  Use the Parameter Explorer and contribute findings via PR.
- ~40% of OBDb DID data needs new decode functions (`u16_tenths`,
  `u16_div100`, `s16_div4`, `s16_div100`, `u8_enum`, `u8_div100`).
  Spec'd in `docs/DECODE_FUNCTIONS.md`; implementation is the next
  blocker for v0.3.x.
- Freeze-frame schema is simulator-only; real-car layouts still need
  community contribution (spec'd in `community/freeze_schemas.toml`).
- Real-car validation of B58 and N55 F-series UDS DIDs still needs owners
  with ENET adapters — see `ROADMAP.md` § Real-Car Validation.

## How to Upgrade

### From v0.2.0 (data-only)
Restart the app — `community/` files load at runtime with no recompile.
Oracle, Opinions, and Story all work offline against the shipped
community files.

### From v0.2.0 (full install)
Download the installer from the Assets below (built by CI on tag push).

### From v0.1.0 or earlier
Full install recommended. See `README.md` Quick Start for the
`npm install` + `pip install -r requirements.txt` + `npm run dev`
flow.

### VPS deployment
See `DEPLOY.md` for the full guide. The minimum diff from a fresh
Ubuntu 22.04+ VPS:

```bash
git clone https://github.com/ohgeeceee/beemuu /root/beemuu
cd /root/beemuu
sudo python3 -c 'import secrets; print("BEEMUU_ADMIN_PASSWORD=" + secrets.token_urlsafe(32))' \
  | sudo tee /etc/beemuu/beemuu.env
sudo chmod 600 /etc/beemuu/beemuu.env
sudo cp ops/beemuu-api.service /etc/systemd/system/
sudo cp ops/beemuu.montanablotter.com.conf /etc/nginx/sites-available/
sudo systemctl daemon-reload
sudo systemctl enable --now beemuu-api
sudo systemctl reload nginx
python -m backend.bootstrap_dtc   # seed DTCs
```

## Contributors

- **ohgeeceee** — Creator, maintainer, all v0.3.0 work in this release
  (Oracle, Opinions, Story, VPS backend, deploy artifacts, `bmw_diag/`
  extraction, security.rs rewrite, KWP2000 + UDS Python modules,
  documentation overhaul).
- **OBDb** ([github.com/obdb/Vehicle-Parameter](https://github.com/obdb/Vehicle-Parameter))
  — CC-BY-SA 4.0 open database providing UDS DID labels and PID mappings
  (continued from v0.2.0).
- See commit history for individual DID mappers and DTC contributors.

## Links

- Full changelog: [CHANGELOG.md](https://github.com/ohgeeceee/beemuu/blob/main/CHANGELOG.md)
- Contributing guide: [CONTRIBUTING.md](https://github.com/ohgeeceee/beemuu/blob/main/CONTRIBUTING.md)
- Roadmap: [ROADMAP.md](https://github.com/ohgeeceee/beemuu/blob/main/ROADMAP.md)
- Community data: [community/](https://github.com/ohgeeceee/beemuu/tree/main/community)
- Security policy: [SECURITY.md](https://github.com/ohgeeceee/beemuu/blob/main/SECURITY.md)
- Deployment guide: [DEPLOY.md](https://github.com/ohgeeceee/beemuu/blob/main/DEPLOY.md)
- Community framework: [COMMUNITY_FRAMEWORK.md](https://github.com/ohgeeceee/beemuu/blob/main/COMMUNITY_FRAMEWORK.md)
