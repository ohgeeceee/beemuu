"""Seed DTC ↔ schematic cross-links for the three CC0 seed SVGs.

These links are curated by the project owner, not generated from any
OEM source. They're deliberately a small, illustrative set so the API
plumbing is exercised end-to-end. Community- and admin-curated links
go in alongside these via the future admin/CMS tools — when that
arrives, this module becomes the canonical boot seed and admin
submissions pile on top.

All links point at the seeded CC0 schematics shipped by
backend/seed_schematics.py. If that file's slugs change, this file
breaks at boot — that's intentional (forces a human to review both).
"""
from __future__ import annotations

from pathlib import Path

from . import cross_links, seed

# (schematic_slug, code, note)
# Notes are short and factual — they explain WHY a schematic is relevant
# to the code, not WHAT the code means (the DTC endpoint covers that).
_LINKS: list[tuple[str, str, str]] = [
    # --- e89 RCD 3302 retrofit: power & K-CAN ---
    # No OBD DTCs map directly to an aftermarket HU; we do point at
    # the most common "no comm with the head-unit" complaints.
    (
        "e89-z4-rcd3302-power-can",
        "U0167",
        "Lost communication with infotainment — verify HU power via F23.",
    ),
    (
        "e89-z4-rcd3302-power-can",
        "B1342",
        "Head-unit internal power supply fault — check the +12V tap.",
    ),

    # --- e90 CAS3 / CAS4 pinout ---
    (
        "e90-cas3-pinout",
        "29E0",
        "DME-CAS communication timeout — verify CAS pin 6/19 PT-CAN "
        "wires and pin 3 KL15 input.",
    ),
    (
        "e90-cas3-pinout",
        "29E2",
        "CAS key transponder / EWS ring antenna issue — pins 5/18.",
    ),
    (
        "e90-cas3-pinout",
        "A105",
        "CAS relay output stage — verify pin 9 (start) and pin 23 "
        "(KL15 ctrl).",
    ),
    (
        "e90-cas3-pinout",
        "U0100",
        "PT-CAN timeout — first place to inspect: splice at CAS "
        "pin 16/17 after rodent damage in engine bay.",
    ),

    # --- e60 N54 DME main-relay / power tree ---
    (
        "e60-n54-dme-power",
        "29E0",
        "DME cannot reach CAS over PT-CAN — also check DME pin 3 GND.",
    ),
    (
        "e60-n54-dme-power",
        "2A82",
        "DME main relay (K6320) stuck open — bypass with pin 30→87 "
        "jumper for testing only.",
    ),
    (
        "e60-n54-dme-power",
        "29D2",
        "DME power management fault — verify KL87 at DME pin 1 and "
        "relay pin 87.",
    ),
    (
        "e60-n54-dme-power",
        "29DC",
        "KL87 supply below threshold at DME — measure at pin 1 with "
        "key on.",
    ),
    (
        "e60-n54-dme-power",
        "2A0C",
        "DME internal — confirm external power is clean before "
        "reflashing.",
    ),
]


def run(db_path: Path) -> int:
    """Idempotent upsert of every seed cross-link.

    Returns count processed. If you add or change a row here,
    re-running the bootstrap CLI is enough — no data migration step.
    """
    count = 0
    for slug, code, note in _LINKS:
        cross_links.link_one(
            db_path, slug=slug, code=code, note=note
        )
        count += 1
    return count


# Auto-register with the bootstrap registry so a fresh server pre-seeds.
seed.register_source(run)
