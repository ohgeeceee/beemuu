#!/usr/bin/env python3
"""Generate the data-driven guide pages for beemuu.com.

The public site links ~34 per-record pages (`/dtc/*`, `/engines/*`) plus a
handful of hub pages that were never built after the landing page moved to
GitHub Pages. `scripts/test-github-pages-build.cjs` calls these the
"deliberate backlog". This generator builds them from the in-repo sources of
truth so they never drift from the data:

  - community/dtc_texts.toml        -> BMW hex code -> short text
  - community/opinions/*.toml       -> DIY / indie / dealer repair opinions
  - backend/seed_bmw_dim01.py       -> code, section, title, severity, source
  - backend/seed_dtcs.py            -> generic SAE J2012 code titles
  - backend/seed_cross_links.py     -> code -> schematic cross-links
  - community/profiles/*.toml       -> live-data parameter profiles

Everything is generated into `frontend/` and committed, exactly like every
other hand-authored page. Re-run after editing any of the sources above:

    python3 scripts/gen-content-pages.py

Output is deterministic; re-running with unchanged inputs rewrites identical
bytes.
"""
from __future__ import annotations

import ast
import html
import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
DATA = ROOT / "community"
BACKEND = ROOT / "backend"

SITE = "https://beemuu.com"
TODAY = "2026-10-11"
AUTHOR = {"@type": "Organization", "name": "Beemuu contributors", "url": SITE + "/"}
PUBLISHER = {"@type": "Organization", "name": "Beemuu contributors"}
OG_IMAGE = SITE + "/og-image-service.png"


# --------------------------------------------------------------------------
# small HTML helpers
# --------------------------------------------------------------------------

def esc(s: str) -> str:
    return html.escape(str(s), quote=True)


def rel_guides(current: str) -> str:
    """The shared 'Related guides' nav. `current` is the href of this page."""
    items = [
        ("/hardware.html", "BMW K+DCAN diagnostics"),
        ("/protocols.html", "BMW ENET / DoIP diagnostics"),
        ("/tools/known-codes.html", "BMW fault codes"),
        ("/protocols.html", "BMW VIN decoding"),
        ("/glossary.html", "Glossary"),
        ("/roadmap/index.html", "Roadmap"),
    ]
    lis = []
    for href, label in items:
        if href == current:
            lis.append(f'<li><strong>{esc(label)} (you are here)</strong></li>')
        else:
            lis.append(f'<li><a href="{esc(href)}">{esc(label)}</a></li>')
    return (
        '<nav class="related-guides" aria-label="Related guides"><h2>Related guides</h2><ul>'
        + "".join(lis)
        + "</ul></nav>"
    )


def head(title: str, desc: str, url: str, og_type: str, ld: list[dict]) -> str:
    blocks = "".join(
        '<script type="application/ld+json">\n' + json.dumps(b, ensure_ascii=False) + "\n</script>"
        for b in ld
    )
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="initial-scale=1">'
        f"<title>{esc(title)} | Beemuu</title>"
        f'<meta name="description" content="{esc(desc)}">'
        '<meta name="robots" content="index, follow, max-image-preview:large">'
        f'<meta property="og:type" content="{esc(og_type)}">'
        '<meta property="og:site_name" content="Beemuu">'
        f'<meta property="og:title" content="{esc(title)}">'
        f'<meta property="og:description" content="{esc(desc)}">'
        f'<meta property="og:url" content="{esc(SITE + url)}">'
        f'<meta property="og:image" content="{esc(OG_IMAGE)}">'
        '<meta name="twitter:card" content="summary_large_image">'
        f'<meta name="twitter:image" content="{esc(OG_IMAGE)}">'
        f'<link rel="canonical" href="{esc(SITE + url)}">'
        '<link rel="stylesheet" href="/guide.css">'
        + blocks
        + "</head>"
    )


CHROME_HEADER = (
    '<body><a class="skip-link" href="#main">Skip to content</a>'
    '<header class="site-header"><a class="brand" href="/"><span class="brand-mark">B</span>BEEMUU</a>'
    '<nav><a href="/hardware.html">K+DCAN</a><a href="/protocols.html">ENET</a>'
    '<a href="/tools/known-codes.html">Fault codes</a>'
    '<a href="https://github.com/ohgeeceee/beemuu">GitHub</a></nav></header>'
)

CHROME_FOOTER = (
    '<footer><div><a class="brand" href="/"><span class="brand-mark">B</span>BEEMUU</a>'
    '<p>Independent, free and open-source BMW diagnostic software. Not affiliated with BMW AG.</p></div>'
    '<nav><a href="/">Home</a><a href="/schematics.html">Schematics</a>'
    '<a href="/index.html#status">Status</a>'
    '<a href="https://github.com/ohgeeceee/beemuu">GitHub</a></nav></footer></body></html>'
)


def breadcrumb_ld(url: str, crumbs: list[tuple[str, str]]) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": name, "item": SITE + href}
            for i, (name, href) in enumerate(crumbs)
        ],
    }


def article_ld(headline: str, desc: str, url: str) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "TechArticle",
        "headline": headline,
        "description": desc,
        "url": SITE + url,
        "datePublished": TODAY,
        "dateModified": TODAY,
        "author": AUTHOR,
        "publisher": PUBLISHER,
        "mainEntityOfPage": SITE + url,
    }


def page(
    *,
    url: str,
    title: str,
    desc: str,
    eyebrow: str,
    h1: str,
    lede: str,
    meta: list[str],
    crumbs: list[tuple[str, str]],
    toc: list[tuple[str, str]],
    article: str,
    related: list[tuple[str, str, str]],
    cta_h: str,
    cta_p: str,
    og_type: str = "article",
) -> str:
    toc_html = (
        '<aside class="toc"><strong>On this page</strong>'
        + "".join(f'<a href="#{esc(a)}">{esc(t)}</a>' for a, t in toc)
        + "</aside>"
    )
    meta_html = "".join(f"<span>{esc(m)}</span>" for m in meta)
    crumb_html = " / ".join(
        f'<a href="{esc(h)}">{esc(n)}</a>' for n, h in crumbs[:-1]
    ) + f' / <a href="{esc(crumbs[-1][1])}" aria-current="page">{esc(crumbs[-1][0])}</a>'
    related_html = (
        '<section class="related"><h2>Continue learning</h2><div class="related-grid">'
        + "".join(
            f'<a href="{esc(h)}"><strong>{esc(t)}</strong><span>{esc(s)}</span></a>'
            for h, t, s in related
        )
        + "</div></section>"
    )
    return (
        head(title, desc, url, og_type, [
            article_ld(title, desc, url),
            breadcrumb_ld(url, crumbs),
        ])
        + CHROME_HEADER
        + '<main id="main"><section class="guide-hero">'
        + f'<p class="breadcrumbs">{crumb_html}</p>'
        + f'<p class="eyebrow">{esc(eyebrow)}</p>'
        + f"<h1>{esc(h1)}</h1>"
        + f'<p class="lede">{lede}</p>'
        + f'<div class="guide-meta">{meta_html}</div>'
        + "</section>"
        + f'<div class="guide-layout">{toc_html}<article class="article">{article}</article></div>'
        + related_html
        + f'<section class="cta"><h2>{esc(cta_h)}</h2><p>{esc(cta_p)}</p>'
        + f'<a class="button" href="/tools/dtc-decoder.html">Open the DTC decoder</a>'
        + f'<a class="button secondary" href="https://github.com/ohgeeceee/beemuu">GitHub</a></section>'
        + rel_guides(url)
        + f'<p class="last-updated"><small>Last updated: {TODAY} · Beemuu contributors</small></p>'
        + "</main>"
        + CHROME_FOOTER
    )


def write(path: str, content: str) -> None:
    dest = FRONTEND / path
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(content, encoding="utf-8")
    print(f"wrote frontend/{path}")


# --------------------------------------------------------------------------
# source loaders
# --------------------------------------------------------------------------

def load_dtc_texts() -> dict[str, str]:
    with open(DATA / "dtc_texts.toml", "rb") as fh:
        return {k.upper(): v for k, v in tomllib.load(fh).get("dtc", {}).items()}


def load_opinions() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for p in sorted((DATA / "opinions").glob("*.toml")):
        with open(p, "rb") as fh:
            data = tomllib.load(fh)
        out[str(data["dtc"]).upper()] = data
    return out


def _parse_seed_rows(path: Path) -> list[tuple]:
    """Pull the literal `_ROWS`/`_LINKS` list out of a seed module and eval it."""
    src = path.read_text(encoding="utf-8")
    for name in ("_ROWS", "_LINKS"):
        m = re.search(rf"^{name}\s*(?::[^=]+)?=\s*(\[.*?\n\])", src, re.S | re.M)
        if m:
            return ast.literal_eval(m.group(1))
    return []


def load_dim01() -> dict[str, dict]:
    rows = _parse_seed_rows(BACKEND / "seed_bmw_dim01.py")
    return {
        r[0].upper(): {"section": r[1], "title": r[2], "severity": r[3], "source_url": r[4]}
        for r in rows
    }


def load_sae() -> dict[str, dict]:
    rows = _parse_seed_rows(BACKEND / "seed_dtcs.py")
    return {r[0].upper(): {"title": r[1], "severity": r[2]} for r in rows}


def load_cross_links() -> dict[str, list[tuple[str, str]]]:
    rows = _parse_seed_rows(BACKEND / "seed_cross_links.py")
    out: dict[str, list[tuple[str, str]]] = {}
    for slug, code, note in rows:
        out.setdefault(code.upper(), []).append((slug, note))
    return out


def load_profiles() -> list[dict]:
    out = []
    for p in sorted((DATA / "profiles").glob("*.toml")):
        with open(p, "rb") as fh:
            data = tomllib.load(fh)
        for prof in data.get("profile", []):
            pid = prof.get("id", "")
            if pid.startswith("test"):
                continue
            prof["_file"] = p.name
            out.append(prof)
    return out


# --------------------------------------------------------------------------
# curated DTC set (the 13 codes the site links as /dtc/<code>.html)
# --------------------------------------------------------------------------

def profile_status(label: str) -> str:
    """Human status for an engine profile, from its [community] label tag."""
    low = label.lower()
    if "unverified" in low:
        return "Partly unverified"
    if "[community" in low:
        return "Community profile"
    return "Shipped profile"


SEVERITY_LABEL = {
    "info": "Advisory",
    "warn": "Service soon",
    "critical": "Stop / drive carefully",
}
CATEGORY_LABEL = {
    "misfire": "Misfire",
    "fuel": "Fuel & air metering",
    "vanos": "VANOS / camshaft",
    "turbo": "Turbo & charge air",
    "lambda": "Lambda / NOx",
    "throttle": "Throttle & pedal",
    "cooling": "Cooling",
    "sensor": "Sensor",
    "battery": "Power management",
    "transmission": "Transmission",
    "dsc": "Stability control",
    "body": "Body / CAS",
    "can": "Bus / CAN",
    "hvac": "Climate",
    "airbag": "Airbag",
    "network": "Network",
    "powertrain": "Powertrain",
    "other": "Other",
}


def build_dtc_index() -> tuple[list[str], dict]:
    """Return (codes, catalog) for the featured codes."""
    dim01 = load_dim01()
    sae = load_sae()
    texts = load_dtc_texts()
    opinions = load_opinions()

    featured = [
        "120308", "29E0", "29E1", "29E2", "2A82", "2A99", "30FF",
        "P0171", "P0300", "P0301", "P0306", "P0420", "U0100",
    ]
    catalog: dict[str, dict] = {}
    for code in featured:
        if code in opinions:
            title = opinions[code]["dtc_text"]
        elif code in dim01:
            title = dim01[code]["title"]
        elif code in sae:
            title = sae[code]["title"]
        else:
            title = texts.get(code, code)

        if code in dim01:
            section = dim01[code]["section"]
            severity = dim01[code]["severity"]
            source_url = dim01[code]["source_url"]
        elif code in sae:
            section = "powertrain" if code.startswith("P") else "network"
            if code.startswith("U"):
                section = "network"
            elif code.startswith("B"):
                section = "body"
            elif code.startswith("C"):
                section = "other"
            severity = sae[code]["severity"]
            source_url = "https://www.sae.org/standards/content/j2012_202104/"
        else:
            section, severity, source_url = "other", "warn", ""

        catalog[code] = {
            "code": code,
            "title": title,
            "section": section,
            "severity": severity,
            "source_url": source_url,
            "opinions": opinions.get(code, {}).get("opinion", []),
            "alt_text": texts.get(code),
        }
    return featured, catalog


# --------------------------------------------------------------------------
# page builders
# --------------------------------------------------------------------------

def build_dtc_page(code: str, entry: dict, cross: dict) -> str:
    url = f"/dtc/{code}.html"
    title = f"BMW fault code {code} — {entry['title']}"
    desc = (
        f"What BMW fault code {code} ({entry['title']}) means: severity, "
        f"likely systems, schematic cross-links and community DIY / indie / "
        f"dealer repair opinions."
    )
    cat = CATEGORY_LABEL.get(entry["section"], entry["section"].title())
    sev = SEVERITY_LABEL.get(entry["severity"], entry["severity"])

    art = []
    art.append('<h2 id="meaning">What it means</h2>')
    art.append(
        f'<p><strong>{esc(code)}</strong> — {esc(entry["title"])}. '
        f'BeeEmUu groups this code under <strong>{esc(cat)}</strong> with a '
        f'severity of <strong>{esc(sev)}</strong>.</p>'
    )
    art.append(
        '<div class="fact-grid">'
        f'<div class="fact"><span>Code</span><strong><code>{esc(code)}</code></strong></div>'
        f'<div class="fact"><span>System</span><strong>{esc(cat)}</strong></div>'
        f'<div class="fact"><span>Severity</span><strong>{esc(sev)}</strong></div>'
        f'<div class="fact"><span>Format</span><strong>{"SAE J2012" if code.startswith(("P", "B", "C", "U")) else "BMW hex"}</strong></div>'
        '</div>'
    )
    if entry.get("alt_text") and entry["alt_text"].lower() != entry["title"].lower():
        art.append(
            f'<div class="notice"><h2>Overlay text</h2><p>The community overlay '
            f'file (<code>community/dtc_texts.toml</code>) carries a different '
            f'short text for this code: “{esc(entry["alt_text"])}”. Where an '
            f'opinions file disagrees, the opinions text above wins.</p></div>'
        )

    art.append('<h2 id="sources">Provenance</h2>')
    if entry["source_url"]:
        art.append(
            f'<p>The title and severity above are seeded from the open-research '
            f'source of record: <a href="{esc(entry["source_url"])}" '
            f'rel="noopener nofollow">{esc(entry["source_url"])}</a>. BeeEmUu '
            f'stores short factual descriptions only; no proprietary ISTA or '
            f'OEM text is reproduced.</p>'
        )
    else:
        art.append(
            '<p>The title above is the public-domain SAE J2012 technical '
            'definition for this code.</p>'
        )

    links = cross.get(code, [])
    art.append('<h2 id="schematics">Related schematics</h2>')
    if links:
        art.append('<ul>')
        for slug, note in links:
            art.append(
                f'<li><a href="/schematics.html">{esc(slug)}</a> — {esc(note)}</li>'
            )
        art.append("</ul>")
    else:
        art.append(
            '<p>No schematic cross-link is seeded for this code yet. The '
            '<a href="/schematics.html">schematic library</a> holds the '
            'CC0 seed diagrams; community links are added over time.</p>'
        )

    art.append('<h2 id="opinions">Community repair opinions</h2>')
    if entry["opinions"]:
        art.append(
            '<p>The same code means different work depending on who is paying. '
            'These are the recorded DIY, independent-shop and dealer paths:</p>'
        )
        art.append('<div class="code-table"><table><thead><tr>'
                   '<th>Perspective</th><th>Action</th><th>Cost</th>'
                   '<th>Time</th><th>Difficulty</th></tr></thead><tbody>')
        for op in entry["opinions"]:
            cost = op.get("cost_usd", 0)
            cost_s = "free" if not cost else f"~${cost}"
            if op.get("source_url"):
                src = f'<br><small><a href="{esc(op["source_url"])}" rel="noopener nofollow">{esc(op.get("source", "source"))}</a></small>'
            else:
                src = f'<br><small>{esc(op.get("source", ""))}</small>'
            art.append(
                f'<tr><td><strong>{esc({"diy": "DIY", "indie": "Independent shop", "dealer": "Dealer"}.get(op.get("perspective", ""), op.get("perspective", "").title()))}</strong></td>'
                f'<td>{esc(op.get("action", ""))}{src}</td>'
                f'<td>{esc(cost_s)}</td><td>{esc(op.get("time_estimate", ""))}</td>'
                f'<td>{esc(op.get("difficulty", "").title())}</td></tr>'
            )
            if op.get("note"):
                art.append(
                    f'<tr><td></td><td colspan="4"><em>{esc(op["note"])}</em></td></tr>'
                )
        art.append('</tbody></table></div>')
        art.append(
            '<div class="notice"><h2>Not a diagnosis</h2><p>These opinions are '
            'community-contributed starting points, not a repair instruction. '
            'Read the live data before replacing parts.</p></div>'
        )
    else:
        art.append(
            '<p>No community opinion file exists for this code yet. Add one by '
            'opening a PR with <code>community/opinions/'
            f'{esc(code)}.toml</code>.</p>'
        )

    art.append('<h2 id="faq">Frequently asked</h2>')
    art.append('<div class="faq-list">')
    art.append(
        f'<details><summary>Is code {esc(code)} safe to clear?</summary>'
        f'<p>Clearing is only safe once you have read and recorded the freeze '
        f'frame. Re-appearing after a clear is the useful signal; clearing '
        f'without recording destroys it.</p></details>'
    )
    art.append(
        f'<details><summary>Is {esc(code)} a BMW-specific or a generic code?</summary>'
        f'<p>{"This is a generic SAE J2012 code, so any OBD-II tool can read it." if code.startswith(("P", "B", "C", "U")) else "This is a BMW manufacturer hex code. A generic OBD-II tool will not show it — you need BMW-protocol access over K+DCAN or ENET/DoIP."}</p></details>'
    )
    art.append('</div>')

    return page(
        url=url, title=title, desc=desc,
        eyebrow="Fault code", h1=f"{code} — {entry['title']}",
        lede=f"Severity, systems and community repair paths for BMW fault code {esc(code)}.",
        meta=[cat, sev, f"{len(entry['opinions'])} opinions" if entry["opinions"] else "No opinions yet"],
        crumbs=[("Beemuu", "/"), ("Fault codes", "/dtc/"), (code, url)],
        toc=[("meaning", "What it means"), ("sources", "Provenance"),
             ("schematics", "Related schematics"), ("opinions", "Repair opinions"),
             ("faq", "FAQ")],
        article="".join(art),
        related=[("/dtc/", "All fault codes", "The full index."),
                 ("/tools/dtc-decoder.html", "DTC decoder", "Look up any code."),
                 ("/schematics.html", "Schematic library", "Wiring for the fault.")],
        cta_h="Decode the code on your car.",
        cta_p="BeeEmUu reads BMW fault memory over K+DCAN and ENET — free, offline, no account.",
    )


def build_dtc_index_page(featured: list[str], catalog: dict) -> str:
    url = "/dtc/index.html"
    rows = []
    for code in featured:
        e = catalog[code]
        cat = CATEGORY_LABEL.get(e["section"], e["section"].title())
        sev = SEVERITY_LABEL.get(e["severity"], e["severity"])
        rows.append(
            f'<a href="/dtc/{esc(code)}.html"><span class="resource-code">{esc(code)}</span>'
            f'<span><strong>{esc(e["title"])}</strong>'
            f'<small>{esc(cat)} · {esc(sev)}</small></span>'
            f'<span aria-hidden="true">↗</span></a>'
        )
    art = (
        '<h2 id="codes">Featured fault codes</h2>'
        '<p>These codes have full write-ups: severity, provenance, schematic '
        'cross-links and community repair opinions where recorded.</p>'
        f'<div class="resource-index">{"".join(rows)}</div>'
        '<h2 id="by-engine">Browse by engine</h2>'
        '<div class="resource-index">'
        '<a href="/dtc/by-engine/n54.html"><span class="resource-code">N54</span>'
        '<span><strong>N54 fault codes</strong><small>The classic twin-turbo I6 trouble set.</small></span>'
        '<span aria-hidden="true">↗</span></a>'
        '<a href="/dtc/by-engine/b58.html"><span class="resource-code">B58</span>'
        '<span><strong>B58 fault codes</strong><small>Modern straight-six charge-air and e-wastegate codes.</small></span>'
        '<span aria-hidden="true">↗</span></a>'
        '</div>'
        '<h2 id="all">Every BMW code</h2>'
        '<p>The full catalogue — 211 hex codes from open community research '
        'plus the generic SAE J2012 set — is searchable in the '
        '<a href="/tools/known-codes.html">known-codes browser</a>. The '
        '<a href="/tools/dtc-decoder.html">DTC decoder</a> resolves a single '
        'code on demand.</p>'
        '<h2 id="faq">Fault-code questions</h2>'
        '<div class="faq-list">'
        '<details><summary>Why do BMW codes look different from OBD-II codes?</summary>'
        '<p>BMW uses 4-hex and 6-hex manufacturer codes alongside the generic '
        'SAE J2012 P/B/C/U codes. Both describe the same underlying faults, but '
        'the hex codes carry BMW-specific detail the generic set flattens.</p></details>'
        '<details><summary>Where do the descriptions come from?</summary>'
        '<p>Open community research (BimmerFest, Bimmerforums, SpoolStreet, '
        'BimmerProfs and others) plus the public-domain SAE definitions. No '
        'proprietary ISTA text is reproduced.</p></details>'
        '</div>'
    )
    return page(
        url=url, title="BMW fault codes — diagnostic trouble code index",
        desc="An index of BMW diagnostic trouble codes with severity, system, "
             "schematic cross-links and community repair opinions for each.",
        eyebrow="Fault codes", h1="BMW fault codes, explained.",
        lede="Every code BeeEmUu knows about, grouped by system and by engine, "
             "with the same severity and provenance the desktop app shows.",
        meta=[f"{len(featured)} featured codes", "211 community hex codes", "Updated October 2026"],
        crumbs=[("Beemuu", "/"), ("Fault codes", url)],
        toc=[("codes", "Featured codes"), ("by-engine", "By engine"),
             ("all", "Every code"), ("faq", "FAQ")],
        article=art,
        related=[("/tools/known-codes.html", "Known codes", "Search the catalogue."),
                 ("/tools/dtc-decoder.html", "DTC decoder", "Resolve one code."),
                 ("/dtc/by-engine/n54.html", "N54 codes", "Engine-specific set.")],
        cta_h="Read your own fault memory.",
        cta_p="BeeEmUu reads and clears BMW fault memory — free and offline.",
    )


def build_by_engine_page(engine: str, codes: list[str], catalog: dict) -> str:
    url = f"/dtc/by-engine/{engine}.html"
    rows = []
    for code in codes:
        e = catalog.get(code)
        if not e:
            continue
        rows.append(
            f'<a href="/dtc/{esc(code)}.html"><span class="resource-code">{esc(code)}</span>'
            f'<span><strong>{esc(e["title"])}</strong>'
            f'<small>{esc(CATEGORY_LABEL.get(e["section"], e["section"].title()))}</small></span>'
            f'<span aria-hidden="true">↗</span></a>'
        )
    name = engine.upper()
    art = (
        f'<h2 id="codes">{esc(name)} fault codes</h2>'
        f'<p>The codes BeeEmUu most often sees on the {esc(name)} family, with '
        f'full write-ups where the community has recorded repair paths.</p>'
        f'<div class="resource-index">{"".join(rows)}</div>'
        '<h2 id="live">Watch live data too</h2>'
        f'<p>Codes are half the picture. The live-data profile for this engine '
        f'— rail pressure, charge-air temperature, VANOS and fuel trims — is on '
        f'the <a href="/engines/{esc(engine)}.html">{esc(name)} engine page</a>.</p>'
    )
    return page(
        url=url, title=f"{name} BMW fault codes",
        desc=f"Diagnostic trouble codes for the BMW {name} engine family, with "
             f"severity and community repair opinions.",
        eyebrow=f"{name} engine", h1=f"{name} fault codes.",
        lede=f"The {name} trouble set in one place — codes, causes and repair paths.",
        meta=[f"{len(rows)} codes", name, "Updated October 2026"],
        crumbs=[("Beemuu", "/"), ("Fault codes", "/dtc/"),
                (name, url)],
        toc=[("codes", "Codes"), ("live", "Live data")],
        article=art,
        related=[("/dtc/", "All fault codes", "The full index."),
                 (f"/engines/{engine}.html", f"{name} engine", "Live-data profile."),
                 ("/tools/known-codes.html", "Known codes", "Search the catalogue.")],
        cta_h=f"Scan your {name}.",
        cta_p="BeeEmUu reads fault memory and live data over K+DCAN or ENET.",
    )


def build_engine_page(prof: dict) -> str:
    pid = prof["id"]
    url = f"/engines/{pid}.html"
    label = prof.get("label", pid)
    clean = label.split("[")[0].strip()
    params = prof.get("param", [])
    name = pid.upper()

    rows = []
    for p in params:
        rng = ""
        if p.get("min") is not None and p.get("max") is not None:
            rng = f'{p["min"]}–{p["max"]} {p.get("unit", "")}'.strip()
        query = p.get("query", "")
        proto = query.split(":")[0] if ":" in query else query
        rows.append(
            f'<tr><td><strong>{esc(p.get("label", p.get("id", "")))}</strong></td>'
            f'<td><code>{esc(query.upper() if proto != "did" else query)}</code></td>'
            f'<td>{esc(p.get("decode", ""))}</td>'
            f'<td>{esc(rng)}</td></tr>'
        )
    art = (
        f'<h2 id="overview">Overview</h2>'
        f'<p>The <strong>{esc(clean)}</strong> live-data profile as it ships in '
        f'<code>community/profiles/{esc(prof["_file"])}</code>. It lists every '
        f'parameter BeeEmUu polls for this engine, the query it sends and how '
        f'the reply is decoded.</p>'
        '<div class="fact-grid">'
        f'<div class="fact"><span>Profile id</span><strong><code>{esc(pid)}</code></strong></div>'
        f'<div class="fact"><span>Parameters</span><strong>{len(params)}</strong></div>'
        f'<div class="fact"><span>Status</span><strong>{esc(profile_status(label))}</strong></div>'
        '</div>'
        '<h2 id="params">Monitored parameters</h2>'
        '<div class="code-table"><table><thead><tr><th>Parameter</th>'
        '<th>Query</th><th>Decode</th><th>Range</th></tr></thead><tbody>'
        + "".join(rows) +
        '</tbody></table></div>'
        '<div class="notice"><h2>Confirm before trusting</h2><p>Community '
        'profiles are contributed and only partly bench-verified. Confirm a '
        'local identifier with the Parameter Explorer before relying on it for '
        'a repair decision.</p></div>'
    )
    return page(
        url=url, title=f"BMW {name} live-data profile",
        desc=f"Live-data parameters BeeEmUu polls for the BMW {name} engine: "
             f"queries, decodes and healthy ranges.",
        eyebrow="Engine profile", h1=f"{name} live data.",
        lede=f"Every parameter BeeEmUu monitors on the {esc(clean)}, with its query and decode.",
        meta=[f"{len(params)} parameters", pid, "Community profile"],
        crumbs=[("Beemuu", "/"), ("Engines", "/engines.html"), (name, url)],
        toc=[("overview", "Overview"), ("params", "Parameters")],
        article=art,
        related=[("/engines.html", "All engines", "The engine index."),
                 ("/engines/compare.html", "Compare engines", "Side by side."),
                 (f"/dtc/by-engine/{pid}.html", f"{name} codes", "Fault-code set.")
                 if pid in ("n54", "b58") else ("/dtc/", "Fault codes", "The full index.")],
        cta_h=f"Log {name} live data.",
        cta_p="BeeEmUu graphs and CSV-logs every parameter above — free and offline.",
    )


def build_engines_index(profiles: list[dict]) -> str:
    rows = []
    for p in profiles:
        clean = p.get("label", p["id"]).split("[")[0].strip()
        rows.append(
            f'<a href="/engines/{esc(p["id"])}.html"><span class="resource-code">{esc(p["id"].upper())}</span>'
            f'<span><strong>{esc(clean)}</strong>'
            f'<small>{len(p.get("param", []))} live-data parameters</small></span>'
            f'<span aria-hidden="true">↗</span></a>'
        )
    art = (
        '<h2 id="profiles">Engine profiles</h2>'
        '<p>BeeEmUu ships a live-data profile per engine family. Each lists the '
        'parameters it polls, the query it sends and how the reply is decoded.</p>'
        f'<div class="resource-index">{"".join(rows)}</div>'
        '<h2 id="compare">Compare</h2>'
        '<p>See the families side by side — parameter coverage, protocol and '
        'the codes each is known for — on the '
        '<a href="/engines/compare.html">engine comparison page</a>.</p>'
        '<h2 id="faq">Profile questions</h2>'
        '<div class="faq-list">'
        '<details><summary>Where do the profiles come from?</summary><p>The '
        'community (<code>community/profiles/*.toml</code>). Each profile is a '
        'plain TOML file you can read, fork and PR.</p></details>'
        '<details><summary>Can I add my own engine?</summary><p>Yes — copy an '
        'existing profile, change the queries and decodes, and open a PR. See '
        '<code>community/profiles/README.md</code>.</p></details>'
        '</div>'
    )
    return page(
        url="/engines.html", title="BMW engine live-data profiles",
        desc="Live-data parameter profiles for BMW engine families — parameters, "
             "queries and decodes per engine.",
        eyebrow="Engines", h1="BMW engine profiles.",
        lede="One page per engine family: what BeeEmUu monitors and how it decodes it.",
        meta=[f"{len(profiles)} engines", "Community profiles", "Updated October 2026"],
        crumbs=[("Beemuu", "/"), ("Engines", "/engines.html")],
        toc=[("profiles", "Profiles"), ("compare", "Compare"), ("faq", "FAQ")],
        article=art,
        related=[("/engines/compare.html", "Compare engines", "Side by side."),
                 ("/dtc/", "Fault codes", "The code index."),
                 ("/protocols.html", "Protocols", "How the data is read.")],
        cta_h="Scan your engine.",
        cta_p="BeeEmUu reads live data from every engine above — free and offline.",
    )


def build_engine_compare(profiles: list[dict]) -> str:
    rows = []
    for p in profiles:
        clean = p.get("label", p["id"]).split("[")[0].strip()
        rows.append(
            f'<tr><td><a href="/engines/{esc(p["id"])}.html">{esc(p["id"].upper())}</a></td>'
            f'<td>{esc(clean)}</td><td>{len(p.get("param", []))}</td></tr>'
        )
    art = (
        '<h2 id="table">Engine comparison</h2>'
        '<p>Every engine profile BeeEmUu ships, by parameter count. Click an '
        'engine to see the full parameter list.</p>'
        '<div class="code-table"><table><thead><tr><th>Engine</th>'
        '<th>Description</th><th>Parameters</th></tr></thead><tbody>'
        + "".join(rows) +
        '</tbody></table></div>'
        '<h2 id="faq">Comparison questions</h2>'
        '<div class="faq-list">'
        '<details><summary>Does more parameters always mean better coverage?</summary>'
        '<p>No. The count reflects what the community has verified for that '
        'engine. A shorter profile can be more trustworthy than a longer, '
        'unverified one.</p></details>'
        '</div>'
    )
    return page(
        url="/engines/compare.html", title="Compare BMW engine profiles",
        desc="Compare BMW engine live-data profiles side by side by parameter "
             "coverage.",
        eyebrow="Engines", h1="Compare engine profiles.",
        lede="Parameter coverage across every engine family BeeEmUu supports.",
        meta=[f"{len(profiles)} engines", "Community profiles", "Updated October 2026"],
        crumbs=[("Beemuu", "/"), ("Engines", "/engines.html"),
                ("Compare", "/engines/compare.html")],
        toc=[("table", "Comparison"), ("faq", "FAQ")],
        article=art,
        related=[("/engines.html", "All engines", "The engine index."),
                 ("/dtc/", "Fault codes", "The code index."),
                 ("/hardware.html", "Hardware", "What you need to connect.")],
        cta_h="Pick your engine, log live data.",
        cta_p="BeeEmUu graphs every parameter above — free and offline.",
    )


# --- hub pages -------------------------------------------------------------

def build_roadmap_hub() -> str:
    art = (
        '<h2 id="shipped">Where the project is</h2>'
        '<p>BeeEmUu ships in small, reviewable cycles. The desktop app is at '
        '<strong>v5.0.1</strong>; the per-cycle pages below describe what each '
        'cycle was in scope for and what it deferred.</p>'
        '<div class="resource-index">'
        '<a href="/roadmap/index.html"><span class="resource-code">index</span>'
        '<span><strong>Per-cycle roadmap</strong><small>Every shipped and planned cycle, in detail.</small></span>'
        '<span aria-hidden="true">↗</span></a>'
        '<a href="/roadmap/v0.14.6.html"><span class="resource-code">0.14.6</span>'
        '<span><strong>v0.14.6 — Forward roadmap audit</strong><small>Doc-rotation close-of-cycle.</small></span>'
        '<span aria-hidden="true">↗</span></a>'
        '<a href="https://github.com/ohgeeceee/beemuu/blob/main/ROADMAP.md">'
        '<span class="resource-code">ROADMAP.md</span>'
        '<span><strong>The canonical roadmap</strong><small>Source of truth in the repo.</small></span>'
        '<span aria-hidden="true">↗</span></a>'
        '</div>'
        '<h2 id="how">How cycles work</h2>'
        '<p>Each cycle is 3&ndash;5 pull requests with a written plan doc. '
        'Everything is open on GitHub; you can read the plan, the PRs and the '
        'changelog for any cycle.</p>'
    )
    return page(
        url="/roadmap.html", title="Beemuu roadmap — what is shipped and what is next",
        desc="The Beemuu roadmap: shipped cycles, in-flight work and the "
             "next planned cycle, with PR-level detail.",
        eyebrow="Roadmap", h1="The Beemuu roadmap.",
        lede="A public, cycle-by-cycle record of what the project ships — and what it defers on purpose.",
        meta=["Updated October 2026", "Open source", "GPL-3.0"],
        crumbs=[("Beemuu", "/"), ("Roadmap", "/roadmap.html")],
        toc=[("shipped", "Where the project is"), ("how", "How cycles work")],
        article=art,
        related=[("/roadmap/index.html", "Per-cycle roadmap", "Cycle detail."),
                 ("/changelog.html", "Changelog", "What shipped when."),
                 ("https://github.com/ohgeeceee/beemuu", "GitHub", "Follow along.")],
        cta_h="Read the plan, then the code.",
        cta_p="Every cycle is a public plan doc and a stack of reviewed PRs.",
    )


def build_changelog_hub() -> str:
    art = (
        '<h2 id="sources">Where the changelog lives</h2>'
        '<p>BeeEmUu keeps one canonical changelog in the repository. It is the '
        'source of truth for every release; the release notes on GitHub are '
        'cut from it.</p>'
        '<div class="resource-index">'
        '<a href="https://github.com/ohgeeceee/beemuu/blob/main/CHANGELOG.md">'
        '<span class="resource-code">CHANGELOG.md</span>'
        '<span><strong>Changelog</strong><small>Every change, newest first.</small></span>'
        '<span aria-hidden="true">↗</span></a>'
        '<a href="https://github.com/ohgeeceee/beemuu/releases">'
        '<span class="resource-code">releases</span>'
        '<span><strong>GitHub releases</strong><small>Tagged builds with downloadable installers.</small></span>'
        '<span aria-hidden="true">↗</span></a>'
        '<a href="/roadmap/index.html"><span class="resource-code">roadmap</span>'
        '<span><strong>Per-cycle roadmap</strong><small>The plan behind each release.</small></span>'
        '<span aria-hidden="true">↗</span></a>'
        '</div>'
        '<h2 id="current">Current release</h2>'
        '<p>The latest release is <strong>v5.0.1</strong>. Download installers '
        'from the <a href="https://github.com/ohgeeceee/beemuu/releases/latest">'
        'latest release</a> page.</p>'
    )
    return page(
        url="/changelog.html", title="Beemuu changelog",
        desc="What shipped in every BeeEmUu release, with links to the "
             "canonical CHANGELOG and GitHub releases.",
        eyebrow="Changelog", h1="What shipped, when.",
        lede="Every BeeEmUu change, newest first — one canonical file plus the GitHub releases cut from it.",
        meta=["Updated October 2026", "v5.0.1", "GPL-3.0"],
        crumbs=[("Beemuu", "/"), ("Changelog", "/changelog.html")],
        toc=[("sources", "Where it lives"), ("current", "Current release")],
        article=art,
        related=[("/roadmap.html", "Roadmap", "What is next."),
                 ("/roadmap/index.html", "Per-cycle roadmap", "Cycle detail."),
                 ("https://github.com/ohgeeceee/beemuu/releases", "Releases", "Download.")],
        cta_h="Grab the latest build.",
        cta_p="BeeEmUu is free and open-source — download it and go.",
    )


GUIDES = {
    "bmw-k-dcan-diagnostics.html": dict(
        title="BMW K+DCAN diagnostics — E-series guide",
        eyebrow="Diagnostics guide",
        h1="BMW K+DCAN diagnostics.",
        lede="How BeeEmUu talks to E-series BMWs over the K+DCAN serial interface.",
        desc="How BMW K+DCAN diagnostics work, which E-series cars use it, and "
             "how BeeEmUu reads fault memory and live data over the cable.",
        sections=[
            ("what", "What K+DCAN is",
             "<p>K+DCAN is the serial diagnostic interface used on BMW "
             "E-series cars (roughly 2004&ndash;2013). One USB cable exposes two "
             "channels: K-line and DCAN, and the modules answer KWP2000 and "
             "UDS requests.</p>"
             "<p>The full pinout, baud rates and per-module behaviour are on "
             "the <a href=\"/hardware.html\">hardware guide</a>.</p>"),
            ("cars", "Which cars use it",
             "<ul><li>E87 / E90 / E91 / E92 / E93 (1 and 3 Series)</li>"
             "<li>E60 / E61 (5 Series)</li><li>E70 / E71 (X5 / X6)</li>"
             "<li>E89 (Z4)</li></ul>"
             "<p>F- and G-series cars use <a href=\"/bmw-enet-doip-diagnostics.html\">"
             "ENET/DoIP</a> instead.</p>"),
            ("scan", "What you can read",
             "<p>Fault memory, freeze frames, service (CBS) data and live "
             "parameters across engine, transmission, chassis and body "
             "modules. See the <a href=\"/engines.html\">engine profiles</a> "
             "for the parameters BeeEmUu polls.</p>"),
        ],
        related=[("/hardware.html", "Hardware guide", "Cables and pinouts."),
                 ("/bmw-enet-doip-diagnostics.html", "ENET / DoIP", "F- and G-series."),
                 ("/engines.html", "Engine profiles", "Live data per engine.")],
    ),
    "bmw-enet-doip-diagnostics.html": dict(
        title="BMW ENET / DoIP diagnostics — F- and G-series guide",
        eyebrow="Diagnostics guide",
        h1="BMW ENET / DoIP diagnostics.",
        lede="How BeeEmUu talks to F- and G-series BMWs over ENET (DoIP over Ethernet).",
        desc="How BMW ENET / DoIP diagnostics work, which F- and G-series cars "
             "use it, and how BeeEmUu reads fault memory and live data over Ethernet.",
        sections=[
            ("what", "What ENET / DoIP is",
             "<p>ENET is BMW's Ethernet diagnostic interface. The modules "
             "speak DoIP (Diagnostics over IP), the same UDS services wrapped "
             "in an IP transport instead of a serial line.</p>"
             "<p>Vehicle discovery, addressing and the DME pinout are on the "
             "<a href=\"/protocols.html\">protocols guide</a>.</p>"),
            ("cars", "Which cars use it",
             "<ul><li>F20 / F30 / F31 (1 and 3 Series)</li>"
             "<li>F10 (5 Series)</li><li>F15 / F16 (X5 / X6)</li>"
             "<li>G20 / G30 and later</li></ul>"
             "<p>Older E-series cars use <a href=\"/bmw-k-dcan-diagnostics.html\">"
             "K+DCAN</a>.</p>"),
            ("scan", "What you can read",
             "<p>The same fault memory and live-data surface as K+DCAN, over a "
             "faster link. See the <a href=\"/engines.html\">engine profiles</a> "
             "and the <a href=\"/dtc/\">fault-code index</a>.</p>"),
        ],
        related=[("/protocols.html", "Protocols guide", "DoIP and UDS."),
                 ("/bmw-k-dcan-diagnostics.html", "K+DCAN", "E-series."),
                 ("/dtc/", "Fault codes", "The code index.")],
    ),
    "bmw-fault-codes.html": dict(
        title="BMW fault codes — how to read them",
        eyebrow="Diagnostics guide",
        h1="Reading BMW fault codes.",
        lede="What a BMW diagnostic trouble code is, and how to resolve one.",
        desc="How to read BMW fault codes: the hex vs SAE formats, what "
             "severity means, and where to look up any code.",
        sections=[
            ("formats", "Two code formats",
             "<p>BMW reports generic SAE J2012 codes (P/B/C/U) and its own "
             "4- and 6-hex manufacturer codes. Both describe the same faults; "
             "the hex codes carry BMW-specific detail.</p>"),
            ("severity", "Severity, not just text",
             "<p>BeeEmUu tags every code advisory, service-soon or stop. A "
             "misfire code is not the same urgency as a headlight washer "
             "relay.</p>"),
            ("lookup", "Look one up",
             "<p>Use the <a href=\"/tools/dtc-decoder.html\">DTC decoder</a> "
             "for a single code, the "
             "<a href=\"/tools/known-codes.html\">known-codes browser</a> to "
             "search the catalogue, or the <a href=\"/dtc/\">featured index</a> "
             "for full write-ups.</p>"),
        ],
        related=[("/dtc/", "Fault-code index", "Featured write-ups."),
                 ("/tools/dtc-decoder.html", "DTC decoder", "Resolve one code."),
                 ("/tools/known-codes.html", "Known codes", "Search the catalogue.")],
    ),
    "bmw-vin-decoding.html": dict(
        title="BMW VIN decoding — what the 17 characters mean",
        eyebrow="Diagnostics guide",
        h1="BMW VIN decoding.",
        lede="The 17-character VIN, what each position encodes, and what it does not tell you.",
        desc="How to decode a BMW VIN: the WMI, model and check-digit "
             "positions, and what a VIN does not reveal.",
        sections=[
            ("structure", "The structure",
             "<p>A VIN is 17 characters. The first three are the World "
             "Manufacturer Identifier; BMW's WBA/WBS/WBX prefixes identify a "
             "BMW passenger car. Position 10 is the model year, position 11 the "
             "plant.</p>"),
            ("limits", "What it does not say",
             "<p>The VIN identifies the chassis and build, not the fitted "
             "options or the current fault state. Options and software level "
             "come from the modules themselves — read them over "
             "<a href=\"/bmw-k-dcan-diagnostics.html\">K+DCAN</a> or "
             "<a href=\"/bmw-enet-doip-diagnostics.html\">ENET</a>.</p>"),
            ("more", "Read the modules",
             "<p>BeeEmUu reads vehicle identity and module data directly; see "
             "the <a href=\"/protocols.html\">protocols guide</a> for how the "
             "identity requests are framed.</p>"),
        ],
        related=[("/protocols.html", "Protocols guide", "How identity is read."),
                 ("/oem.html", "OEM parts", "Part-number lookup."),
                 ("/glossary.html", "Glossary", "The jargon.")],
    ),
}


def build_guide(slug: str, cfg: dict) -> str:
    url = f"/{slug}"
    art = []
    toc = []
    for sid, heading, body in cfg["sections"]:
        toc.append((sid, heading))
        art.append(f'<h2 id="{sid}">{esc(heading)}</h2>{body}')
    return page(
        url=url, title=cfg["title"], desc=cfg["desc"],
        eyebrow=cfg["eyebrow"], h1=cfg["h1"], lede=cfg["lede"],
        meta=["Guide", "Updated October 2026", "GPL-3.0"],
        crumbs=[("Beemuu", "/"), (cfg["h1"], url)],
        toc=toc, article="".join(art), related=cfg["related"],
        cta_h="Read the data, not the guess.",
        cta_p="BeeEmUu reads your BMW's modules directly — free and offline.",
    )


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main() -> None:
    featured, catalog = build_dtc_index()

    # DTC pages
    cross = load_cross_links()
    for code in featured:
        write(f"dtc/{code}.html", build_dtc_page(code, catalog[code], cross))
    write("dtc/index.html", build_dtc_index_page(featured, catalog))

    # by-engine DTC pages
    by_engine = {
        "n54": ["29E0", "29E1", "29E2", "2A82", "2A99", "30FF"],
        "b58": ["120308", "29E0", "29E1", "2A82"],
    }
    for engine, codes in by_engine.items():
        write(f"dtc/by-engine/{engine}.html",
              build_by_engine_page(engine, codes, catalog))

    # engine pages
    profiles = load_profiles()
    for prof in profiles:
        write(f"engines/{prof['id']}.html", build_engine_page(prof))
    write("engines.html", build_engines_index(profiles))
    write("engines/compare.html", build_engine_compare(profiles))

    # hub pages
    write("roadmap.html", build_roadmap_hub())
    write("changelog.html", build_changelog_hub())
    # dashboard.html is authored by hand (frontend/dashboard.html; PR #362
    # "site live dashboard board"). It is a live board that reads the public
    # GitHub API at runtime, so the generator must NOT emit it — a regen would
    # clobber the board. frontend/version_surface.test.js pins its version chip.

    # guide pages
    for slug, cfg in GUIDES.items():
        write(slug, build_guide(slug, cfg))

    print(f"\nGenerated {len(featured)} DTC pages, {len(profiles)} engine pages, "
          f"2 by-engine pages, 3 hub pages, {len(GUIDES)} guides.")


if __name__ == "__main__":
    main()
