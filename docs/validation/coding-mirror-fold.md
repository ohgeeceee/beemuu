# E90 FRM coding dump — real-car harness

> **Purpose.** BeeEmUu can **read** FRM (`0x72`) identification and
> dump the local IDs / DIDs that answer. It cannot change automatic
> mirror folding. [v0.8.0](../v0.8.0_plan.md) left ECU coding writes
> (NCD/CAFD) out of scope: *writing stays Tier C until the format is
> documented from open sources; read-only coding display may become a
> research item.* This harness is that research item.
>
> **This dump does not decode `Spiegel_Komfort_einklapp`.** The UI
> always shows mirror-fold state as **Unknown**. Do not invent a bit
> offset from a forum post
> ([CONTRIBUTING.md](../../CONTRIBUTING.md)).
>
> **Time required.** 10–20 minutes plus probe time. A full local-ID
> (0x00–0xFF) and DID (0x0000–0x00FF) scan can take several minutes on
> a real FRM — each unanswered identifier waits for a transport
> timeout.

## What this is not

- Not an on/off toggle and not an ECU write. There is no
  `write_did`, KWP `0x3B`, or `set_coding_parameter` in this path.
- Not NCS Expert. To **turn automatic mirror folding off** on a 2006
  E90 330i this weekend, use NCS Expert + NCS Dummy (BMW Standard
  Tools). The usual FRM parameter is `Spiegel_Komfort_einklapp` →
  `nicht aktiv`. `komfortschliessung_FB` on CAS is a different
  setting (hold-lock comfort close) and is out of scope here.
- Not F-series live-data DIDs `406B` / `406C` (mirror *state* in
  [`DECODE_FUNCTIONS.md`](../DECODE_FUNCTIONS.md)). Those are not E90
  variant coding.
- Not a seventh Service Functions routine. The six `0x31` entries
  stay unchanged.

## 1. Pre-flight checklist

- [ ] **K+DCAN cable** on the OBD port. A 2006 E90 is D-CAN
      (115200). Use Auto-detect if unsure.
- [ ] **FTDI VCP latency timer = 1 ms.** Do not "fix" slow reads by
      inflating software timeouts — see the hardware invariant in
      `CLAUDE.md`.
- [ ] **Ignition on** (engine off is fine).
- [ ] **Traffic view recording** for the whole dump. The
      request/response bytes are the evidence.
- [ ] **Simulator NOT connected** when filing a real-car report.
      The sim answers identify plus a few placeholder local IDs; a
      sim dump proves the Export button, not the car.
- [ ] Battery maintainer is optional for a **read**. Required before
      any later write (not this feature).

## 2. Dump procedure

1. Connect (K+DCAN). Status bar should show a VIN (via
   `protocol::read_vin` — do not add a raw VIN DID read).
2. Open **Service Functions** (Advanced mode).
3. Confirm the **FRM coding dump (E90)** card. State must read
   **Unknown**. Ident may say "not scanned" until you export or run
   a vehicle test.
4. Click **Export backup**. BeeEmUu:
   - identifies FRM with KWP `1A 80` (via `scan_modules` if needed)
   - probes local IDs `0x00`–`0xFF` (`probe_range` / KWP `21`)
   - probes DIDs `0x0000`–`0x00FF` (`probe_range` / UDS `22`)
   - writes `~/beeemuu-exports/beeemuu-frm-coding-<VIN>-<stamp>.txt`
5. Keep the dump file and the Traffic recording.

### What a useful dump contains

- `ident:` line matching the FRM `1A 80` string (hw / sw / ci).
- One hex row per local ID or DID that answered.
- Header `Mirror-fold state: Unknown`.

A missing FRM (timeout on `0x72`) is a finding: the module is
absent, asleep, or on a different address. Record it; do not guess.

## 3. Optional: NCS before/after (grounds a later write PR)

This step is **not** required to land the dump feature. It is the
only honest path to a *later* coding-write PR, if the owner wants
one:

1. Export a dump (before).
2. In NCS Dummy / NCS Expert, set FRM `Spiegel_Komfort_einklapp` to
   `nicht aktiv` (or back to active). Do not pull bit maps out of
   SP-Daten / `.prg` files into this repo.
3. Export a second dump (after).
4. Open an issue with both files, the ident string, chassis
   (E90 330i), date, and the Traffic bytes. The delta is the
   candidate map. Forum paste-ins without dumps get rejected.

Until that issue exists, BeeEmUu will not flip a bit.

## 4. Filing the report

1. **Dump succeeded:** attach the `.txt` (and Traffic if you have
   it) to an issue titled
   `[FRM coding dump] ident <string> on E90 …`.
2. **FRM absent / timeout:** same issue title with the NRC or
   timeout. Still useful.
3. **Do not** open a write PR from this harness. Coding writes
   remain out of scope per v0.8.0 until a format story lands from
   open sources.

## 5. Reference

- [`docs/v0.8.0_plan.md`](../v0.8.0_plan.md) — coding writes deferred
- [`docs/validation/service-functions.md`](service-functions.md) —
  write-path harness for `0x31` routines (different class of op)
- [`docs/hardware/addressing-model.md`](../hardware/addressing-model.md)
  — why FRM is `0x72` on K+DCAN
- [`src/js/frm_coding_dump.js`](../../src/js/frm_coding_dump.js) —
  dump text / filename helpers
