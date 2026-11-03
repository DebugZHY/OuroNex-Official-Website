"""SIDA feature section: a quiet directory rail beside three detail rows.

Contract pinned here:

* the section content is centred; ``.feature-layout`` is one 1332px column and
  ``.feature-tabs`` is a grid of a 448px rail plus the copy column, both
  vertically centred on one another;
* the rail is a list of hairline rows: no card boxes, no radius, no fill, a 2px
  gradient accent bar on the selected row, 45px soft-glow line icons and a
  24px Manrope label;
* the copy column is separated from the rail by a 1px rule that carries a
  112px blue fade at the top, and its three rows are split by 1px hairlines
  with a closing rule under the last one;
* row typography: Manrope 500 34px/1.16 title with a 16.5px/1.74 body capped
  at 62ch; on ≤760 the block stacks, the rule disappears, the title is 26px
  and the body 16px; ≤420 tightens to 23/15.

Only ``assets/home.css`` is read: no browser, no server.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
HOME_CSS = REPO_ROOT / "assets" / "home.css"

BASE_RAIL = "max-content"
MEDIUM_RAIL = "max-content"
NARROW_RAIL = "max-content"

BASE_TITLE_SIZE = "41px"
BASE_TITLE_LINE_HEIGHT = "1.16"
BASE_TITLE_SPACING = "-.03em"
BASE_BODY_SIZE = "20px"
BASE_BODY_LINE_HEIGHT = "1.74"
BODY_MEASURE = "62ch"

HAIRLINE = "1pxsolidrgba(155,181,210,.13)"

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")

TABS = ".feature-tabs"
LIST = ".feature-tab-list"
BUTTON = ".feature-tab-list button"
ICON = ".feature-tab-list .directory-icon"
SELECTED = BUTTON + "[aria-selected=true]"
ACCENT = BUTTON + "::before"
PANELS = ".feature-panels"
PANEL = ".feature-panel"
STACK = ".feature-card-stack"
CARD = ".feature-detail-card"
TITLE = ".feature-detail-card h3"
BODY = ".feature-detail-card p"

W1200 = ("max-width:1200px",)
W1000 = ("max-width:1000px", "min-width:761px")
MOBILE = ("max-width:760px",)
TINY = ("max-width:420px",)


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


def font_parts(declarations: dict) -> dict:
    parts = {
        "font-family": declarations.get("font-family", ""),
        "font-weight": declarations.get("font-weight", ""),
        "font-size": declarations.get("font-size", ""),
        "line-height": declarations.get("line-height", ""),
    }
    shorthand = declarations.get("font", "")
    if shorthand:
        match = re.match(r"(?:(\d{3})\s+)?(\S+?)(?:/(\S+))?\s+(.+)$", shorthand.strip())
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


class ShellTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()

    def test_section_sits_on_the_shared_background(self):
        section = base(self.css, ".sida-section")
        self.assertEqual(normalise(section.get("background", "")), "transparent",
                         "the SIDA section paints no panel of its own")
        self.assertEqual(normalise(section.get("justify-content", "")), "center")
        self.assertEqual(px(section.get("padding-bottom", "")), 8.0)

    def test_layout_centres_one_1180_column(self):
        layout = base(self.css, ".feature-layout")
        self.assertEqual(normalise(layout.get("align-content", "")), "center")
        self.assertEqual(normalise(layout.get("gap", "")), "0")
        self.assertEqual(normalise(layout.get("padding", "")), "0",
                         "the copy block leaves all spacing to the CTA row")
        self.assertIn("min(1332px,calc(100%-64px))",
                      normalise(layout.get("width", "")),
                      "the SIDA column is capped at 1332px")

    def test_cta_row_is_pushed_away_from_the_copy(self):
        row = base(self.css, ".sida-section .download-row")
        self.assertEqual(normalise(row.get("margin-top", "")), "clamp(14px,1.8vh,26px)",
                         "the download row keeps a clear break below the copy")

    def test_no_fixed_shared_height_survives(self):
        self.assertNotIn("--feature-height", self.css,
                         "the old clamp-driven shared height is retired")


class RailTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()

    def test_base_grid_is_a_content_rail_plus_copy(self):
        tabs = base(self.css, TABS)
        self.assertEqual(normalise(tabs.get("grid-template-columns", "")),
                         f"{BASE_RAIL}minmax(0,1fr)")
        self.assertEqual(normalise(tabs.get("align-items", "")), "center",
                         "the rail is centred against the copy column")
        self.assertEqual(normalise(tabs.get("gap", "")), "0",
                         "the rule, not a gutter, divides the two columns")

    def test_narrower_viewports_fluidise_the_rail(self):
        wide = rules(block(self.css, W1200))
        tracks = [decl.get("grid-template-columns", "") for selectors, decl in wide
                  if normalise(TABS) in selectors]
        self.assertTrue(any(normalise(t).startswith(normalise(MEDIUM_RAIL)) for t in tracks),
                        f"<=1200 keeps the content rail, found {tracks}")

        tablet = rules(block(self.css, W1000))
        tracks = [decl.get("grid-template-columns", "") for selectors, decl in tablet
                  if normalise(TABS) in selectors]
        self.assertTrue(any(normalise(t).startswith(normalise(NARROW_RAIL)) for t in tracks),
                        f"the tablet band keeps the content rail, found {tracks}")

        self.assertNotIn("min-width:1001px", self.css,
                         "the tablet band alone owns 1001-1200, so the fixed rail is never "
                         "overridden by a second breakpoint")

    def test_mobile_stacks_the_rail_above_the_copy(self):
        mobile = rules(block(self.css, MOBILE))
        tabs = [decl for selectors, decl in mobile if normalise(TABS) in selectors][0]
        self.assertEqual(normalise(tabs.get("grid-template-columns", "")), "1fr")
        listing = [decl for selectors, decl in mobile if normalise(LIST) in selectors][0]
        self.assertEqual(normalise(listing.get("grid-template-columns", "")), "1fr")
        self.assertEqual(normalise(listing.get("padding-right", "")), "0")


class DirectoryRowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()

    def test_rows_are_hairline_strips_not_card_boxes(self):
        button = base(self.css, BUTTON)
        self.assertEqual(normalise(button.get("border", "")), "0")
        self.assertEqual(normalise(button.get("border-radius", "")), "0")
        self.assertEqual(normalise(button.get("background", "")), "none")
        self.assertEqual(normalise(button.get("border-top", "")), HAIRLINE)
        self.assertEqual(normalise(base(self.css, BUTTON + ":last-child").get("border-bottom", "")),
                         HAIRLINE, "the list closes with the same hairline as the row dividers")

    def test_row_padding_and_label(self):
        button = base(self.css, BUTTON)
        self.assertEqual(normalise(button.get("padding", "")), "29px9px29px27px")
        self.assertEqual(normalise(button.get("grid-template-columns", "")),
                         "64pxminmax(0,1fr)")
        font = font_parts(button)
        self.assertEqual(font["font-size"], "24px")
        self.assertEqual(font["font-weight"], "500")
        self.assertIn("--display", font["font-family"])

    def test_list_is_centred_and_not_stretched(self):
        listing = base(self.css, LIST)
        self.assertEqual(normalise(listing.get("align-content", "")), "center")
        self.assertEqual(normalise(listing.get("height", "")), "auto")
        self.assertEqual(px(listing.get("padding-right", "")), 36.0)
        self.assertEqual(normalise(listing.get("gap", "")), "0")
        self.assertEqual(normalise(listing.get("border", "")), "0",
                         "the rail drops the inherited tablist underline")

    def test_selected_row_uses_a_gradient_accent_bar(self):
        accent = base(self.css, ACCENT)
        self.assertEqual(normalise(accent.get("width", "")), "2px")
        self.assertIn("linear-gradient", normalise(accent.get("background", "")))
        self.assertEqual(normalise(accent.get("opacity", "")), "0")
        self.assertEqual(normalise(base(self.css, SELECTED + "::before").get("opacity", "")), "1")
        selected = base(self.css, SELECTED)
        self.assertEqual(normalise(selected.get("background", "")), "none",
                         "selection never repaints the row as a card")
        self.assertEqual(normalise(selected.get("box-shadow", "")), "none")

    def test_directory_icon_is_a_45px_soft_glow_line(self):
        icon = base(self.css, ICON)
        self.assertEqual(px(icon.get("width", "")), 45.0)
        self.assertEqual(px(icon.get("height", "")), 45.0)
        self.assertIn("drop-shadow", normalise(icon.get("filter", "")))
        selected_icon = base(self.css, BUTTON + "[aria-selected=true]" + " .directory-icon")
        self.assertEqual(normalise(selected_icon.get("color", "")), "#e6f1ff")
        self.assertEqual(normalise(selected_icon.get("filter", "")).count("drop-shadow"), 2,
                         "the active row doubles its glow")


class CopyColumnTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()

    def test_column_carries_a_rule_with_a_blue_fade(self):
        panels = base(self.css, PANELS)
        self.assertEqual(px(panels.get("padding-left", "")), 53.0)
        self.assertEqual(normalise(panels.get("border-left", "")), HAIRLINE)
        fade = base(self.css, PANELS + "::before")
        self.assertEqual(px(fade.get("width", "")), 1.0)
        self.assertEqual(px(fade.get("height", "")), 136.0)
        self.assertIn("#729eff", normalise(fade.get("background", "")))

    def test_panel_is_a_bare_host(self):
        panel = base(self.css, PANEL)
        self.assertEqual(panel.get("padding"), "0")
        self.assertEqual(panel.get("border"), "0")
        self.assertEqual(panel.get("background"), "transparent")
        self.assertEqual(panel.get("overflow"), "visible")

    def test_three_rows_stack_with_no_surface(self):
        stack = base(self.css, STACK)
        self.assertEqual(normalise(stack.get("grid-template-columns", "")), "minmax(0,1fr)")
        self.assertEqual(normalise(stack.get("gap", "")), "0")

        card = base(self.css, CARD)
        self.assertEqual(normalise(card.get("border-radius", "")), "0")
        self.assertEqual(normalise(card.get("background", "")), "none")
        self.assertEqual(normalise(card.get("box-shadow", "")), "none")
        self.assertEqual(normalise(card.get("border-top", "")), HAIRLINE)
        self.assertEqual(normalise(card.get("padding", "")), "24px028px")

    def test_first_row_loses_its_rule_and_the_last_closes(self):
        first = base(self.css, CARD + ":first-child")
        self.assertEqual(normalise(first.get("border-top", "")), "0")
        self.assertEqual(px(first.get("padding-top", "")), 2.0)
        last = base(self.css, CARD + ":last-child")
        self.assertEqual(normalise(last.get("border-bottom", "")), HAIRLINE)

    def test_hover_rule_is_a_gradient_sweep(self):
        sweep = base(self.css, CARD + "::after")
        self.assertEqual(normalise(sweep.get("transform", "")), "scalex(0)")
        self.assertIn("linear-gradient", normalise(sweep.get("background", "")))
        self.assertEqual(normalise(base(self.css, CARD + ":hover::after").get("transform", "")),
                         "scalex(1)")

    def test_rows_all_read_left(self):
        self.assertNotIn("feature-detail-card:nth-child(2)", self.css,
                         "the old right-anchored middle row is gone")


class TypographyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()

    def test_title_is_manrope_500_at_34px(self):
        font = font_parts(base(self.css, TITLE))
        self.assertIn("--display", font["font-family"])
        self.assertEqual(font["font-weight"], "500")
        self.assertEqual(font["font-size"], normalise(BASE_TITLE_SIZE))
        self.assertEqual(font["line-height"], BASE_TITLE_LINE_HEIGHT)
        self.assertEqual(normalise(base(self.css, TITLE).get("letter-spacing", "")),
                         BASE_TITLE_SPACING)

    def test_body_is_20_over_1_74_capped_at_62ch(self):
        body = base(self.css, BODY)
        self.assertEqual(normalise(body.get("font-size", "")), BASE_BODY_SIZE)
        self.assertEqual(normalise(body.get("line-height", "")), BASE_BODY_LINE_HEIGHT)
        self.assertEqual(normalise(body.get("max-width", "")), BODY_MEASURE)
        self.assertEqual(normalise(body.get("color", "")), "#a7b9cd")

    def test_mobile_type_steps_down(self):
        mobile = rules(block(self.css, MOBILE))
        title = [decl for selectors, decl in mobile if normalise(TITLE) in selectors][0]
        self.assertEqual(normalise(title.get("font-size", "")), "26px")
        body = [decl for selectors, decl in mobile if normalise(BODY) in selectors][0]
        self.assertEqual(normalise(body.get("font-size", "")), "16px")

        tiny = rules(block(self.css, TINY))
        title = [decl for selectors, decl in tiny if normalise(TITLE) in selectors][0]
        self.assertEqual(normalise(title.get("font-size", "")), "23px")
        body = [decl for selectors, decl in tiny if normalise(BODY) in selectors][0]
        self.assertEqual(normalise(body.get("font-size", "")), "15px")


class MobileShellTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()

    def test_mobile_drops_the_column_rule_and_fade(self):
        mobile = rules(block(self.css, MOBILE))
        panels = [decl for selectors, decl in mobile if normalise(PANELS) in selectors][0]
        self.assertEqual(px(panels.get("padding-left", "")), 0.0)
        self.assertEqual(normalise(panels.get("border-left", "")), "0")
        fade = [decl for selectors, decl in mobile if normalise(PANELS + "::before") in selectors]
        self.assertTrue(fade and normalise(fade[0].get("display", "")) == "none",
                        "the blue fade is hidden once the columns stack")

    def test_mobile_rows_keep_their_padding_rhythm(self):
        mobile = rules(block(self.css, MOBILE))
        button = [decl for selectors, decl in mobile if normalise(BUTTON) in selectors][0]
        self.assertEqual(normalise(button.get("padding", "")), "18px6px18px16px")
        icon = [decl for selectors, decl in mobile if normalise(ICON) in selectors][0]
        self.assertEqual(px(icon.get("width", "")), 32.0)


if __name__ == "__main__":
    unittest.main()
