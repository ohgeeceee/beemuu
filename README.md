# BeeEmUu

[![Tests](https://github.com/ohgeeceee/beemuu/actions/workflows/test.yml/badge.svg)](https://github.com/ohgeeceee/beemuu/actions/workflows/test.yml)

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
[![v0.16.0](https://img.shields.io/badge/release-v0.16.0-blue.svg)](CHANGELOG.md)

BeeEmUu (the binary is `beemuu`) is a desktop application — Tauri shell over a
Rust core — for talking to your BMW's ECUs over OBD-II. It speaks **UDS**
(F/G series, modern cars over ENET/DoIP), **KWP2000** (E series, classic cars
over a $15 K+DCAN cable), and **standard OBD-II PIDs**. A built-in virtual
E90 simulator means you can work on the app without owning a car.

> **Try it first** at [beemuu.com](https://beemuu.com/)
> for the landing page and project status. This README is for people who already
> want to install.

---

## What ships today

The desktop app is organized into eight tabs. Every one of these is real code in
`src/index.html`:

| Tab | What it does |
|-----|--------------|
| **Vehicle Test** | Scan every ECU on the bus; click one to read full fault memory with DTC text and freeze frames. |
| **Live Data** | Real-time gauges from per-engine profiles (N52, N54, N55, N62, B58, N20/N26, S55, B48, S58, N57…). Toggle continuous polling at ~250 ms. |
| **Logging** | Record a session at ~4 Hz, replay with scrubber and markers, export to CSV. Exports are written to `~/beeemuu-exports/`. |
| **Parameter Explorer** | Probe KWP2000 local IDs or UDS DIDs to discover what data the car exposes — the workbench for adding new parameters. |
| **Vehicle Info** | Read VIN, decode it, read odometer. VIN reads route through `protocol::read_vin` (UDS `22 F1 90` vs KWP `1A 90`, with a CAS fallback) — landing with PR #98 (issue #89). |
| **Service Functions** | Battery registration, CBS reset, DPF/adaptations where the ECU firmware supports them. High-risk functions stay gated. |
| **Diagnostics** | Run an individual diagnostic job against one ECU (as opposed to scanning the whole car). |
| **Snapshots** | Bundle VIN + fault memory + freeze frames + recent live values into one JSON artifact for sharing or analysis. |

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

---

## What makes BeeEmUu different

We're not the only BMW diagnostic tool. We're the only one with these commitments:

| Principle | What it means |
|-----------|--------------|
| **No VC, no paywalls.** | BeeEmUu will not take funding that forces us to betray the community. There is no "Pro" tier of the same code. |
| **Auditable source.** | This repo is the only source of truth. Read the diffs. Open the PRs. |
| **Offline by default.** | Reads your car, writes a CSV on disk. Your VIN never leaves your machine unless you export a snapshot and send it yourself. See [`SECURITY.md`](SECURITY.md). |
| **Data contributions matter.** | DTC texts, DID maps, and engine profiles are first-class contributions. You can add them by editing TOML — no Rust required. See [`CONTRIBUTING.md`](CONTRIBUTING.md). |
| **Decisions in public.** | Work lands directly as pull requests — reasoning in the PR body, decision in the review. The roadmap is a markdown file, not a sales deck. See [`COMMUNITY_FRAMEWORK.md`](COMMUNITY_FRAMEWORK.md). |
| **Real hardware support, not just OBDLink clones.** | K+DCAN cable (FTDI), ENET/DoIP (F/G series), and a simulator that uses the same wire protocol. We don't sell a "premium cable" that does what any $15 part does. |

---

## Quick start (from source)

Requires **Node 20+**. Tauri drives the Rust build, so the first compile is
the slowest part. (Python 3.11+ is only needed to run the `backend/` test
suite — `pip install pytest`, nothing else; the backend is stdlib-only.)

```bash
git clone https://github.com/ohgeeceee/beemuu
cd beemuu

# 1. JS deps for the Tauri shell
npm install

# 2. Launch the desktop app (Tauri builds + opens it)
npm run dev
```

When the window opens, choose **Simulator (virtual E90)** from the connection
dropdown for your first scan. You don't need a car to learn the UI.

### Real-car setup

| Vehicle era | Cable | Protocol | Default address |
|-------------|-------|----------|-----------------|
| E-series (E36 → early E9x) | USB K+DCAN cable (FTDI FT232RL) | KWP2000 | `/dev/ttyUSB0` (Linux), `COMx` (Windows) |
| E-series late / F-series | Same K+DCAN cable in D-CAN mode | KWP2000 / UDS | same |
| F-series / G-series | ENET/DoIP cable (RJ45 from OBD port to laptop NIC) | UDS over DoIP | auto-discovery via UDP broadcast on port 13400 (**Discover** button); manual IP entry still works, typically `169.254.x.x` |

The connectors dropdown autodetects cable type on first scan. There's no
"buy our cable" upsell. Building your own ENET cable? The DIY pinout is in
[`docs/hardware/enet-cable-pinout.md`](docs/hardware/enet-cable-pinout.md).

---

## What's coming

The roadmap is the canonical source of truth for planned work —
[`ROADMAP.md`](ROADMAP.md) lists every item with a confidence label
(`🟢 Ready`, `🟡 Needs research`, `✅ Done`). Don't trust this README
section over the roadmap; it is a *summary*, not the spec.

The current release is **v0.16.0 — "Share the Trace"** (shipped
2026-08-31): i18n (DE/EN/FR), service manual lookup per DTC,
walk freeze-frame lookup, bundle export with freeze-frame snippets,
vehicle database enrichment (10 VIN prefixes), health report
freeze-frame column, and mobile-responsive CSS. 88 tests pass.
See [`CHANGELOG.md`](CHANGELOG.md) for the full list.

### What shipped in v0.15.x (2026-08-30)

- **Tuner logging workflow** ✅ — injector duty, trigger-based
  logging, custom math channels, workspace persistence.
  PRs #228–#235, v0.15.0–v0.15.9.
- **External log import** ✅ — Bootmod3/MHD CSV read-only adapter.
  PR #257.
- **CAN broadcast validation harness** ✅ — anonymized fixture +
  real-car capture instructions. PR #258.
- **Vehicle database** ✅ — VIN prefix → build-sheet mappings.
  PR #258.

### What shipped in v0.14.0 (2026-07-25)

- **Live Gauges panel** ✅ — 6-gauge real-time panel under Live
  Data tab. PR #162.
- **Pure JS CAN broadcast decoders** ✅ — 8 byte-level decoders
  for E-series broadcast IDs. PR #157.
- **JS-side simulator broadcast personality** ✅ — 10-thread
  worker producing 6 known frames at documented rates. PR #158.
- **Live Gauges on `beemuu.com`** ✅ — same 6 gauges on the
  public site. PR #167.

### Ideas being explored (not on the roadmap yet)

These are not promised and not scheduled. They are mentioned in
[`LAUNCH_POST.md`](LAUNCH_POST.md) as long-term direction. They land
on [`ROADMAP.md`](ROADMAP.md) when someone does the work and opens a
PR — see [`COMMUNITY_FRAMEWORK.md`](COMMUNITY_FRAMEWORK.md) Rule 2
(work lands directly as PRs; Discussions are optional, never a gate).

- **Adaptive Drift Tracker** — plot long-term fuel trims and adaptation
  values over time to predict when an N55 is about to throw 29E0.
- **Tuning Fingerprint Detector** — compare live-data distributions
  against a stock baseline (useful when buying used).

Changelog: [`CHANGELOG.md`](CHANGELOG.md). Last release: **v0.16.0**
(2026-08-31), "Share the Trace" — i18n, service manual lookup,
walk freeze-frame lookup, bundle export, vehicle DB, reports,
FR i18n, mobile CSS. 88 tests pass.

---

## How to contribute

BeeEmUu is a community project. There are two contribution paths:

| Path | Skill | Where |
|------|-------|-------|
| **Data** (DTC texts, DID maps, engine profiles) | TOML editing — no compiler | [`community/`](community/), see [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| **Code** (features, bug fixes, new transport) | Rust, JS, Python | [`src-tauri/`](src-tauri/), [`src/`](src/), [`backend/`](backend/) |

Every contribution carries a confidence label so users know what to trust
(`[community]`, `[OBDb]`, `[forum]`). Read [`CONTRIBUTING.md`](CONTRIBUTING.md)
before opening a PR — it covers the commit style, PR template, and how to
mark protected-path changes (transport, protocol parser, command surface).

### Our commitments to contributors

From [`COMMUNITY_FRAMEWORK.md`](COMMUNITY_FRAMEWORK.md), non-negotiable:

1. Every issue gets a human reply within 48 hours — or a public "slipped" note.
2. Work lands directly as pull requests — no Discussion thread gates a feature.
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
