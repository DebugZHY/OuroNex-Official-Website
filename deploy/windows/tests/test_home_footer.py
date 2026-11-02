"""Structural and content regression tests for the Home footer block.

Home ships the canonical ``footer.site-footer`` from the footer spec:

* ``div.wrap.footer-top`` with ``a.footer-brand`` (logo + wordmark),
  ``nav.footer-nav`` (six links, one of them the inert Application placeholder)
  and ``div.footer-socials`` (five labelled icon buttons) in that order;
* ``div.wrap.footer-bottom`` with ``p.footer-copyright`` then
  ``nav.footer-legal`` (Terms of Service, Privacy Policy);
* the retired ``.home-footer`` markup, the Pages/Company columns, the Hong Kong
  line and the two explanatory legal blocks are gone.

Site-wide structure, the per-page walk and the stylesheet contract live in
``test_site_footer.py``; this module pins the Home footer's own copy and the
shared dictionary entries it renders.

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
SHARED_JSON = REPO_ROOT / "assets" / "i18n" / "shared.json"
SHARED_JS = REPO_ROOT / "assets" / "i18n" / "shared.js"
HOME_JSON = REPO_ROOT / "assets" / "i18n" / "home.json"

LOGO = "assets/ouronex-mark.svg"
COPYRIGHT = "Copyright \u00a9 2026 OuroNex Technology Company Limited. All Rights Reserved."
SOCIALS = ("X", "LinkedIn", "GitHub", "WeChat", "RedNote")

# label, href (None for the inert placeholders), i18n key
NAV_LINKS = (
    ("Home", "index.html#home", "shared.home.5c1d84"),
    ("Features", "index.html#sida", "shared.features"),
    ("Application", None, "shared.application"),
    ("Price", "index.html#price", "shared.price.3e8248"),
    ("Business", "index.html#business", "shared.business.d6663d"),
    ("About", "index.html#about", "shared.about.6b21fb"),
)
LEGAL_LINKS = (
    ("Terms of Service", "terms.html", "shared.terms-of-service.3f9c1a"),
    ("Privacy Policy", "privacy.html", "shared.privacy-policy.6b2d4e"),
)
RETIRED_CLASSES = (
    "home-footer",
    "footer-grid",
    "footer-menus",
    "footer-col",
    "footer-copy",
    "footer-nav-row",
    "footer-wordmark",
    "footer-brand-block",
    "footer-content",
)
LANGUAGES = ("en", "zh-CN", "zh-TW")
VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
HEADINGS = ("h1", "h2", "h3", "h4", "h5", "h6")
CLASS_ATTRIBUTE = re.compile(r'\bclass="([^"]*)"')


class _TreeBuilder(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = {"tag": "#document", "attrs": {}, "children": [], "text": []}
        self._stack = [self.root]

    def _node(self, tag: str, attrs) -> dict:
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


def elements(node: dict) -> list:
    return [child for child in node["children"] if child["tag"] != "#text"]


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


class FooterFixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX_HTML.read_text(encoding="utf-8")
        cls.document = parse(cls.index)
        footers = find_all(cls.document, lambda node: node["tag"] == "footer")
        if len(footers) != 1:
            raise AssertionError(f"index.html must hold exactly one <footer>, found {len(footers)}")
        cls.footer = footers[0]
        cls.shared_json = json.loads(SHARED_JSON.read_text(encoding="utf-8"))
        cls.shared_js = json.loads(
            SHARED_JS.read_text(encoding="utf-8")
            .split("Object.assign(window.OuroNexI18n || {}, ", 1)[1]
            .rstrip()
            .rstrip(";")
            .rstrip(")")
        )
        cls.home_json = json.loads(HOME_JSON.read_text(encoding="utf-8"))

    def child(self, parent: dict, name: str) -> dict:
        matches = [node for node in elements(parent) if has_class(node, name)]
        self.assertEqual(len(matches), 1, f"expected exactly one .{name}")
        return matches[0]

    def top(self) -> dict:
        return self.child(self.footer, "footer-top")

    def bottom(self) -> dict:
        return self.child(self.footer, "footer-bottom")


class FooterLayoutTests(FooterFixtures):
    def test_index_has_exactly_one_site_footer(self):
        self.assertIn("site-footer", classes(self.footer))
        self.assertNotIn("home-footer", classes(self.footer))
        self.assertEqual(self.index.count("<footer"), 1)

    def test_footer_follows_the_about_section(self):
        about_index = self.index.find('id="about"')
        footer_index = self.index.find('<footer class="site-footer"')
        self.assertGreater(about_index, -1, "the About section must exist")
        self.assertGreater(footer_index, about_index, "the footer trails the About block")

    def test_top_holds_brand_nav_and_socials_in_source_order(self):
        children = elements(self.top())
        self.assertEqual([child["tag"] for child in children], ["a", "nav", "div"])
        self.assertTrue(has_class(children[0], "footer-brand"))
        self.assertTrue(has_class(children[1], "footer-nav"))
        self.assertTrue(has_class(children[2], "footer-socials"))

    def test_bottom_holds_copyright_then_legal(self):
        children = elements(self.bottom())
        self.assertEqual([child["tag"] for child in children], ["p", "nav"])
        self.assertTrue(has_class(children[0], "footer-copyright"))
        self.assertTrue(has_class(children[1], "footer-legal"))

    def test_no_headings_in_footer(self):
        self.assertEqual(
            [node["tag"] for node in descendants(self.footer) if node["tag"] in HEADINGS],
            [],
        )


class FooterBrandAndSocialsTests(FooterFixtures):
    def test_brand_links_home_with_the_wordmark(self):
        brand = self.child(self.top(), "footer-brand")
        self.assertEqual(brand["attrs"].get("href"), "index.html")
        self.assertEqual(brand["attrs"].get("aria-label"), "OuroNex home")
        images = [node for node in descendants(brand) if node["tag"] == "img"]
        self.assertEqual(len(images), 1)
        self.assertEqual(images[0]["attrs"].get("src"), LOGO)
        self.assertEqual(images[0]["attrs"].get("alt"), "")
        names = [node for node in descendants(brand) if has_class(node, "footer-name")]
        self.assertEqual([normalised_text(node) for node in names], ["OuroNex"])

    def test_socials_are_the_five_labelled_buttons(self):
        socials = self.child(self.top(), "footer-socials")
        buttons = elements(socials)
        self.assertEqual([button["tag"] for button in buttons], ["button"] * 5)
        self.assertEqual([button["attrs"].get("aria-label") for button in buttons], list(SOCIALS))
        for button in buttons:
            self.assertIn("footer-social", classes(button))
            self.assertEqual(button["attrs"].get("type"), "button")
            self.assertIn("data-coming-soon", button["attrs"])
            icons = [node for node in elements(button) if node["tag"] == "svg"]
            self.assertEqual(len(icons), 1)
            self.assertEqual(icons[0]["attrs"].get("aria-hidden"), "true")
            self.assertEqual(icons[0]["attrs"].get("focusable"), "false")
            self.assertEqual(normalised_text(button), "", "icon buttons add no text")


class FooterNavigationTests(FooterFixtures):
    def test_nav_holds_the_six_links_in_order(self):
        nav = self.child(self.top(), "footer-nav")
        self.assertEqual(nav["attrs"].get("data-i18n-aria-label"), "shared.footer.26c01e")
        links = elements(nav)
        self.assertEqual(len(links), 6)
        self.assertEqual(
            [(normalised_text(link), link["attrs"].get("href")) for link in links],
            [(label, href) for label, href, _key in NAV_LINKS],
        )

    def test_each_link_carries_its_translated_span(self):
        links = elements(self.child(self.top(), "footer-nav"))
        for link, (label, href, key) in zip(links, NAV_LINKS):
            with self.subTest(label=label):
                spans = [node for node in elements(link) if node["tag"] == "span"]
                self.assertEqual(len(spans), 1)
                self.assertEqual(spans[0]["attrs"].get("data-i18n"), key)
                self.assertEqual(normalised_text(spans[0]), label)
                if href is None:
                    self.assertEqual(
                        label,
                        "Application",
                        "Application is the only remaining inert footer entry",
                    )
                    self.assertNotIn("href", link["attrs"], "placeholders must not link")
                    self.assertEqual(link["attrs"].get("aria-disabled"), "true")
                    self.assertIn("nav-placeholder", classes(link))
                    self.assertIn("data-nav-placeholder", link["attrs"])
                else:
                    self.assertNotIn("aria-disabled", link["attrs"])
                    self.assertNotIn("nav-placeholder", classes(link))
                    self.assertNotIn("data-nav-placeholder", link["attrs"])

    def test_features_links_to_the_sida_section(self):
        links = elements(self.child(self.top(), "footer-nav"))
        features = [link for link in links if normalised_text(link) == "Features"]
        self.assertEqual(len(features), 1, "Features must be one footer entry")
        self.assertEqual(
            features[0]["attrs"].get("href"),
            "index.html#sida",
            "Features opens the SIDA section instead of being inert",
        )


class FooterBottomTests(FooterFixtures):
    def test_copyright_line_is_exact(self):
        copyrights = [node for node in elements(self.bottom()) if has_class(node, "footer-copyright")]
        self.assertEqual(len(copyrights), 1)
        self.assertEqual(normalised_text(copyrights[0]), COPYRIGHT)
        self.assertIsNone(copyrights[0]["attrs"].get("data-i18n"), "the legal line stays untranslated")

    def test_legal_nav_links_terms_and_privacy(self):
        legal = self.child(self.bottom(), "footer-legal")
        links = elements(legal)
        self.assertEqual(len(links), 2)
        self.assertEqual(
            [(normalised_text(link), link["attrs"].get("href")) for link in links],
            [(label, href) for label, href, _key in LEGAL_LINKS],
        )
        for link, (_label, _href, key) in zip(links, LEGAL_LINKS):
            spans = [node for node in elements(link) if node["tag"] == "span"]
            self.assertEqual(len(spans), 1)
            self.assertEqual(spans[0]["attrs"].get("data-i18n"), key)


class FooterRetiredMarkupTests(FooterFixtures):
    def test_no_retired_footer_class_survives(self):
        for value in CLASS_ATTRIBUTE.findall(self.index):
            tokens = value.split()
            for retired in RETIRED_CLASSES:
                self.assertNotIn(retired, tokens, f"retired footer class {retired!r} still used")

    def test_old_footer_copy_is_gone(self):
        footer_text = normalised_text(self.footer)
        self.assertNotIn("Hong Kong", footer_text)
        for retired in (
            "Confidentiality",
            "All SIDA tools run locally",
            "AI outputs support professional review",
        ):
            self.assertNotIn(retired, footer_text)
        self.assertEqual(footer_text.count("Copyright"), 1)


class FooterDictionaryTests(FooterFixtures):
    def test_nav_and_legal_labels_live_in_the_shared_dictionary(self):
        keys = [key for _label, _href, key in NAV_LINKS + LEGAL_LINKS]
        for key in keys:
            with self.subTest(key=key):
                for name, data in (("shared.json", self.shared_json), ("shared.js", self.shared_js)):
                    self.assertIn(key, data, f"{name} is missing {key}")
                    entry = data[key]
                    self.assertEqual(set(entry), set(LANGUAGES), f"{key} language fields")
                    for language in LANGUAGES:
                        self.assertTrue(entry[language].strip(), f"{key}.{language} is empty")
                self.assertNotIn(key, self.home_json, f"{key} must not live in home.json")

    def test_compiled_shared_dictionary_matches_the_json_source(self):
        self.assertEqual(self.shared_js, self.shared_json)

    def test_retired_home_legal_copy_is_gone(self):
        for key in (
            "home.confidentiality",
            "home.confidentiality-copy",
            "home.policy",
            "home.policy-copy",
        ):
            self.assertNotIn(key, self.home_json)


if __name__ == "__main__":
    unittest.main(verbosity=2)
