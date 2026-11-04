"""SIDA feature panels: four filled stages inside the tab shell.

The panel was rebuilt twice after this module was written - first the photo
panels went, then the twelve-card stack. What ships today is one fixed-height
``.feature-panels`` box holding four ``.feature-panel`` tabpanels, and each panel
holds exactly one ``.feature-stage``:

* ``feature-engineering`` - a ``.sida-tagcloud`` code index, mounted by
  ``sida-wordcloud.js``;
* ``feature-workflow`` - a ``.sida-flow`` canvas, mounted by
  ``sida-workflow.js``;
* ``feature-free`` - a ``.feature-shot`` screenshot of
  ``assets/illustrations/professional-tools.jpg``;
* ``feature-experts`` - a ``.feature-shot--experts`` screenshot of
  ``assets/illustrations/multidisciplinary-experts.png``.

The live panels ship only a translated loading fallback; the screenshots ship
their ``alt`` text. The test names below are kept from the card era for
traceability, and every body now pins today's stage markup and the stage CSS in
``assets/sida-panels.css`` (the panel-shell rules stay in ``assets/home.css``).

Self-contained stdlib checks (regex + div slicing); no browser, no server.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_HTML = REPO_ROOT / "index.html"
HOME_CSS = REPO_ROOT / "assets" / "home.css"
SIDA_CSS = REPO_ROOT / "assets" / "sida-panels.css"
ILLUSTRATIONS = REPO_ROOT / "assets" / "illustrations"

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")
STAGE_RE = re.compile(r'class="feature-stage(?: [^"]*)?"')

# Panel id -> the single stage that panel renders, in DOM (tab) order.
PANEL_STAGES = (
    {
        "panel": "feature-engineering",
        "tab": "tab-engineering",
        "stage_class": "feature-stage",
        "node_class": "sida-tagcloud sida-wordcloud",
        "hook": 'data-sida-wordcloud=""',
        "fallback_class": "sida-wordcloud__fallback",
        "fallback_text": "Loading the code index\u2026",
        "src": None,
        "alt": None,
    },
    {
        "panel": "feature-workflow",
        "tab": "tab-workflow",
        "stage_class": "feature-stage",
        "node_class": "sida-flow",
        "hook": 'data-sida-flow=""',
        "fallback_class": "sida-flow__fallback",
        "fallback_text": "Loading project workflow\u2026",
        "src": None,
        "alt": None,
    },
    {
        "panel": "feature-free",
        "tab": "tab-free",
        "stage_class": "feature-stage feature-stage--media",
        "node_class": "feature-shot",
        "hook": None,
        "fallback_class": None,
        "fallback_text": None,
        "src": "assets/illustrations/professional-tools.jpg",
        "alt": "The SIDA professional tool set",
    },
    {
        "panel": "feature-experts",
        "tab": "tab-experts",
        "stage_class": "feature-stage feature-stage--media",
        "node_class": "feature-shot feature-shot--experts",
        "hook": None,
        "fallback_class": None,
        "fallback_text": None,
        "src": "assets/illustrations/multidisciplinary-experts.png",
        "alt": (
            "The SIDA bot manager with specialist agents assigned to preliminary "
            "design, modelling, structural analysis and review"
        ),
    },
)

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

# The photo-era illustration files that the rebuild deleted from assets/.
LEGACY_ASSETS = ("sida-1-photo.jpg", "sida-2-visual.jpg", "sida-3.png")

# Markup hooks of the retired twelve-card stack.
RETIRED_CARD_MARKERS = ("feature-card-stack", "feature-detail-card")


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
    raise AssertionError(f"{selector}: no such rule in the stylesheet")


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


def text_of(markup: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", " ", markup).split())


class FeatureDetailCardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX_HTML.read_text(encoding="utf-8")
        cls.home_css = COMMENT_RE.sub("", HOME_CSS.read_text(encoding="utf-8"))
        cls.home_base, cls.home_medias = split_media(cls.home_css)
        cls.sida_css = COMMENT_RE.sub("", SIDA_CSS.read_text(encoding="utf-8"))
        cls.sida_base, cls.sida_medias = split_media(cls.sida_css)

        start = cls.index.index('<div class="feature-panels">')
        _, end = div_bounds(cls.index, start)
        cls.panels_block = cls.index[start:end]

    def panel(self, panel_id: str) -> str:
        match = re.search(
            r'<article[^>]*id="' + panel_id + r'".*?</article>', self.panels_block, re.S
        )
        self.assertIsNotNone(match, f"missing panel {panel_id}")
        return match.group(0)

    def stage_html(self, panel_id: str) -> str:
        """The panel's single stage element, article wrapper removed."""
        block = self.panel(panel_id)
        inner = block[block.index(">") + 1: block.rindex("</article>")]
        open_index = inner.index("<div")
        start, end = div_bounds(inner, open_index)
        self.assertEqual(inner[:start].strip(), "", f"{panel_id}: stage must open the panel")
        self.assertEqual(
            inner[end:].strip(), "", f"{panel_id}: the stage is the panel's only child"
        )
        return inner[start:end]

    def media(self, needle: str, medias=None) -> str:
        for prelude, body in (medias if medias is not None else self.sida_medias):
            if needle in prelude:
                return body
        raise AssertionError(f"missing the {needle} block")

    # -- markup -----------------------------------------------------------

    def test_every_panel_holds_one_card_stack(self):
        """The card stack is retired; each panel now holds one .feature-stage."""
        self.assertEqual(self.panels_block.count('class="feature-panel"'), 4)
        self.assertEqual(len(STAGE_RE.findall(self.panels_block)), 4,
                         "one stage per panel, four in total")
        for marker in RETIRED_CARD_MARKERS:
            self.assertNotIn(marker, self.panels_block,
                             f"the retired twelve-card stack is gone: {marker}")
        for spec in PANEL_STAGES:
            with self.subTest(panel=spec["panel"]):
                stage = self.stage_html(spec["panel"])
                self.assertRegex(stage, r'^<div class="feature-stage[^"]*"')
                self.assertEqual(re.match(r'<div class="([^"]*)"', stage).group(1),
                                 spec["stage_class"])

    def test_each_stack_holds_three_titled_cards_with_title_then_copy(self):
        """Named for the three titled cards it replaced; each stage now carries one
        labelled content node - a live data mount or a titled screenshot."""
        for spec in PANEL_STAGES:
            with self.subTest(panel=spec["panel"]):
                stage = self.stage_html(spec["panel"])
                self.assertEqual(stage.count(f'class="{spec["node_class"]}"'), 1,
                                 f'{spec["panel"]}: exactly one content node')
                if spec["fallback_class"]:
                    self.assertIn(spec["hook"], stage,
                                  f'{spec["panel"]}: the live panel keeps its mount hook')
                    self.assertEqual(stage.count(f'class="{spec["fallback_class"]}"'), 1)
                    self.assertEqual(text_of(stage), spec["fallback_text"],
                                     "the live panel ships its loading fallback only")
                    self.assertNotIn("<img", stage,
                                     "the live panels render their own DOM, not a screenshot")
                else:
                    self.assertIn("<figure", stage)
                    self.assertEqual(stage.count("<img"), 1)
                    self.assertEqual(re.search(r'src="([^"]+)"', stage).group(1), spec["src"])
                    self.assertEqual(re.search(r'alt="([^"]*)"', stage).group(1), spec["alt"])
                    self.assertEqual(text_of(stage), "", "a screenshot panel ships no inline copy")

    def test_twelve_cards_render_in_panel_order(self):
        """The twelve cards are gone; the four stages still render in tab order."""
        self.assertEqual(self.panels_block.count('class="feature-panel"'), 4)
        for marker in RETIRED_CARD_MARKERS:
            self.assertEqual(self.panels_block.count(marker), 0,
                             f"the twelve-card era markup is gone: {marker}")
        ids = re.findall(r'<article[^>]*class="feature-panel"[^>]*id="([^"]+)"',
                         self.panels_block)
        self.assertEqual(ids, [spec["panel"] for spec in PANEL_STAGES],
                         "panels render in tab order")
        nodes = re.findall(
            r'class="(sida-tagcloud sida-wordcloud|sida-flow|feature-shot[^"]*)"',
            self.panels_block,
        )
        self.assertEqual(nodes, [spec["node_class"] for spec in PANEL_STAGES],
                         "code cloud, then workflow, then the two screenshots")
        srcs = re.findall(r'<img[^>]*src="([^"]+)"', self.panels_block)
        self.assertEqual(srcs, [spec["src"] for spec in PANEL_STAGES if spec["src"]])
        for src in srcs:
            with self.subTest(src=src):
                self.assertTrue((REPO_ROOT / src).is_file(), f"{src} must exist on disk")
                self.assertTrue(src.startswith("assets/illustrations/"),
                                "panel screenshots stay in the local illustration folder")

    def test_legacy_photo_panels_are_gone(self):
        """The 2024 photo panels stay gone; media returned through stage--media/shots."""
        for marker in LEGACY_MARKERS:
            with self.subTest(marker=marker):
                self.assertNotIn(marker, self.index, f"removed photo design remnant: {marker}")
                self.assertNotIn(marker, self.home_css, f"removed photo CSS remnant: {marker}")
                self.assertNotIn(marker, self.sida_css, f"removed photo CSS remnant: {marker}")
        for name in LEGACY_ASSETS:
            with self.subTest(asset=name):
                self.assertFalse((ILLUSTRATIONS / name).exists(),
                                 f"the photo-era illustration is deleted: {name}")
        self.assertEqual(self.panels_block.count('class="feature-stage feature-stage--media"'), 2,
                         "only the two screenshot panels opt into the media stage")
        self.assertEqual(len(re.findall(r'<figure class="feature-shot', self.panels_block)), 2,
                         "the screenshots live in .feature-shot figures, not photo frames")
        self.assertEqual(self.panels_block.count("<img"), 2)

    def test_inline_title_prefixes_are_gone_from_the_copy(self):
        """The cards' 'Pain Point:' prefixes went with the copy: today the panel
        shells carry only their loading fallbacks."""
        self.assertEqual(self.panels_block.count("<h3>"), 0, "no card titles survive")
        for prefix in ("Pain Point:", "Fast Retrieval:", "Confidentiality:", "Typical Agents:"):
            self.assertNotIn(prefix, self.panels_block)
        fallbacks = [spec["fallback_text"] for spec in PANEL_STAGES if spec["fallback_text"]]
        self.assertEqual(text_of(self.panels_block), " ".join(fallbacks),
                         "the only text in the panel shells is the two loading fallbacks")

    # -- desktop styling --------------------------------------------------

    def test_card_stack_places_three_equal_rows_in_one_column(self):
        """The three-row stack is retired; one stage fills the fixed panel height."""
        panels = declarations(self.sida_base, ".feature-panels")
        self.assertEqual(panels.get("height"), "var(--stage-h)",
                         "the panels box keeps one fixed stage height")
        self.assertIn("clamp(", panels.get("--stage-h", ""),
                      "the stage height is a viewport-aware clamp")
        panel = declarations(self.sida_base, ".feature-panel")
        self.assertEqual(panel.get("height"), "100%")
        stage = declarations(self.sida_base, ".feature-stage")
        self.assertEqual(stage.get("display"), "grid")
        self.assertEqual(normalise(stage.get("place-content", "")), "stretch",
                         "the single stage stretches to fill the panel")
        self.assertEqual(stage.get("height"), "100%")
        self.assertEqual(normalise(declarations(self.sida_base, ".feature-stage--media")
                                   .get("place-content", "")), "center",
                         "screenshot stages centre their shot")
        self.assertEqual(self.panels_block.count("feature-card-stack"), 0)

    def test_detail_card_has_no_surface(self):
        """The flat text rows are gone; the stage that replaced them is a bordered
        surface, and the retired card rule paints nothing."""
        for selector in (".sida-tagcloud", ".sida-flow", ".feature-shot"):
            with self.subTest(selector=selector):
                rule = declarations(self.sida_base, selector)
                self.assertEqual(normalise(rule.get("border", "")),
                                 "1pxsolidrgba(155,181,210,.14)",
                                 "each stage is outlined by one hairline border")
                self.assertEqual(normalise(rule.get("border-radius", "")), "19px")
        self.assertNotIn("box-shadow", declarations(self.sida_base, ".sida-tagcloud"),
                         "the code index surface stays flat, no drop shadow")
        self.assertNotIn("box-shadow", declarations(self.sida_base, ".feature-shot"))
        for marker in RETIRED_CARD_MARKERS:
            self.assertEqual(self.index.count(marker), 0,
                             f"the card rule has no markup left to style: {marker}")

    def test_every_row_reads_left(self):
        """The left-aligned text rows are gone; every stage content is centred."""
        self.assertNotIn("feature-detail-card:nth-child(2)", self.home_css,
                         "the old right-anchored middle row rule is deleted")
        self.assertNotIn("feature-detail-card:nth-child(2)", self.sida_css)
        flow = declarations(self.sida_base, ".sida-flow__fallback")
        self.assertEqual(normalise(flow.get("place-items", "")), "center")
        self.assertEqual(normalise(flow.get("margin", "")), "0")
        tag = declarations(self.sida_base, ".sida-tagcloud__fallback")
        self.assertEqual(normalise(tag.get("align-self", "")), "center")
        self.assertEqual(normalise(tag.get("justify-self", "")), "center")
        self.assertEqual(normalise(declarations(self.sida_base, ".feature-shot")
                                   .get("place-items", "")), "center",
                         "the screenshots are centred in their frame")
        self.assertEqual(self.index.count("feature-detail-card"), 0)

    def test_rows_are_separated_by_a_hairline(self):
        """The detail rows' hairlines went with the rows; today the tab list and the
        panels rail carry the hairlines."""
        button = declarations(self.home_base, ".feature-tab-list button")
        self.assertEqual(normalise(button.get("border-top", "")),
                         "1pxsolidrgba(155,181,210,.13)",
                         "each directory entry opens with a hairline")
        last = declarations(self.home_base, ".feature-tab-list button:last-child")
        self.assertEqual(normalise(last.get("border-bottom", "")),
                         "1pxsolidrgba(155,181,210,.13)",
                         "the directory closes with its own rule")
        panels = declarations(self.home_base, ".feature-panels")
        self.assertEqual(normalise(panels.get("border-left", "")),
                         "1pxsolidrgba(155,181,210,.13)",
                         "one 1px divider separates the directory from the stage")
        rail = declarations(self.home_base, ".feature-panels::before")
        self.assertEqual(normalise(rail.get("height", "")), "136px")
        self.assertEqual(rail.get("background"),
                         "linear-gradient(180deg,#729eff,rgba(114,158,255,0))",
                         "the accent segment fades down from the divider")
        sweep = declarations(self.home_base, ".feature-tab-list button::before")
        self.assertIn("linear-gradient", normalise(sweep.get("background", "")),
                      "hover/selection paints the accent rule")
        self.assertEqual(self.index.count("feature-detail-card"), 0,
                         "the retired row hairlines have no markup left to paint")

    def test_card_title_is_a_manrope_display_heading(self):
        """The panel titles are the tab labels now, still Manrope at 500."""
        button = declarations(self.home_base, ".feature-tab-list button")
        self.assertEqual(normalise(button.get("font", "")),
                         normalise("500 24px/1.2 var(--display)"))
        self.assertIn("var(--display)", button.get("font", ""))
        self.assertEqual(normalise(button.get("letter-spacing", "")), "-.012em")
        self.assertEqual(button.get("color"), "#9cb2c8")
        selected = declarations(self.home_base, ".feature-tab-list button[aria-selected=true]")
        self.assertEqual(selected.get("color"), "#f4f9ff")
        self.assertEqual(self.index.count("feature-detail-card"), 0)

    def test_card_copy_is_20px(self):
        """The 20px card body went with the cards; the in-stage copy is the 17px
        loading fallback in both live panels."""
        for selector in (".sida-tagcloud__fallback", ".sida-flow__fallback"):
            with self.subTest(selector=selector):
                rule = declarations(self.sida_base, selector)
                self.assertEqual(normalise(rule.get("font-size", "")), "17px")
                self.assertEqual(rule.get("color"), "#7d93ab")
        self.assertEqual(self.index.count("feature-detail-card"), 0)

    # -- responsive -------------------------------------------------------

    def test_mobile_cards_return_to_one_column(self):
        """The mobile single column is now a single stacked stage."""
        mobile = self.media("max-width:760px")
        self.assertEqual(normalise(declarations(mobile, ".feature-panels").get("--stage-h", "")),
                         "auto")
        self.assertEqual(declarations(mobile, ".feature-panels").get("height"), "auto")
        self.assertEqual(declarations(mobile, ".feature-panel").get("height"), "auto")
        stage = declarations(mobile, ".feature-stage")
        self.assertEqual(stage.get("height"), "auto")
        self.assertEqual(normalise(stage.get("min-height", "")), "360px",
                         "the stage keeps a 360px floor once the fixed height is released")
        self.assertEqual(self.panels_block.count("feature-card-stack"), 0)

    def test_mobile_copy_is_16px_and_the_rows_tighten(self):
        """The 16px mobile card body went with the cards: the mobile band does not
        rescale type at all, it only tightens the stage boxes."""
        mobile = self.media("max-width:760px")
        self.assertNotIn("font-size", mobile,
                         "the mobile band must not rescale the stage copy")
        self.assertEqual(normalise(declarations(mobile, ".sida-tagcloud").get("min-height", "")),
                         "340px")
        self.assertEqual(normalise(declarations(mobile, ".sida-flow").get("min-height", "")),
                         "400px")
        self.assertEqual(normalise(declarations(mobile, ".feature-shot").get("min-height", "")),
                         "280px")
        self.assertEqual(normalise(declarations(self.sida_base, ".sida-tagcloud__fallback")
                                   .get("font-size", "")), "17px",
                         "the 17px stage copy holds at every width")

    def test_panels_release_the_fixed_height_on_mobile(self):
        mobile = self.media("max-width:760px")
        panels = declarations(mobile, ".feature-panels")
        self.assertEqual(normalise(panels.get("--stage-h", "")), "auto")
        self.assertEqual(panels.get("height"), "auto")
        self.assertNotIn("--stage-h", declarations(self.sida_base, ".feature-stage"),
                         "only the panels box owns the fixed height")

    def test_short_desktop_only_tightens_the_rows(self):
        short = self.media("max-height:800px)and(min-height:601px)and(min-width:761px)")
        panels = declarations(short, ".feature-panels")
        self.assertEqual(normalise(panels.get("--stage-h", "")),
                         normalise("clamp(360px,calc(100svh - 272px),540px)"))
        self.assertEqual(normalise(declarations(short, ".sida-section").get("padding-top", "")),
                         "24px",
                         "on short desktops the section drops its top padding")
        self.assertNotIn("font-size", short, "the stage copy scale holds on short desktops")

    def test_narrow_width_only_tightens_the_rows(self):
        narrow = self.media("max-width:1200px")
        self.assertEqual(normalise(declarations(narrow, ".feature-panels").get("--stage-h", "")),
                         normalise("clamp(420px,calc(100svh - 232px),620px)"))
        cloud = declarations(narrow, ".sida-tagcloud")
        self.assertEqual(normalise(cloud.get("padding", "")), "17px19px")
        self.assertEqual(normalise(cloud.get("gap", "")), "12px")
        self.assertNotIn("font-size", narrow,
                         "the 17px stage copy scale holds down to the tablet band")


if __name__ == "__main__":
    unittest.main(verbosity=2)
