# rust-harness — run the Beemuu Rust core without Tauri system libraries

`cargo test` on the real crate (`src-tauri/`) needs Tauri v2's Linux system
libraries (glib, gtk, webkit2gtk-4.1, libudev), which aren't installable
without root. When CI is unavailable or you're on a box without them, this
harness runs most of the **non-Tauri** Rust logic with plain `cargo`.

```bash
cd rust-harness
cargo test
```

## What it covers (via relative symlinks to the real sources)

- `protocol/` — `read_vin`, `read_dtcs`, `identify`, security access, freeze
  decode, NRC parsing, and the **VIN invariant** guard (it static-scans the
  real `src-tauri/src/commands.rs` as text: every VIN read must route through
  `protocol::read_vin`, never a raw `22 F1 90`).
- `data/` — `ecus`, `dtc`, `freeze`, `live` (the `Decode` functions +
  `profile_params`), `service_functions`, `vin`.
- `community/` — profile parsing, and the **shipped-data gates**:
  `shipped_community_tomls_parse`, `shipped_dtc_texts_parse_and_nonempty`
  (this is the gate that catches duplicate TOML keys), `shipped_oracle_json_parses`.
- `transport/` — `mod`, `enet`, `record`, `sim` are the real files; `kdcan`
  and `isotp` are stand-ins (see below).

Roughly **~115 tests**. Full results on the base branch: `transport` 20,
`protocol+data+community` 93, all passing.

## What is stubbed and why

- `kdcan.rs` — the real K+DCAN transport needs the `serialport` crate's
  libudev backend, which needs a system package. `transport/mod.rs::open`
  only calls two of its constructors, so the stub provides just those.
- `isotp.rs` — its own tests call `crate::protocol`, which would create a
  module cycle in this harness. The real file is 430 lines of ISO-TP that CI
  compiles; it is not touched here.
- `stub-serialport/` — a tiny crate named `serialport` exposing only
  `available_ports()` for `transport/mod.rs::list_serial_ports`.
- `commands.rs` is symlinked in but **not compiled** (it needs Tauri) — it is
  present only for the VIN-invariant static scan.

## ⚠️ Symlinks: never write through them

`write_file`/`patch` at a symlinked path writes **through** the link and
clobbers the real `src-tauri/src/...` file (this happened once and wiped 421
lines of `isotp.rs` before it was caught). If you need to change a real
module here, edit it in `src-tauri/src/` and re-run; if you need to edit a
stub, `unlink` the symlink first and copy.

The full crate (including `commands.rs`, `keepalive.rs`, and the Tauri
command surface) still needs CI (`cargo test` in `src-tauri/`) — this harness
is the fast local loop, not a substitute for it.
