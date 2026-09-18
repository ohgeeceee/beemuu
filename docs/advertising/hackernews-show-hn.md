**Title:** Show HN: BeeEmUu – free, open-source BMW diagnostics desktop app (Rust + Tauri)

**Body:**

BeeEmUu is a free, open-source BMW diagnostics desktop app I built with Tauri 2 + Rust. v2.0.0 just landed.

**What's novel:**

- Real CAN decoding (15 new decoders) — not just generic OBD-II, but BMW-specific parameter parsing
- ENET/DoIP support alongside the usual K+DCAN — modern BMWs use Ethernet diagnostics, and most OSS tools stop at K-line
- Built-in CAN simulator — lets you test the entire diagnostic pipeline without hardware
- Zero telemetry — no analytics, no phone-home, no accounts. This is a deliberate design choice, not a marketing one
- Session logging + replay — record a diagnostic session and replay it later for analysis

**Stack:** Tauri 2 (Rust core, web frontend), Python for the diagnostic protocol layer, JS/TS for the UI. Test suite: 424 JS + 219 Python + 13 Rust tests.

**License:** GPL-3.0. No paid tier, no VC funding, no dual-licensing trap. Just open source.

**Repo:** https://github.com/ohgeeceee/beemuu

Right now Windows-first; installers are in progress. I'm happy to answer questions about the CAN decoding architecture or the ENET/DoIP implementation.
