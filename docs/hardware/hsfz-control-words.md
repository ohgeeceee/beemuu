# HSFZ control words (ENET, TCP 6801)

Reference for the BMW **HSFZ** (High-Speed-Fahrzeug-Zugang / High-Speed
Car Access) framing used by the ENET transport in
`src-tauri/src/transport/enet.rs`.

## Frame

```
[ len: u32 BE ][ ctrl: u16 BE ][ data ... ]
```

- `len` counts the **data** bytes only (for a diagnostic message that is
  `2 + payload_len`, i.e. the source + target address bytes plus the UDS
  payload).
- `ctrl` is the control word (table below).
- For `0x0001` / `0x0002` messages, `data = [source, target, uds...]`
  (1-byte addressing). `source` is the tester (`0xF4`), `target` the ECU.

## Control words

| ctrl | Name | Payload |
|------|------|---------|
| `0x0001` | diagnostic request / response | `[source, target, uds...]` |
| `0x0002` | acknowledge (echo of a request) | `[source, target, uds...]` |
| `0x0010` | terminal 15 control message | — |
| `0x0011` | vehicle identification data | identification string |
| `0x0012` | alive check | `[source, target]` (len 2) or ident string |
| `0x0013` | status data inquiry | — |
| `0x0040` | **incorrect tester address** | `[expected, received]` |
| `0x0041` | **incorrect control word** | — |
| `0x0042` | **incorrect format** | — |
| `0x0043` | **incorrect destination address** | `[source, target]` |
| `0x0044` | **message too large** | — |
| `0x0045` | **diagnostic application not ready** | — |
| `0x00FF` | **out of memory** | — |

The `0x0040`–`0x00FF` words are **errors**: the gateway understood the
message and refused it, and the payload says why. They are the first thing
to check when a request "times out" — the transport surfaces them as
`TransportError::GatewayRejected` rather than a bare timeout.

## Sources

- Wireshark dissector: `epan/dissectors/packet-hsfz.c`
  (github.com/wireshark/wireshark) — control-word table and per-word
  payload layout.
- Scapy: `scapy/contrib/automotive/bmw/hsfz.py` (secdev/scapy) — same
  control-word set; `incorrect_tester_address` carries expected/received
  addresses.
- munich.dissec.to knowledgebase (DoIP / HSFZ chapter): `TYPE` 1 = message,
  2 = echo/ack, 64 = error.

## Notes

- F-series cars speak **HSFZ on TCP 6801 only**; they do **not** answer
  DoIP discovery on UDP 13400 (that is G-series). So auto-discovery will
  not find an F-series car — enter its link-local IP (169.254.x.x)
  manually.
- The ZGW terminates CAN-side ISO 15765-2 segmentation: every HSFZ
  diagnostic message already carries a complete, reassembled payload, so
  no FF/CF/FC machinery is needed here (see `transport::isotp` for raw
  CAN-class transports).
