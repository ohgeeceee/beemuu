# BeeEmUu — Launch Post

A copy-paste-ready launch announcement, with platform-specific variants below.
Product truth: BeeEmUu is an independent, community-owned diagnostic tool for
BMW vehicles — Tauri/Rust desktop app with a Python diagnostic core
(`bmw_diag/`), speaks UDS / KWP2000 / OBD-II over K+DCAN and ENET cables,
under **GPL-3.0-or-later**.

---

## Hacker News

**Title:** Show HN: BeeEmUu – open-source BMW diagnostics that doesn't phone home or charge you $60/yr

**Body:**

Hey HN,

I want to read DTCs off my own car's ECU. That's it. That's the project.

Every option I had either wanted me to pay the dealer $200+ for a one-time cable
that nags me to renew, or wanted a $60/yr phone-app subscription that required
me to leave Bluetooth LE on in a parking garage at 1am, or wanted to ship my
VIN to a server I don't own.

So I wrote BeeEmUu. It's a desktop app (Tauri shell, Rust core, Python
diagnostic backend) that talks to a $15 K+DCAN cable, or an ENET cable for
F/G series, or a built-in simulator if I'm on the train.

What makes it worth your attention:

- **Real protocols.** UDS over DoIP, KWP2000 over K-line, and standard OBD-II
  PIDs. The 0x27 SecurityAccess seed/key handling is pluggable because every
  ECU does it differently.
- **10 tabs, all shipping:** vehicle test, live data gauges, session
  recording with scrubber + markers at 1× / 4× / 10×, parameter explorer for
  reverse-engineering your car's local IDs, a Hunt leaderboard that turns
  that mapping work into a game, VIN read/decode, service functions,
  individual diagnostic jobs, snapshots for sharing, and a backend status
  panel.
- **GPL-3.0-or-later.** Copyleft on purpose — a fork can't quietly close back up.
- **No telemetry, no remote.** Your car never leaves your machine unless you
  export a snapshot and send it yourself. Auditable Rust + Python source.
- **Data contributions are first-class.** The most valuable thing in
  BeeEmUu is community-curated DTC text, DID maps, and engine profiles —
  not more code. Editing TOML is enough; no Rust required.

What's missing / needs help:

- **Diagnostic Story mode** — turn a snapshot into a mechanic's narrative
  report. "N55 + 8% fuel trim at idle → smoke-test the intake tract, $80–150
  indie." Local model, no cloud. Spec is written, needs someone to build it.
- **Adaptive Drift Tracker** — predict when an N55 is about to throw 29E0
  from how adaptation values have moved over the last few sessions.
- **Community Oracle** *(research)* — opt-in anonymized DTC pattern
  matching. "42 other N55 owners saw this exact DTC set — 80% fixed it by
  replacing the HPFP."
- **An ENET cable anyone can buy** — the pinning is well-documented, but I
  haven't put together the BOM yet.

I didn't build this to start a company. I built it because I needed it to
exist, and the cost of letting the existing options keep being the default
felt higher than the cost of writing it.

Stack: Rust + Tauri 2.0 (desktop), Python 3.11+ (`bmw_diag/` is a
standalone library), TOML data files in `community/`. Linux / macOS / Windows.

Happy to talk about:
- protocol decisions (especially KWP2000 local IDs — there's no published
  table for any E-series DME, and I'd love to coordinate with anyone mapping
  them)
- the UDS SecurityAccess design (how pluggable seeds/keys should work)
- why we picked GPL-3.0 instead of MIT

GitHub: https://github.com/ohgeeceee/beemuu
Landing: https://beemuu.montanablotter.com/

---

## Reddit — r/cars, r/BMW, r/DIY

**Title:** I got tired of paying $60/yr to read DTCs off my own BMW, so I open-sourced the alternative

**Body:**

Posting with mods' permission in mind — I'm the maintainer, I have nothing to
sell, the GitHub link is at the bottom.

Background: BMW's own diagnostic software (ISTA) costs $200+ and only ships
to dealer-tier accounts. BimmerLink / Carly are $60/yr subscriptions that
require your phone in Bluetooth range. Both work, but the cost of admission
felt wrong for what is essentially "send a UDS 22 read, parse the response."

BeeEmUu is what I wanted instead:

- K+DCAN cable (the $15 FTDI-based one every E-series owner has) or ENET for
  F/G series
- Reads faults with full DTC text and freeze frames
- Streams live data at ~4 Hz, logs to CSV, replay with scrubber
- Encodes as far as the ECU firmware allows (CBS reset, battery registration)
- GPL-3.0, no remote calls, no telemetry
- Built-in simulator for the days you're trying to learn the UI without
  sitting in your car

What I'd want from this sub:

1. E-series owners with a K+DCAN cable: any chance you'd run
   `bmw_diag --transport kdcan scan` against your DME and file an issue if
   it doesn't show up in the Diagnostics tab? Per-engine profile coverage
   is the real bottleneck — `community/profiles/` is curated TOML and every
   car that maps a new local ID is a permanent contribution.
2. F/G ENET owners: same offer, just over DoIP. The B58 UDS DID table is
   partial — the rest needs volunteer testers.

Hunt leaderboard if anyone is bored on a Sunday:
https://github.com/ohgeeceee/beemuu — get +50 points per byte you decode.

---

## X / Twitter — thread

**Tweet 1/8:**
I want to read DTCs off my own car's ECU. That's the whole product.

Every option I have charges me to do that. The dealer wants $200 + renewals.
Phone apps want $60/yr and my Bluetooth. I wrote BeeEmUu instead. 🧵

**Tweet 2/8:**
BeeEmUu is a desktop app: Tauri/Rust shell + Python diagnostic core.
Talks to your $15 K+DCAN cable (or ENET for F/G, or a built-in simulator).
UDS over DoIP, KWP2000 over K-line, OBD-II PIDs. Same protocols the dealer
tool uses, no dealer tier required.

**Tweet 3/8:**
10 tabs, all shipping today: vehicle test, live gauges, session recording
with scrubber at 1×/4×/10×, parameter explorer (reverse-engineer what your
car exposes), Hunt leaderboard (mapping new local IDs is a game), VIN read
+ decode, service functions, individual diagnostic jobs, snapshots, backend.

**Tweet 4/8:**
GPL-3.0-or-later. Copyleft on purpose — a fork can't quietly close back up.
No telemetry. No remote. Your car never leaves your machine unless you
export a snapshot and send it yourself.

**Tweet 5/8:**
What's missing / needs help:

• Diagnostic Story mode (snapshot → mechanic's narrative report)
• Adaptive Drift Tracker (predict 29E0 before it happens)
• Community Oracle (opt-in anonymized DTC pattern matching)
• E-series KWP2000 local ID crowdsourcing — there's literally no published
  table for any E-series DME.

**Tweet 6/8:**
The most valuable contribution isn't code — it's data. DTC texts, DID maps,
engine profiles. Editing TOML is enough; no Rust required.

Per-engine profile coverage is the real bottleneck.

**Tweet 7/8:**
If you've got a K+DCAN cable and 20 minutes:

1. `git clone https://github.com/ohgeeceee/beemuu`
2. `pip install -r requirements.txt`
3. `python -m bmw_diag --transport kdcan scan`
4. File an issue if your DME isn't recognized.

Every car that maps a new local ID is a permanent contribution.

**Tweet 8/8:**
Built with craft, not capital. No VC, no paywalls, no roadmap that
prioritizes a sales deck over a bug report.

Landing: https://beemuu.montanablotter.com
Source: https://github.com/ohgeeceee/beemuu
Maintainer, not a company. Tell me what broke.
