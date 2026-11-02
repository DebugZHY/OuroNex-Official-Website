"""Static CSS contract for the Business desktop scale-up.

Pins the exact desktop declarations the Home manager is applying to
``assets/home.css`` for the Business section, and guards the small-screen rules
that must survive that scale-up (≤760px stack, ≤420px refinements and the
short-desktop 761px+ band).

Self-contained: reads only ``assets/home.css``; no dependency on sibling test
modules, no browser, no server.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
HOME_CSS = REPO_ROOT / "assets" / "home.css"
INDEX_HTML = REPO_ROOT / "index.html"
HOME_I18N = REPO_ROOT / "assets" / "i18n" / "home.json"
COPY_KEYS = (
    "home.general-copy",
    "home.specific-copy",
    "home.saas-copy",
    "home.training-copy",
)

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")

MOBILE = "max-width:760px"
NARROW = "max-width:420px"
SHORT_DESKTOP = "max-height:760px"
TABLET_MIN = "min-width:761px"


def normalise(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").lower())


def parse_body(body: str) -> dict:
    declarations = {}
    for declaration in body.split(";"):
        if ":" not in declaration:
            continue
        prop, _, value = declaration.partition(":")
        declarations[prop.strip().lower()] = re.sub(r"\s+", " ", value.strip().lower())
    return declarations


def rules_with_offsets(css: str) -> list:
    found = []
    for match in RULE_RE.finditer(css):
        selectors = [normalise(part) for part in match.group(1).split(",") if part.strip()]
        if not selectors or any(selector.startswith("@") for selector in selectors):
            continue
        declarations = parse_body(match.group(2))
        if declarations:
            found.append((selectors, declarations, match.start()))
    return found


def split_media(css: str):
    """Return (base css, [(normalised prelude, body), ...]) in source order."""
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
        medias.append((normalise(prelude), css[brace + 1:end], position))
        index = end + 1
    return "".join(base_parts), medias


def margin_side(declarations: dict, side: str) -> str:
    """Resolve one side from ``margin``/``margin-bottom`` shorthands."""
    direct = declarations.get("margin-" + side)
    if direct is not None:
        return normalise(direct)
    shorthand = declarations.get("margin")
    if shorthand is None:
        return ""
    parts = shorthand.split()
    if len(parts) == 1:
        value = parts[0]
    elif len(parts) == 2:
        value = parts[0] if side in ("top", "bottom") else parts[1]
    elif len(parts) == 3:
        value = {"top": parts[0], "left": parts[1], "right": parts[1], "bottom": parts[2]}[side]
    else:
        value = {"top": parts[0], "right": parts[1], "bottom": parts[2], "left": parts[3]}[side]
    return normalise(value)


class BusinessScaleFixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = COMMENT_RE.sub("", HOME_CSS.read_text(encoding="utf-8"))
        cls.base, cls.medias = split_media(cls.css)
        cls.base_rules = rules_with_offsets(cls.base)

    def base_rule(self, selector: str) -> dict:
        target = normalise(selector)
        for selectors, declarations, _offset in self.base_rules:
            if target in selectors:
                return declarations
        raise AssertionError(f"{selector}: no base rule in assets/home.css")

    def media_block(self, *fragments: str):
        for prelude, body, offset in self.medias:
            if all(normalise(fragment) in prelude for fragment in fragments):
                return body, offset
        raise AssertionError(f"missing @media block containing {fragments}")

    def media_rule(self, body: str, selector: str) -> dict:
        target = normalise(selector)
        for selectors, declarations, _offset in rules_with_offsets(body):
            if target in selectors:
                return declarations
        raise AssertionError(f"{selector}: no rule in the media block")

    def assert_decl(self, declarations: dict, prop: str, expected: str) -> None:
        actual = declarations.get(prop)
        self.assertIsNotNone(actual, f"missing {prop}")
        self.assertEqual(
            normalise(actual),
            normalise(expected),
            f"{prop}: expected {expected!r}, found {actual!r}",
        )


class BusinessDesktopScaleTests(BusinessScaleFixtures):
    def test_desktop_layout_is_wide_and_evenly_gapped(self):
        layout = self.base_rule(".business-layout")
        self.assert_decl(layout, "width", "min(1920px,calc(100% - 64px))!important")
        self.assert_decl(layout, "grid-template-columns", "1.2fr .8fr")
        self.assert_decl(layout, "align-items", "center")
        self.assert_decl(layout, "gap", "clamp(40px,4vw,80px)")

    def test_desktop_type_scale(self):
        heading = self.base_rule(".business-layout h2")
        self.assert_decl(heading, "font-size", "clamp(38px,3.2vw,70px)")
        self.assertEqual(margin_side(heading, "bottom"), "32px", "h2 needs a 32px bottom margin")
        self.assert_decl(self.base_rule(".business-layout h3"), "font-size", "30px")
        self.assert_decl(self.base_rule(".business-layout p"), "font-size", "21px")

    def test_delivery_cards_grow(self):
        self.assert_decl(self.base_rule(".delivery-grid"), "gap", "20px")
        article = self.base_rule(".delivery-grid article")
        self.assert_decl(article, "min-height", "220px")
        self.assert_decl(article, "padding", "32px")
        self.assert_decl(article, "justify-content", "center")

    def test_process_rows_grow(self):
        self.assert_decl(self.base_rule(".process-list"), "gap", "20px")
        article = self.base_rule(".process-list article")
        self.assert_decl(article, "min-height", "132px")
        self.assert_decl(article, "padding", "12px 0 12px 28px")
        self.assert_decl(article, "border-left", "3px solid var(--accent-strong)")


class BusinessSmallScreenTests(BusinessScaleFixtures):
    def test_mobile_stack_keeps_a_readable_scale(self):
        body, _offset = self.media_block(MOBILE)
        layout = self.media_rule(body, ".business-layout")
        self.assert_decl(layout, "width", "calc(100% - 32px)!important")
        self.assert_decl(layout, "grid-template-columns", "1fr")
        self.assert_decl(self.media_rule(body, ".business-layout h2"), "font-size", "28px")
        self.assert_decl(self.media_rule(body, ".business-layout h3"), "font-size", "18px")
        self.assert_decl(self.media_rule(body, ".business-layout p"), "font-size", "15px")
        self.assert_decl(self.media_rule(body, ".process-list h3"), "font-size", "16px")
        self.assert_decl(self.media_rule(body, ".process-list p"), "font-size", "14px")
        self.assert_decl(self.media_rule(body, ".delivery-grid article"), "min-height", "0")
        self.assert_decl(self.media_rule(body, ".process-list article"), "min-height", "0")

    def test_narrow_refinement_keeps_the_larger_copy(self):
        body, _offset = self.media_block(NARROW)
        self.assert_decl(self.media_rule(body, ".business-layout p"), "font-size", "14px")
        self.assert_decl(self.media_rule(body, ".process-list h3"), "font-size", "15px")
        self.assert_decl(self.media_rule(body, ".delivery-grid article"), "padding", "12px")
        self.assert_decl(self.media_rule(body, ".process-list article"), "padding", "10px")

    def test_mobile_rules_win_the_cascade_over_the_desktop_scale(self):
        _body, offset = self.media_block(MOBILE)
        widened = (
            ".business-layout",
            ".business-layout h2",
            ".business-layout h3",
            ".business-layout p",
            ".delivery-grid",
            ".delivery-grid article",
            ".process-list",
            ".process-list article",
        )
        late = [
            selector
            for selectors, _declarations, position in self.base_rules
            if position > offset
            for selector in selectors
            if selector in {normalise(item) for item in widened}
        ]
        self.assertEqual(late, [], f"base rules after the mobile block would undo the stack: {late}")
        for selectors, _declarations, position in self.base_rules:
            if any(selector in {normalise(item) for item in widened} for selector in selectors):
                self.assertLess(position, offset, "desktop rules must precede the mobile overrides")

    def test_short_desktop_keeps_the_compact_delivery_cards(self):
        body, _offset = self.media_block(SHORT_DESKTOP, TABLET_MIN)
        article = self.media_rule(body, ".delivery-grid article")
        self.assert_decl(article, "min-height", "120px")


class BusinessCopyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX_HTML.read_text(encoding="utf-8")
        cls.i18n = json.loads(HOME_I18N.read_text(encoding="utf-8"))

    def html_copy(self, key: str) -> str:
        match = re.search(
            rf'<p><span data-i18n="{re.escape(key)}">(.*?)</span></p>', self.index
        )
        if not match:
            raise AssertionError(f"{key}: no paragraph in index.html")
        return match.group(1)

    def test_the_four_cards_use_short_descriptions(self):
        for key in COPY_KEYS:
            with self.subTest(key=key):
                copy = self.html_copy(key)
                self.assertLessEqual(len(copy), 100, f"{key}: {len(copy)} chars is too long")
                self.assertNotIn("Powered by an LLM wiki", copy)

    def test_dictionary_matches_the_short_html_copy(self):
        for key in COPY_KEYS:
            with self.subTest(key=key):
                self.assertEqual(self.i18n[key]["en"], self.html_copy(key), key)
                for locale in ("zh-CN", "zh-TW"):
                    self.assertTrue(self.i18n[key][locale].strip(), f"{key} {locale} empty")


if __name__ == "__main__":
    unittest.main(verbosity=2)
