**Title:** Free open-source BMW diagnostic tool (v2.0.0) — read/clear codes, live data, session logging, K+DCAN + ENET

**Body:**

Hey r/BMWDIY,

I wanted to share something I've been building: **BeeEmUu v2.0.0**, a free, open-source desktop app for BMW diagnostics.

I made this because most BMW diagnostic tools are either expensive, locked down, or require a phone app with ads. This is different — it's GPL-3.0, completely free, no paid tier, and no telemetry. Just straightforward diagnostics.

**Key features:**

- Read and clear fault codes
- Live data streaming — see sensor values in real time while the engine runs
- Session logging and replay — great for catching intermittent gremlins
- Supports K+DCAN and ENET/DoIP interfaces
- Built-in simulator — try the whole thing without even plugging into a car
- ENET/HSFZ gateway refusal diagnostics (for those stubborn locked-down ECUs)
- 15 new CAN decoders
- i18n in DE/EN/FR and accessibility support

**The tech stack:** Tauri 2 + Rust backend. It's fast, lightweight, and the whole thing is open source.

**Testing:** 424 JS tests + 219 Python tests + 13 Rust ENET tests.

**GitHub:** https://github.com/ohgeeceee/beemuu

Right now it's Windows-only with installers coming soon. Linux/macOS support is on the roadmap.

If you're an independent mechanic, a weekend warrior, or just someone who doesn't want to pay $200 for software to clear a check engine light, give it a look. Issues and PRs are welcome — I'd genuinely love feedback from people who actually turn wrenches.

I'm Jon (ohgeeceee) — happy to answer questions here or on GitHub.
