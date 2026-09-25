"""Tests for community/freeze/*.toml — per-ECU freeze-frame byte schemas.

Each schema file documents a byte layout for one ECU address (filename
stem = address as hex). The schemas are SIMULATOR-ONLY today: they match
the byte layout emitted by src-tauri/src/transport/sim.rs::SimEcu.freeze,
NOT any real BMW ECU. The README forbids inventing meaning for unverified
offsets, so this test does NOT add fields — it pins the *documented*
contract: the source bytes each schema's header cites must decode, through
that schema's offset/width/scale/bias, to the documented physical values.

This is the same decode the Rust side does (src-tauri/src/data/freeze.rs:
raw * scale + bias, big-endian multi-byte widths). If a schema edit breaks
the documented decode, or sim.rs drifts from the schema, this test fails.
"""

from __future__ import annotations

import struct
import tomllib
import unittest
from pathlib import Path

COMMUNITY = Path(__file__).resolve().parents[2] / "community"
FREEZE_DIR = COMMUNITY / "freeze"

# width -> (byte count, unpack format, signed)
WIDTHS = {
    "u8": (1, ">B", False),
    "i8": (1, ">b", True),
    "u16": (2, ">H", False),
    "i16": (2, ">h", True),
    "u24": (3, None, False),  # custom: 3-byte big-endian
}


def decode_field(payload: bytes, field: dict) -> float:
    """Decode one schema field from a payload using offset/width/scale/bias.

    Mirrors src-tauri/src/data/freeze.rs: raw * scale + bias, big-endian.
    """
    offset = int(field["offset"])
    width = field["width"]
    nbytes, fmt, _signed = WIDTHS[width]
    raw = payload[offset : offset + nbytes]
    if len(raw) < nbytes:
        raise AssertionError(f"field {field['label']!r} at offset {offset} overruns payload")
    if width == "u24":
        value = (raw[0] << 16) | (raw[1] << 8) | raw[2]
    else:
        (value,) = struct.unpack(fmt, raw)
    return value * float(field["scale"]) + float(field["bias"])


def load_schema(address_hex: str) -> dict:
    """Parse one freeze schema TOML file by address (hex stem)."""
    path = FREEZE_DIR / f"{address_hex}.toml"
    with open(path, "rb") as f:
        return tomllib.load(f)


class TestFreezeSchemasParse(unittest.TestCase):
    def test_every_schema_file_parses_as_toml(self) -> None:
        files = sorted(FREEZE_DIR.glob("*.toml"))
        self.assertGreaterEqual(len(files), 3, "expected at least the DME/DSC/FRM schemas")
        for path in files:
            with self.subTest(file=path.name):
                with open(path, "rb") as f:
                    data = tomllib.load(f)
                self.assertIsInstance(data.get("field"), list, f"{path.name} must have [[field]]")
                self.assertGreater(len(data["field"]), 0, f"{path.name} must define fields")

    def test_widths_are_supported(self) -> None:
        for path in sorted(FREEZE_DIR.glob("*.toml")):
            with open(path, "rb") as f:
                data = tomllib.load(f)
            for field in data["field"]:
                with self.subTest(file=path.name, field=field.get("label")):
                    self.assertIn(field["width"], WIDTHS, f"unsupported width {field['width']!r}")


class TestFreezeSchemaDecode(unittest.TestCase):
    """Pin each schema to the documented simulator source bytes.

    The (address, source_bytes, expected) tuples come from the schema
    headers and src-tauri/src/transport/sim.rs::SimTransport::new().
    """

    CASES = [
        # DME (0x12): dme_freeze = [0x02,0xEE,0x7A, ...] -> rpm=750, coolant=82C
        ("12", bytes([0x02, 0xEE, 0x7A, 0x00, 0x14, 0x8B, 0x01, 0xE2, 0x40]),
         {"Engine speed": 750.0, "Coolant temp": 82.0}),
        # DSC (0x29): dsc_freeze = [0x00,0x00,0x51, ...] -> rpm=0, coolant=41C
        ("29", bytes([0x00, 0x00, 0x51, 0x2D, 0x00, 0x8A, 0x01, 0xE2, 0x41]),
         {"Engine speed": 0.0, "Coolant temp": 41.0}),
        # FRM (0x72): frm_freeze = [0x00,0x00,0x4B, ...] -> rpm=0, coolant=35C
        ("72", bytes([0x00, 0x00, 0x4B, 0x00, 0x00, 0x8B, 0x01, 0xE2, 0x40]),
         {"Engine speed": 0.0, "Coolant temp": 35.0}),
    ]

    def test_documented_bytes_decode_to_documented_values(self) -> None:
        for address, payload, expected in self.CASES:
            with self.subTest(address=address):
                schema = load_schema(address)
                decoded = {f["label"]: decode_field(payload, f) for f in schema["field"]}
                for label, want in expected.items():
                    self.assertIn(label, decoded, f"{address}.toml missing field {label!r}")
                    self.assertAlmostEqual(
                        decoded[label], want, places=1,
                        msg=f"{address}.toml {label}: got {decoded[label]}, want {want}",
                    )


if __name__ == "__main__":
    unittest.main()
