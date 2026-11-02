"""Home pricing grid regression tests: five cards, scaled-down type, hover glow."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
HOME_CSS = REPO_ROOT / "assets" / "home.css"
SITE_JS = REPO_ROOT / "assets" / "site.js"

# The price section was scaled down from the 34/52/20px ramp to this one.
BASE_TYPE = {"plan-description": "15px", "plan-currency": "15px", "plan-interval": "15px"}
NARROW_TYPE = {"plan-description": "14px", "plan-currency": "14px", "plan-interval": "14px"}


def css() -> str:
    return HOME_CSS.read_text(encoding="utf-8")


def strip_rules(text: str) -> list[str]:
    return re.findall(r"\.plan-strip\{([^}]*)\}", text)


class HomePricingLayoutTests(unittest.TestCase):
    def test_five_cards_use_five_columns_at_every_breakpoint(self) -> None:
        rules = strip_rules(css())
        self.assertGreaterEqual(len(rules), 4)
        for rule in rules:
            with self.subTest(rule=rule):
                self.assertIn("grid-template-columns:repeat(5,", rule)
                self.assertNotIn("repeat(4,", rule, "the fifth card would be pushed to a second row")

    def test_card_floor_leaves_a_partial_card_on_mobile(self) -> None:
        text = css()
        self.assertGreaterEqual(text.count("repeat(5,minmax(160px,1fr))"), 2)
        self.assertGreaterEqual(text.count(".plan-mini{min-width:160px"), 2)

    def test_supporting_text_is_scaled_down_in_every_override(self) -> None:
        text = css()
        for selector, base in BASE_TYPE.items():
            rules = [
                rule
                for rule in re.findall(rf"\.{selector}\{{([^}}]*)\}}", text)
                if "font-size:" in rule
            ]
            self.assertGreaterEqual(len(rules), 2, selector)
            for rule in rules:
                found = re.search(r"font-size:([^;]+)", rule)
                value = found.group(1).strip() if found else None
                with self.subTest(selector=selector, rule=rule):
                    self.assertIn(value, {base, NARROW_TYPE[selector]})
                    self.assertLess(int(value[:-2]), 20, "the section must stay compact")

    def test_card_title_and_price_shrink_with_the_section(self) -> None:
        text = css()
        title = re.search(r"\.plan-mini h2\{([^}]*)\}", text).group(1)
        price = re.search(r"\.plan-price\{([^}]*)\}", text).group(1)
        self.assertIn("font-size:26px", title)
        self.assertIn("font-size:38px", price)
        self.assertIn("min-height:250px", re.search(r"\.plan-mini\{([^}]*)\}", text).group(1))

    def test_table_is_compact_and_fits_six_plan_columns(self) -> None:
        text = css()
        table = re.search(r"\.plan-table\{([^}]*)\}", text).group(1)
        cells = re.search(r"\.plan-table th,\.plan-table td\{([^}]*)\}", text).group(1)
        self.assertIn("font-size:15px", table)
        self.assertIn("min-width:1060px", table)
        self.assertIn("width:min(1180px,calc(100% - 64px))", re.search(r"\.price-layout\{([^}]*)\}", text).group(1),
                      "the price block sits in the same column as the other sections")
        self.assertIn("height:46px", cells)
        self.assertIn("font-size:15px", cells)

    def test_subscribe_button_is_scaled_down_in_every_override(self) -> None:
        rules = [
            rule
            for rule in re.findall(r"\.plan-mini \.plan-action\{([^}]*)\}", css())
            if "font-size:" in rule
        ]
        self.assertGreaterEqual(len(rules), 3)
        for rule in rules:
            value = re.search(r"font-size:([^;]+)", rule)
            with self.subTest(rule=rule):
                self.assertLess(int(value.group(1).strip()[:-2]), 20)


class SubscribeGlowTests(unittest.TestCase):
    def test_the_action_carries_a_pointer_tracking_glow(self) -> None:
        text = css()
        base = re.search(
            r"\.plan-mini \.plan-action\{--mx:50%;--my:50%;([^}]*)\}", text
        )
        self.assertIsNotNone(base, "the action must declare the pointer variables")
        self.assertIn("overflow:hidden", base.group(1))
        glow = re.search(r"\.plan-mini \.plan-action::before\{([^}]*)\}", text)
        self.assertIsNotNone(glow)
        body = glow.group(1)
        self.assertIn("radial-gradient(", body)
        self.assertIn("var(--mx)", body)
        self.assertIn("var(--my)", body)
        self.assertIn("opacity:0", body)
        self.assertIn("pointer-events:none", body)
        hover = re.search(
            r"\.plan-mini \.plan-action:hover::before[^{]*\{([^}]*)\}", text
        )
        self.assertIsNotNone(hover)
        self.assertIn("opacity:1", hover.group(1))
        self.assertRegex(text, r"\.plan-mini \.plan-action>span\{[^}]*z-index:1")

    def test_the_glow_is_off_for_touch_and_reduced_motion(self) -> None:
        text = css()
        self.assertIsNotNone(
            re.search(
                r"@media\(hover:none\)\{(?:(?!@media).)*?\.plan-mini \.plan-action::before\{display:none\}",
                text,
                re.S,
            ),
            "touch devices must not paint the glow",
        )
        self.assertIsNotNone(
            re.search(
                r"@media\(prefers-reduced-motion:reduce\)\{(?:(?!@media).)*?\.plan-mini \.plan-action::before\{transition:none\}",
                text,
                re.S,
            ),
            "reduced motion must not animate the glow",
        )

    def test_site_js_feeds_the_pointer_position(self) -> None:
        script = SITE_JS.read_text(encoding="utf-8")
        self.assertIn(".plan-mini .plan-action", script)
        self.assertIn("setProperty('--mx'", script)
        self.assertIn("setProperty('--my'", script)


if __name__ == "__main__":
    unittest.main()
