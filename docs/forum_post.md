# BeeEmUu Forum Post Template

Copy-paste the section that fits your platform, then tweak the bracketed parts.

---

## Version A: BimmerPost / BimmerFest / SpoolStreet (Technical, DIY crowd)

```
[Title] BeeEmUu — open-source BMW diagnostic tool (live gauges, fault codes, Parameter Explorer)

Hey everyone,

I've been building BeeEmUu, a fully open-source diagnostic platform for BMWs. No ISTA, no subscriptions, no proprietary data — just a desktop app that talks to your car over a cheap K+DCAN cable or ENET adapter.

What it does:
• Vehicle scan — module-by-module scan with fault counts and ID readback
• Fault memory — read/clear DTCs with decoded status bits and community fault text
• Live gauges — real-time dials for RPM, temps, pressures, load, etc.
• Parameter Explorer — scan a module's identifiers and watch a live byte-mutation heatmap (reverse-engineering tool for unknown DIDs)
• Logging — record to CSV with time-series chart playback
• Vehicle info — VIN decode, mileage, exportable report
• CBS resets & service functions — with proper risk warnings
• Built-in simulator — test the UI without a car connected

Supported hardware:
• K+DCAN USB cable (INPA-compatible) — E-series, most F-series
• ENET adapter — F-series, G-series
• BLE/WiFi adapters planned

Engine profiles included:
• N52 (E9x/E60) — OBD-II verified, oil temp placeholder (BSD protocol — no open-source KWP2000 local ID found)
• N54 (E8x/E9x) — OBD-II verified, boost + rail pressure, oil temp placeholder
• N55 (E9x/F-series) — OBD-II verified; F-series gets UDS DIDs for oil/coolant/IAT/ATF temp from OBDb (CC-BY-SA)
• N62 (E6x/E53) — OBD-II verified, oil temp placeholder
• B58 (F/G-series) — OBD-II + UDS DIDs for oil/coolant/IAT/ATF temp/kickdown

Community data: ~150 DTC fault texts, 25+ verified UDS DIDs, all sourced from OBDb, forum logs, and public docs. No BMW proprietary software data.

Tech stack: Tauri v2 (Rust backend, vanilla JS frontend). Builds on Windows and Linux. GPL-3.0.

GitHub: https://github.com/ohgeeceee/beemuu
Latest release: [paste release link]

Screenshots:
[attach beeemuu_chart_playback.png or your own screenshot]

What I need:
• Real-car testers — especially E-series owners with K+DCAN cables. The simulator only goes so far.
• DID hunters — if you've mapped a local identifier or UDS DID on your car, open an issue with the raw bytes and expected value.
• Profile contributors — adding a new engine is a single TOML file. See community/README.md.

Not looking for: proprietary data dumps (ISTA screenshots, SGBD extracts, PRG files). The project stays clean.

Drop questions here or open a GitHub issue. Thanks for looking!

— ohgeeceee
```

---

## Version B: Reddit (r/BMW, r/cars) — Shorter, broader appeal

```
[Title] I built an open-source diagnostic app for BMWs — free, no subscriptions, no ISTA required

BeeEmUu is a desktop app that reads fault codes, shows live gauges, logs data to CSV, and even has a "Parameter Explorer" for reverse-engineering unknown sensor IDs on your car.

Works with:
• Cheap K+DCAN cable (the INPA one) for E-series and most F-series
• ENET adapter for newer F/G-series
• Built-in simulator so you can play with the UI without a car

Includes engine profiles for N52, N54, N55, N62, B58 with ~150 community fault codes and verified UDS DIDs. All data is open-source (OBDb, forums, public docs) — nothing pulled from BMW's proprietary software.

Built in Rust + Tauri. Runs on Windows and Linux. GPL-3.0.

GitHub: https://github.com/ohgeeceee/beemuu

Looking for testers and contributors. If you know your way around BMW diagnostics, issue reports with real-car logs are gold. If you want to add a new engine profile, it's just a TOML file.

[attach screenshot]
```

---

## Version C: Twitter/X / Bluesky / Mastodon (One-liner + thread)

```
Post 1/ 🧵
BeeEmUu — open-source BMW diagnostics, no ISTA subscription needed.

Live gauges. Fault codes. Parameter explorer for reverse-engineering DIDs. CSV logging. Built-in simulator.

E-series (K+DCAN) → F/G-series (ENET) → your laptop.

https://github.com/ohgeeceee/beemuu

Post 2/ 🧵
What makes it different?
• All community data — ~150 DTCs, 25+ UDS DIDs — sourced from OBDb & forums
• Zero proprietary BMW data (no ISTA extracts, no SGBDs)
• GPL-3.0 — fork it, build it, improve it

Post 3/ 🧵
Needs real-car testers, especially E-series owners.
If you've mapped a mystery sensor ID on your BMW, open an issue — the Parameter Explorer is built for exactly that.

Rust + Tauri. Windows + Linux.

Post 4/ 🧵
Profiles included: N52, N54, N55, N62, B58.
Adding a new engine = one TOML file. No Rust required.

Docs: https://github.com/ohgeeceee/beemuu/tree/main/community
```

---

## Version D: YouTube / Video Description

```
BeeEmUu is an independent, open-source diagnostic platform for BMW vehicles.

It runs on Windows and Linux, connects via K+DCAN or ENET, and gives you:
• Module scans and fault-code reading with community descriptions
• Live dial gauges for RPM, temps, pressures, and more
• Parameter Explorer — a reverse-engineering tool for finding unknown sensor IDs
• CSV logging with chart playback
• Vehicle info, VIN decode, and service functions

It ships with a built-in simulator so you can explore the UI without a car, and community engine profiles for N52, N54, N55, N62, and B58.

All data is sourced from open databases (OBDb) and community forums — no proprietary BMW software is used.

GitHub: https://github.com/ohgeeceee/beemuu
License: GPL-3.0
```

---

## Tips for posting

1. **Attach a screenshot** — the chart playback or live gauges. Visual proof gets clicks.
2. **Pin the GitHub link** — make it the first or last thing in the post.
3. **Respond within 24 hours** — even if it's just "thanks, will add to the issue tracker."
4. **Be honest about status** — say "research preview" if it's not fully baked. DIY crowds respect honesty.
5. **Ask for one thing** — "test this on your car" or "add a TOML profile for your engine." Don't overwhelm.

---

*Generated for BeeEmUu. Customize the bracketed parts and post away.*
