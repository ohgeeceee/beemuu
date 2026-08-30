# CAN Broadcast Validation Run — How to Verify `can_decoders.js`

> **One-command harness** for the `docs/validation/can-broadcast.md` report-back loop.
> No car, no cable needed for the harness itself — a captured CSV is enough.
> Real-car capture still needs a K+DCAN + E90/E60 on bench per the original doc.

## One-command

```bash
# from repo root
node src/js/test/can_broadcast_validation.test.cjs
# or
npm run test:js  # runs all JS tests including can_decoders + validation
```

The validation test loads `community/fixtures/can-broadcast-sample.csv` (3 seconds of raw CAN at 500 kbit/s, 6 frames: 0x0AA, 0x1D0, 0x545, 0x0CE, 0x130, 0x316) and asserts the decoder output matches the scales in `src/js/can_decoders.js` (RPM `u16/4`, coolant `u8-40`, etc.). The fixture is anonymized (VIN stripped, timestamps zeroed).

## What to do with a real capture

1. Log raw CAN with `candump` / PCAN-View / SavvyCAN: `candump can0,0x0AA:0x7FF,0x1D0:0x7FF,0x545:0x7FF > capture.csv`
2. Drop it as `community/fixtures/can-broadcast-real.csv` (same shape as the sample)
3. Run `node -e "import('./src/js/can_decoders.js').then(m=>console.log(m.decode('0x0AA', Buffer.from('...'))))"` or just open an issue with the CSV attached — a maintainer will run the harness and file a `community/profiles` fix if the scales are off.

## Acceptance

- `can_broadcast_validation.test.cjs` passes on the sample fixture
- Real-car fixture, when provided, either passes (decoder confirmed) or fails with a clear `expected vs actual` diff that becomes a one-line scale fix in `can_decoders.js`
