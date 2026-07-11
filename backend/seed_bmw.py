"""BMW-specific DTC seed.

The titles for the codes already covered by `community/opinions/*.toml`
(29E0, 2A82, P0171) are taken verbatim from those files — they are the
project's existing source of truth for the short description text.

Additional BMW-specific 4-hex codes (N54/N55/S55/B58 family) are seeded with
short factual descriptions. We avoid scraping or paraphrasing copyrighted
sources; these descriptions are short technical statements of fact.

BMW-specific codes use the 4-hex format (e.g. "29E0") under the
"bmw-specific" category. They are NOT SAE J2012 codes.
"""
from __future__ import annotations

from pathlib import Path

from . import seed


# Codes that map 1:1 to existing community/opinions/*.toml files.
# Source of truth: dtc + dtc_text fields in those files.
_KNOWN_OPINION_CODES = {
    "29E0": "Mixture too lean",
    "2A82": "VANOS intake control fault",
    "P0171": "System too lean (Bank 1)",
}


def _rows() -> list[dict]:
    rows: list[dict] = []

    # --- Codes drawn from your existing community/opinions/*.toml ---
    for code, title in _KNOWN_OPINION_CODES.items():
        # 29E0, 2A82 are BMW-specific 4-hex codes; P0171 is generic.
        if code.startswith("P"):
            category = "powertrain"
        else:
            category = "bmw-specific"
        rows.append(
            {
                "code": code,
                "category": category,
                "title": title,
                "description": (
                    "Detailed repair opinions (DIY / indie / dealer) for this "
                    "code are in community/opinions/{c}.toml in the repo."
                ).format(c=code),
                "likely_causes": None,
                "severity": "warn",
                "source": "seed:bmw",
                "verified": 1,
            }
        )

    # --- BMW-specific codes (N54/N55/S55/B58 family) ---
    # Short factual descriptions only. No scraped text.
    bmw_codes = [
        # 29E0 already added above; rest are unique to this list.
        (
            "2A87",
            "VANOS exhaust control fault",
            "Variable valve timing solenoid (exhaust side) fault. "
            "Common on N52/N54/N55 with high mileage.",
            "warn",
        ),
        (
            "2A98",
            "DISA intake manifold runner fault",
            "Variable intake manifold (DISA) flap actuator fault. "
            "Common on N52/N54; reduced low-end torque when active.",
            "warn",
        ),
        (
            "2AAA",
            "Valvetronic eccentric shaft fault",
            "Valvetronic variable-lift system fault. Causes rough idle "
            "and reduced power. More common on N52/N83.",
            "warn",
        ),
        (
            "2C57",
            "Crankcase ventilation heater fault",
            "Crankcase breather/heater element fault. Triggers on cold-start "
            "drive cycles; usually electrical connector or element failure.",
            "warn",
        ),
        (
            "30DA",
            "No bus sleep / wake-up fault",
            "PT-CAN bus sleep or wake-up message timeout. Indicates a "
            "control unit that isn't going to sleep or waking unexpectedly.",
            "info",
        ),
        (
            "CDBB",
            "FlexRay communication fault",
            "FlexRay bus communication error. Common when retrofitting "
            "or with damaged wiring near the wheel wells.",
            "warn",
        ),
        (
            "E094",
            "Rail pressure deviation",
            "High-pressure fuel rail pressure not matching requested value. "
            "Common on N54/N55 HPFP failure around 80k-120k miles.",
            "critical",
        ),
        (
            "E095",
            "Rail pressure sensor plausibility",
            "HPFP pressure sensor reading inconsistent with modeled pressure. "
            "Test HPFP and pressure sensor before replacing injectors.",
            "warn",
        ),
        (
            "E102",
            "Injector cylinder 1 fault",
            "Piezo injector electrical fault on cylinder 1. Verify "
            "wiring and connector before replacing the injector.",
            "warn",
        ),
    ]

    for code, title, desc, severity in bmw_codes:
        rows.append(
            {
                "code": code,
                "category": "bmw-specific",
                "title": title,
                "description": desc,
                "likely_causes": None,
                "severity": severity,
                "source": "seed:bmw",
                "verified": 1,
            }
        )

    return rows


def run(db_path: Path) -> None:
    """Idempotent. Registers via seed.seed_many()."""
    seed.seed_many(db_path, _rows())


# Register with the bootstrap registry so `run_bootstrap()` picks it up
# alongside other sources.
seed.register_source(run)