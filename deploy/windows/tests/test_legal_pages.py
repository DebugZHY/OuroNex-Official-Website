"""Regression tests for the Terms of Service and Privacy Policy pages."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX = REPO_ROOT / "index.html"
TERMS = REPO_ROOT / "terms.html"
PRIVACY = REPO_ROOT / "privacy.html"
LEGAL_CSS = REPO_ROOT / "assets" / "legal.css"

CASE = {
    TERMS: ("Terms of Service", "terms.html", "privacy.html", 21),
    PRIVACY: ("Privacy Policy", "privacy.html", "terms.html", 17),
}


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def footer_of(markup: str) -> str:
    match = re.search(r'<footer class="site-footer">.*?</footer>', markup, re.S)
    if match is None:
        raise AssertionError("no <footer class=\"site-footer\"> block")
    return match.group(0)


class LegalPageTests(unittest.TestCase):
    def test_both_pages_exist_and_are_wired(self):
        for path, (title, _self, _other, _sections) in CASE.items():
            with self.subTest(page=path.name):
                self.assertTrue(path.exists(), path)
                markup = read(path)
                self.assertGreater(len(markup), 30_000)
                self.assertIn(f"<title>{title} — OuroNex</title>", markup)
                self.assertIn(f'href="https://ouronex.com/{path.name}" rel="canonical"', markup)
                self.assertIn('class="legal-page"', markup)
                self.assertIn('href="/assets/legal.css"', markup)
                self.assertIn('href="/assets/site.css"', markup)
                self.assertIn('href="/assets/home.css"', markup)
                self.assertIn(f'data-i18n-page="{path.stem}"', markup)
                self.assertIn(f'/assets/i18n/{path.stem}.js', markup)

    def test_each_page_has_one_h1_and_the_expected_section_count(self):
        for path, (_title, _self, _other, expected) in CASE.items():
            with self.subTest(page=path.name):
                markup = read(path)
                self.assertEqual(markup.count("<h1>"), 1)
                self.assertEqual(markup.count('<section id="'), expected)
                self.assertEqual(markup.count("<h2 "), expected)
                self.assertEqual(markup.count("<h2>"), 0)

    def test_table_of_contents_matches_heading_ids(self):
        for path, (_title, _self, _other, expected) in CASE.items():
            with self.subTest(page=path.name):
                markup = read(path)
                aside_match = re.search(r'<aside class="legal-sidebar".*?</aside>', markup, re.S)
                assert aside_match is not None
                aside = aside_match.group(0)
                hrefs = re.findall(r'href="#([^"]+)"', aside)
                self.assertEqual(len(hrefs), expected)
                self.assertEqual(len(set(hrefs)), expected)
                ids = re.findall(r'<h2 id="([^"]+)"', markup)
                self.assertEqual(ids, hrefs)
                all_ids = re.findall(r'\sid="([^"]+)"', markup)
                self.assertEqual(len(all_ids), len(set(all_ids)), "ids must be unique")
                for anchor in hrefs:
                    self.assertIn(f'id="{anchor}"', markup)

    def test_header_meta_and_updated_date(self):
        for path, (title, _self, _other, _sections) in CASE.items():
            with self.subTest(page=path.name):
                markup = read(path)
                self.assertIn(f"<h1>{title}</h1>", markup)
                self.assertIn("OuroNex Technology Company Limited", markup)
                self.assertIn('datetime="2026-11-02"', markup)
                self.assertIn("2 November 2026", markup)
                self.assertIn('class="legal-intro"', markup)
                self.assertIn('class="legal-toc-mobile"', markup)
                self.assertIn('class="reading-progress"', markup)

    def test_navigation_and_shared_home_footer(self):
        home_footer = footer_of(read(INDEX))

        for path, (title, self_href, other_href, _sections) in CASE.items():
            with self.subTest(page=path.name):
                markup = read(path)
                self.assertIn('href="/index.html"', markup, "the page links back to Home")
                footer = footer_of(markup)
                for section in ("home", "sida", "application", "price", "business", "about"):
                    self.assertIn(
                        f'href="index.html#{section}"',
                        footer,
                        f"the shared footer keeps the #{section} anchor",
                    )
                self.assertEqual(
                    footer,
                    home_footer,
                    "the legal pages must reuse the root-level footer block verbatim",
                )
                self.assertIn('class="footer-nav"', footer)
                links = re.findall(r'<a href="([^"]+)"([^>]*)><span data-i18n="([^"]+)"', footer)
                self.assertEqual(
                    len(links), 8, "six section anchors plus the two legal links"
                )
                self.assertEqual(
                    len(re.findall(r'<span data-i18n="[^"]+">', footer)),
                    8,
                    "six footer nav labels plus the two legal labels",
                )
                self.assertEqual(
                    footer.count("data-nav-placeholder"),
                    0,
                    "no footer entry stays inert",
                )
                self.assertIn((self_href, "", "shared.terms-of-service.3f9c1a" if title == "Terms of Service"
                               else "shared.privacy-policy.6b2d4e"), links)
                self.assertIn((other_href, "", "shared.privacy-policy.6b2d4e" if title == "Terms of Service"
                               else "shared.terms-of-service.3f9c1a"), links)
                self.assertIn('class="footer-legal"', footer)
                self.assertIn("Copyright © 2026 OuroNex Technology Company Limited", footer)

    def test_terms_keep_the_engineering_and_liability_guardrails(self):
        text = read(TERMS)
        for phrase in (
            "professional engineering",
            "not professional engineering advice",
            "Hong Kong Special Administrative Region",
            "Limitation of Liability",
            "Confidential Information",
            "AI-Assisted Outputs",
            "SIDA (Super-Intelligent Design &amp; Analysis)",
        ):
            self.assertIn(phrase, text)
        self.assertIn("Sections 5.2, 6.5, 9, 10, 11, 12, 15, 16, 17, 19, 20, and 21", text)

    def test_privacy_keeps_local_first_and_pdpo_rights(self):
        text = read(PRIVACY)
        for phrase in (
            "not uploaded to our servers by default",
            "Personal Data (Privacy) Ordinance",
            "Privacy Commissioner for Personal Data, Hong Kong",
            "We do not sell, rent, trade",
            "Your rights",
            "Service providers",
            "International transfers",
        ):
            self.assertIn(phrase, text)
        self.assertIn("project data", text)
        self.assertIn("Section 12", text)

    def test_no_sample_company_or_product_names_leak(self):
        forbidden = ("kimi", "minimax", "moonshot", "nanonoble", "beijing", "singapore")
        for path in (TERMS, PRIVACY):
            text = read(path).lower()
            for name in forbidden:
                self.assertNotIn(name, text, f"{path.name} contains {name}")

    def test_legal_stylesheet_has_desktop_and_mobile_layouts(self):
        css = read(LEGAL_CSS)
        self.assertIn("grid-template-columns: 300px minmax(0, 860px)", css)
        self.assertIn(".legal-toc-mobile", css)
        self.assertIn("@media (max-width: 1120px)", css)
        self.assertIn("@media (max-width: 760px)", css)
        self.assertIn("scroll-margin-top", css)
        self.assertIn("position: sticky", css)


if __name__ == "__main__":
    unittest.main(verbosity=2)
