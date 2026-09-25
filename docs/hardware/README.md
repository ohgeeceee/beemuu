# BeeEmUu hardware docs

DIY hardware notes for the cables and adapters BeeEmUu needs.

- [`enet-cable-pinout.md`](enet-cable-pinout.md) — build a $5 BMW
  ENET/DoIP cable for F/G-series from an OBD-II plug, Cat5e, and a
  100 Ω resistor.
- [`addressing-model.md`](addressing-model.md) — why one table of
  one-byte ECU addresses scans both E-series (K+DCAN) and F/G-series
  (ENET/HSFZ via the ZGW), and what the scan can and cannot find.
- [`hsfz-control-words.md`](hsfz-control-words.md) — the HSFZ control-word
  table (TCP 6801), including the error words the gateway uses to refuse a
  request, with sources.

Want to add a doc here? Open a PR; the existing one is the
template for tone (practical, no marketing, links to sources at the
end).
