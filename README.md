# BeeEmUu

> **One app, one repo, one domain.** BeeMuu is a single application — Tauri shell,
> web frontend, and Python backend all live in [github.com/ohgeeceee/beemuu](https://github.com/ohgeeceee/beemuu)
> and serve from `beemuu.com` / `api.beemuu.com`. No sibling repos, no separate
> frontend or backend products, no second domain.

> **Independent, community-owned diagnostic software for BMW vehicles.**
> Read and clear faults. Stream live data. Log a driving session and replay it.
> K+DCAN, ENET, and a built-in simulator. No dealer subscription, no phone tether,
> no telemetry.

[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](LICENSE)
[![No VC](https://img.shields.io/badge/no_VC-no_paywalls-critical.svg)](COMMUNITY_FRAMEWORK.md)
[![Community-owned](https://img.shields.io/badge/community-owned-orange.svg)](CONTRIBUTORS.md)
[![v0.3.0](https://img.shields.io/badge/release-v0.3.0-success.svg)](RELEASE_NOTES_v0.3.0.md)

BeeEmUu (the binary is `beemuu`) is a desktop application — Tauri shell over a
Rust core with a Python diagnostic backend in `bmw_diag/` — for talking to
your BMW's ECUs over OBD-II. It speaks **UDS** (F/G series, modern cars over
ENET/DoIP), **KWP2000** (E series, classic cars over a $15 K+DCAN cable),
and **standard OBD-II PIDs**. A built-in virtual E90 simulator means you can
work on the app without owning a car.

> **Try it first** at [beemuu.com](https://beemuu.com/)
> for the landing page and project status. This README is for people who already
> want to install.

---

## What ships today

The desktop app is organized into ten tabs. Every one of these is real code in
`src/index.html`:

| Tab | What it does |
|-----|--------------|
| **Vehicle Test** | Scan every ECU on the bus; click one to read full fault memory with DTC text and freeze frames. |
| **Live Data** | Real-time gauges from per-engine profiles (N52, N54, N55, N62, B58…). Toggle continuous polling at ~250 ms. |
| **Logging** | Record a session at ~4 Hz, export to CSV, replay with scrubber and markers. JSONL stored in `~/beeemuu-sessions/`. |
| **Parameter Explorer** | Probe KWP2000 local IDs or UDS DIDs to discover what data the car exposes — the workbench for adding new parameters. |
| **Hunt** | Gamified reverse-engineering on top of the Explorer: points for new identifiers, mapped bytes, merged contributions, plus a public leaderboard. |
| **Vehicle Info** | Read VIN, decode it, read odometer — uses `protocol::read_vin`, the correct UDS/KWP split. |
| **Service Functions** | Battery registration, CBS reset, DPF/adaptations where the ECU firmware supports them. High-risk functions stay gated. |
| **Diagnostics** | Run an individual diagnostic job against one ECU (as opposed to scanning the whole car). |
| **Snapshots** | Bundle VIN + fault memory + freeze frames + recent live values into one JSON artifact for sharing or analysis. |
| **Backend** | Local status of the bundled read-only API (`/api/health`, `/api/dashboard`), plus the live hosted build status from `beemuu.com` (`/api/stats`, `/api/landing-content`). |

### Where the hosted app lives

BeeMuu has exactly one production deployment. The web frontend and the Python
backend are two surfaces of the **same application**, not two products:

| Surface | URL | What it is |
|---------|-----|------------|
| Landing page + hosted admin panel | `https://beemuu.com` | Static frontend served by nginx from `/var/www/beemuu/frontend/` (and `/admin`) on the NJ Spectrum VPS. |
| Hosted backend API | `https://api.beemuu.com` | Same `backend/` Python app, served by `beemuu-prod-api.service` and reverse-proxied via nginx `/api/*`. The desktop app and the hosted page both talk to this same backend over `/api/*`. |

There is no separate "frontend repo" and no separate "backend repo", and there
is no second domain. The retired `montanablotter.com` / `beemuu.montanablotter.com`
hosting is gone; do not reference it.

The optional **Python core** in `bmw_diag/` is a standalone library you can use
from any Python 3.11+ project without the desktop app. Same transport layer,
no Tauri dependency.

---

## What makes BeeEmUu different

We're not the only BMW diagnostic tool. We're the only one with these commitments:

| Principle | What it means |
|-----------|--------------|
| **No VC, no paywalls.** | BeeEmUu will not take funding that forces us to betray the community. There is no "Pro" tier of the same code. |
| **Auditable source.** | This repo is the only source of truth. Read the diffs. Open the PRs. |
| **Offline by default.** | Reads your car, writes a CSV on disk. Your VIN never leaves your machine unless you export a snapshot and send it yourself. See [`SECURITY.md`](SECURITY.md). |
| **Data contributions matter.** | DTC texts, DID maps, and engine profiles are first-class contributions. You can add them by editing TOML — no Rust required. See [`CONTRIBUTING.md`](CONTRIBUTING.md). |
| **Decisions in public.** | Major features are discussed in GitHub Discussions before they ship. The roadmap is a markdown file, not a sales deck. See [`COMMUNITY_FRAMEWORK.md`](COMMUNITY_FRAMEWORK.md). |
| **Real hardware support, not just OBDLink clones.** | K+DCAN cable (FTDI), ENET/DoIP (F/G series), and a simulator that uses the same wire protocol. We don't sell a "premium cable" that does what any $15 part does. |

---

## Quick start (from source)

Requires **Node 20+** and **Python 3.11+**. Tauri drives the Rust build, so the
first compile is the slowest part.

```bash
git clone https://github.com/ohgeeceee/beemuu
cd beemuu

# 1. JS deps for the Tauri shell
npm install

# 2. Python deps for the diagnostic core (bmw_diag)
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. Launch the desktop app (Tauri builds + opens it)
npm run dev
```

When the window opens, choose **Simulator (virtual E90)** from the connection
dropdown for your first scan. You don't need a car to learn the UI.

### Real-car setup

| Vehicle era | Cable | Protocol | Default address |
|-------------|-------|----------|-----------------|
| E-series (E36 → early E9x) | USB K+DCAN cable (FTDI FT232RL) | KWP2000 | `/dev/ttyUSB0` (Linux), `COMx` (Windows) |
| E-series late / F-series | Same K+DCAN cable in D-CAN mode | KWP2000 / UDS | same |
| F-series / G-series | ENET/DoIP cable (RJ45 from OBD port to laptop NIC) | UDS over DoIP | discovered via UDP broadcast on 13400, typically `169.254.x.x` |

The connectors dropdown autodetects cable type on first scan. There's no
"buy our cable" upsell.

---

## What's coming

The roadmap is public and discussed item-by-item. See [`ROADMAP.md`](ROADMAP.md).

Highlights from v0.3.0 ("Real Car") and beyond:

- **Diagnostic Story mode** *(in progress)* — turn a snapshot into a mechanic's
  narrative report. "N55 + 8% fuel trim at idle → smoke-test the intake
  tract, $80–150 at an indie shop." Local model, no cloud.
- **Adaptive Drift Tracker** — plot how long-term fuel trims and adaptation
  values move session-over-session. Predicts when an N55 is about to throw 29E0.
- **Community Oracle** *(research)* — opt-in, anonymized pattern matching.
  "42 other N55 owners saw this exact DTC set — 80% fixed it by replacing
  the HPFP."
- **Tuning Fingerprint Detector** *(research)* — compare live data
  distributions against a stock baseline. Useful when buying used.

Changelog: [`CHANGELOG.md`](CHANGELOG.md). Last release: **v0.3.0** (2026-07-11),
"Community Intelligence" — Parameter Hunt, Community Oracle, DTC Opinions,
Diagnostic Story, and the VPS-hosted backend. See
[`RELEASE_NOTES_v0.3.0.md`](RELEASE_NOTES_v0.3.0.md).

---

## How to contribute

BeeEmUu is a community project. There are two contribution paths:

| Path | Skill | Where |
|------|-------|-------|
| **Data** (DTC texts, DID maps, engine profiles) | TOML editing — no compiler | [`community/`](community/), see [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| **Code** (features, bug fixes, new transport) | Rust + JS | [`src-tauri/`](src-tauri/), [`src/`](src/), [`bmw_diag/`](bmw_diag/) |

Every contribution carries a confidence label so users know what to trust
(`[community]`, `[OBDb]`, `[forum]`). Read [`CONTRIBUTING.md`](CONTRIBUTING.md)
before opening a PR — it covers the commit style, PR template, and how to
mark protected-path changes (transport, protocol parser, command surface).

### Our commitments to contributors

From [`COMMUNITY_FRAMEWORK.md`](COMMUNITY_FRAMEWORK.md), non-negotiable:

1. Every issue gets a human reply within 48 hours — or a public "slipped" note.
2. No feature enters the roadmap without a public Discussion thread.
3. Every contributor is named in `CONTRIBUTORS.md` and release notes.
4. Architecture, security incidents, and the roadmap are public by default.

---

## License

BeeEmUu is released under the **GNU General Public License v3.0 or later**.
See [`LICENSE`](LICENSE) for the full text. In short: you can read, modify,
and redistribute under the same terms. We chose copyleft on purpose so a
fork can't quietly close back up.

```
BeeEmUu — Independent BMW diagnostics
Copyright (C) 2025–2026 BeeEmUu Contributors

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
```

---

## Links

- Project status & landing page: **https://beemuu.com**
- Source: **https://github.com/ohgeeceee/beemuu**
- Issues: **https://github.com/ohgeeceee/beemuu/issues**
- Discussions (Q&A, roadmap): **https://github.com/ohgeeceee/beemuu/discussions**
- Security disclosures: see [`SECURITY.md`](SECURITY.md) — do not file publicly

---

*Built with craft, not capital. Star ⭐ the repo, fork, or just use it and tell
us what broke.*
