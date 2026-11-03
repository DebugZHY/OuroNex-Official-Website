"""Static contract for the Business flowchart and the Application section.

Pins the desktop geometry of the engagement flowchart in ``assets/home.css``
(three entry cards, a fan-in bus, one dashed decision gate, a fan-out bus, three
service lanes, one delivery bar) plus the small-screen rules that must survive
it, and checks the markup and copy that drive the diagram.

Self-contained: reads only ``assets/home.css``, ``index.html`` and the home
dictionary; no browser, no server.
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
    "home.tendering-copy",
    "home.specific-copy",
    "home.saas-copy",
    "home.training-copy",
)
FLOW_KEYS = tuple(
    key
    for group in ("entry-1", "entry-2", "entry-3", "lane-1", "lane-2", "lane-3")
    for key in (f"home.flow-{group}-kicker", f"home.flow-{group}-title", f"home.flow-{group}-copy")
) + (
    "home.flow-band-title",
    "home.flow-band-note",
    "home.flow-final-title",
)

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")

MOBILE = "max-width:760px"
NARROW = "max-width:420px"
SHORT_DESKTOP = "max-height:760px"
TABLET_MIN = "min-width:761px"
LEFT_TO_RIGHT = "min-width:1101px"


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
        bodies = []
        offset = None
        for prelude, body, block_offset in self.medias:
            if all(normalise(fragment) in prelude for fragment in fragments):
                bodies.append(body)
                # The group ends at its last block; that is the point base rules
                # must not come after.
                offset = block_offset
        if not bodies:
            raise AssertionError(f"missing @media block containing {fragments}")
        # Several blocks can share a prelude; the cascade reads them in order, so
        # the whole group has to be inspected together.
        return "".join(bodies), offset

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


class BusinessFlowDesktopTests(BusinessScaleFixtures):
    def test_desktop_layout_is_centred_and_evenly_gapped(self):
        layout = self.base_rule(".business-layout")
        self.assert_decl(layout, "width", "min(1400px,calc(100% - 64px))!important")
        self.assert_decl(layout, "align-content", "center")
        self.assert_decl(layout, "gap", "clamp(14px,2.4vh,32px)")

    def test_desktop_type_scale(self):
        heading = self.base_rule(".business-layout h2")
        self.assert_decl(heading, "font-size", "clamp(38px,3.2vw,70px)")
        self.assertEqual(margin_side(heading, "bottom"), "0")
        self.assert_decl(self.base_rule(".flow-card h3"), "font-size", "23px")
        self.assert_decl(self.base_rule(".flow-kicker"), "font-size", "13px")
        self.assert_decl(self.base_rule(".flow-copy"), "font-size", "15px")
        self.assert_decl(self.base_rule(".flow-final__logo"), "width", "72px")

    def test_three_entry_cards_and_three_lane_cards_share_one_grid(self):
        stage = self.base_rule(".flow-stage")
        self.assert_decl(stage, "grid-template-columns", "repeat(3,minmax(0,1fr))")
        self.assert_decl(stage, "gap", "var(--flow-gap)")
        self.assert_decl(self.base_rule(".flow"), "--flow-gap", "18px")
        self.assert_decl(
            self.base_rule(".flow-card"),
            "padding",
            "clamp(15px,2.2vh,22px) 24px clamp(17px,2.4vh,24px)",
        )
        self.assert_decl(self.base_rule(".flow-card--lane"), "box-shadow", "inset 2px 0 0 rgba(114,158,255,.34)")

    def test_the_gate_collects_the_entries_and_splits_them_again(self):
        band = self.base_rule(".flow-band")
        self.assert_decl(band, "width", "min(540px,100%)")
        self.assert_decl(band, "margin", "0 auto")
        self.assert_decl(band, "border", "1px solid rgba(114,158,255,.34)")
        self.assert_decl(self.base_rule(".flow-band__title"), "font-size", "17px")
        self.assert_decl(self.base_rule(".flow-band__note"), "font-size", "13px")
        for pseudo in ("::after", "::before"):
            with self.subTest(pseudo=pseudo):
                self.assert_decl(
                    self.base_rule(f".flow-stage--entry .flow-card{pseudo}"), "display", "none"
                )
        self.assert_decl(self.base_rule(".flow-card::after"), "height", "20px")
        self.assert_decl(self.base_rule(".flow-band::after"), "height", "16px")
        self.assert_decl(self.base_rule(".flow-fan"), "height", "28px")
        self.assert_decl(self.base_rule(".flow-fan--in"), "height", "38px")

    def test_one_fan_buses_three_stems_onto_the_card_centres(self):
        for index, position in (
            (1, "calc((100% - 2*var(--flow-gap))/6)"),
            (2, "calc((100% - 2*var(--flow-gap))/2 + var(--flow-gap))"),
            (3, "calc(100% - (100% - 2*var(--flow-gap))/6)"),
        ):
            with self.subTest(stem=index):
                self.assert_decl(self.base_rule(f".flow-fan span:nth-child({index})"), "left", position)
        bus = self.base_rule(".flow-fan::before")
        self.assert_decl(bus, "left", "calc((100% - 2*var(--flow-gap))/6)")
        self.assert_decl(bus, "right", "calc((100% - 2*var(--flow-gap))/6)")
        self.assert_decl(bus, "height", "1px")

    def test_delivery_bar_closes_the_flow(self):
        final = self.base_rule(".flow-final")
        self.assert_decl(final, "border", "1px solid rgba(114,158,255,.26)")
        self.assert_decl(self.base_rule(".flow-final h3"), "font-size", "21px")
        mark = self.base_rule(".flow-final__logo")
        self.assert_decl(mark, "display", "block")
        self.assert_decl(mark, "object-fit", "contain")

    def test_delivery_rows_run_as_plain_hairline_rows(self):
        rows = self.base_rule(".delivery-rows")
        self.assert_decl(rows, "display", "grid")
        self.assert_decl(rows, "align-content", "start")
        row = self.base_rule(".delivery-row")
        self.assert_decl(row, "grid-template-columns", "minmax(0,1fr) minmax(0,.56fr)")
        self.assert_decl(row, "padding-block", "clamp(12px,1.5vh,16px)")
        self.assert_decl(row, "border-top", "1px solid rgba(120,150,200,.16)")
        self.assertNotIn("background", row, "the rows carry no card fill")
        self.assertNotIn("border-radius", row, "the rows carry no card corners")
        self.assert_decl(self.base_rule(".delivery-row__figure"), "height",
                         "clamp(96px,11.5vh,124px)")
        flipped = self.base_rule(".delivery-row--flip")
        self.assert_decl(flipped, "grid-template-columns", "minmax(0,.56fr) minmax(0,1fr)")
        self.assert_decl(
            self.base_rule(".delivery-row--flip .delivery-row__figure"), "grid-column", "1"
        )
        self.assert_decl(self.base_rule(".application-layout h2"), "font-size", "clamp(38px,3.2vw,70px)")


class BusinessFlowMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX_HTML.read_text(encoding="utf-8")
        section = cls.index[cls.index.index('id="business"'):]
        cls.business = section[:section.index("</section>")]

    def test_the_diagram_is_three_cards_gate_three_cards_one_bar(self):
        body = self.business
        self.assertEqual(body.count('class="flow-card"'), 3, "three entry cards")
        self.assertEqual(body.count('class="flow-card flow-card--lane"'), 3, "three lane cards")
        self.assertEqual(body.count('class="flow-fan flow-fan--in"'), 1, "one collecting bus")
        self.assertEqual(body.count('class="flow-fan"'), 1, "one splitting bus")
        self.assertEqual(body.count('class="flow-num"'), 3, "only the lanes are numbered, so no 1:1 read")
        self.assertEqual(body.count("<span></span>"), 6, "each bus anchors three stems")
        self.assertEqual(body.count('class="flow-pills"'), 0, "the chip row is retired")
        self.assertIn('src="assets/illustrations/sida-logo.png"', body, "the mark closes the flow")
        order = [body.index(marker) for marker in (
            "flow-stage--entry",
            "flow-fan flow-fan--in",
            'class="flow-band"',
            'class="flow-fan"',
            "flow-stage--lane",
            'class="flow-final"',
        )]
        self.assertEqual(order, sorted(order), "the flow must read top to bottom")

    def test_every_flow_string_is_translated(self):
        dictionary = json.loads(HOME_I18N.read_text(encoding="utf-8"))
        used = set(re.findall(r'data-i18n="(home\.flow-[^"]+)"', self.business))
        self.assertEqual(used, set(FLOW_KEYS), "markup and contract drifted apart")
        for key in FLOW_KEYS:
            with self.subTest(key=key):
                for locale in ("en", "zh-CN", "zh-TW"):
                    self.assertTrue(dictionary[key][locale].strip(), f"{key} {locale} is empty")

    def test_flow_html_matches_the_english_dictionary(self):
        dictionary = json.loads(HOME_I18N.read_text(encoding="utf-8"))
        pairs = re.findall(r'data-i18n="(home\.flow-[^"]+)">([^<]*)<', self.business)
        self.assertEqual(len(pairs), len(FLOW_KEYS))
        for key, text in pairs:
            with self.subTest(key=key):
                self.assertEqual(text, dictionary[key]["en"], f"{key} drift between HTML and home.json")


class BusinessFlowSmallScreenTests(BusinessScaleFixtures):
    def test_tablet_and_mobile_stack_the_diagram(self):
        for block, gap in (
            (self.media_block(TABLET_MIN, "max-width:1000px")[0], "12px"),
            (self.media_block(MOBILE)[0], "10px"),
        ):
            stage = self.media_rule(block, ".flow-stage")
            self.assert_decl(stage, "grid-template-columns", "1fr")
            self.assert_decl(stage, "gap", gap)
            self.assert_decl(self.media_rule(block, ".flow-fan"), "display", "none")

    def test_mobile_stack_keeps_a_readable_scale(self):
        body, _offset = self.media_block(MOBILE)
        self.assert_decl(self.media_rule(body, ".business-layout"), "width", "calc(100% - 32px)!important")
        self.assert_decl(self.media_rule(body, ".business-layout h2"), "font-size", "28px")
        self.assert_decl(self.media_rule(body, ".flow-card"), "padding", "16px 18px 18px")
        self.assert_decl(self.media_rule(body, ".flow-card h3"), "font-size", "19px")
        self.assert_decl(self.media_rule(body, ".flow-copy"), "font-size", "14px")
        self.assert_decl(self.media_rule(body, ".flow-final h3"), "font-size", "17px")
        self.assert_decl(
            self.media_rule(body, ".delivery-row"),
            "grid-template-columns",
            "minmax(0,1fr)",
        )

    def test_narrow_refinement_keeps_a_compact_scale(self):
        body, _offset = self.media_block(NARROW)
        self.assert_decl(self.media_rule(body, ".delivery-row"), "padding-block", "12px")
        self.assert_decl(self.media_rule(body, ".flow-card"), "padding", "14px 16px 16px")
        self.assert_decl(self.media_rule(body, ".flow-copy"), "font-size", "13px")

    def test_mobile_rules_win_the_cascade_over_the_desktop_scale(self):
        _body, offset = self.media_block(MOBILE)
        widened = (
            ".business-layout",
            ".business-layout h2",
            ".flow-stage",
            ".flow-card",
            ".flow-copy",
            ".flow-final",
            ".delivery-rows",
            ".delivery-row",
        )
        late = [
            selector
            for selectors, _declarations, position in self.base_rules
            if position > offset
            for selector in selectors
            if selector in {normalise(item) for item in widened}
        ]
        self.assertEqual(late, [], f"base rules after the mobile block would undo the stack: {late}")

    def test_short_desktop_keeps_the_compact_cards(self):
        body, _offset = self.media_block(SHORT_DESKTOP, TABLET_MIN)
        self.assert_decl(self.media_rule(body, ".delivery-row"), "padding-block", "18px")
        self.assert_decl(self.media_rule(body, ".flow-card"), "padding", "18px 20px 20px")
        self.assert_decl(self.media_rule(body, ".flow-card h3"), "font-size", "20px")


class SectionLedeRemovalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.html = INDEX_HTML.read_text(encoding="utf-8")
        self.css = HOME_CSS.read_text(encoding="utf-8")

    def test_neither_section_carries_a_lede_under_its_heading(self) -> None:
        self.assertNotIn('class="application-lede"', self.html)
        self.assertNotIn('class="business-lede"', self.html)
        self.assertNotIn("home.application-lede", self.html)
        self.assertNotIn("home.flow-lede", self.html)

    def test_the_lede_rules_are_gone_from_the_stylesheet(self) -> None:
        self.assertNotIn(".application-lede", self.css)
        self.assertNotIn(".business-lede", self.css)


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
