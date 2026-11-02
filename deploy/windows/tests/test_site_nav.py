"""Whole-site header navigation contract: SIDA is retired, Features is promoted.

The public header keeps one canonical order on every page::

    Home, Features, Application, Price, Business, About

* the three root pages that ship the Home header (``index.html``,
  ``terms.html``, ``privacy.html``) carry all six entries, with ``Application``
  as the only inert placeholder;
* the stand-alone pages (``404.html``, ``arena.html`` and every ``news/*.html``)
  carry five entries - no placeholders at all;
* ``Features`` always points at the SIDA section (``#sida`` on the Home page,
  the same page's ``#home`` prefix plus ``#sida`` everywhere else) and is never
  inert again: no ``aria-disabled``, no ``data-nav-placeholder`` and no
  ``nav-placeholder`` class;
* no page may reference the retired ``shared.sida`` translation key.

The footer navigation and the shared footer type scale live in
``test_site_footer.py``; the Django login/register header is pinned in
``backend/accounts/tests.py``.

Source inspection only: no browser, no server, no network.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
TEMPLATES = REPO_ROOT / "backend" / "templates"

ROOT_PAGES = ("index.html", "terms.html", "privacy.html", "404.html", "arena.html")
NEWS_PAGES = tuple(
    sorted(f"news/{page.name}" for page in (REPO_ROOT / "news").glob("*.html"))
)
ALL_PAGES = ROOT_PAGES + NEWS_PAGES

# Six links: five Home sections plus the inert Application entry.
SIX_LINK_PAGES = ("index.html", "terms.html", "privacy.html")
# Five links: no placeholders on the stand-alone pages.
FIVE_LINK_PAGES = ("404.html", "arena.html") + NEWS_PAGES

# label -> Home section fragment (None for the inert placeholder)
HEADER_NAV = (
    ("Home", "home"),
    ("Features", "sida"),
    ("Application", None),
    ("Price", "price"),
    ("Business", "business"),
    ("About", "about"),
)

RETIRED_KEY = "shared.sida"
PLACEHOLDER_FLAGS = ("aria-disabled", "data-nav-placeholder", "nav-placeholder")

ANCHOR_RE = re.compile(
    r'<a(?P<attrs>[^>]*)><span data-i18n="(?P<key>[^"]+)">(?P<label>[^<]+)</span></a>'
)
HREF_RE = re.compile(r'\bhref="([^"]*)"')
PRIMARY_RE = re.compile(r'<div class="nav-primary">(.*?)</div>', re.S)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def primary_block(markup: str) -> str:
    match = PRIMARY_RE.search(markup)
    if match is None:
        raise AssertionError("the page has no .nav-primary navigation block")
    return match.group(1)


def nav_items(markup: str) -> list:
    """(label, href or None, i18n key, raw attributes) for every header entry."""
    items = []
    for match in ANCHOR_RE.finditer(primary_block(markup)):
        href = HREF_RE.search(match.group("attrs"))
        items.append(
            (
                match.group("label").strip(),
                href.group(1) if href else None,
                match.group("key"),
                match.group("attrs"),
            )
        )
    return items


class HeaderNavigationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.markup = {relative: read(REPO_ROOT / relative) for relative in ALL_PAGES}

    def test_every_public_page_is_walked(self) -> None:
        self.assertEqual(list(self.markup), list(ALL_PAGES))
        self.assertGreaterEqual(len(self.markup), 13)

    def test_six_link_pages_hold_the_public_order(self) -> None:
        for relative in SIX_LINK_PAGES:
            with self.subTest(page=relative):
                items = nav_items(self.markup[relative])
                self.assertEqual(
                    [label for label, _href, _key, _attrs in items],
                    [label for label, _section in HEADER_NAV],
                    "Home, Features, Application, Price, Business, About",
                )
                home_href = items[0][1]
                self.assertIsNotNone(home_href, "Home must link to its section")
                self.assertTrue(home_href.endswith("#home"), home_href)
                prefix = home_href[: -len("#home")]
                expected = [
                    (label, None if section is None else prefix + "#" + section)
                    for label, section in HEADER_NAV
                ]
                self.assertEqual(
                    [(label, href) for label, href, _key, _attrs in items],
                    expected,
                )

    def test_five_link_pages_hold_the_public_order_without_placeholders(self) -> None:
        for relative in FIVE_LINK_PAGES:
            with self.subTest(page=relative):
                block = primary_block(self.markup[relative])
                items = nav_items(self.markup[relative])
                self.assertEqual(
                    [label for label, _href, _key, _attrs in items],
                    ["Home", "Features", "Price", "Business", "About"],
                    "the stand-alone pages drop the inert Application entry",
                )
                for label, href, _key, attrs in items:
                    self.assertIsNotNone(href, f"{relative}: {label} must link somewhere")
                    for flag in PLACEHOLDER_FLAGS:
                        self.assertNotIn(
                            flag,
                            attrs,
                            f"{relative}: {label} must not be inert",
                        )
                for flag in ("aria-disabled", "data-nav-placeholder"):
                    self.assertNotIn(flag, block, f"{relative}: header has no placeholders")
                self.assertNotIn(">Application<", block, f"{relative}: Application is gone")

    def test_features_links_to_the_sida_section_and_is_never_inert(self) -> None:
        for relative in ALL_PAGES:
            with self.subTest(page=relative):
                items = nav_items(self.markup[relative])
                features = [item for item in items if item[0] == "Features"]
                self.assertEqual(len(features), 1, "Features must be one header entry")
                label, href, key, attrs = features[0]
                self.assertEqual(key, "shared.features")
                self.assertIsNotNone(href, f"{relative}: Features must not stay inert")
                self.assertTrue(
                    href.endswith("#sida"),
                    f"{relative}: Features must open the SIDA section, found {href}",
                )
                for flag in PLACEHOLDER_FLAGS:
                    self.assertNotIn(
                        flag,
                        attrs,
                        f"{relative}: Features must not carry {flag}",
                    )

    def test_sida_is_not_a_nav_entry_any_more(self) -> None:
        for relative in ALL_PAGES:
            with self.subTest(page=relative):
                labels = [item[0] for item in nav_items(self.markup[relative])]
                self.assertNotIn("SIDA", labels)
                self.assertNotIn(RETIRED_KEY, self.markup[relative])

    def test_no_page_references_the_retired_shared_key(self) -> None:
        pages = list(ALL_PAGES) + sorted(
            str(path.relative_to(REPO_ROOT)).replace("\\", "/")
            for path in TEMPLATES.rglob("*.html")
        )
        for relative in pages:
            with self.subTest(page=relative):
                self.assertNotIn(
                    RETIRED_KEY,
                    read(REPO_ROOT / relative),
                    f"{relative} still references {RETIRED_KEY}",
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
