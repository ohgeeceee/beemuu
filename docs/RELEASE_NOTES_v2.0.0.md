---
title: "BeeEmUu v2.0.0 — ENET fixed, CAN parity, accessibility & i18n"
date: 2026-09-18
description: "BeeEmUu v2.0.0 is here: a major release with ENET/HSFZ protocol fixes, full CAN decoder parity, accessibility improvements, internationalization support, and log import."
tags: [release, v2.0.0, bmw-diagnostics, enet, can-bus, i18n, accessibility, open-source]
---

# BeeEmUu v2.0.0 — ENET fixed, CAN parity, accessibility & i18n

After consolidating everything from v0.14 through v0.19, we're proud to release **BeeEmUu v2.0.0** — the biggest update yet to our independent, community-owned BMW diagnostics software.

If you've been following along on GitHub, you know the last several months have been quiet but busy. We didn't chase splashy new features. Instead, we focused on **fixing what was broken**, **leveling up the fundamentals**, and making BeeEmUu work for more people in more languages. Here's what's actually in this release.

---

## ENET and HSFZ — finally fixed

This was the elephant in the room, and we're glad to put it to rest.

ENET-based diagnostics on newer BMWs (F-series and beyond) has been unreliable for too long. HSFZ (Heizgerät/Steuergerät-Zentralverriegelung) modules would intermittently fail to respond, sessions would drop mid-scan, and fault codes would be read incompletely. Users reported it. We reproduced it. And now it's fixed.

The root cause was a combination of session-handling timeouts and incorrect service discovery on multiplexed ENET channels. We rewrote the session state machine and added proper retry logic with exponential backoff. The result: stable connections to HSFZ, IHKA, LM, and other body modules over ENET — the same stability you already get over K+DCAN.

If you've been putting off scanning an F-chassis because "ENET doesn't work reliably," give it another try. It should just work now.

---

## CAN decoder parity

Our K+DCAN decoder was solid, but the ENET-side CAN decoder lagged behind. Some manufacturerspecific DIDs were missing, timing-dependent frames were getting dropped, and certain BMW sub-buses weren't being parsed correctly.

v2.0.0 brings the ENET decoder to full parity with the K+DCAN decoder. Every DID, every timing variant, every sub-bus configuration that worked on K+DCAN now works on ENET — and vice versa. Live data streaming, fault code reading, and session logging are all consistent regardless of which adapter you're using.

This matters because parity means predictability. You no longer need to wonder whether a behavior is "a BMW thing" or "an adapter thing." It's just BMW.

---

## Accessibility

Software should be usable by everyone, full stop.

v2.0.0 ships a comprehensive accessibility overhaul: full keyboard navigation across every screen, proper ARIA labels throughout the interface, screen reader support for all diagnostic readouts, and high-contrast theming that doesn't look like a punishment. We also fixed color-only information conveyance in fault-code severity indicators — severity is now communicated with icons, text labels, and patterns, not just red.

This work was driven by community feedback and is something we intend to keep improving in future releases. If you run into accessibility barriers we haven't caught yet, please open an issue.

---

## Internationalization (i18n)

BeeEmUu is now fully translatable. The UI has been externalized into locale files, and we're shipping complete translations for:

- **English** (US/UK)
- **Deutsch (German)**
- **Español (Spanish)**
- **中文简体 (Simplified Chinese)**
- **Русский (Russian)**

Every string, every error message, every tooltip is localizable. If your language isn't on this list, we'd love to have you contribute a translation. The framework is there — we just need volunteers. Check [CONTRIBUTING.md](https://github.com/ohgeeceee/beemuu/blob/main/CONTRIBUTING.md) if you're interested.

---

## Log import

You can now import and analyze BeeEmUu log files from other installations. Pull a session log from a friend's machine, load it up, and inspect every frame, every decoded value, every fault code — exactly as if you'd been behind the wheel yourself.

Log import supports the full BeeEmUu `.bel` format (BeeEmUu Log, our open container format based on SQLite) as well as raw CAN dumps in `.log` and `.asc`. This is huge for remote diagnostics: a shop can send you a session log, you can analyze it at your desk, and both of you can be looking at the exact same data.

---

## What's not here (and why)

There are a couple of features that didn't make the cut for v2.0.0 — not because we abandoned them, but because they needed more time:

- **Wireless ENET support** — in progress, targeting v2.1
- **BMW ICOM emulator mode** — research phase, no ETA
- **Windows Installer (MSI/EXE)** — see below

We'd rather ship something solid than ship something half-finished. If you're curious what's planned next, check out the [public roadmap](https://github.com/ohgeeceee/beemuu/blob/main/ROADMAP.md).

---

## Download

**⚠️ Heads up:** Our CI pipeline is currently blocked by a billing issue on the infrastructure provider's side, so signed installers (.exe, .dmg, .deb) aren't available yet. We're working to resolve this as quickly as possible.

In the meantime:

- **Source builds** are fully functional. Clone the repo and follow the [build instructions](https://github.com/ohgeeceee/beemuu/blob/main/BUILDING.md).
- **Unsigned pre-release binaries** are available on [GitHub Releases](https://github.com/ohgeeceee/beemuu/releases/tag/v2.0.0) for Linux and macOS.
- **Signed, notarized installers** will land as soon as the CI billing issue is resolved. Follow [@ohgeeceee](https://github.com/ohgeeceee) or watch the [releases page](https://github.com/ohgeeceee/beemuu/releases) for updates.

---

## Full changelog

For a complete, commit-level breakdown of every change since v0.14.0, see the [CHANGELOG.md](https://github.com/ohgeeceee/beemuu/blob/main/CHANGELOG.md).

---

## Thank you

v2.0.0 is the result of months of debugging, testing, and iteration — much of it driven by bug reports, log files, and patience from the BeeEmUu community. Thank you to everyone who filed an issue, submitted a pull request, donated a few dollars, or simply told a friend about the project.

BeeEmUu is independent. It's community-owned. It's free and it will stay free. That's the whole point.

Now go scan your car.

— Jon Currie ([@ohgeeceee](https://github.com/ohgeeceee)), BeeEmUu maintainer
