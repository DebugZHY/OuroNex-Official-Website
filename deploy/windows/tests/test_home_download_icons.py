"""Focused tests for the normalized Windows/Apple download icons and pill alignment.

Pins the download-icon slot geometry, the fixed left icon position, right-aligned
download labels with equal right insets, the Apple viewBox crop and visual-height
match, the untouched Windows mark, the centred early-access pill and the
single-column narrow layout.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_HTML = REPO_ROOT / "index.html"
HOME_CSS = REPO_ROOT / "assets" / "home.css"

BUTTON = ".sida-section .download-actions .button"
EARLY = ".sida-section .download-actions .early-access"
ACTIONS = ".sida-section .download-actions"
ICON = ".sida-section .download-actions .download-icon"

RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")
COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
SVG_RE = re.compile(r"<svg\b[^>]*class=\"download-icon\"[^>]*>.*?</svg>", re.S)

WINDOWS_VIEWBOX = "0 0 18 17"
WINDOWS_PATH = (
    "M0 2.2 8.8 1v7.1H0zM9.8.8 18 0v8.2H9.8zM0 9.2h8.8v7.1L0 15.1z"
    "M9.8 9.2H18V17l-8.2-1.1z"
)


def _normalise_selector(text: str) -> str:
    return re.sub(r"\s+", "", text).lower()


def _declarations(body: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for declaration in body.split(";"):
        declaration = declaration.strip()
        if not declaration or ":" not in declaration:
            continue
        prop, _, value = declaration.partition(":")
        parsed[prop.strip().lower()] = re.sub(r"\s+", " ", value.strip()).lower()
    return parsed


def rules(css: str) -> list[tuple[list[str], dict[str, str]]]:
    css = COMMENT_RE.sub("", css)
    found = []
    for match in RULE_RE.finditer(css):
        selectors = [
            _normalise_selector(part)
            for part in match.group(1).split(",")
            if part.strip()
        ]
        if not selectors or any(part.startswith("@") for part in selectors):
            continue
        declarations = _declarations(match.group(2))
        if declarations:
            found.append((selectors, declarations))
    return found


def matching_rules(css: str, selector: str) -> list[dict[str, str]]:
    target = _normalise_selector(selector)
    return [
        declarations
        for selectors, declarations in rules(css)
        if target in selectors
    ]


def merged(css: str, selector: str) -> dict[str, str]:
    effective: dict[str, str] = {}
    for declarations in matching_rules(css, selector):
        effective.update(declarations)
    return effective


def viewbox_numbers(value: str) -> tuple[float, float, float, float]:
    parts = [float(part) for part in re.split(r"[\s,]+", value.strip()) if part]
    if len(parts) != 4:
        raise AssertionError(f"unexpected viewBox: {value!r}")
    return parts[0], parts[1], parts[2], parts[3]


class DownloadIconsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX_HTML.read_text(encoding="utf-8")
        cls.css = HOME_CSS.read_text(encoding="utf-8")
        cls.icons = SVG_RE.findall(cls.index)
        cls.windows_svg, cls.apple_svg = cls.icons[0], cls.icons[1]

    # -- icon slots ---------------------------------------------------------

    def test_both_download_icons_use_the_same_20px_slot(self) -> None:
        self.assertEqual(len(self.icons), 2, "expected exactly the Windows and Apple icons")
        for svg in self.icons:
            self.assertIn('class="download-icon"', svg)

        icon = merged(self.css, ICON)
        self.assertEqual(icon.get("display"), "block")
        self.assertEqual(icon.get("flex"), "0 0 20px")
        self.assertEqual(icon.get("width"), "20px")
        self.assertEqual(icon.get("height"), "20px")

    def test_icon_precedes_the_label_in_both_download_pills(self) -> None:
        actions = re.search(r'<div class="download-actions">(.*?)</div>', self.index, re.S)
        self.assertIsNotNone(actions)
        block = actions.group(1)
        self.assertLess(block.index("download-icon"), block.index("home.windows"))
        apple_at = block.index("home.mac")
        self.assertLess(block.rfind("download-icon", 0, apple_at), apple_at)

    # -- pill alignment -----------------------------------------------------

    def test_download_pills_keep_the_icon_and_label_together(self) -> None:
        button_rules = matching_rules(self.css, BUTTON)
        aligned = [rule for rule in button_rules if rule.get("justify-content") == "flex-start"]
        self.assertTrue(aligned, "download pills must keep the label right after the icon")
        self.assertEqual(aligned[-1].get("gap"), "12px")

        # The functional shorthand owns the padding: 16px 24px on desktop, 14px 18px narrow.
        paddings = [rule["padding"] for rule in button_rules if "padding" in rule]
        self.assertGreaterEqual(
            len(paddings), 2, f"expected a desktop and a narrow shorthand: {paddings!r}"
        )
        self.assertEqual(paddings[0].split(), ["16px", "24px"], "desktop shorthand padding")
        self.assertEqual(paddings[-1].split(), ["14px", "18px"], "narrow shorthand padding")

    def test_desktop_download_actions_keep_a_20px_column_gap(self) -> None:
        desktop = next(
            rule for rule in matching_rules(self.css, ACTIONS) if rule.get("display") == "grid"
        )
        gap = desktop.get("gap", "").split()
        column_gap = gap[1] if len(gap) > 1 else gap[0] if gap else ""
        self.assertEqual(column_gap, "20px", f"pill column gap must stay 20px: {gap!r}")

    def test_download_labels_sit_left_of_the_pill_padding(self) -> None:
        selector = ".sida-section .download-actions .button>span"
        label = merged(self.css, selector)
        self.assertEqual(label.get("text-align"), "left")

    def test_compact_gap_overrides_the_shared_28px_button_gap(self) -> None:
        site_css = (REPO_ROOT / "assets" / "site.css").read_text(encoding="utf-8")
        shared_gaps = [
            rule["gap"] for rule in matching_rules(site_css, ".button") if "gap" in rule
        ]
        self.assertTrue(shared_gaps, "shared .button gap declaration not found")
        self.assertEqual(
            shared_gaps[0], "28px", "shared .button base gap changed unexpectedly"
        )

        button_rules = matching_rules(self.css, BUTTON)
        gap_rules = [rule["gap"] for rule in button_rules if "gap" in rule]
        self.assertTrue(gap_rules, "no download-pill gap declaration")
        self.assertEqual(gap_rules[-1], "12px", "last gap declaration must win with 12px")

    def test_early_access_stays_centered(self) -> None:
        early = merged(self.css, EARLY)
        self.assertEqual(early.get("justify-content"), "center")
        self.assertNotIn("gap", early, "early access must keep the shared pill metrics")

    # -- Apple viewBox ------------------------------------------------------

    def test_apple_viewbox_is_cropped_to_the_glyph_bounds(self) -> None:
        viewbox = re.search(r'viewBox="([^"]+)"', self.apple_svg)
        self.assertIsNotNone(viewbox)
        value = viewbox.group(1)
        self.assertNotIn("0 0 24 24", value, "the old blank-margin 24x24 viewBox must be gone")

        x, y, width, height = viewbox_numbers(value)
        self.assertAlmostEqual(x, 4.4, delta=0.15, msg=f"Apple left bound: {value}")
        self.assertAlmostEqual(y, 2.5, delta=0.15, msg=f"Apple vertical framing: {value}")
        self.assertAlmostEqual(width, 15.2, delta=0.15, msg=f"Apple glyph width: {value}")
        self.assertAlmostEqual(height, 19.0, delta=0.15, msg=f"Apple visual height: {value}")
        self.assertEqual(viewbox_numbers(value), (x, y, width, height))

    def test_apple_glyph_anchors_to_the_left_edge_of_its_slot(self) -> None:
        self.assertIn('preserveAspectRatio="xMinYMid meet"', self.apple_svg)
        self.assertNotIn(
            "preserveAspectRatio",
            self.windows_svg,
            "the Windows mark already fills its slot and must stay untouched",
        )

    def test_apple_mark_uses_no_css_scale_or_transform_hacks(self) -> None:
        icon = merged(self.css, ICON)
        for prop in ("transform", "scale", "zoom"):
            self.assertNotIn(prop, icon, f"{ICON}: {prop} must not be used")

    def test_windows_mark_is_untouched(self) -> None:
        viewbox = re.search(r'viewBox="([^"]+)"', self.windows_svg)
        self.assertIsNotNone(viewbox)
        self.assertEqual(viewbox.group(1), WINDOWS_VIEWBOX)

        paths = re.findall(r'<path\b[^>]*d="([^"]+)"', self.windows_svg)
        self.assertEqual(paths, [WINDOWS_PATH])
        self.assertEqual(len(re.findall(r"<path\b", self.windows_svg)), 1)

    # -- narrow layout ------------------------------------------------------

    def test_narrow_layout_stays_one_column_without_centered_downloads(self) -> None:
        actions_rules = matching_rules(self.css, ACTIONS)
        narrow_columns = [
            rule.get("grid-template-columns")
            for rule in actions_rules
            if rule.get("grid-template-columns") == "minmax(0,1fr)"
        ]
        self.assertTrue(narrow_columns, "the one-column narrow download grid is required")

        button_rules = matching_rules(self.css, BUTTON)
        narrow_button = [rule for rule in button_rules if rule.get("white-space") == "normal"]
        self.assertTrue(narrow_button, "the narrow download pill rule is required")
        for rule in narrow_button:
            self.assertNotIn(
                "justify-content", rule, "the narrow pill must inherit the left alignment"
            )

        flex_start_indexes = [
            index for index, rule in enumerate(button_rules)
            if rule.get("justify-content") == "flex-start"
        ]
        self.assertTrue(flex_start_indexes, "download pills must keep labels next to icons")
        flex_start_at = flex_start_indexes[0]
        last_centered = [
            index for index, rule in enumerate(button_rules)
            if rule.get("justify-content") == "center"
        ]
        self.assertTrue(
            all(index < flex_start_at for index in last_centered),
            "no later rule may centre the download content again",
        )

    def test_download_row_is_sized_to_its_compact_content(self) -> None:
        actions_rules = matching_rules(self.css, ACTIONS)
        desktop = next(rule for rule in actions_rules if rule.get("display") == "grid")
        self.assertEqual(desktop.get("grid-template-columns"), "repeat(3,auto)")
        self.assertEqual(desktop.get("width"), "min(100%,900px)")


if __name__ == "__main__":
    unittest.main()
