"""SIDA feature panels: three side-by-side titled detail cards per tab.

The photo/illustration panels were removed with the homepage redesign; each
``.feature-panel`` now holds one ``.feature-card-stack`` with exactly three
``.feature-detail-card`` elements. Every card carries its own translated ``h3``
title followed by the translated copy paragraph, and the three cards sit next to
each other on desktop, collapsing to one column on mobile. This module pins that
structure, the title/body type scale and the removal of the legacy photo markup.

Self-contained stdlib checks (regex + div slicing); no browser, no server.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_HTML = REPO_ROOT / "index.html"
HOME_CSS = REPO_ROOT / "assets" / "home.css"

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")

# Panel id -> ((title key, English title, copy key), ...) in DOM order.
PANEL_CARDS = {
    "feature-engineering": (
        ("home.feature-engineering-card-1-title", "Pain point", "home.feature-engineering-copy"),
        ("home.feature-engineering-card-2-title", "Comparison", "home.feature-engineering-copy-2"),
        (
            "home.feature-engineering-card-3-title",
            "Confidentiality",
            "home.feature-engineering-copy-3",
        ),
    ),
    "feature-workflow": (
        ("home.feature-workflow-card-1-title", "Pain point", "home.feature-workflow-copy"),
        (
            "home.feature-workflow-card-2-title",
            "Traditional agents",
            "home.feature-workflow-copy-2",
        ),
        (
            "home.feature-workflow-card-3-title",
            "Visual flowcharts",
            "home.feature-workflow-copy-3",
        ),
    ),
    "feature-free": (
        ("home.feature-free-card-1-title", "Pain point", "home.feature-free-copy"),
        ("home.feature-free-card-2-title", "Built-in tools", "home.feature-free-copy-2"),
        ("home.feature-free-card-3-title", "Computer use", "home.feature-free-copy-3"),
    ),
    "feature-experts": (
        ("home.feature-experts-card-1-title", "Pain point", "home.feature-experts-copy"),
        ("home.feature-experts-card-2-title", "Specialist bots", "home.feature-experts-copy-2"),
        ("home.feature-experts-card-3-title", "Hong Kong library", "home.feature-experts-copy-3"),
    ),
}

CARD_ORDER = tuple(card for cards in PANEL_CARDS.values() for card in cards)

LEGACY_MARKERS = (
    "feature-panel--photo",
    "feature-panel--visual",
    "feature-panel--workflow",
    "feature-photo-frame",
    "feature-photo",
    "sida-1-photo.jpg",
    "sida-2-visual.jpg",
    "sida-3.png",
)


def normalise(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").lower())


def split_media(css: str):
    base_parts = []
    medias = []
    index = 0
    while True:
        position = css.find("@media", index)
        if position < 0:
            base_parts.append(css[index:])
            break
        base_parts.append(css[index:position])
        brace = css.index("{", position)
        prelude = css[position + len("@media"):brace]
        depth = 0
        end = brace
        for cursor in range(brace, len(css)):
            if css[cursor] == "{":
                depth += 1
            elif css[cursor] == "}":
                depth -= 1
                if depth == 0:
                    end = cursor
                    break
        medias.append((normalise(prelude), css[brace + 1:end]))
        index = end + 1
    return "".join(base_parts), medias


def declarations(css: str, selector: str) -> dict:
    target = normalise(selector)
    for match in RULE_RE.finditer(css):
        selectors = [normalise(part) for part in match.group(1).split(",") if part.strip()]
        if target not in selectors:
            continue
        found = {}
        for declaration in match.group(2).split(";"):
            if ":" not in declaration:
                continue
            prop, _, value = declaration.partition(":")
            found[prop.strip().lower()] = re.sub(r"\s+", " ", value.strip().lower())
        if found:
            return found
    raise AssertionError(f"{selector}: no such rule in home.css")


def div_bounds(markup: str, open_index: int):
    depth = 1
    cursor = open_index + len("<div")
    while cursor < len(markup):
        next_open = markup.find("<div", cursor)
        next_close = markup.find("</div", cursor)
        if next_close < 0:
            raise AssertionError("unbalanced <div> in index.html")
        if 0 <= next_open < next_close:
            depth += 1
            cursor = next_open + len("<div")
            continue
        depth -= 1
        if depth == 0:
            return open_index, next_close + len("</div>")
        cursor = next_close + len("</div")
    raise AssertionError("unclosed <div> in index.html")


class FeatureDetailCardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX_HTML.read_text(encoding="utf-8")
        cls.css = COMMENT_RE.sub("", HOME_CSS.read_text(encoding="utf-8"))
        cls.base, cls.medias = split_media(cls.css)

        start = cls.index.index('<div class="feature-panels">')
        _, end = div_bounds(cls.index, start)
        cls.panels_block = cls.index[start:end]

    def panel(self, panel_id: str) -> str:
        match = re.search(
            r'<article[^>]*id="' + panel_id + r'".*?</article>', self.panels_block, re.S
        )
        self.assertIsNotNone(match, f"missing panel {panel_id}")
        return match.group(0)

    def cards(self, panel_id: str) -> list:
        block = self.panel(panel_id)
        return re.findall(r'<div class="feature-detail-card">(.*?)</div>', block, re.S)

    def media(self, needle: str) -> dict:
        for prelude, body in self.medias:
            if needle in prelude:
                return body
        raise AssertionError(f"missing the {needle} block")

    # -- markup -----------------------------------------------------------

    def test_every_panel_holds_one_card_stack(self):
        self.assertEqual(self.panels_block.count('class="feature-card-stack"'), 4)
        self.assertEqual(self.panels_block.count('class="feature-panel"'), 4)
        for panel_id in PANEL_CARDS:
            block = self.panel(panel_id)
            self.assertEqual(block.count('class="feature-card-stack"'), 1, panel_id)

    def test_each_stack_holds_three_titled_cards_with_title_then_copy(self):
        seen_titles = []
        for panel_id, cards in PANEL_CARDS.items():
            found = self.cards(panel_id)
            self.assertEqual(len(found), 3, f"{panel_id}: three detail cards")
            for html, (title_key, title, copy_key) in zip(found, cards):
                with self.subTest(panel=panel_id, title=title):
                    self.assertIn(
                        f'<h3><span data-i18n="{title_key}">{title}</span></h3>', html
                    )
                    self.assertIn(f'<p><span data-i18n="{copy_key}">', html)
                    self.assertLess(
                        html.index("<h3>"), html.index("<p>"), "the title precedes its copy"
                    )
                    self.assertEqual(html.count("<h3>"), 1, "one title per card")
                    self.assertEqual(html.count("<p>"), 1, "one paragraph per card")
                    seen_titles.append(title)
        self.assertEqual(tuple(seen_titles), tuple(card[1] for card in CARD_ORDER))

    def test_twelve_cards_render_in_panel_order(self):
        rendered = re.findall(
            r'<div class="feature-card-stack">(.*?)</div>\s*</article>', self.panels_block, re.S
        )
        self.assertEqual(len(rendered), 4, "four panels")
        counts = [block.count('class="feature-detail-card"') for block in rendered]
        self.assertEqual(counts, [3, 3, 3, 3], "three cards per panel")
        self.assertEqual(self.panels_block.count('class="feature-detail-card"'), 12)

    def test_inline_title_prefixes_are_gone_from_the_copy(self):
        for html in re.findall(
            r'<div class="feature-detail-card">.*?</div>', self.panels_block, re.S
        ):
            paragraph = re.search(r"<p>(.*?)</p>", html, re.S).group(1)
            for prefix in ("Pain point:", "Comparison:", "Confidentiality:", "Traditional agents:"):
                self.assertNotIn(prefix, paragraph, "the title now lives in the h3")

    def test_legacy_photo_panels_are_gone(self):
        for marker in LEGACY_MARKERS:
            self.assertNotIn(marker, self.index, f"removed photo design remnant: {marker}")
            self.assertNotIn(marker, self.css, f"removed photo CSS remnant: {marker}")
        self.assertNotIn("<img", self.panels_block, "the detail panels are text-only now")

    # -- desktop styling --------------------------------------------------

    def test_card_stack_places_three_equal_rows_in_one_column(self):
        stack = declarations(self.base, ".feature-card-stack")
        self.assertEqual(stack.get("height"), "100%")
        self.assertEqual(stack.get("display"), "grid")
        self.assertEqual(
            normalise(stack.get("grid-template-columns", "")),
            "minmax(0,1fr)",
            "the three rows share a single column",
        )
        self.assertEqual(
            normalise(stack.get("grid-template-rows", "")),
            "repeat(3,minmax(0,1fr))",
            "the three blocks stack as equal rows",
        )
        self.assertEqual(normalise(stack.get("gap", "")), "0")

    def test_detail_card_has_no_surface(self):
        card = declarations(self.base, ".feature-detail-card")
        self.assertEqual(normalise(card.get("padding", "")), "16px0")
        self.assertEqual(normalise(card.get("border", "")), "0")
        self.assertEqual(normalise(card.get("border-radius", "")), "0")
        self.assertEqual(normalise(card.get("background", "")), "none")
        self.assertEqual(normalise(card.get("box-shadow", "")), "none")
        self.assertEqual(card.get("display"), "flex")
        self.assertEqual(card.get("flex-direction"), "column")
        self.assertEqual(card.get("align-items"), "stretch")
        self.assertEqual(card.get("justify-content"), "center")

    def test_rows_are_separated_by_a_hairline(self):
        divider = declarations(self.base, ".feature-detail-card+.feature-detail-card")
        self.assertEqual(
            normalise(divider.get("border-top", "")),
            "1pxsolidrgba(155,181,210,.3)",
        )
        self.assertNotIn(".feature-detail-card::before", self.base, "the accent rail is gone")
        self.assertNotIn(".feature-detail-card::after", self.base, "the corner glow is gone")

    def test_card_title_is_a_manrope_display_heading(self):
        title = declarations(self.base, ".feature-detail-card h3")
        self.assertEqual(normalise(title.get("font", "")), normalise("400 clamp(24px,1.9vw,32px)/1.15 var(--display)"))
        self.assertIn("var(--display)", title.get("font", ""))
        self.assertEqual(normalise(title.get("margin", "")), "008px")
        self.assertEqual(title.get("color"), "#edf4ff")
        self.assertEqual(normalise(title.get("letter-spacing", "")), "-.025em")

    def test_card_copy_is_22px(self):
        paragraph = declarations(self.base, ".feature-detail-card p")
        self.assertEqual(normalise(paragraph.get("margin", "")), "0")
        self.assertEqual(paragraph.get("text-align"), "left")
        self.assertEqual(normalise(paragraph.get("font-size", "")), "20px")
        self.assertEqual(normalise(paragraph.get("line-height", "")), "1.5")
        self.assertEqual(paragraph.get("color"), "#c0cede")

    # -- responsive -------------------------------------------------------

    def test_mobile_cards_return_to_one_column(self):
        mobile = self.media("max-width:760px")
        stack = declarations(mobile, ".feature-card-stack")
        self.assertEqual(stack.get("height"), "auto")
        self.assertEqual(normalise(stack.get("grid-template-rows", "")), "none")
        self.assertEqual(normalise(stack.get("gap", "")), "0")
        stack_rules = re.findall(r"\.feature-card-stack\{([^}]*)\}", mobile)
        self.assertTrue(stack_rules, "the mobile stack rule is required")
        columns = [
            normalise(value)
            for body in stack_rules
            for value in re.findall(r"grid-template-columns:([^;}]*)", body)
        ]
        self.assertTrue(
            any(value in {"minmax(0,1fr)", "1fr", "repeat(1,minmax(0,1fr))"} for value in columns),
            "mobile cards must stack into one column; the ≤760px .feature-card-stack rule "
            f"declares {columns or 'no grid-template-columns, so the desktop three-column row is inherited'}",
        )

    def test_mobile_copy_is_17px_and_the_rows_tighten(self):
        mobile = self.media("max-width:760px")
        card = declarations(mobile, ".feature-detail-card")
        self.assertEqual(normalise(card.get("padding", "")), "14px0")
        self.assertEqual(
            normalise(declarations(mobile, ".feature-detail-card p").get("font-size", "")),
            "17px",
            "mobile body copy is 17px",
        )

    def test_panels_release_the_fixed_height_on_mobile(self):
        mobile = self.media("max-width:760px")
        panels = declarations(mobile, ".feature-panels")
        self.assertEqual(panels.get("height"), "auto")
        self.assertEqual(normalise(panels.get("min-height", "")), "0")
        self.assertEqual(panels.get("max-height"), "none")
        self.assertEqual(normalise(declarations(mobile, ".feature-panel").get("padding", "")), "0")

    def test_short_desktop_tightens_the_rows_and_keeps_16px_copy(self):
        short = self.media("max-height:760px)and(min-width:761px")
        card = declarations(short, ".feature-detail-card")
        self.assertEqual(normalise(card.get("padding", "")), "10px0")
        paragraph = declarations(short, ".feature-detail-card p")
        self.assertEqual(normalise(paragraph.get("font-size", "")), "16px")
        self.assertEqual(normalise(paragraph.get("line-height", "")), "1.45")

    def test_narrow_width_tightens_the_rows_and_drops_to_19px_copy(self):
        narrow = self.media("max-width:1200px")
        card = declarations(narrow, ".feature-detail-card")
        self.assertEqual(normalise(card.get("padding", "")), "14px0")
        self.assertEqual(
            normalise(declarations(narrow, ".feature-detail-card p").get("font-size", "")),
            "19px",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
