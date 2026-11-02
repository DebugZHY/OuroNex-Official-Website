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

    def test_currency_and_interval_stay_14px_in_every_override(self) -> None:
        css = HOME_CSS.read_text(encoding="utf-8")
        found = 0
        for selector, rule in re.findall(r"\.(plan-currency|plan-interval)\{([^}]*)\}", css):
            size = re.search(r"font-size:([^;]+)", rule)
            value = size.group(1).strip() if size else None
            self.assertEqual(value, "14px", f"{selector}: {rule}")
            found += 1
        self.assertGreaterEqual(found, 3)


if __name__ == "__main__":
    unittest.main()
