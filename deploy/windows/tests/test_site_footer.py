"""Whole-site footer contract: every public page ships the same footer block.

The footer spec (``D:/tmp/briefs/footer-spec.md``) freezes one canonical block:

* exactly one ``<footer class="site-footer">`` per public page;
* ``div.wrap.footer-top`` holding, in source order, ``a.footer-brand``,
  ``nav.footer-nav`` (six links: five section anchors plus the inert
  Application placeholder) and ``div.footer-socials`` (five
  ``button.footer-social`` labelled X / LinkedIn / GitHub / WeChat / RedNote);
* ``div.wrap.footer-bottom`` holding ``p.footer-copyright`` then
  ``nav.footer-legal`` with exactly the two legal links;
* none of the retired components (``home-footer``, ``footer-grid``,
  ``footer-menus``, ``footer-col``, ``footer-copy``) anywhere;
* the ``.site-footer`` rules in ``assets/site.css`` and no ``.home-footer`` rule
  left in ``assets/home.css``.

Walking every page in one module means the next footer edit cannot drift page by
page. Source inspection only: no browser, no server, no network.
"""

from __future__ import annotations

import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_HTML = REPO_ROOT / "index.html"
SITE_CSS = REPO_ROOT / "assets" / "site.css"
HOME_CSS = REPO_ROOT / "assets" / "home.css"

ROOT_PAGES = ("index.html", "terms.html", "privacy.html", "404.html", "arena.html")
NEWS_PAGES = tuple(
    sorted(
        f"news/{page.name}"
        for page in (REPO_ROOT / "news").glob("*.html")
    )
)

COPYRIGHT = (
    "Copyright \u00a9 2026 OuroNex Technology Company Limited. All Rights Reserved."
)
LOGO_SRC = "assets/ouronex-mark.svg"

# label, href suffix, i18n key
NAV_LINKS = (
    ("Home", "index.html#home", "shared.home.5c1d84"),
    ("Features", "index.html#sida", "shared.features"),
    ("Application", "index.html#application", "shared.application"),
    ("Price", "index.html#price", "shared.price.3e8248"),
    ("Business", "index.html#business", "shared.business.d6663d"),
    ("About", "index.html#about", "shared.about.6b21fb"),
)

SOCIALS = ("X", "LinkedIn", "GitHub", "WeChat", "RedNote")

LEGAL_LINKS = (
    ("Terms of Service", "terms.html", "shared.terms-of-service.3f9c1a"),
    ("Privacy Policy", "privacy.html", "shared.privacy-policy.6b2d4e"),
)

RETIRED_FOOTER_CLASSES = (
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

CSS_CONTRACT = (
    ".site-footer .footer-top{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)",
    ".site-footer .footer-brand{",
    "justify-self:start",
    ".site-footer .footer-nav{",
    "justify-self:center",
    ".site-footer .footer-socials{",
    "justify-self:end",
    ".site-footer .footer-bottom{",
    "justify-content:space-between",
)

# Navigation stays at the 20px display size; the metadata row sits below it at 16px.
FOOTER_NAV_TYPE = (".site-footer .footer-nav a",)
FOOTER_NAV_PX = "20px"
FOOTER_META_TYPE = (".site-footer .footer-legal a", ".site-footer .footer-copyright")
FOOTER_META_PX = "16px"
FOOTER_TYPE_SCALE = FOOTER_NAV_TYPE + FOOTER_META_TYPE

VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")
CLASS_ATTRIBUTE = re.compile(r'\bclass="([^"]*)"')


# ---------------------------------------------------------------------------
# Minimal element tree over html.parser
# ---------------------------------------------------------------------------


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


def squashed(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").lower())


def sheet(path: Path) -> str:
    return COMMENT_RE.sub("", path.read_text(encoding="utf-8"))


def rule_body(css: str, selector: str) -> list:
    """Return every declaration block written for ``selector``."""
    target = squashed(selector)
    bodies = []
    for match in RULE_RE.finditer(css):
        selectors = [squashed(part) for part in match.group(1).split(",")]
        if target in selectors:
            bodies.append(squashed(match.group(2)))
    return bodies


def media_blocks(css: str) -> list:
    """Every ``@media`` block as (squashed prelude, body) pairs."""
    blocks = []
    index = 0
    while True:
        start = css.find("@media", index)
        if start < 0:
            return blocks
        brace = css.index("{", start)
        depth = 0
        end = len(css)
        for cursor in range(brace, len(css)):
            if css[cursor] == "{":
                depth += 1
            elif css[cursor] == "}":
                depth -= 1
                if depth == 0:
                    end = cursor
                    break
        blocks.append((squashed(css[start:brace]), css[brace + 1:end]))
        index = end + 1


def page_path(relative: str) -> Path:
    return REPO_ROOT / relative


def prefix_for(relative: str) -> str:
    return "../" if relative.startswith("news/") else ""


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------


class FooterContract(unittest.TestCase):
    """Every public page exposes the frozen footer block."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.pages = ROOT_PAGES + NEWS_PAGES
        cls.markup = {}
        cls.footers = {}
        for relative in cls.pages:
            path = page_path(relative)
            if not path.is_file():
                continue
            markup = path.read_text(encoding="utf-8")
            cls.markup[relative] = markup
            document = parse(markup)
            found = find_all(document, lambda node: node["tag"] == "footer")
            cls.footers[relative] = (document, found)

    def footer(self, relative: str) -> dict:
        self.assertIn(relative, self.markup, f"{relative} is missing from the repository")
        document, found = self.footers[relative]
        self.assertEqual(len(found), 1, f"{relative} must carry exactly one <footer>")
        return found[0]

    def child_of(self, relative: str, parent: dict, name: str) -> dict:
        matches = [node for node in elements(parent) if has_class(node, name)]
        self.assertEqual(
            len(matches), 1, f"{relative}: expected exactly one .{name}"
        )
        return matches[0]

    def footer_part(self, relative: str, name: str) -> dict:
        return self.child_of(relative, self.footer(relative), name)

    def top(self, relative: str) -> dict:
        return self.footer_part(relative, "footer-top")

    def bottom(self, relative: str) -> dict:
        return self.footer_part(relative, "footer-bottom")

    def top_part(self, relative: str, name: str) -> dict:
        return self.child_of(relative, self.top(relative), name)

    def bottom_part(self, relative: str, name: str) -> dict:
        return self.child_of(relative, self.bottom(relative), name)


# ---------------------------------------------------------------------------
# 1. One footer per page, in the frozen shape
# ---------------------------------------------------------------------------


class FooterStructureTests(FooterContract):
    def test_every_public_page_is_walked(self) -> None:
        self.assertEqual(
            list(self.markup),
            list(self.pages),
            "the walker must read every public page",
        )
        self.assertGreaterEqual(len(self.pages), 13)

    def test_exactly_one_site_footer_per_page(self) -> None:
        for relative in self.pages:
            with self.subTest(page=relative):
                footer = self.footer(relative)
                self.assertIn("site-footer", classes(footer), "wrong footer class")
                self.assertNotIn("home-footer", classes(footer), "the old footer class is still used")

    def test_footer_holds_the_two_wrapped_rows_only(self) -> None:
        for relative in self.pages:
            with self.subTest(page=relative):
                footer = self.footer(relative)
                wrappers = elements(footer)
                self.assertEqual(
                    [classes(node) for node in wrappers],
                    [["wrap", "footer-top"], ["wrap", "footer-bottom"]],
                    "the footer holds the top row then the bottom row",
                )

    def test_footer_top_children_are_brand_nav_and_socials(self) -> None:
        for relative in self.pages:
            with self.subTest(page=relative):
                top = self.top(relative)
                children = elements(top)
                self.assertEqual(
                    [child["tag"] for child in children],
                    ["a", "nav", "div"],
                    "brand, nav, socials in source order",
                )
                self.assertIn("footer-brand", classes(children[0]))
                self.assertIn("footer-nav", classes(children[1]))
                self.assertIn("footer-socials", classes(children[2]))

    def test_footer_bottom_children_are_copyright_and_legal(self) -> None:
        for relative in self.pages:
            with self.subTest(page=relative):
                bottom = self.bottom(relative)
                children = elements(bottom)
                self.assertEqual([child["tag"] for child in children], ["p", "nav"])
                self.assertIn("footer-copyright", classes(children[0]))
                self.assertIn("footer-legal", classes(children[1]))


# ---------------------------------------------------------------------------
# 2. Brand block
# ---------------------------------------------------------------------------


class FooterBrandTests(FooterContract):
    def test_brand_links_home_with_the_wordmark(self) -> None:
        for relative in self.pages:
            with self.subTest(page=relative):
                prefix = prefix_for(relative)
                brand = self.top_part(relative, "footer-brand")
                self.assertEqual(brand["tag"], "a")
                self.assertEqual(brand["attrs"].get("href"), prefix + "index.html")
                self.assertEqual(
                    brand["attrs"].get("aria-label"), "OuroNex home", "the brand needs its label"
                )
                images = [node for node in descendants(brand) if node["tag"] == "img"]
                self.assertEqual(len(images), 1, "the brand holds exactly one logo image")
                logo = images[0]
                self.assertEqual(logo["attrs"].get("src"), prefix + LOGO_SRC)
                self.assertEqual(logo["attrs"].get("alt"), "")
                self.assertEqual(logo["attrs"].get("width"), "104")
                self.assertEqual(logo["attrs"].get("height"), "64")
                names = [node for node in descendants(brand) if has_class(node, "footer-name")]
                self.assertEqual([normalised_text(node) for node in names], ["OuroNex"])


# ---------------------------------------------------------------------------
# 3. Navigation: six links, one inert placeholder
# ---------------------------------------------------------------------------


class FooterNavigationTests(FooterContract):
    def test_nav_holds_exactly_six_links(self) -> None:
        for relative in self.pages:
            with self.subTest(page=relative):
                nav = self.top_part(relative, "footer-nav")
                self.assertEqual(nav["tag"], "nav")
                self.assertEqual(
                    nav["attrs"].get("data-i18n-aria-label"),
                    "shared.footer.26c01e",
                    "the nav keeps its translated label",
                )
                links = elements(nav)
                self.assertEqual([link["tag"] for link in links], ["a"] * 6)
                self.assertEqual(len(links), 6, "the footer nav holds six links")

    def test_five_section_links_point_at_the_home_anchors(self) -> None:
        for relative in self.pages:
            with self.subTest(page=relative):
                prefix = prefix_for(relative)
                links = elements(self.top_part(relative, "footer-nav"))
                actual = [(normalised_text(link), link["attrs"].get("href")) for link in links]
                expected = [
                    (label, None if href is None else prefix + href)
                    for label, href, _key in NAV_LINKS
                ]
                self.assertEqual(actual, expected)

    def test_every_footer_link_is_live_and_translated(self) -> None:
        for relative in self.pages:
            with self.subTest(page=relative):
                links = elements(self.top_part(relative, "footer-nav"))
                for link, (_label, href, key) in zip(links, NAV_LINKS):
                    spans = [node for node in elements(link) if node["tag"] == "span"]
                    self.assertEqual(len(spans), 1, "each footer link holds one label span")
                    self.assertEqual(spans[0]["attrs"].get("data-i18n"), key)
                    self.assertEqual(link["attrs"].get("href"), prefix_for(relative) + href)
                    self.assertNotIn("aria-disabled", link["attrs"])
                    self.assertNotIn("nav-placeholder", classes(link))
                    self.assertNotIn("data-nav-placeholder", link["attrs"])

    def test_features_links_to_the_sida_section(self) -> None:
        for relative in self.pages:
            with self.subTest(page=relative):
                prefix = prefix_for(relative)
                links = elements(self.top_part(relative, "footer-nav"))
                features = [
                    link for link in links if normalised_text(link) == "Features"
                ]
                self.assertEqual(len(features), 1, "Features must be one footer entry")
                self.assertEqual(
                    features[0]["attrs"].get("href"),
                    prefix + "index.html#sida",
                    "Features opens the SIDA section instead of being inert",
                )


# ---------------------------------------------------------------------------
# 4. Social buttons
# ---------------------------------------------------------------------------


class FooterSocialTests(FooterContract):
    def test_five_labelled_social_buttons(self) -> None:
        for relative in self.pages:
            with self.subTest(page=relative):
                socials = self.top_part(relative, "footer-socials")
                buttons = elements(socials)
                self.assertEqual([button["tag"] for button in buttons], ["button"] * 5)
                self.assertEqual(
                    [button["attrs"].get("aria-label") for button in buttons], list(SOCIALS)
                )

    def test_social_buttons_are_inert_icon_buttons(self) -> None:
        for relative in self.pages:
            with self.subTest(page=relative):
                for button in elements(self.top_part(relative, "footer-socials")):
                    label = button["attrs"].get("aria-label")
                    self.assertIn("footer-social", classes(button))
                    self.assertEqual(button["attrs"].get("type"), "button")
                    self.assertIn("data-coming-soon", button["attrs"], f"{label}: alert hook missing")
                    icons = [node for node in elements(button) if node["tag"] == "svg"]
                    self.assertEqual(len(icons), 1, f"{label}: one inline icon expected")
                    icon = icons[0]
                    self.assertEqual(icon["attrs"].get("aria-hidden"), "true")
                    self.assertEqual(icon["attrs"].get("focusable"), "false")
                    view_box = icon["attrs"].get("viewbox") or icon["attrs"].get("viewBox")
                    self.assertEqual(
                        re.sub(r"\s+", " ", view_box or ""),
                        "0 0 24 24",
                        f"{label}: the icon keeps the 24-unit viewBox",
                    )
                    self.assertEqual(normalised_text(button), "", f"{label}: icon adds no text")


# ---------------------------------------------------------------------------
# 5. Bottom row: copyright then legal links
# ---------------------------------------------------------------------------


class FooterBottomTests(FooterContract):
    def test_copyright_line_is_exact_and_unique(self) -> None:
        for relative in self.pages:
            with self.subTest(page=relative):
                copyrights = find_all(
                    self.footer(relative), lambda node: has_class(node, "footer-copyright")
                )
                self.assertEqual(len(copyrights), 1, "one copyright element per footer")
                self.assertEqual(copyrights[0]["tag"], "p")
                self.assertEqual(normalised_text(copyrights[0]), COPYRIGHT)

    def test_legal_nav_holds_terms_and_privacy(self) -> None:
        for relative in self.pages:
            with self.subTest(page=relative):
                prefix = prefix_for(relative)
                legal = self.bottom_part(relative, "footer-legal")
                self.assertEqual(legal["tag"], "nav")
                links = elements(legal)
                self.assertEqual(len(links), 2, "exactly the two legal links")
                self.assertEqual(
                    [(normalised_text(link), link["attrs"].get("href")) for link in links],
                    [(label, prefix + href) for label, href, _key in LEGAL_LINKS],
                )
                for link, (_label, _href, key) in zip(links, LEGAL_LINKS):
                    spans = [node for node in elements(link) if node["tag"] == "span"]
                    self.assertEqual(len(spans), 1)
                    self.assertEqual(spans[0]["attrs"].get("data-i18n"), key)


# ---------------------------------------------------------------------------
# 6. Retired components are gone
# ---------------------------------------------------------------------------


class FooterRetiredMarkupTests(FooterContract):
    def test_no_retired_footer_class_survives_on_any_page(self) -> None:
        for relative in self.pages:
            with self.subTest(page=relative):
                for value in CLASS_ATTRIBUTE.findall(self.markup[relative]):
                    tokens = value.split()
                    for retired in RETIRED_FOOTER_CLASSES:
                        self.assertNotIn(
                            retired,
                            tokens,
                            f"{relative}: retired footer class {retired!r} still in use",
                        )

    def test_no_old_footer_copy_or_columns(self) -> None:
        headings = ("h1", "h2", "h3", "h4", "h5", "h6")
        for relative in self.pages:
            with self.subTest(page=relative):
                footer = self.footer(relative)
                footer_text = normalised_text(footer)
                self.assertNotIn("Hong Kong", footer_text, "the Hong Kong line is retired")
                for retired in (
                    "Confidentiality",
                    "All SIDA tools run locally",
                    "AI outputs support professional review",
                ):
                    self.assertNotIn(retired, footer_text, f"{relative}: old copy block survives")
                self.assertEqual(
                    [node["tag"] for node in descendants(footer) if node["tag"] in headings],
                    [],
                    "the footer holds no column headings",
                )
                self.assertEqual(
                    footer_text.count("Copyright"), 1, "one copyright line only"
                )

    def test_only_one_footer_per_page_even_in_comments(self) -> None:
        for relative in self.pages:
            with self.subTest(page=relative):
                self.assertEqual(
                    self.markup[relative].count("<footer"),
                    1,
                    f"{relative}: exactly one footer element",
                )


# ---------------------------------------------------------------------------
# 7. Stylesheet contract
# ---------------------------------------------------------------------------


class FooterStyleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.site = sheet(SITE_CSS)
        cls.squashed_site = squashed(cls.site)
        cls.home = sheet(HOME_CSS)
        cls.squashed_home = squashed(cls.home)

    def test_site_css_declares_the_frozen_footer_rules(self) -> None:
        for needle in CSS_CONTRACT:
            with self.subTest(needle=needle):
                self.assertIn(squashed(needle), self.squashed_site)

    def test_top_row_is_a_three_track_grid(self) -> None:
        bodies = rule_body(self.site, ".site-footer .footer-top")
        self.assertTrue(bodies, ".site-footer .footer-top must be styled")
        self.assertIn("display:grid", bodies[0])
        self.assertIn("grid-template-columns:minmax(0,1fr)autominmax(0,1fr)", bodies[0])

    def test_nav_is_centred_in_the_middle_track(self) -> None:
        bodies = rule_body(self.site, ".site-footer .footer-nav")
        self.assertTrue(bodies, ".site-footer .footer-nav must be styled")
        self.assertIn("justify-self:center", bodies[0])

    def test_bottom_row_is_ruled_and_justified(self) -> None:
        bodies = rule_body(self.site, ".site-footer .footer-bottom")
        self.assertTrue(bodies, ".site-footer .footer-bottom must be styled")
        matching = [
            body
            for body in bodies
            if re.search(r"border-top:1pxsolid", body)
            and "justify-content:space-between" in body
        ]
        self.assertTrue(
            matching,
            "one .footer-bottom rule must combine the 1px divider with space-between: "
            f"{bodies}",
        )

    def test_footer_type_scale(self) -> None:
        for selector in FOOTER_NAV_TYPE + FOOTER_META_TYPE:
            expected = FOOTER_NAV_PX if selector in FOOTER_NAV_TYPE else FOOTER_META_PX
            with self.subTest(selector=selector):
                bodies = rule_body(self.site, selector)
                self.assertTrue(bodies, f"{selector} must be styled")
                sizes = [
                    size
                    for body in bodies
                    for size in re.findall(r"font-size:([^;}]+)", body)
                ]
                self.assertTrue(sizes, f"{selector} must declare its font size")
                for size in sizes:
                    self.assertEqual(
                        size,
                        expected,
                        f"{selector} must render at {expected}, found {bodies}",
                    )

    def test_mobile_block_does_not_shrink_the_footer_type_scale(self) -> None:
        mobile = [
            body
            for prelude, body in media_blocks(self.site)
            if "max-width:760px" in prelude
        ]
        self.assertTrue(mobile, "site.css must keep the 760px mobile block")
        for body in mobile:
            for selector in FOOTER_TYPE_SCALE:
                for rule in rule_body(body, selector):
                    for size in re.findall(r"font-size:([^;}]+)", rule):
                        with self.subTest(selector=selector, size=size):
                            values = [
                                float(value)
                                for value in re.findall(r"(\d+(?:\.\d+)?)px", size)
                            ]
                            self.assertTrue(
                                values, f"unreadable footer size in the mobile block: {rule}"
                            )
                            floor = 20.0 if selector in FOOTER_NAV_TYPE else 16.0
                            self.assertGreaterEqual(
                                min(values),
                                floor,
                                f"the mobile block must not shrink {selector} below {floor}px: {rule}",
                            )

    def test_no_home_footer_rule_survives(self) -> None:
        selectors = []
        for match in RULE_RE.finditer(self.home):
            selectors.extend(squashed(part) for part in match.group(1).split(","))
        offenders = [selector for selector in selectors if "home-footer" in selector]
        self.assertEqual(offenders, [], "retired .home-footer rules must be removed from home.css")


if __name__ == "__main__":
    unittest.main(verbosity=2)
