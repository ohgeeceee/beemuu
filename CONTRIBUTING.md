# Contributing to BeeEmUu

Thanks for your interest! This project lives or dies by community knowledge
of BMW diagnostic protocols, so contributions of *data* are as valuable as
contributions of code.

## Easiest path: edit TOML, no Rust needed

Most valuable contributions are **data**, and you can add data by editing the
files in [`community/`](community/README.md) — no compiler, no Rust. Restart
the app and the **Diagnostics** tab shows what loaded.

- **Fault-code texts** → `community/dtc_texts.toml`
- **Live-data profiles** (per engine) → `community/profiles.toml`
- **Freeze-frame layouts** (per ECU) → `community/freeze_schemas.toml`

Include your chassis and engine so others know what your data applies to, and
say how you verified it (Parameter Explorer, forum thread you can cite, etc.).

**Tested-vehicle reports.** Ran it on your car? Add a row to the "Tested
vehicles" table in the README, even if you only confirmed the module scan.

**Sharing a mapped profile?** The app can export it for you and import ones
others send — see [docs/sharing-profiles.md](docs/sharing-profiles.md). Add
per-car files under `community/profiles/` so PRs don't collide.

**Transport testing.** Reports of what works/breaks with specific cables,
chassis, and modules are gold. Include cable type, chassis, module, and the
raw hex of request/response where possible.

## Hard rules

1. **No BMW proprietary data.** No SGBDs, no ISTA fault-text dumps, no
   copied ISTA assets or strings. Everything in this repo must be original
   or community-derived knowledge.
2. **No trademark use.** Don't add BMW logos or ISTA branding anywhere.
3. **Safety first.** Any new service function that actuates hardware must
   be marked `risk: "high"` and describe its preconditions.

## Code contributions

- Rust backend: `cargo fmt` and `cargo clippy` clean before PR.
- Frontend is deliberately vanilla JS — no frameworks/build steps please.
- Test against the simulator (`Transport: Simulator`) at minimum; say in
  the PR whether you tested on a real car and which one.

## Development setup

See README.md. Short version: Rust stable + Node 18+, `npm install`,
`npm run dev`, choose Simulator, connect.
