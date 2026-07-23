# DTC History (v0.12.0 "Fault Memory") — User-Facing Guide

> **Purpose.** v0.12.0 adds an opt-in local DTC history. When you tick
> **Record history** on the Fault memory panel, every successful DTC
> read appends one JSON line to
> `~/beeemuu-exports/dtc-history.jsonl`. The recurring-DTC callout
> (slice 5) reads this file to surface "this code has appeared N
> times over the past 14 days". This doc explains where the file
> lives, what's in it, how to clear it, and the caveats — same
> shape as the `testplans.md` and `service-functions.md` harness docs.
>
> **Time required.** Zero for the first read after enabling — the
> first read creates the file. A few minutes to inspect or delete.
>
> **Risk honesty.** This is a *read-derived* log: nothing here is
> sent off-device, nothing writes to the car, nothing modifies a
> fault. The most aggressive action the file supports is `clear` —
> and that's a single local `rm` of one file. The toggle is off by
> default so existing users don't get a surprise file in their
> home directory without explanation.

## 1. Where the file lives

```
~/beeemuu-exports/dtc-history.jsonl
```

Resolved by the same home-dir lookup `export_text` uses (CLAUDE.md §3
"Application Comms"): `%USERPROFILE%` on Windows, `$HOME` elsewhere.
The directory is auto-created on first write; you do not need to
`mkdir` it.

If you need the exact path on your install, open the Fault memory
panel after a read — the status bar logs the path after each
recording (e.g. `Recorded 2 DTCs to /home/you/beeemuu-exports/dtc-history.jsonl`).

## 2. File format

One JSON object per line. Forward-compatible: serde ignores unknown
fields on read, so a future schema bump won't break old files.

```json
{"ts_iso":"2026-07-21T10:00:00Z","vin":"WBA3A5C50CF256789","address":18,"code":"2A82","status":36,"status_text":"confirmed","text":"VANOS intake solenoid fault"}
```

| Field | Meaning |
|---|---|
| `ts_iso` | UTC timestamp of the read (zero-padded, ISO-8601, sortable as a string). |
| `vin` | VIN of the car when the read happened, or `null` if no VIN was known. |
| `address` | UDS target id of the module that reported the fault (e.g. `0x12` for DME, `0x18` for EGS). |
| `code` | DTC code, BMW-style hex (e.g. `"2A82"`, `"29E0"`, `"P0171"`). |
| `status` | Raw status byte from UDS `0x19 02`. The displayed `status_text` is derived from this. |
| `status_text` | Human-readable status (e.g. `"confirmed"`, `"pending"`, `"intermittent"`). |
| `text` | DTC description (community-overlaid or built-in). |

The file is plain text — `cat`, `less`, `grep`, `jq`, Excel, `pandas`,
all work. Example one-liner:

```sh
grep '"code":"2A82"' ~/beeemuu-exports/dtc-history.jsonl | wc -l
# → how many times 2A82 has been recorded
```

## 3. The 60-second dedup window

Re-reading the same `(vin, address, code)` tuple within 60 seconds
of a previous read on the same module does **not** append a new
line. This guards against the most common noise: a tech clicks
"Read" twice in a row, the simulator or transport re-emits the
same fault list, the second emission would otherwise double-count.

Reads after the 60-second window **do** append — the timeline
counts each genuine re-occurrence.

If you see fewer entries than expected, the dedup window is the
likely cause. There is no UI to disable it; it's a hard guard at
the Rust layer (`commands.rs::DTC_DEDUP_WINDOW_SECS`).

## 4. "No VIN" entries

The first time you read faults in a session, the VIN may not be
known yet (you haven't clicked "Read vehicle"). Those reads land in
the JSONL with `"vin": null`.

The recurring-DTC callout (slice 5) does **not** merge no-VIN
entries with VIN-tagged ones. So a "2A82" recorded before the VIN
read will not count toward the "seen before" banner after you
read the VIN. This is intentional: an unknown VIN could mean a
different car, and silently merging across cars would produce
misleading "5 occurrences" counts.

If you want a continuous timeline, always click "Read vehicle"
**before** reading faults on a fresh session.

## 5. Clearing the history

Three ways to clear, in increasing order of effort:

1. **One command from the terminal (recommended for now):**

   ```sh
   rm ~/beeemuu-exports/dtc-history.jsonl
   ```

   The next read that finds the file gone simply creates a fresh
   one. There is no in-memory "previously-recorded" state on the
   renderer side. The Rust-side `clear_dtc_history` Tauri command
   does the same `rm` under the hood — wiring it to a Settings UI
   button is a small follow-up slice once the Fault memory panel
   grows a settings submenu; until then, the terminal command is
   the supported path.
2. **Toggle the recording off.** Untick **Record history** —
   this stops new lines from being appended but keeps the
   existing file intact. Tick it again to resume.
3. **Hand-edit the file.** The JSONL is plain text. `grep -v '"code":"2A82"'`
   keeps every line except the one you want to forget, redirected
   back into the same file. Power users only; see §2 for the
   field shape.

There is no in-app "Clear history" button yet. The most recent
plan (`docs/v0.12.0_plan.md` slice 6) lands the doc + the data
side; the UI affordance is tracked as a follow-up.

## 6. Storage growth

The file grows by ~250 bytes per DTC line. A heavy user who reads
faults on 30 modules every weekend for a year produces roughly
30 × 52 × 250 = ~390 KB. The slice-5 callout only looks at lines
within the past 14 days, so an old file is fine to keep — older
lines just don't surface.

If storage ever becomes a concern (it shouldn't on a modern
desktop), the file is plain text: `truncate -s 0` resets it,
`grep` keeps only what you want.

## 7. What this file is **not**

- **Not a backup.** The file is local to one machine. If you wipe
  the home directory, the file is gone.
- **Not shareable across machines.** A F30 335i and an E46 M3
  produce different `(vin, address, code)` tuples; copying one
  machine's history onto another pollutes the callout.
- **Not a substitute for a real fix.** The callout tells you
  "this keeps coming back". It does not tell you why. The actual
  diagnostic work is still the guided test plan +
  freeze-frame + community opinions flow that v0.9.0 built.
- **Not a write to the car.** Nothing in `record_dtc_read`,
  `query_dtc_history`, or `clear_dtc_history` touches the bus.
  Per CLAUDE.md §1 Tier B, these commands are file-only.

## 8. How to verify the file is being written

After ticking **Record history** and clicking **Read** on the
fault panel:

1. The status bar logs `Recorded N DTCs to /path/to/dtc-history.jsonl`.
2. `wc -l ~/beeemuu-exports/dtc-history.jsonl` increases by 1
   for each non-empty read (the dedup window collapses duplicates).
3. `tail -1 ~/beeemuu-exports/dtc-history.jsonl` shows the latest
   line. Compare its `ts_iso` to your wall clock — they should
   agree to the minute.

If the file doesn't appear after a successful read, check the
status bar for an error message — most likely the home directory
is not writable, or the toggle wasn't actually checked.

## 9. Privacy note

The file lives in your home directory. It is **not** sent
anywhere: no cloud sync, no telemetry, no automatic upload.
`clear_dtc_history` deletes it locally; there's no remote copy
to clean up because there is no remote copy. The VIN column is
your own VIN; the fault codes are your own car's codes.

If you share your laptop with someone, they can read this file
with normal filesystem access. If that matters, set the file's
permissions (the project does not do this automatically because
`export_text` doesn't either, and changing one without the other
would be inconsistent).
