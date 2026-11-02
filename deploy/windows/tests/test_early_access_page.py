"""Contract tests for the early-access request page and the hero link into it."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX = REPO_ROOT / "index.html"
PAGE = REPO_ROOT / "early-access.html"
CSS = REPO_ROOT / "assets" / "early-access.css"
SCRIPT = REPO_ROOT / "assets" / "early-access.js"
MANIFEST = REPO_ROOT / "package-manifest.json"
PRIVACY = REPO_ROOT / "privacy.html"

REQUIRED = ("name", "organisation", "email")
OPTIONAL = ("phone", "role", "team", "notes")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def block(markup: str, tag: str, class_name: str) -> str:
    match = re.search(rf'<{tag} class="{class_name}">.*?</{tag}>', markup, re.S)
    if match is None:
        raise AssertionError(f"no <{tag} class=\"{class_name}\"> block")
    return match.group(0)


class EarlyAccessPageTests(unittest.TestCase):
    def test_page_exists_and_is_wired(self):
        self.assertTrue(PAGE.exists(), PAGE)
        markup = read(PAGE)
        self.assertIn("<title>Request early access — OuroNex</title>", markup)
        self.assertIn('href="https://ouronex.com/early-access.html" rel="canonical"', markup)
        self.assertIn('class="access-page"', markup)
        self.assertIn('data-i18n-page="early-access"', markup)
        for sheet in ("site.css", "home.css", "i18n.css", "early-access.css"):
            self.assertIn(f'href="/assets/{sheet}"', markup, sheet)
        for script in ("i18n/shared.js", "i18n/early-access.js", "i18n.js", "site.js", "early-access.js"):
            self.assertIn(f'src="/assets/{script}"', markup, script)

    def test_page_has_one_heading_and_the_shared_chrome(self):
        markup = read(PAGE)
        self.assertEqual(markup.count("<h1>"), 1)
        legal = read(PRIVACY)
        self.assertEqual(block(markup, "header", "site-header"),
                         block(legal, "header", "site-header"),
                         "the header must be the shared site header")
        self.assertEqual(block(markup, "footer", "site-footer"),
                         block(legal, "footer", "site-footer"),
                         "the footer must be the shared site footer")

    def test_form_carries_the_four_customer_fields(self):
        markup = read(PAGE)
        names = re.findall(r'<(?:input|select|textarea)[^>]*\bname="([a-z]+)"', markup)
        self.assertEqual(names, list(REQUIRED) + list(OPTIONAL))

        required = re.findall(r'<input[^>]*\bname="([a-z]+)"[^>]*\brequired=""', markup)
        self.assertEqual(sorted(required), sorted(REQUIRED),
                         "only name, organisation and email are required")
        for field in OPTIONAL:
            with self.subTest(field=field):
                self.assertNotIn(f'name="{field}" required', markup)

        email = re.search(r'<input[^>]*name="email"[^>]*>', markup).group(0)
        self.assertIn('type="email"', email)
        self.assertIn('autocomplete="email"', email)
        self.assertIn('aria-required="true"', email)
        phone = re.search(r'<input[^>]*name="phone"[^>]*>', markup).group(0)
        self.assertIn('type="tel"', phone)
        self.assertIn('autocomplete="tel"', phone)

    def test_every_control_has_a_bound_label_and_an_error_slot(self):
        markup = read(PAGE)
        for field in REQUIRED + OPTIONAL:
            with self.subTest(field=field):
                control = re.search(rf'<(?:input|select|textarea)[^>]*id="access-{field}"', markup)
                self.assertIsNotNone(control, f"no control for {field}")
        for label_for in re.findall(r'<label for="([^"]+)"', markup):
            self.assertRegex(markup, rf'id="{label_for}"', f"label {label_for} has no control")
        for field in REQUIRED + ("phone",):
            self.assertIn(f'id="access-{field}-error"', markup)

    def test_validation_is_client_side_only(self):
        script = read(SCRIPT)
        self.assertIn("novalidate", read(PAGE))
        for rule in ("name:", "organisation:", "email:", "phone:"):
            self.assertIn(rule, script, rule)
        self.assertIn("e.preventDefault()", script.replace("event.preventDefault()", "e.preventDefault()"))
        self.assertNotIn("fetch(", script)
        self.assertNotIn("XMLHttpRequest", script)
        self.assertNotIn("navigator.sendBeacon", script)
        self.assertIn('role="status"', read(PAGE))
        self.assertIn("data-access-done", script)

    def test_hero_cta_opens_the_page_in_a_new_tab(self):
        markup = read(INDEX)
        anchor = re.search(r'<a[^>]*class="button-outline early-access"[^>]*>.*?</a>', markup, re.S)
        self.assertIsNotNone(anchor, "the hero CTA must be a link")
        tag = anchor.group(0)
        self.assertIn('href="/early-access.html"', tag)
        self.assertIn('target="_blank"', tag)
        self.assertIn('rel="noopener"', tag)
        self.assertNotIn("data-coming-soon", tag)
        hero = re.search(r'<div class="hero-actions">.*?</div>', markup, re.S).group(0)
        self.assertNotIn("<button", hero, "the hero CTA row may only hold links")

    def test_styles_hold_the_form_layout(self):
        css = read(CSS)
        self.assertIn(".access-form {", css)
        self.assertIn("grid-template-columns: repeat(2, minmax(0, 1fr));", css)
        self.assertIn("min-height: 52px;", css)
        self.assertIn("border-radius: 999px;", css)
        self.assertIn("box-shadow: 0 0 0 3px rgba(114, 158, 255, .18);", css)
        self.assertIn("@media (max-width: 1080px)", css)
        self.assertIn("@media (max-width: 720px)", css)
        self.assertIn("@media (prefers-reduced-motion: reduce)", css)

    def test_new_files_are_in_the_public_manifest(self):
        entries = {entry["path"] for entry in json.loads(read(MANIFEST))["files"]}
        for path in ("early-access.html", "assets/early-access.css",
                     "assets/early-access.js", "assets/i18n/early-access.js"):
            self.assertIn(path, entries, path)


if __name__ == "__main__":
    unittest.main()
