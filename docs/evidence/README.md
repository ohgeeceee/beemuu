# Evidence packs

Real-car CAN broadcast validation packs for the v0.22 evidence program.

Each pack is a JSON file recording one or more CAN frames captured from a
real vehicle, paired with the expected decoded values. These packs
serve two purposes:

1. **Decoder verification**: confirm that the byte-level math in
   `src/js/can_decoders.js` and `src-tauri/src/transport/sim.rs`
   produces the same numbers a real car does.
2. **Regression guard**: prevent future refactors from silently
   changing a decoder's scale or offset.

## File naming

One file per engine family, matching the community profile filename:

```
docs/evidence/<family>.example.json
```

Examples: `b58.example.json`, `n55.example.json`, `n52.example.json`,
`e-series.example.json`.

## Trace format

See `schema.json` for the formal schema. Each trace is a JSON array of
frame records:

```json
[
  {
    "id": "0x0AA",
    "data": [11, 176, 0, 0, 0, 0, 128, 0],
    "expected": { "rpm": 748.0, "throttle": 50.2 },
    "source": "real-car capture via K+DCAN cable on E90 335i (N54)",
    "captured_at": "2026-09-05T14:30:00Z"
  }
]
```

Fields:
- `id` — CAN arbitration ID as a hex string (e.g. `"0x0AA"`)
- `data` — 8-byte payload array (0-255 per byte)
- `expected` — decoded values the decoder MUST produce for this frame
- `source` — provenance: vehicle, cable, tool used
- `captured_at` — ISO 8601 timestamp

## How to contribute a pack

1. Connect to a real car with a K+DCAN or ENET cable.
2. Use the Parameter Explorer or a CAN sniffer to capture raw frames.
3. Verify the expected decoded values match what ISTA, INPA, or a
   known-good tool shows for the same vehicle.
4. Submit a PR with the JSON file. Include the vehicle VIN (or WMI +
   last 6 if privacy is a concern), the cable type, and any notes
   about the capture conditions (engine warm/cold, idle/load, etc.).

## Security

Evidence packs are read-only reference data. They are never executed
and never sent to any server — they live in-repo only. The desktop
app reads them via `src-tauri/src/community.rs` for validation
reporting, but no pack is auto-downloaded.
