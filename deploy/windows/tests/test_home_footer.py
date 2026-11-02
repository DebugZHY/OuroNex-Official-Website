"""Structural and content regression tests for the Home footer.

The footer keeps the brand, wordmark, copyright and social block on the left and
one right-hand navigation group containing the four section links plus the two
legal links. The previous two explanatory legal blocks are gone.

Source inspection only: no browser, no server, no network.
"""

from __future__ import annotations

import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_HTML = REPO_ROOT / "index.html"
HOME_CSS = REPO_ROOT / "assets" / "home.css"
SHARED_JSON = REPO_ROOT / "assets" / "i18n" / "shared.json"
SHARED_JS = REPO_ROOT / "assets" / "i18n" / "shared.js"
HOME_JSON = REPO_ROOT / "assets" / "i18n" / "home.json"

LOGOS = "assets/ouronex-mark.svg"
COPYRIGHT = "Copyright \u00a9 2026 OuroNex Technology Company Limited. All Rights Reserved."
SOCIALS = ("X", "LinkedIn", "GitHub", "WeChat", "RedNote")
NAV_LINKS = (
    ("SIDA", "#sida"),
    ("Price", "#price"),
    ("Business", "#business"),
    ("About", "#about"),
    ("Terms of Service", "terms.html"),
    ("Privacy Policy", "privacy.html"),
)
LEGAL_KEYS = {
    "shared.terms-of-service.3f9c1a": ("Terms of Service", "服务条款", "服務條款"),
    "shared.privacy-policy.6b2d4e": ("Privacy Policy", "隐私政策", "隱私政策"),
}
LANGUAGES = ("en", "zh-CN", "zh-TW")
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
             "meta", "param", "source", "track", "wbr"}
HEADINGS = ("h1", "h2", "h3", "h4", "h5", "h6")
COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")


class _TreeBuilder(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = {"tag": "#document", "attrs": {}, "children": [], "text": []}
        self._stack = [self.root]

    def _node(self, tag, attrs):
        node = {"tag": tag, "attrs": dict(attrs), "children": [], "text": []}
        self._stack[-1]["children"].append(node)
        return node

    def handle_starttag(self, tag, attrs):
        node = self._node(tag, attrs)
        if tag not in VOID_TAGS:
            self._stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self._node(tag, attrs)

    def handle_endtag(self, tag):
        if tag in VOID_TAGS:
            return
        for index in range(len(self._stack) - 1, 0, -1):
            if self._stack[index]["tag"] == tag:
                del self._stack[index:]
                return

    def handle_data(self, data):
        self._stack[-1]["text"].append(data)


def parse(markup: str) -> dict:
    builder = _TreeBuilder()
    builder.feed(markup)
    builder.close()
    return builder.root


def classes(node: dict) -> list:
    return (node["attrs"].get("class") or "").split()


def has_class(node: dict, name: str) -> bool:
    return name in classes(node)


def descendants(node: dict) -> list:
    found = []
    for child in node["children"]:
        found.append(child)
        found.extend(descendants(child))
    return found


def find_all(node: dict, predicate) -> list:
    return [item for item in descendants(node) if predicate(item)]


def text_of(node: dict) -> str:
    parts = list(node["text"])
    for child in node["children"]:
        parts.append(text_of(child))
    return "".join(parts)


def normalised_text(node: dict) -> str:
    return " ".join(text_of(node).split())


def text_segments(node: dict) -> list:
    segments = [text.strip() for text in node["text"] if text.strip()]
    for child in node["children"]:
        segments.extend(text_segments(child))
    return segments


def sheet() -> str:
    return COMMENT_RE.sub("", HOME_CSS.read_text(encoding="utf-8"))


def declarations(css: str, selector: str) -> dict:
    target = re.sub(r"\s+", "", selector).lower()
    merged: dict = {}
    for match in RULE_RE.finditer(css):
        selectors = [re.sub(r"\s+", "", part).lower() for part in match.group(1).split(",")]
        if target not in selectors:
            continue
        for declaration in match.group(2).split(";"):
            if ":" not in declaration:
                continue
            prop, _, value = declaration.partition(":")
            merged[prop.strip().lower()] = re.sub(r"\s+", " ", value.strip().lower())
    return merged


def base_declarations(css: str, selector: str) -> dict:
    target = re.sub(r"\s+", "", selector).lower()
    for match in RULE_RE.finditer(css):
        selectors = [re.sub(r"\s+", "", part).lower() for part in match.group(1).split(",")]
        if target not in selectors:
            continue
        found: dict = {}
        for declaration in match.group(2).split(";"):
            if ":" not in declaration:
                continue
            prop, _, value = declaration.partition(":")
            found[prop.strip().lower()] = re.sub(r"\s+", " ", value.strip().lower())
        return found
    return {}


def media_block(css: str, prelude: str) -> str:
    index = css.find(prelude)
    if index < 0:
        return ""
    start = css.index("{", index)
    depth = 0
    for position in range(start, len(css)):
        char = css[position]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return css[start + 1:position]
    return ""


def squash(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").lower())


class FooterFixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX_HTML.read_text(encoding="utf-8")
        cls.document = parse(cls.index)
        cls.about = find_all(cls.document, lambda node: node["attrs"].get("id") == "about")[0]
        footers = find_all(cls.about, lambda node: has_class(node, "home-footer"))
        if len(footers) != 1:
            raise AssertionError(f"#about must hold exactly one .home-footer, found {len(footers)}")
        cls.footer = footers[0]
        cls.css = sheet()
        cls.shared_json = json.loads(SHARED_JSON.read_text(encoding="utf-8"))
        cls.shared_js = json.loads(
            SHARED_JS.read_text(encoding="utf-8")
            .split("Object.assign(window.OuroNexI18n || {}, ", 1)[1]
            .rstrip()
            .rstrip(";")
            .rstrip(")")
        )
        cls.home_json = json.loads(HOME_JSON.read_text(encoding="utf-8"))

    def region(self, name: str) -> dict:
        found = [child for child in self.footer["children"] if has_class(child, name)]
        self.assertEqual(len(found), 1, f"footer must hold exactly one .{name}")
        return found[0]


class FooterLayoutTests(FooterFixtures):
    def test_footer_is_the_last_region_of_about(self):
        children = [child for child in self.about["children"] if child["tag"] != "#text"]
        self.assertIs(children[-1], self.footer)
        self.assertEqual(self.footer["tag"], "footer")

    def test_two_main_regions_in_reference_order(self):
        regions = [child for child in self.footer["children"] if child["tag"] != "#text"]
        self.assertEqual(len(regions), 2)
        self.assertTrue(has_class(regions[0], "footer-brand-block"))
        self.assertTrue(has_class(regions[1], "footer-content"))

    def test_brand_region_holds_logo_wordmark_copyright_and_socials(self):
        brand = self.region("footer-brand-block")
        images = find_all(brand, lambda node: node["tag"] == "img")
        self.assertEqual(len(images), 1)
        self.assertEqual(images[0]["attrs"].get("src"), LOGOS)
        self.assertIn("OuroNex", text_of(brand))
        copies = find_all(brand, lambda node: has_class(node, "footer-copyright"))
        self.assertEqual(len(copies), 1)
        self.assertEqual(normalised_text(copies[0]), COPYRIGHT)
        buttons = find_all(brand, lambda node: node["tag"] == "button" and has_class(node, "footer-social"))
        self.assertEqual([button["attrs"].get("aria-label") for button in buttons], list(SOCIALS))

    def test_right_region_is_one_nav_row_with_six_direct_links(self):
        content = self.region("footer-content")
        children = [child for child in content["children"] if child["tag"] != "#text"]
        self.assertEqual([child["tag"] for child in children], ["nav"])
        self.assertTrue(has_class(children[0], "footer-nav"))
        links = [child for child in children[0]["children"] if child["tag"] == "a"]
        self.assertEqual(
            [(normalised_text(link), link["attrs"].get("href")) for link in links],
            list(NAV_LINKS),
        )
        self.assertEqual(len(links), 6, "the legal links must sit in the same group as the four section links")
        for link in links:
            spans = [child for child in link["children"] if child["tag"] == "span"]
            self.assertEqual(len(spans), 1)
            self.assertTrue(spans[0]["attrs"].get("data-i18n"))

    def test_old_legal_blocks_and_their_copy_are_gone(self):
        content = self.region("footer-content")
        self.assertEqual(
            find_all(content, lambda node: "footer-legal" in (node["attrs"].get("class") or "").split()),
            [],
        )
        markup = normalised_text(self.footer)
        self.assertNotIn("Confidentiality", markup)
        self.assertNotIn("All SIDA tools run locally", markup)
        self.assertNotIn("AI outputs support professional review", markup)
        self.assertEqual(
            text_segments(self.footer),
            ["OuroNex", COPYRIGHT, *[label for label, _href in NAV_LINKS]],
        )

    def test_no_headings_in_footer(self):
        self.assertEqual(
            [node["tag"] for node in descendants(self.footer) if node["tag"] in HEADINGS],
            [],
        )


class FooterStyleTests(FooterFixtures):
    def test_footer_keeps_two_theme_columns(self):
        footer = base_declarations(self.css, ".home-footer")
        self.assertEqual(footer.get("background"), "#0b1220")
        self.assertEqual(footer.get("grid-template-columns", "").count("minmax("), 2)

    def test_navigation_links_are_20px_in_one_wrapping_group(self):
        nav = base_declarations(self.css, ".home-footer .footer-nav")
        self.assertEqual(nav.get("display"), "flex")
        self.assertEqual(nav.get("flex-wrap"), "wrap")
        self.assertIn("gap", nav)
        links = declarations(self.css, ".home-footer .footer-nav a")
        self.assertEqual(links.get("font-size"), "20px")
        self.assertEqual(links.get("white-space"), "nowrap")
        self.assertNotIn("margin-left", links, "the legal links must not be pushed into a separate group")

    def test_no_legal_block_styles_remain(self):
        for selector in (
            ".home-footer .footer-legal",
            ".home-footer .footer-legal-item",
            ".home-footer .footer-legal-title",
            ".home-footer .footer-legal-copy",
        ):
            self.assertEqual(base_declarations(self.css, selector), {}, selector)

    def test_social_buttons_are_circles(self):
        social = base_declarations(self.css, ".home-footer .footer-social")
        self.assertEqual(social.get("border-radius"), "50%")
        self.assertEqual(social.get("width"), social.get("height"))

    def test_mobile_stacks_without_horizontal_overflow(self):
        mobile = media_block(self.css, "@media(max-width:760px)")
        self.assertTrue(mobile)
        self.assertEqual(squash(declarations(mobile, ".home-footer").get("grid-template-columns", "")), "1fr")
        self.assertIn("min-width", declarations(mobile, ".home-footer .footer-brand-block"))
        self.assertIn("gap", declarations(mobile, ".home-footer .footer-nav"))
        self.assertNotIn("footer-legal", mobile)


class FooterDictionaryTests(FooterFixtures):
    def test_legal_link_labels_live_in_the_shared_dictionary(self):
        for key, (english, simplified, traditional) in LEGAL_KEYS.items():
            with self.subTest(key=key):
                for data in (self.shared_json, self.shared_js):
                    self.assertEqual(
                        data[key],
                        {"en": english, "zh-CN": simplified, "zh-TW": traditional},
                    )
                self.assertNotIn(key, self.home_json)

    def test_compiled_shared_dictionary_matches_the_json_source(self):
        self.assertEqual(self.shared_js, self.shared_json)

    def test_old_legal_copy_was_removed_from_the_home_dictionary(self):
        for key in ("home.confidentiality", "home.confidentiality-copy", "home.policy", "home.policy-copy"):
            self.assertNotIn(key, self.home_json)


if __name__ == "__main__":
    unittest.main(verbosity=2)
