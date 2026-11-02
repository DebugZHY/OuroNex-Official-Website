"""Home pricing card and comparison-table content regression tests.

Scope: the current Price layout — four cards (Lite, Standard, Professional,
Enterprise), no billing period lines, and the retuned comparison table with
uppercase row labels, four added capability rows, one Enterprise-only custom
models row, one priority-support row and a trailing custom integration row.
Removed rows stay removed. Copy is pinned verbatim in the index and in all three
dictionary languages.

Everything is source inspection of the real index and dictionaries: no browser,
no server, no network.
"""

from __future__ import annotations

import html
import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_HTML = REPO_ROOT / "index.html"
HOME_JSON = REPO_ROOT / "assets" / "i18n" / "home.json"
HOME_JS = REPO_ROOT / "assets" / "i18n" / "home.js"

CARD_TEXTS = (
    "Lite Efficient trial HK$ 49 / month Subscribe Now",
    "Standard Standard choice HK$ 119 / month Subscribe Now",
    "Professional Premium mode HK$ 469 / month Subscribe Now",
    "Enterprise Empowerment as you wish Custom Contact Sales",
)

PRICE_COLUMNS = ("Free", "Lite", "Standard", "Professional", "Enterprise")

# Row label, then the five plan cells in PRICE_COLUMNS order.
TABLE_ROWS = (
    ("MONTHLY TOKENS", ("10M (The 1st month only)", "300M", "850M", "3B", "Custom")),
    ("STANDARD MODELS", ("\u2713", "\u2713", "\u2713", "\u2713", "\u2713")),
    ("CUSTOM MODELS", ("\u2014", "\u2014", "\u2014", "\u2014", "\u2713")),
    ("FREE DOCUMENTATION", ("\u2713", "\u2713", "\u2713", "\u2713", "\u2713")),
    ("DATA MANAGEMENT", ("\u2713", "\u2713", "\u2713", "\u2713", "\u2713")),
    ("BUILT-IN TOOLS", ("\u2713", "\u2713", "\u2713", "\u2713", "\u2713")),
    ("COMPUTER USE", ("\u2713", "\u2713", "\u2713", "\u2713", "\u2713")),
    ("PRIORITY SUPPORT", ("\u2014", "\u2713", "\u2713", "\u2713", "Dedicated")),
    ("CUSTOM INTEGRATION", ("\u2014", "\u2014", "\u2014", "\u2014", "\u2713")),
)

ALL_CHECKS = ("\u2713", "\u2713", "\u2713", "\u2713", "\u2713")

# The four capability rows that every plan now includes.
CAPABILITY_ROWS = (
    "FREE DOCUMENTATION",
    "DATA MANAGEMENT",
    "BUILT-IN TOOLS",
    "COMPUTER USE",
)

DELETED_ROWS = (
    "24/7 priority support",
    "API access",
    "Web search",
    "Early access",
    "Community support",
    "SLA guarantee",
    "On-premise option",
)

DELETED_KEYS = (
    "home.table-community",
    "home.table-sla",
    "home.table-onprem",
)

# Row keys retired earlier that are no longer rendered (the unused dictionary
# entries are out of this contract's scope).
UNRENDERED_KEYS = (
    "home.table-247",
    "home.table-api",
    "home.table-search",
    "home.table-early",
)

# Rows whose labels were rewritten to the uppercase English table style.
RELABELLED_ROWS = (
    ("home.table-tokens", "MONTHLY TOKENS"),
    ("home.table-basic-models", "STANDARD MODELS"),
    ("home.table-video-models", "CUSTOM MODELS"),
    ("home.table-priority", "PRIORITY SUPPORT"),
    ("home.table-integration", "CUSTOM INTEGRATION"),
)

NEW_CAPABILITY_KEYS = (
    ("home.table-free-documentation", "FREE DOCUMENTATION"),
    ("home.table-data-management", "DATA MANAGEMENT"),
    ("home.table-built-in-tools", "BUILT-IN TOOLS"),
    ("home.table-computer-use", "COMPUTER USE"),
)

LANGUAGES = ("en", "zh-CN", "zh-TW")
CJK = re.compile(r"[\u4e00-\u9fff]")


def visible_text(fragment: str) -> str:
    text = re.sub(r"<[^>]+>", " ", fragment)
    return " ".join(html.unescape(text).split())


def source() -> str:
    return INDEX_HTML.read_text(encoding="utf-8")


def strip_block() -> str:
    text = source()
    match = re.search(
        r'<div class="plan-strip">(.*?)</div>\s*'
        r'<div aria-label="Plan feature comparison"',
        text,
        re.DOTALL,
    )
    if not match:
        raise AssertionError("pricing card strip not found")
    return match.group(1)


def pricing_cards() -> list:
    return re.findall(r"<article\b[^>]*>(.*?)</article>", strip_block(), re.DOTALL)


def table_rows() -> list:
    text = source()
    match = re.search(r'<table class="plan-table">(.*?)</table>', text, re.DOTALL)
    if not match:
        raise AssertionError("comparison table not found")
    rows = []
    for row in re.findall(r"<tr>(.*?)</tr>", match.group(1), re.DOTALL):
        cells = re.findall(r"<t[hd]\b[^>]*>(.*?)</t[hd]>", row, re.DOTALL)
        rows.append(tuple(visible_text(cell) for cell in cells))
    return rows


class HomePricingCardTests(unittest.TestCase):
    def test_free_card_is_gone_and_four_cards_remain_in_order(self):
        cards = pricing_cards()
        self.assertEqual(len(cards), 4, "the Free card must be removed")
        names = [
            visible_text(re.search(r"<h2[^>]*>(.*?)</h2>", card, re.DOTALL).group(1))
            for card in cards
        ]
        self.assertEqual(names, ["Lite", "Standard", "Professional", "Enterprise"])

    def test_card_text_is_exact(self):
        self.assertEqual(
            tuple(visible_text(card) for card in pricing_cards()), CARD_TEXTS
        )

    def test_billing_period_lines_are_removed(self):
        strip = strip_block()
        self.assertNotIn("plan-period", strip)
        self.assertNotIn("Billed monthly", strip)
        self.assertNotIn("Contact us for pricing", strip)
        self.assertNotIn("data-i18n=\"home.per-month\"", strip)
        self.assertNotIn("data-i18n=\"home.contact-pricing\"", strip)

    def test_enterprise_description_is_exact(self):
        enterprise = pricing_cards()[3]
        description = re.search(
            r'<p class="plan-description"[^>]*>(.*?)</p>', enterprise, re.DOTALL
        )
        self.assertIsNotNone(description, "Enterprise needs a description line")
        self.assertEqual(visible_text(description.group(1)), "Empowerment as you wish")

    def test_prices_buttons_and_description_carriers_are_preserved(self):
        cards = pricing_cards()
        for card, amount in zip(cards[:3], ("49", "119", "469")):
            self.assertIn('class="plan-currency"', card)
            self.assertIn('class="plan-amount">' + amount + "<", card)
            self.assertIn('class="plan-interval">/ month<', card)
            self.assertIn(
                '<button class="button plan-action" data-available-soon="" type="button">', card
            )
            self.assertNotIn('href', card)
            self.assertIn('data-i18n="home.subscribe-now">Subscribe Now<', card)
            self.assertIn('class="plan-description"', card)
        enterprise = cards[3]
        self.assertIn('class="plan-price plan-price--text"', enterprise)
        self.assertIn('data-i18n="home.custom">Custom<', enterprise)
        self.assertIn('class="button-outline plan-action"', enterprise)
        self.assertIn("data-available-soon", enterprise)
        self.assertIn('data-i18n="home.contact-sales">Contact Sales<', enterprise)
        for card in cards:
            self.assertNotIn("plan-tokens", card)
            self.assertNotIn("plan-popular", card)


class HomePricingTableTests(unittest.TestCase):
    def test_header_keeps_all_five_plan_columns(self):
        header = table_rows()[0]
        self.assertEqual(header[0], "Feature", "the sr-only cell stays")
        self.assertEqual(header[1:], PRICE_COLUMNS)

    def test_rows_and_values_are_exact(self):
        rows = table_rows()
        self.assertEqual(
            rows[1:],
            [tuple([label]) + tuple(cells) for label, cells in TABLE_ROWS],
        )

    def test_deleted_rows_are_gone(self):
        text = source()
        table = re.search(r'<table class="plan-table">.*?</table>', text, re.DOTALL).group(0)
        for label in DELETED_ROWS:
            self.assertNotIn(label, table)
        for key in DELETED_KEYS + UNRENDERED_KEYS:
            self.assertFalse(key in table, f"retired table row still rendered: {key}")

    def test_four_capability_rows_are_checked_for_every_plan(self):
        rows = dict(TABLE_ROWS)
        rendered = table_rows()
        labels = [row[0] for row in rendered[1:]]
        for label in CAPABILITY_ROWS:
            with self.subTest(row=label):
                self.assertIn(label, labels)
                self.assertEqual(rows[label], ALL_CHECKS, f"{label} must be included everywhere")

    def test_custom_integration_is_the_last_row(self):
        rendered = table_rows()
        self.assertEqual(rendered[-1][0], "CUSTOM INTEGRATION")
        self.assertEqual(rendered[-1][1:], ("\u2014", "\u2014", "\u2014", "\u2014", "\u2713"))

    def test_row_labels_use_the_uppercase_english_style(self):
        labels = [row[0] for row in table_rows()[1:]]
        self.assertEqual(labels, [label for label, _cells in TABLE_ROWS])
        for label in labels:
            with self.subTest(label=label):
                self.assertEqual(label, label.upper(), "table row labels are uppercase")

    def test_only_enterprise_offers_custom_models(self):
        row = dict(TABLE_ROWS)["CUSTOM MODELS"]
        self.assertEqual(row, ("\u2014", "\u2014", "\u2014", "\u2014", "\u2713"))


class HomePricingDictionaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.home_json = json.loads(HOME_JSON.read_text(encoding="utf-8"))
        cls.home_js = json.loads(
            HOME_JS.read_text(encoding="utf-8")
            .split("Object.assign(window.OuroNexI18n || {}, ", 1)[1]
            .rstrip()
            .rstrip(";")
            .rstrip(")")
        )

    def test_relabelled_and_new_rows_carry_all_three_languages(self):
        for key, english in RELABELLED_ROWS + NEW_CAPABILITY_KEYS:
            for name, data in (("home.json", self.home_json), ("home.js", self.home_js)):
                with self.subTest(dictionary=name, key=key):
                    self.assertIn(key, data)
                    entry = data[key]
                    self.assertEqual(set(entry), set(LANGUAGES))
                    self.assertEqual(entry["en"], english)
                    for language in LANGUAGES:
                        self.assertTrue(entry[language].strip())
                    for language in ("zh-CN", "zh-TW"):
                        self.assertNotEqual(entry[language], english)
                        self.assertRegex(
                            entry[language], CJK, f"{key}.{language} must be Chinese"
                        )

    def test_removed_row_keys_are_gone_from_both_dictionaries(self):
        for key in DELETED_KEYS:
            with self.subTest(key=key):
                self.assertFalse(key in self.home_json, f"{key} must be removed from home.json")
                self.assertFalse(key in self.home_js, f"{key} must be removed from home.js")

    def test_compiled_dictionary_matches_the_json_source(self):
        self.assertEqual(self.home_js, self.home_json)

    def test_table_labels_resolve_in_the_dictionary(self):
        table = re.search(
            r'<table class="plan-table">.*?</table>', source(), re.DOTALL
        ).group(0)
        for key in re.findall(r'data-i18n="(home\.table-[^"]+)"', table):
            self.assertIn(key, self.home_json, f"unresolved table key {key}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
