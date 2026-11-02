"""SIDA feature section: three stacked detail rows in one shared height.

Contract pinned here:

* one shared ``--feature-height: clamp(448px, 52.8vh, 608px)`` drives the left
  directory and the right text column; short viewports override it to 384px
  (max-height 800 / min-height 601) and 416px (max-height 600);
* the three ``.feature-detail-card`` rows stack in a single column, carry no
  card surface and are separated by a 1px hairline between neighbours;
* row typography: Manrope 400, ``clamp(24px, 1.9vw, 32px)``/1.15/``-.025em`` title
  with 20px body, stepping to 26/19 (≤1200), 24/18 (≤1000), 24/18 (short
  601–800), 22/16 (≤600) and 22/17 on mobile; every row aligns its text left;
* the directory icon is 44px and keeps a 68px tap target on mobile, where the
  rows stay content-driven (auto height, no clipping).

Only ``assets/home.css`` is read: no browser, no server.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
HOME_CSS = REPO_ROOT / "assets" / "home.css"

SHARED_HEIGHT = "clamp(448px,52.8vh,608px)"
SHORT_HEIGHT = "384px"
TINY_HEIGHT = "416px"

BASE_TITLE_SIZE = "56px"
BASE_TITLE_LINE_HEIGHT = "1.1"
BASE_TITLE_SPACING = "-.025em"
BASE_BODY_SIZE = "24px"

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")

TABS = ".feature-tabs"
LIST = ".feature-tab-list"
BUTTON = ".feature-tab-list button"
PANELS = ".feature-panels"
PANEL = ".feature-panel"
STACK = ".feature-card-stack"
CARD = ".feature-detail-card"
TITLE = ".feature-detail-card h3"
BODY = ".feature-detail-card p"

W1200 = ("max-width:1200px",)
W1000 = ("max-width:1000px", "min-width:761px")
MOBILE = ("max-width:760px",)
H800 = ("max-height:800px", "min-height:601px")


def sheet() -> str:
    return COMMENT_RE.sub("", HOME_CSS.read_text(encoding="utf-8"))


def normalise(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").lower())


def parse(body: str) -> dict:
    declarations: dict = {}
    for declaration in body.split(";"):
        if ":" not in declaration:
            continue
        prop, _, value = declaration.partition(":")
        declarations[prop.strip().lower()] = re.sub(r"\s+", " ", value.strip().lower())
    return declarations


def rules(css: str) -> list:
    found = []
    for match in RULE_RE.finditer(css):
        selectors = [normalise(part) for part in match.group(1).split(",") if part.strip()]
        if not selectors or any(selector.startswith("@") for selector in selectors):
            continue
        declarations = parse(match.group(2))
        if declarations:
            found.append((selectors, declarations))
    return found


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
        prelude = normalise(css[position + len("@media"):brace])
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
        medias.append((prelude, css[brace + 1:end]))
        index = end + 1
    return "".join(base_parts), medias


def base(css: str, selector: str) -> dict:
    target = normalise(selector)
    for selectors, declarations in rules(css):
        if target in selectors:
            return declarations
    raise AssertionError(f"{selector}: no such rule in home.css")


def block(css: str, prelude: tuple) -> str:
    matches = []
    for media, body in split_media(css)[1]:
        if all(normalise(fragment) in media for fragment in prelude):
            matches.append(body)
    if not matches:
        raise AssertionError(f"missing @media block containing {prelude}")
    return "".join(matches)


def block_with_height(css: str, height: str):
    """Return (prelude, body) of the media block that sets --feature-height:<height>."""
    target = normalise(height)
    for prelude, body in split_media(css)[1]:
        for selectors, declarations in rules(body):
            if normalise(TABS) in selectors and normalise(declarations.get("--feature-height", "")) == target:
                return prelude, body
    raise AssertionError(f"no media block sets --feature-height:{height}")


def font_parts(declarations: dict) -> dict:
    """Resolve weight/size/line-height/family from longhands or the `font` shorthand."""
    parts = {
        "font-family": declarations.get("font-family", ""),
        "font-weight": declarations.get("font-weight", ""),
        "font-size": declarations.get("font-size", ""),
        "line-height": declarations.get("line-height", ""),
    }
    shorthand = declarations.get("font", "")
    if shorthand:
        match = re.match(
            r"(?:(\d{3})\s+)?(\S+?)(?:/(\S+))?\s+(.+)$", shorthand.strip()
        )
        if match:
            weight, size, line_height, family = match.groups()
            parts["font-weight"] = parts["font-weight"] or (weight or "")
            parts["font-size"] = parts["font-size"] or size
            parts["line-height"] = parts["line-height"] or (line_height or "")
            parts["font-family"] = parts["font-family"] or family
    return {key: normalise(value) for key, value in parts.items()}


def px(value: str) -> float:
    text = (value or "").strip()
    if text == "0":
        return 0.0
    match = re.match(r"(\d+(?:\.\d+)?)px", text)
    if not match:
        raise AssertionError(f"not a px value: {value!r}")
    return float(match.group(1))


def card_index(selector: str):
    """Return the card index (1-3) a selector applies to, or None."""
    match = re.search(r"feature-detail-card:(?:nth-child|nth-of-type)\((\d+)\)", selector)
    return int(match.group(1)) if match else None


class SharedHeightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()

    def test_sida_content_group_is_centered_below_the_header(self):
        section = base(self.css, ".sida-section")
        self.assertEqual(normalise(section.get("justify-content", "")), "center")
        self.assertEqual(px(section.get("padding-bottom", "")), 32.0)

    def test_desktop_height_is_the_scaled_448_608_ramp(self):
        tabs = base(self.css, TABS)
        self.assertEqual(normalise(tabs.get("--feature-height", "")), normalise(SHARED_HEIGHT))
        self.assertNotIn("clamp(560px,66vh,760px)", self.css, "the old 100 % height ramp must be gone")

    def test_directory_stretches_against_the_copy_column(self):
        listing = base(self.css, LIST)
        panels = base(self.css, PANELS)
        self.assertEqual(normalise(listing.get("height", "")), "100%",
                         "the tabs fill whatever height the rows need")
        self.assertEqual(normalise(panels.get("height", "")), "auto",
                         "the copy column sizes to the 56/24 type")
        self.assertEqual(px(panels.get("min-height")), 0.0)
        self.assertEqual(normalise(listing.get("grid-template-rows", "")), "repeat(4,minmax(0,1fr))")
        self.assertEqual(px(listing.get("gap", "")), 20.0)

    def test_short_viewport_overrides_are_384_and_416(self):
        overrides = {}
        for prelude, body in split_media(self.css)[1]:
            for selectors, declarations in rules(body):
                if normalise(TABS) in selectors and "--feature-height" in declarations:
                    overrides.setdefault(normalise(declarations["--feature-height"]), []).append(prelude)
        self.assertEqual(
            sorted(overrides), ["384px", "416px"],
            f"expected exactly the 384px and 416px short-height bands, found {overrides}",
        )
        short_band = overrides["384px"][0]
        self.assertIn("max-height:800px", short_band, f"384px belongs to the 800/601 band: {short_band}")
        self.assertIn("min-height:601px", short_band, f"384px belongs to the 800/601 band: {short_band}")
        for stale in ("--feature-height:480px", "--feature-height:520px"):
            self.assertNotIn(stale, self.css, f"stale shared height: {stale}")


class CardLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()

    def test_three_cards_stack_in_one_column(self):
        stack = base(self.css, STACK)
        self.assertEqual(stack.get("display"), "grid")
        self.assertEqual(normalise(stack.get("grid-template-columns", "")),
                         "minmax(0,1fr)", "one column holds every row")
        self.assertEqual(normalise(stack.get("grid-auto-rows", "")),
                         "minmax(0,auto)", "each row grows with its own copy")
        self.assertEqual(stack.get("height"), "auto")
        self.assertEqual(normalise(stack.get("gap", "")), "0",
                         "the hairlines replace the gutter")

    def test_desktop_grid_is_two_columns(self):
        tabs = base(self.css, TABS)
        tracks = tabs.get("grid-template-columns", "")
        self.assertEqual(tracks.count("minmax("), 2, f"expected two columns, found {tracks!r}")
        self.assertEqual(tabs.get("align-items"), "stretch")

    def test_panel_is_a_bare_host_and_the_card_owns_the_surface(self):
        panel = base(self.css, PANEL)
        self.assertEqual(panel.get("padding"), "0")
        self.assertEqual(panel.get("border"), "0")
        self.assertEqual(panel.get("background"), "transparent")
        self.assertEqual(panel.get("overflow"), "visible")

        card = base(self.css, CARD)
        self.assertEqual(normalise(card.get("border-radius", "")), "0")
        self.assertEqual(normalise(card.get("background", "")), "none",
                         "the card surface is gone")
        self.assertEqual(normalise(card.get("box-shadow", "")), "none")
        padding = card.get("padding", "").split()
        self.assertEqual(len(padding), 2, f"rows need a two-value padding, found {padding!r}")
        divider = base(self.css, CARD + "+" + CARD)
        self.assertEqual(normalise(divider.get("border-top", "")),
                         "1pxsolidrgba(155,181,210,.3)",
                         "neighbouring rows are split by one hairline")

        body_rule = base(self.css, BODY)
        self.assertEqual(normalise(body_rule.get("margin", "")), "0")
        self.assertEqual(body_rule.get("color"), "#c0cede")


class TypographyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()

    def assert_type(self, title: dict, body: dict, size: str, body_size: str, where: str) -> None:
        font = font_parts(title)
        self.assertEqual(font["font-size"], normalise(size), f"{where}: title size")
        self.assertEqual(normalise(body.get("font-size", "")), normalise(body_size),
                         f"{where}: body size")

    def test_base_title_is_manrope_400_at_the_scaled_display_size(self):
        title = base(self.css, TITLE)
        font = font_parts(title)
        self.assertTrue(
            "manrope" in font["font-family"] or "var(--display" in font["font-family"],
            f"the card title must use the Manrope display family, found {font['font-family']!r}",
        )
        self.assertEqual(font["font-weight"], "400")
        self.assertEqual(font["font-size"], normalise(BASE_TITLE_SIZE))
        self.assertEqual(font["line-height"], BASE_TITLE_LINE_HEIGHT)
        self.assertEqual(normalise(title.get("letter-spacing", "")), BASE_TITLE_SPACING)
        self.assertEqual(normalise(base(self.css, BODY).get("font-size", "")), BASE_BODY_SIZE)

    def test_desktop_widths_keep_the_56_24_scale(self):
        for prelude in (W1200, W1000):
            media = block(self.css, prelude)
            with self.subTest(media=prelude):
                self.assertNotIn(".feature-detail-card p", media,
                                 f"{prelude} must not downscale the 24px copy")
                self.assertNotIn(".feature-detail-card h3", media,
                                 f"{prelude} must not downscale the 56px title")
        mobile = block(self.css, MOBILE)
        self.assert_type(base(mobile, TITLE), base(mobile, BODY),
                         "32px", "18px", "mobile")

    def test_short_viewports_only_tighten_the_gutters(self):
        for height in (SHORT_HEIGHT, TINY_HEIGHT):
            prelude, media = block_with_height(self.css, height)
            with self.subTest(media=prelude, height=height):
                self.assertNotIn(".feature-detail-card p", media,
                                 f"{prelude} keeps the 24px copy")
                self.assertNotIn(".feature-detail-card h3", media,
                                 f"{prelude} keeps the 56px title")


class AlignmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()

    def test_first_and_third_rows_read_left_and_the_middle_right(self):
        expected = {1: "left", 2: "right", 3: "left"}
        base_css, medias = split_media(self.css)

        middle = base(base_css, CARD + ":nth-child(2)")
        self.assertEqual(normalise(middle.get("text-align", "")), "right",
                         "the middle row is right aligned")
        for selector in (CARD + ":nth-child(2) h3", CARD + ":nth-child(2) p"):
            self.assertEqual(normalise(base(base_css, selector).get("text-align", "")), "right")

        for selector, where in ((TITLE, "title"), (BODY, "body")):
            self.assertEqual(
                normalise(base(base_css, selector).get("text-align", "")),
                "left",
                f"the outer rows read left-aligned ({where})",
            )
        self.assertNotRegex(self.css, r"feature-detail-card:nth-child\((1|3)\)",
                            "the outer rows must not carry their own alignment rules")
        for prelude, body in medias:
            for selector in (TITLE, BODY):
                try:
                    value = normalise(base(body, selector).get("text-align", ""))
                except AssertionError:
                    continue
                if not value:
                    continue
                self.assertEqual(value, "left", f"{prelude}: {selector} must stay left")


class MobileCardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()
        cls.mobile = block(cls.css, MOBILE)

    def test_mobile_directory_keeps_a_68px_tap_target(self):
        button = base(self.mobile, BUTTON)
        self.assertEqual(px(button.get("min-height")), 68.0)

    def test_mobile_cards_stay_content_driven(self):
        stack = base(self.mobile, STACK)
        self.assertEqual(stack.get("height"), "auto")
        self.assertIn(normalise(stack.get("grid-template-columns", "")), {"1fr", "minmax(0,1fr)"})
        card = base(self.mobile, CARD)
        for prop in ("height", "max-height"):
            self.assertNotIn(prop, card, f"mobile cards must not fix {prop}")
        panels = base(self.mobile, PANELS)
        self.assertEqual(panels.get("height"), "auto")
        self.assertEqual(panels.get("max-height"), "none")
        self.assertEqual(base(self.mobile, PANEL).get("height"), "auto")

    def test_mobile_cards_are_not_clipped(self):
        for selectors, declarations in rules(self.mobile):
            if normalise(STACK) in selectors or normalise(CARD) in selectors:
                self.assertNotEqual(declarations.get("overflow"), "hidden",
                                    f"{selectors} must not clip mobile card copy")
                for prop in ("line-clamp", "-webkit-line-clamp", "max-height"):
                    self.assertNotIn(prop, declarations, f"{selectors} clips copy ({prop})")


class UnrelatedContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()

    def test_tab_buttons_keep_their_row_flexibility(self):
        button = base(self.css, BUTTON)
        self.assertEqual(px(button.get("min-height")), 0.0)
        self.assertEqual(normalise(button.get("border-radius", "")), "12px")
        self.assertEqual(normalise(button.get("border-left", ""))[:1], "3", "3px accent edge kept")

    def test_selected_tab_still_uses_the_accent_edge(self):
        selected = base(self.css, ".feature-tab-list button[aria-selected=true]")
        self.assertEqual(selected.get("border-left-color"), "var(--accent)")


if __name__ == "__main__":
    unittest.main(verbosity=2)
