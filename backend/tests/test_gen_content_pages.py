"""Tests for scripts/gen-content-pages.py DTC coverage.

The generator widened from a curated 13-code set to one page per grounded
code in November 2026. These tests pin the coverage contract: every code
with grounded data (dim01 research seed or a community opinions file) gets
a page, no ungrounded code sneaks in, and the index groups every code
exactly once. They import the script as a module without running main().
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "gen-content-pages.py"


@pytest.fixture(scope="module")
def gen():
    """Load scripts/gen-content-pages.py as a module (main() not executed)."""
    spec = importlib.util.spec_from_file_location("gen_content_pages", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


@pytest.fixture(scope="module")
def index(gen):
    return gen.build_dtc_index()


def test_every_grounded_code_gets_a_page(gen, index):
    featured, _ = index
    grounded = set(gen.load_dim01()) | set(gen.load_opinions())
    missing = grounded - set(featured)
    assert not missing, f"grounded codes without a page: {sorted(missing)}"


def test_no_ungrounded_code_sneaks_in(gen, index):
    featured, _ = index
    allowed = (
        set(gen.load_dim01())
        | set(gen.load_opinions())
        | set(gen.load_sae())
        | set(gen.load_dtc_texts())
    )
    unknown = [c for c in featured if c not in allowed]
    assert not unknown, f"page generated for code with no data source: {unknown}"


def test_every_featured_code_has_title_and_severity(index):
    featured, catalog = index
    assert featured, "expected a non-empty catalogue"
    for code in featured:
        entry = catalog[code]
        assert entry["title"], f"{code}: missing title"
        assert entry["severity"], f"{code}: missing severity"
        assert entry["section"], f"{code}: missing section"


def test_index_page_lists_every_code_exactly_once(gen, index):
    featured, catalog = index
    html = gen.build_dtc_index_page(featured, catalog)
    with_opinions = [c for c in featured if catalog[c]["opinions"]]
    for code in featured:
        occurrences = html.count(f"/dtc/{code}.html")
        # Each code appears once in its system group; codes with opinions
        # also appear in the featured strip.
        expected = 2 if code in with_opinions else 1
        assert occurrences == expected, (
            f"{code}: expected {expected} index links, found {occurrences}"
        )


def test_page_escapes_content_and_names_sources(gen, index):
    featured, catalog = index
    code = next(c for c in featured if catalog[c]["source_url"])
    html = gen.build_dtc_page(code, catalog[code], gen.load_cross_links())
    assert catalog[code]["source_url"] in html
    assert "<script" not in html.lower() or "application/ld+json" in html
