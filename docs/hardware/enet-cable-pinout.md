# BMW ENET cable — DIY pinout for F/G-series

BeeEmUu talks to F-series (F30, F10, etc.) and G-series (G20, G30,
etc.) BMWs over an ENET cable — RJ45 on the car side, USB or
Ethernet on the laptop side, with UDS-over-DoIP running over the
wire. The official BMW cable costs ~$60. The AliExpress clones cost
~$5 and use the same wiring, once you know which pin goes where.

This doc covers:

- What to buy on AliExpress (search terms + red flags)
- The exact pinout (OBD-II → RJ45)
- The 100 Ω termination resistor BMW expects
- What success looks like when the cable is wired correctly
- Two common wiring mistakes that look right but don't work

## TL;DR

If you just want the table:

| OBD-II pin | Function          | RJ45 pin | Wire colour (typical Cat5e) |
|-----------:|-------------------|---------:|-----------------------------|
| 3          | Ethernet TX+      | 3        | white-green                 |
| 11         | Ethernet TX−      | 6        | green                       |
| 12         | Ethernet RX+      | 1        | white-orange                |
| 13         | Ethernet RX−      | 2        | orange                      |
| 8          | ignition / KL15   | (cut)    | —                           |
| 16         | +12 V battery     | (cut)    | —                           |
| 4, 5       | chassis ground    | (cut)    | —                           |

Plus a **100 Ω resistor across the Ethernet pair** (RJ45 pins 1 ↔ 2
or 3 ↔ 6 — the standard 100BASE-TX termination). The cable shell is
typically a moulded OBD-II J1962 plug on one end and an RJ45 plug on
the other; the resistor lives inside the OBD-II shell.

## What to buy

Search AliExpress / eBay for:

- **"ENET cable BMW"** — the common listing title
- **"ENET OBD2 coding cable F-series"** — same thing, longer title
- **"K+D-Can ENET cable combo"** — sometimes sold as a pair

You want the **single-RJ45** variant (OBD-II on one end, RJ45 on the
other), not the "splitter" versions that include a USB K+DCAN cable.
The splitter bundles are fine if you also need K+DCAN, but for F/G-
series work you only need the ENET half.

### What to look for

- "For BMW F-series coding" or "E-Sys cable" in the description
- Black moulded OBD-II plug, ~1.5–2 m cable, RJ45 plug on the laptop end
- Under $10 USD (legit clones are $5–8; anything over $15 is priced
  like a real BMW cable for some reason)

### Red flags

- **"For all BMW models 1996–2024"** — likely a K+DCAN cable with
  ENET branding, won't do DoIP
- **No picture of the OBD-II end** — usually means they don't want you
  to see the cheap connector
- **"USB on laptop end"** — that's a K+DCAN cable; ENET is RJ45-to-RJ45

## What it does (so you can sanity-check the build)

ENET is **100BASE-TX Ethernet over an OBD-II cable**. The car has a
small Ethernet switch behind the OBD-II port (the head-unit / TCB
box); the laptop joins that switch as another node. UDS diagnostic
packets ride over IP/UDP on port **13400** (DoIP). BeeEmUu
broadcasts to that port, the car responds with its VIN and IP
(typically `169.254.x.x` — link-local, no DHCP), and the session
establishes.

> **BeeEmuu invariant (from `CLAUDE.md`):** DoIP discovery is
> UDP broadcast on port 13400 across all active interfaces, never
> hardcoded target IPs. The car's IP comes from the broadcast
> response.

## Wiring the pinout

The pinout above is the "Rx-to-Rx, Tx-to-Tx" version. There are two
diagrams circulating on forums (bimmerfest, f30.bimmerpost, etc.);
the other one crosses Rx/Tx and looks superficially symmetric but
doesn't work. **Use the table above.** The other version's symptom
is the connector pairs up (you see the Ethernet link light) but the
DoIP discovery times out with "no ZGW available."

### Why BMW uses pins 3/11/12/13 instead of the obvious 6/14

The standard OBD-II (SAE J1962) puts CAN-H and CAN-L on **pins 6 and
14**. BMW routes 100BASE-TX Ethernet over pins **3, 11, 12, and 13**
instead — these are listed as "Manufacturer Discretionary" in J1962
and BMW has used them for the ENET bus since the F-series. This is
why the standard OBD-II pinout chart (and any generic OBD-II cable)
won't work for ENET/DoIP work.

### How to actually solder it

1. Cut one end off a Cat5e Ethernet patch cable (keep the RJ45 plug
   on the laptop end, intact).
2. Strip back ~5 cm of the outer jacket. You'll see 4 twisted pairs.
3. Untwist **only the green pair (pins 3, 6)** and **only the orange
   pair (pins 1, 2)**. Leave the blue and brown pairs unused — clip
   them short so they can't short against anything.
4. Solder the four wires onto the corresponding OBD-II pins per the
   table. Pin numbering for the OBD-II J1962 connector is on the
   **mating face** of the plug — pin 1 is top-left when the trapezoid
   is oriented with the wider side up.
5. Solder the 100 Ω resistor across the Ethernet pair (RJ45 pin 1
   ↔ pin 2 is the standard termination; some schematics show it
   across 3 ↔ 6 instead — both work).
6. Hot-glue or heat-shrink the OBD-II end to strain-relieve the
   joints. The resistor and joints live in a small cavity; a blob of
   hot glue keeps them from shorting on the connector shell.

## Verifying it works

Plug the cable into the car (ignition **on**, engine **off** is
fine) and into the laptop's Ethernet port. You should see:

1. **Link light on the laptop's Ethernet port.** Solid amber or
   green, no blinking. If it blinks continuously, the pair is
   crossed or the resistor is wrong.
2. **`arp -a` (Windows) / `ip neigh` (Linux) shows a `169.254.x.x`
   neighbour** within ~5 seconds of ignition. The car announces
   itself.
3. **BeeEmUu discovers the car on first scan.** The connection
   dropdown shows the VIN and IP.

If `ip neigh` shows nothing after 30 seconds:

- Check the resistor is **100 Ω** (not 120, not 10 k). A bad resistor
  is the #1 failure cause.
- Check pin 6 is not connected to anything (pin 6 on RJ45 = pin 11 on
  OBD-II = Ethernet TX−; some "splitter" cables wire this wrong).
- Try a different Ethernet port on the laptop. Some USB-Ethernet
  dongles don't carry the link layer fast enough for DoIP discovery.

## When to just buy the official cable

- You only need it once (e.g. one coding session per year)
- You're not confident with a soldering iron on a 16-pin connector
- You need a known-good reference to compare your DIY build against

The official BMW cable (PN 61 35 9 405 441 or similar) is ~$60 USD
and bulletproof. Everything else in this doc is for the hobbyist who
already has a soldering iron and wants to keep their toolkit light.

## Related BeeEmUu docs

- `README.md` § "Connectors" — the high-level hardware overview
- `docs/forum_post.md` § "Supported hardware" — the cable list in
  the project announcement
- `CLAUDE.md` § "Hardware & timing invariants" — DoIP discovery
  rules the code follows

## Sources

The pinout and termination values are cross-checked from:

- BimmerFest forum thread "ENET Wiring Diagrams" (multiple user
  reports, 2016–2023)
- F30 BimmerPost DIY ENET cable build thread
- Standard 100BASE-TX termination practice (Ethernet IEEE 802.3u
  § 25.4 — 100 Ω across the differential pair)

If you find a counter-example on a specific chassis year (e.g. G80
M3 with a non-standard ENET wiring), open an issue with the chassis
code and we'll add it here.
