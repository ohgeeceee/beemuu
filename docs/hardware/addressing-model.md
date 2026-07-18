# E vs F/G addressing: why one scan table works for both

BeeEmUu's module scan probes a single table of **one-byte ECU addresses**
(`src-tauri/src/data/ecus.rs`) on every transport. This doc explains why
that is not a shortcut — it matches how BMW diagnostics actually address
modules on both generations — and what the scan can and cannot discover.

## E-series (K+DCAN cable): one-byte targets on K-line / D-CAN

On E-series cars the tester addresses modules with a single target byte —
the classic KWP2000/DS2-style addressing carried over K-line, and the same
one-byte scheme over D-CAN on later E9x. `0x12` is the DME, `0x60` the
cluster, and so on. Absent modules simply never answer; the probe costs
one timeout.

## F/G-series (ENET cable): still one-byte targets, routed by the ZGW

The F/G-series ENET path looks different on the wire — TCP on port 6801
with BMW's HSFZ framing — but the addressing model is the same. An HSFZ
diagnostic message is:

```
[len: u32 BE] [ctrl: u16 BE] [src, tgt, uds bytes...]
```

`src` and `tgt` are **one byte each** (the tester uses `0xF4`). The
central gateway (ZGW) ACKs the frame (ctrl `0x0002`) and forwards it to
the module that owns the target byte; the module's reply comes back as
another HSFZ message with the addresses swapped. So `0x12` is still the
DME on an F30 — the ZGW just does the CAN-side routing for you.

See `src-tauri/src/transport/enet.rs` (file header) for the framing
details, including the ISO-TP note: the ZGW terminates CAN segmentation,
so every HSFZ message already carries a complete diagnostic payload.

## Where DoIP's 16-bit logical addresses live (and where they don't)

ISO 13400 DoIP logical addresses (u16) appear in BeeEmUu only in the
**vehicle discovery** path: the UDP-13400 broadcast that finds the car on
the network returns a `DiscoveredTarget` whose `logical_address` is the
ZGW's DoIP address. That is used to locate and connect to the gateway —
not to address individual modules. Per-request module addressing stays on
the one-byte targets above.

## What the scan table can discover

- Any module that answers BMW-framed one-byte diagnostic targets, on
  either transport — E-series over K+DCAN, F/G-series over ENET through
  the ZGW.
- Chassis-variant addresses: some modules move target byte by chassis.
  The OBDb data (`research/bmw_diag_dim04_uds_dids.md`, did:DBE4) shows
  the same wheel-speed DID addressed to DSC at `0x29` on 3/4-Series/X3/Z4
  but at `0x19` on 5-Series/X5. The table therefore lists both; a given
  car answers whichever it has and the other probe times out. Keeping a
  wrong-for-this-chassis entry costs one timeout, nothing more.

## What it cannot discover

- Modules that do not answer diagnostic target bytes at all (gateway-
  shadowed or non-diagnostic nodes). If a module never speaks diag, no
  scan table entry will find it.
- Anything addressable only via DoIP u16 logical addressing — out of
  scope for the current transports; discovery returns only the ZGW.

## Sources

- `src-tauri/src/transport/enet.rs` — HSFZ frame layout, tester address
  `0xF4`, ZGW ACK behavior, DoIP discovery constants.
- `src-tauri/src/data/ecus.rs` — the scan table, with per-entry provenance
  comments.
- `research/bmw_diag_dim04_uds_dids.md` — OBDb-verified DIDs keyed by
  target address, including the chassis-variant evidence for `0x19` vs
  `0x29` and the F/G additions (`0x07`, `0x0D`, `0x56`, `0x63`).
