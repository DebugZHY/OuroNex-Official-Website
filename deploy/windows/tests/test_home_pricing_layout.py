"""Home pricing grid regression tests."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
HOME_CSS = REPO_ROOT / "assets" / "home.css"


class HomePricingLayoutTests(unittest.TestCase):
    def test_four_remaining_cards_use_four_columns_at_every_breakpoint(self) -> None:
        css = HOME_CSS.read_text(encoding="utf-8")
        rules = re.findall(r"\.plan-strip\{([^}]*)\}", css)
        self.assertGreaterEqual(len(rules), 4)
        for rule in rules:
            self.assertIn("grid-template-columns:repeat(4,", rule)

    def test_supporting_text_stays_20px_in_every_override(self) -> None:
        css = HOME_CSS.read_text(encoding="utf-8")
        for selector in ("plan-description", "plan-currency", "plan-interval"):
            with self.subTest(selector=selector):
                rules = re.findall(rf"\.{selector}\{{([^}}]*)\}}", css)
                self.assertGreaterEqual(len(rules), 2)
                for rule in rules:
                    size = re.search(r"font-size:([^;]+)", rule)
                    value = size.group(1).strip() if size else None
                    self.assertEqual(value, "20px", f"{selector}: {rule}")

    def test_mobile_cards_keep_the_20px_price_on_one_row(self) -> None:
        css = HOME_CSS.read_text(encoding="utf-8")
        self.assertGreaterEqual(css.count("grid-template-columns:repeat(4,minmax(220px,1fr))"), 2)
        self.assertGreaterEqual(css.count(".plan-mini{min-width:220px"), 2)

    def test_subscribe_button_is_20px_in_every_override(self) -> None:
        css = HOME_CSS.read_text(encoding="utf-8")
        rules = re.findall(r"\.plan-mini \.plan-action\{([^}]*)\}", css)
        self.assertGreaterEqual(len(rules), 3)
        for rule in rules:
            size = re.search(r"font-size:([^;]+)", rule)
            value = size.group(1).strip() if size else None
            self.assertEqual(value, "20px", f".plan-action: {rule}")


if __name__ == "__main__":
    unittest.main()
