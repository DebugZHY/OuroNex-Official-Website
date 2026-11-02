"""The authenticated /pricing/ page is retired.

Pins the removal: no pricing route, view, template or page dictionary; the three
paid Home Price cards and the Enterprise card all use the existing native
``Available soon`` path (no anchor, no /pricing/ or /checkout/ destination); the
Profile plan action points at the Home price section; and the package manifest no
longer ships the retired page dictionary while still describing index.html
exactly.

Only real product files are read: no browser, no server, no Django needed.
"""

from __future__ import annotations

import hashlib
import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_HTML = REPO_ROOT / "index.html"
PROFILE_HTML = REPO_ROOT / "backend" / "templates" / "accounts" / "profile.html"
URLS_PY = REPO_ROOT / "backend" / "accounts" / "urls.py"
VIEWS_PY = REPO_ROOT / "backend" / "accounts" / "views.py"
PRICING_TEMPLATE = REPO_ROOT / "backend" / "templates" / "accounts" / "pricing.html"
PRICING_JS = REPO_ROOT / "assets" / "i18n" / "account-pricing.js"
PRICING_JSON = REPO_ROOT / "assets" / "i18n" / "account-pricing.json"
MANIFEST = REPO_ROOT / "package-manifest.json"
DEPLOYMENT_TESTS = REPO_ROOT / "backend" / "accounts" / "tests_deployment.py"
ACCOUNT_TESTS = REPO_ROOT / "backend" / "accounts" / "tests.py"
FONT_TESTS = REPO_ROOT / "deploy" / "windows" / "tests" / "test_account_font_stability.py"

SUBSCRIBE_LABEL = 'data-i18n="home.subscribe-now">Subscribe Now<'
CONTACT_LABEL = 'data-i18n="home.contact-sales">Contact Sales<'


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def strip_block() -> str:
    markup = read(INDEX_HTML)
    match = re.search(
        r'<div class="plan-strip">(.*?)</div>\s*<div aria-label="Plan feature comparison"',
        markup,
        re.S,
    )
    if not match:
        raise AssertionError("pricing card strip not found")
    return match.group(1)


def cards() -> list:
    return re.findall(r"<article\b[^>]*>(.*?)</article>", strip_block(), re.S)


def action(card: str) -> str:
    match = re.search(
        r"<(?:a|button)\b[^>]*class=\"[^\"]*plan-action[^\"]*\"[^>]*>", card
    )
    if not match:
        raise AssertionError(f"no plan action in card: {card[:80]}")
    return match.group(0)


class RetiredPricingPageTests(unittest.TestCase):
    def test_page_template_and_dictionary_are_deleted(self):
        for path in (PRICING_TEMPLATE, PRICING_JS, PRICING_JSON):
            with self.subTest(path=path.name):
                self.assertFalse(path.exists(), f"{path.name} must be deleted")

    def test_no_pricing_route_or_view(self):
        urls = read(URLS_PY)
        self.assertNotIn("pricing/", urls)
        self.assertNotIn("pricing_view", urls)
        views = read(VIEWS_PY)
        self.assertNotIn("def pricing_view", views)
        self.assertNotIn("accounts/pricing.html", views)

    def test_no_account_pricing_references_survive(self):
        scanned = list((REPO_ROOT / "backend").rglob("*.py")) + list(
            (REPO_ROOT / "backend").rglob("*.html")
        ) + list((REPO_ROOT / "assets" / "i18n").glob("*.js")) + list(
            (REPO_ROOT / "assets" / "i18n").glob("*.json")
        ) + [INDEX_HTML]
        offenders = []
        for path in scanned:
            if "__pycache__" in path.parts:
                continue
            text = read(path)
            if "account-pricing" in text or "accounts/pricing.html" in text:
                offenders.append(str(path.relative_to(REPO_ROOT)))
        self.assertEqual(offenders, [], f"retired page still referenced: {offenders}")

    def test_home_and_profile_have_no_pricing_destination(self):
        self.assertNotIn("pricing", read(INDEX_HTML).lower())
        profile = read(PROFILE_HTML)
        self.assertNotIn("/pricing/", profile)
        self.assertIn('href="/index.html#price"', action(profile))


class HomePriceActionTests(unittest.TestCase):
    def test_four_cards_and_native_alert_actions(self):
        found = cards()
        self.assertEqual(len(found), 4, "Lite, Standard, Professional, Enterprise")
        for card in found:
            with self.subTest(card=card[:60]):
                tag = action(card)
                self.assertTrue(tag.startswith("<button"), f"must be a button: {tag}")
                self.assertIn("data-available-soon", tag)
                self.assertIn('type="button"', tag)
                self.assertNotIn("href", tag)

    def test_paid_cards_keep_their_classes_and_labels(self):
        found = cards()
        for card in found[:3]:
            tag = action(card)
            self.assertEqual(tag, '<button class="button plan-action" data-available-soon="" type="button">')
            self.assertIn(SUBSCRIBE_LABEL, card)
        enterprise = found[3]
        self.assertIn('class="button-outline plan-action"', action(enterprise))
        self.assertIn(CONTACT_LABEL, enterprise)

    def test_strip_contains_no_links_at_all(self):
        block = strip_block()
        self.assertNotIn("<a ", block)
        for forbidden in ('/pricing/', '/checkout/', "pricing"):
            self.assertNotIn(forbidden, block.lower())


class UpdatedTestCoverageTests(unittest.TestCase):
    def test_backend_tests_stop_expecting_the_template(self):
        deployment = read(DEPLOYMENT_TESTS)
        self.assertNotIn("AccountPricingContactControlTests", deployment)
        self.assertNotIn("account-pricing.contact-sales", deployment)
        self.assertIn("RetainedContactControlTests", deployment, "public contact tests must stay")
        account = read(ACCOUNT_TESTS)
        self.assertNotIn("        '/pricing/',\n", account, "PAGES must not render /pricing/")
        marker = "def test_retired_pricing_page_returns_404(self):"
        self.assertIn(marker, account, "an authenticated 404 assertion is required")
        method = account.split(marker, 1)[1].split("\n    def ", 1)[0]
        self.assertIn("status_code, 404", method)
        self.assertIn("'/pricing/'", method)

    def test_font_stability_covers_three_templates(self):
        source = read(FONT_TESTS)
        self.assertNotIn("pricing.html", source)
        for page in ("profile.html", "security.html", "token_usage.html"):
            self.assertIn(page, source)


class ManifestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = json.loads(read(MANIFEST))
        cls.paths = {entry["path"]: entry for entry in cls.manifest["files"]}

    def test_retired_dictionary_is_not_packaged(self):
        self.assertEqual([path for path in self.paths if "account-pricing" in path], [])

    def test_index_entry_matches_the_current_bytes(self):
        entry = self.paths["index.html"]
        payload = INDEX_HTML.read_bytes()
        self.assertEqual(entry["bytes"], len(payload))
        self.assertEqual(entry["sha256"], hashlib.sha256(payload).hexdigest())
        if "size" in entry:
            self.assertEqual(entry["size"], len(payload))

    def test_public_pricing_marketing_dictionary_is_untouched(self):
        self.assertIn("assets/i18n/pricing.js", self.paths)


if __name__ == "__main__":
    unittest.main(verbosity=2)
