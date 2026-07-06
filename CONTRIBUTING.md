# Contributing to BeeEmUu

Thanks for your interest! This project lives or dies by community knowledge
of BMW diagnostic protocols, so contributions of *data* are as valuable as
contributions of code.

## Most-wanted contributions

**Parameter mappings.** Used the Parameter Explorer on your car? Open a PR
adding a profile to `src-tauri/src/data/live.rs` with your chassis/engine in
the label (e.g. "E70 X5 4.8i (N62B48)"), or open an issue with your findings:
ECU, ident type, identifier, byte offsets, scaling, and how you verified it.

**Fault-code texts.** Add community-known codes to `src-tauri/src/data/dtc.rs`.
Cite where the description comes from (observed on your car, forum thread,
etc.). Do NOT paste text extracted from ISTA or other proprietary BMW
software — such contributions will be rejected.

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
