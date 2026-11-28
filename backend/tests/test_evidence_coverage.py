"""Guard for the evidence coverage ledger (docs/evidence/coverage.toml).

Update-3 gate (docs/product_calendar.md, January 2027): every
`[needs verification]` marker in community/profiles/*.toml maps to an
evidence record or a named gap. This suite makes that a CI-enforced
contract instead of a doc promise — a marker without a ledger entry
fails, and a ledger entry whose marker disappears fails too, so the
ledger cannot silently rot as profiles evolve.
"""
from __future__ import annotations

import json
import tomllib
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
PROFILES_DIR = REPO_ROOT / "community" / "profiles"
EVIDENCE_DIR = REPO_ROOT / "docs" / "evidence"
LEDGER_PATH = EVIDENCE_DIR / "coverage.toml"
MARKER = "needs verification"
VALID_STATUS = {"gap", "evidence"}


def _collect_markers() -> set[tuple[str, str]]:
    """(profile_id, param_id) for every live marker; '*' = profile-level."""
    out: set[tuple[str, str]] = set()
    for path in sorted(PROFILES_DIR.glob("*.toml")):
        data = tomllib.loads(path.read_text(encoding="utf-8"))
        for prof in data.get("profile", []):
            pid = prof.get("id", "")
            if pid.startswith("test"):
                continue
            if MARKER in prof.get("label", ""):
                out.add((pid, "*"))
            for prm in prof.get("param", []):
                if MARKER in prm.get("label", ""):
                    out.add((pid, prm.get("id", "")))
    return out


@pytest.fixture(scope="module")
def markers() -> set[tuple[str, str]]:
    return _collect_markers()


@pytest.fixture(scope="module")
def ledger() -> dict:
    return tomllib.loads(LEDGER_PATH.read_text(encoding="utf-8"))


def _entry_keys(ledger: dict) -> list[tuple[str, str]]:
    return [(e["profile"], e["param"]) for e in ledger.get("entry", [])]


def test_markers_exist(markers):
    assert markers, "expected at least one [needs verification] marker"


def test_every_marker_maps_to_an_entry(markers, ledger):
    missing = markers - set(_entry_keys(ledger))
    assert not missing, f"markers without a ledger entry: {sorted(missing)}"


def test_no_orphan_entries(markers, ledger):
    orphans = set(_entry_keys(ledger)) - markers
    assert not orphans, f"ledger entries with no live marker: {sorted(orphans)}"


def test_entries_are_unique(ledger):
    keys = _entry_keys(ledger)
    dupes = {k for k in keys if keys.count(k) > 1}
    assert not dupes, f"duplicate ledger entries: {sorted(dupes)}"


def test_status_is_gap_or_evidence(ledger):
    for e in ledger.get("entry", []):
        assert e.get("status") in VALID_STATUS, (
            f"{e.get('profile')}/{e.get('param')}: "
            f"bad status {e.get('status')!r}"
        )


def test_gap_entries_reference_defined_gaps(ledger):
    defined = set(ledger.get("gap", {}))
    assert defined, "ledger must define at least one [gap.<name>] table"
    for e in ledger.get("entry", []):
        if e.get("status") == "gap":
            assert e.get("gap") in defined, (
                f"{e['profile']}/{e['param']}: undefined gap "
                f"{e.get('gap')!r}"
            )


def test_evidence_entries_reference_real_packs(ledger):
    for e in ledger.get("entry", []):
        if e.get("status") == "evidence":
            pack = EVIDENCE_DIR / e.get("evidence", "")
            assert pack.is_file(), (
                f"{e['profile']}/{e['param']}: evidence pack "
                f"{e.get('evidence')!r} not found in docs/evidence/"
            )
            json.loads(pack.read_text(encoding="utf-8"))  # must parse


def test_gap_definitions_are_actionable(ledger):
    for name, gap in ledger.get("gap", {}).items():
        assert gap.get("summary"), f"gap {name}: missing summary"
        assert gap.get("closes_when"), f"gap {name}: missing closes_when"
