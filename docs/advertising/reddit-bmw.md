**Title:** I built a free, open-source BMW diagnostics app (v2.0.0) — no paid tier, no telemetry

**Body:**

Hey r/BMW,

I'm Jon (ohgeeceee), and I've been working on a side project that I think some of you might find useful: **BeeEmUu v2.0.0**, a free and open-source BMW diagnostics desktop app.

I originally built this because I got tired of paying for proprietary diagnostic tools that lock basic features behind paywalls. It's GPL-3.0 licensed, so it'll stay free forever — no VC backing, no paid tier, no telemetry. Just a tool for people who actually work on their cars.

**What it does:**

- Read and clear fault codes
- Live data streaming (sensor values in real time)
- Session logging + replay (useful for tracking intermittent issues)
- K+DCAN and ENET/DoIP interface support
- Built-in simulator (so you can try it without a cable)
- ENET/HSFZ gateway refusal diagnostics
- 15 new CAN decoders
- Accessibility + i18n (DE/EN/FR)
- Mobile-friendly web view

It's built with Tauri 2 + Rust, so it's lightweight and fast. There's also a solid test suite — 424 JS tests, 219 Python tests, and 13 Rust tests for the ENET module.

**GitHub:** https://github.com/ohgeeceee/beemuu

Installers are still in the works, but you can build from source today on Windows (Linux/macOS support is coming).

If you're into DIY BMW work or track days, I'd love to hear what you think — feedback, bug reports, and PRs are all welcome. And if you have ideas for features you'd actually use, drop them in the issues.

Happy wrenching.
