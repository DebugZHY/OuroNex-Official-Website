"""SIDA feature tab shell: two columns, no centre brand lockup.

The centred ``.sida-brand-lockup`` / ``img.sida-brand-mark`` middle column was
removed with the homepage redesign. This module now pins what replaced it:

* ``.feature-tabs`` holds exactly two direct children - ``.feature-tab-list``
  then ``.feature-panels`` - and no brand node or logo asset is referenced;
* the four tabs keep their order (Information Overload, Complex Workflow,
  Professional Tools, Multidisciplinary Experts), ids and ARIA wiring;
* the desktop grid gives the tab list a fixed 396px rail and the card area
  every remaining pixel, with no shared height driving the columns;
* the removed overlay positioning and the retired 1000px hide rule are gone;
* the shipped Michroma wordmark font/OFL licence and the retired FoundationOne
  font stay verified against the manifest.

Self-contained stdlib checks (regex + text slicing); no browser, no server.
"""

from __future__ import annotations

import hashlib
import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_HTML = REPO_ROOT / "index.html"
HOME_CSS = REPO_ROOT / "assets" / "home.css"
SITE_CSS = REPO_ROOT / "assets" / "site.css"
LOGO = REPO_ROOT / "assets" / "illustrations" / "sida-logo.png"
FONT = REPO_ROOT / "assets" / "fonts" / "michroma-400-sida.woff2"
LICENSE = REPO_ROOT / "assets" / "fonts" / "michroma-OFL.txt"
MANIFEST = REPO_ROOT / "package-manifest.json"

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")

# Desktop: the list keeps a quarter of the width, the cards reclaim the rest.
DESKTOP_COLUMNS = "max-content minmax(0,1fr)"
# Tablet widths keep the same narrow directory and expanded card area.
TABLET_COLUMNS = "max-content minmax(0,1fr)"
SHARED_HEIGHT = "clamp(448px,52.8vh,608px)"

TABS = (
    ("tab-engineering", "feature-engineering", "home.feature-engineering-title", "Information Overload"),
    ("tab-workflow", "feature-workflow", "home.feature-workflow-title", "Complex Workflow"),
    ("tab-free", "feature-free", "home.feature-free-title", "Professional Tools"),
    ("tab-experts", "feature-experts", "home.feature-experts-title", "Multidisciplinary Experts"),
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


class FeatureTabShellTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX_HTML.read_text(encoding="utf-8")
        cls.css = COMMENT_RE.sub("", HOME_CSS.read_text(encoding="utf-8"))
        cls.site_css = SITE_CSS.read_text(encoding="utf-8")
        cls.base, cls.medias = split_media(cls.css)
        cls.manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

        tabs_open = re.search(r'<div[^>]*class="[^"]*\bfeature-tabs\b', cls.index).start()
        cls.tabs_start, cls.tabs_end = div_bounds(cls.index, tabs_open)
        cls.tabs_inner = cls.index[cls.tabs_start:cls.tabs_end]
        cls.list_pos = cls.tabs_inner.find('class="feature-tab-list"')
        cls.panels_pos = cls.tabs_inner.find('class="feature-panels"')

    # -- markup: two children, no brand node ------------------------------

    def test_feature_tabs_holds_only_the_tab_list_and_the_panels(self):
        body_start = self.tabs_inner.index(">") + 1
        body = self.tabs_inner[body_start:self.tabs_inner.rfind("</div>")]
        depth_zero = []
        cursor = 0
        while True:
            position = body.find("<div", cursor)
            if position < 0:
                break
            if body.count("<div", 0, position) - body.count("</div", 0, position) == 0:
                depth_zero.append(position)
            cursor = position + len("<div")
        self.assertEqual(len(depth_zero), 2, "exactly two direct children: tab list + panels")
        self.assertGreaterEqual(self.list_pos, 0, ".feature-tab-list must exist")
        self.assertGreaterEqual(self.panels_pos, 0, ".feature-panels must exist")
        self.assertLess(self.list_pos, self.panels_pos, "tab list comes first")

    def test_brand_lockup_and_logo_markup_are_gone(self):
        for marker in ("sida-brand-lockup", "sida-brand-mark", "sida-brand-name"):
            self.assertNotIn(marker, self.index, f"removed design remnant: {marker}")
            self.assertNotIn(marker, self.css, f"removed design remnant in CSS: {marker}")
        self.assertEqual(re.findall(r"\.sida-brand[\w-]*", self.css), [])

    # -- tabs: order, ids, aria wiring ------------------------------------

    def test_four_tabs_keep_their_order_ids_and_translation_keys(self):
        buttons = re.findall(r'<button[^>]*id="tab-[^"]+"[^>]*>.*?</button>', self.index, re.S)
        self.assertEqual(len(buttons), 4, "exactly four feature tabs")
        found = []
        for button in buttons:
            opening = button[: button.index(">") + 1]
            tab_id = re.search(r'id="([^"]+)"', opening).group(1)
            panel = re.search(r'aria-controls="([^"]+)"', opening).group(1)
            label = re.search(r'data-i18n="([^"]+)">([^<]+)<', button)
            found.append((tab_id, panel, label.group(1), label.group(2).strip()))
        self.assertEqual(found, list(TABS))

    def test_each_panel_is_labelled_by_its_tab(self):
        for tab_id, panel_id, _key, _label in TABS:
            panel = re.search(
                r'<article[^>]*id="' + panel_id + r'"[^>]*>', self.index
            )
            self.assertIsNotNone(panel, f"missing panel {panel_id}")
            self.assertIn(f'aria-labelledby="{tab_id}"', panel.group(0))
            self.assertIn('role="tabpanel"', panel.group(0))
        self.assertEqual(self.index.count('aria-selected="true"'), 1)
        self.assertEqual(self.index.count('aria-selected="false"'), 3)
        self.assertEqual(self.index.count('tabindex="-1"'), 3, "only the active tab is in the tab order")

    # -- desktop grid -----------------------------------------------------

    def test_desktop_grid_uses_the_quarter_three_quarter_split(self):
        tabs = declarations(self.base, ".feature-tabs")
        self.assertEqual(normalise(tabs.get("grid-template-columns", "")), normalise(DESKTOP_COLUMNS))
        self.assertEqual(tabs.get("align-items"), "center")
        self.assertEqual(normalise(tabs.get("gap", "")), "0")
        self.assertNotIn("--feature-height", self.base,
                         "the shared height ramp is retired")

    def test_left_column_is_a_fixed_rail_and_the_cards_reclaim_the_rest(self):
        tabs = declarations(self.base, ".feature-tabs")
        tracks = normalise(tabs.get("grid-template-columns", ""))
        self.assertTrue(tracks.startswith("max-content"),
                        "the tab list is only as wide as its labels")
        self.assertEqual(tracks.count("minmax("), 1,
                         "only the card column grows with the viewport")

    def test_no_third_track_or_overlay_positioning_survives(self):
        tabs = declarations(self.base, ".feature-tabs")
        self.assertEqual(
            tabs.get("grid-template-columns", "").count("minmax("), 1,
            "one fixed rail plus one growing column",
        )
        self.assertNotIn(normalise("top:clamp(18px,2vw,28px)"), normalise(self.css))

    # -- responsive -------------------------------------------------------

    def test_tablet_block_stays_two_columns_without_a_logo_rule(self):
        tablet = next((body for prelude, body in self.medias if "max-width:1200px" in prelude), None)
        self.assertIsNotNone(tablet, "missing the @media(max-width:1200px) block")
        tabs = declarations(tablet, ".feature-tabs")
        self.assertEqual(normalise(tabs.get("grid-template-columns", "")), normalise(TABLET_COLUMNS))
        self.assertIn(normalise(tabs.get("gap", "")), ("", "0"),
                      "the rail keeps its zero gutter at tablet widths")
        self.assertNotIn("sida-brand", tablet)

    def test_mobile_stacks_to_one_column_and_no_thousand_pixel_logo_rule_exists(self):
        mobile = next((body for prelude, body in self.medias if "max-width:760px" in prelude), None)
        self.assertIsNotNone(mobile)
        self.assertEqual(
            normalise(declarations(mobile, ".feature-tabs").get("grid-template-columns", "")), "1fr"
        )
        for prelude, body in self.medias:
            self.assertNotIn("sida-brand", body, f"removed logo rule in {prelude}")
        self.assertNotIn(normalise("@media(max-width:1000px){.sida-brand-mark{display:none}}"),
                         normalise(self.css))

    # -- retained asset integrity ----------------------------------------

    def test_sida_section_keeps_room_for_the_release_note(self):
        section = declarations(self.base, ".sida-section")
        self.assertEqual(normalise(section.get("padding-bottom", "")), normalise("8px"),
                         "the section keeps its own bottom padding outside the clipped note")

    def test_foundation_one_font_is_removed(self):
        self.assertFalse(
            (REPO_ROOT / "assets" / "fonts" / "FoundationOne.ttf").exists(),
            "the retired FoundationOne file must be deleted",
        )
        self.assertNotIn("FoundationOne", self.site_css)
        self.assertNotIn("FoundationOne", self.css)
        self.assertFalse(
            any("FoundationOne" in entry["path"] for entry in self.manifest["files"]),
            "the retired FoundationOne file must not stay in the manifest",
        )

    def test_wordmark_font_is_still_self_hosted_with_its_licence(self):
        self.assertIn("@font-face{font-family:'Michroma'", self.site_css)
        self.assertIn("url('fonts/michroma-400-sida.woff2') format('woff2')", self.site_css)
        self.assertEqual(FONT.read_bytes()[:4], b"wOF2")
        self.assertIn("SIL Open Font License", LICENSE.read_text(encoding="utf-8"))

    def test_manifest_matches_the_retained_font_and_licence_bytes(self):
        entries = {entry["path"]: entry for entry in self.manifest["files"]}
        for path, asset in (
            ("assets/fonts/michroma-400-sida.woff2", FONT),
            ("assets/fonts/michroma-OFL.txt", LICENSE),
        ):
            entry = entries.get(path)
            self.assertIsNotNone(entry, f"{path} is not manifest-listed")
            payload = asset.read_bytes()
            self.assertEqual(entry["bytes"], len(payload), path)
            self.assertEqual(entry["sha256"], hashlib.sha256(payload).hexdigest(), path)

    def test_logo_returns_only_as_the_hero_lockup_mark(self):
        """The tile is back, but only as the mark left of the hero wordmark."""
        self.assertTrue(LOGO.is_file(), "the hero lockup ships assets/illustrations/sida-logo.png")
        entries = {e["path"]: e for e in json.loads(MANIFEST.read_text(encoding="utf-8"))["files"]}
        entry = entries.get("assets/illustrations/sida-logo.png")
        self.assertIsNotNone(entry, "the tile must be manifest-listed or the server will not serve it")
        payload = LOGO.read_bytes()
        self.assertEqual(entry["bytes"], len(payload))
        self.assertEqual(entry["sha256"], hashlib.sha256(payload).hexdigest())
        lockup = re.search(r'<span class="hero-title__lockup">.*?</span></span>', self.index, re.S)
        self.assertIsNotNone(lockup, "the hero wordmark opens with the logo lockup")
        block = lockup.group(0)
        self.assertIn('src="assets/illustrations/sida-logo.png"', block)
        self.assertLess(block.index("hero-title__logo"), block.index("hero-title__name"),
                        "the tile leads the wordmark")
        self.assertEqual(self.index.count("sida-logo.png"), 1, "one reference, in the hero")
        for retired in ("sida-brand-lockup", "sida-brand-mark", "sida-brand-name"):
            self.assertNotIn(retired, self.index)


if __name__ == "__main__":
    unittest.main(verbosity=2)
