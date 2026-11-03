"""Static content regression tests for the About company-introduction block.

Scope (content unit only):

* ``#about`` holds exactly one ``.about-layout``; inside it, in source order,
  one ``.about-intro`` (one ``h2`` then one ``p.about-lede``) and one
  ``.about-founder`` (a three-card grid) — the closing body paragraph row was
  removed, so the section ends on the person cards;
* ``.about-founder`` holds exactly three ``aside.about-founder__card`` elements
  (Mr. Haoyi ZHANG, Dr. Jake CHAN, Ir Prof. Siwei LIU); each card holds
  ``figure.about-founder__photo``, the name ``h3`` and ``p.about-founder__role``;
* the only images inside ``#about`` are the three portraits
  (``assets/illustrations/haoyi-zhang.png`` 840x1080,
  ``assets/illustrations/jake-chan.jpg`` 800x800 and
  ``assets/illustrations/siwei-liu.jpg`` 840x1080) plus the footer logo; every
  portrait exists on disk and is listed in ``package-manifest.json``;
* ``.about-founder__photo`` renders a 240px wide rounded frame with ``aspect-ratio: 840/1080``
  and a circular mask, shrinking to 208px in the ``max-width: 760px`` block;
* every visible text node in ``#about`` (footer excluded) sits inside a span
  carrying a ``data-i18n`` key, and every key resolves in ``home.json`` with the
  same English text rendered in the page;
* the director card sits between the founder and the advisor, and the retired
  third-person copy stays out of ``#about``;
* no ``class`` value containing ``team`` survives in ``index.html`` or
  ``assets/home.css``, and no ``home.team-*`` key survives in the page or
  ``home.json``;
* ``home.json`` carries en / zh-CN / zh-TW for every About key, and the retired
  bio keys are gone.

Everything here is source inspection: no browser, no server, no network.
"""

from __future__ import annotations

import hashlib
import json
import re
import struct
import unittest
from html.parser import HTMLParser
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_HTML = REPO_ROOT / "index.html"
HOME_CSS = REPO_ROOT / "assets" / "home.css"
HOME_JSON = REPO_ROOT / "assets" / "i18n" / "home.json"
MANIFEST = REPO_ROOT / "package-manifest.json"

LANGUAGES = ("en", "zh-CN", "zh-TW")
TRANSLATION_PREFIXES = ("home.",)

# The eleven keys the company-introduction block renders, in document order:
# the intro, the founder card, then the advisor card.
EXPECTED_ABOUT_KEYS = (
    "home.about-title",
    "home.about-lede",
    "home.about-founder-name",
    "home.about-founder-role",
    "home.about-director-name",
    "home.about-director-role",
    "home.about-advisor-name",
    "home.about-advisor-role",
)

FOUNDER_KEYS = EXPECTED_ABOUT_KEYS[2:4]
DIRECTOR_KEYS = EXPECTED_ABOUT_KEYS[4:6]
ADVISOR_KEYS = EXPECTED_ABOUT_KEYS[6:8]
BODY_KEYS = ()  # the closing paragraph row was removed

# The two About blocks in document order.
ABOUT_BLOCKS = ("about-intro", "about-founder")
# The blocks that are direct children of ``.about-layout``.
LAYOUT_BLOCKS = ABOUT_BLOCKS

# A person's name is not localised, so its three language fields stay identical.
# Every other About key must differ from its English text.
UNTRANSLATED_KEYS = (
    "home.about-founder-name",
    "home.about-director-name",
    "home.about-advisor-name",
)

# The three portraits the About section ships, with their exact pixel sizes.
FOUNDER_PHOTO = "assets/illustrations/haoyi-zhang.png"
FOUNDER_PHOTO_SIZE = (840, 1080)
DIRECTOR_PHOTO = "assets/illustrations/jake-chan.jpg"
DIRECTOR_PHOTO_SIZE = (800, 800)
ADVISOR_PHOTO = "assets/illustrations/siwei-liu.jpg"
ADVISOR_PHOTO_SIZE = (840, 1080)

# The English each card must render, byte for byte.
CARD_ENGLISH = {
    "home.about-founder-name": "Mr. Haoyi ZHANG",
    "home.about-founder-role": "Founder and Director",
    "home.about-director-name": "Dr. Jake CHAN",
    "home.about-director-role": "Director",
    "home.about-advisor-name": "Ir Prof. Siwei LIU",
    "home.about-advisor-role": "Technical Advisor",
}

# (card keys, portrait source, intrinsic size, name, role, image alt) per card.
# The advisor's portrait alt is the plain name while the h3 carries the title.
CARDS = (
    (FOUNDER_KEYS, FOUNDER_PHOTO, FOUNDER_PHOTO_SIZE, "Mr. Haoyi ZHANG",
     "Founder and Director", "Haoyi ZHANG"),
    (DIRECTOR_KEYS, DIRECTOR_PHOTO, DIRECTOR_PHOTO_SIZE, "Dr. Jake CHAN",
     "Director", "Jake CHAN"),
    (ADVISOR_KEYS, ADVISOR_PHOTO, ADVISOR_PHOTO_SIZE, "Ir Prof. Siwei LIU",
     "Technical Advisor", "Siwei LIU"),
)

# The photo box: a 240px rounded square on desktop, 208px on mobile.
PHOTO_SELECTOR = ".about-founder__photo"
PHOTO_WIDTH = 240
PHOTO_MOBILE_WIDTH = 208
GRID_SELECTOR = ".about-founder"
GRID_COLUMNS = "repeat(3,minmax(0,1fr))"

# Portrait files that no longer belong to #about.
RETIRED_PERSONS = ()
RETIRED_NAMES = ()
RETIRED_PHOTOS = (
    "assets/illustrations/siwei-liu.jpeg",
)
FOOTER_LOGO = "assets/ouronex-mark.svg"

# The retired team keys must not be referenced or carried by the dictionary.
REMOVED_TEAM_KEYS = (
    "home.team-jake-role",
    "home.team-jake-bio-1",
    "home.team-haoyi-role",
    "home.team-haoyi-bio-1",
    "home.team-siwei-role",
    "home.team-siwei-bio-1",
)
# Every bio line was dropped from the cards, so the keys must not come back.
REMOVED_ABOUT_KEYS = (
    "home.about-founder-bio-1",
    "home.about-founder-bio-2",
    "home.about-advisor-bio",
)

VOID_TAGS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}

KEY_REFERENCE = re.compile(
    r'\bdata-i18n(?:-(?:content|alt|aria-label|placeholder|title|value))?="([^"]+)"'
)
CLASS_ATTRIBUTE = re.compile(r'\bclass="([^"]*)"')
HEADINGS = ("h1", "h2", "h3", "h4", "h5", "h6")
COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
CSS_RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")


# ---------------------------------------------------------------------------
# Minimal element tree over html.parser
# ---------------------------------------------------------------------------


class _TreeBuilder(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = {"tag": "#document", "attrs": {}, "children": [], "text": [], "parent": None}
        self._stack = [self.root]

    def _node(self, tag: str, attrs) -> dict:
        node = {
            "tag": tag,
            "attrs": dict(attrs),
            "children": [],
            "text": [],
            "parent": self._stack[-1],
        }
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
    return list(node["children"])


def descendants(node: dict) -> list:
    found = []
    for child in node["children"]:
        found.append(child)
        found.extend(descendants(child))
    return found


def find_all(node: dict, predicate) -> list:
    return [item for item in descendants(node) if predicate(item)]


def find_by_id(node: dict, element_id: str):
    for item in descendants(node):
        if item["attrs"].get("id") == element_id:
            return item
    return None


def find_by_class(node: dict, name: str) -> list:
    return find_all(node, lambda item: has_class(item, name))


def direct_child(node: dict, predicate):
    for child in node["children"]:
        if predicate(child):
            return child
    return None


def text_of(node: dict) -> str:
    parts = list(node["text"])
    for child in node["children"]:
        parts.append(text_of(child))
    return "".join(parts)


def normalised_text(node: dict) -> str:
    return " ".join(text_of(node).split())


def translation_keys(node: dict) -> list:
    keys = []
    for attribute, value in node["attrs"].items():
        if attribute == "data-i18n" or attribute.startswith("data-i18n-"):
            keys.append(value)
    return keys


def png_size(path: Path) -> tuple:
    """(width, height) read straight from the PNG IHDR chunk."""
    payload = path.read_bytes()
    if payload[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError(f"{path.name} is not a PNG file")
    return struct.unpack(">II", payload[16:24])


def jpeg_size(path: Path) -> tuple:
    """(width, height) read from the first JPEG start-of-frame segment."""
    payload = path.read_bytes()
    if not payload.startswith(b"\xff\xd8"):
        raise AssertionError(f"{path.name} is not a JPEG file")
    index = 2
    while index < len(payload):
        if payload[index] != 0xFF:
            index += 1
            continue
        marker = payload[index + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            height, width = struct.unpack(">HH", payload[index + 5:index + 9])
            return width, height
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            index += 2
            continue
        index += 2 + struct.unpack(">H", payload[index + 2:index + 4])[0]
    raise AssertionError(f"{path.name} has no JPEG start-of-frame segment")


def css_rules(css: str) -> list:
    """Every (selectors, declarations) pair of a comment-free stylesheet."""
    found = []
    for match in CSS_RULE_RE.finditer(COMMENT_RE.sub("", css)):
        selectors = [re.sub(r"\s+", "", part) for part in match.group(1).split(",") if part.strip()]
        if not selectors or any(selector.startswith("@") for selector in selectors):
            continue
        declarations = {}
        for declaration in match.group(2).split(";"):
            if ":" not in declaration:
                continue
            prop, _, value = declaration.partition(":")
            declarations[prop.strip().lower()] = re.sub(r"\s+", "", value.strip().lower())
        if declarations:
            found.append((selectors, declarations))
    return found


def css_rule(css: str, selector: str) -> dict:
    target = re.sub(r"\s+", "", selector)
    for selectors, declarations in css_rules(css):
        if target in selectors:
            return declarations
    raise AssertionError(f"{selector}: no rule found in assets/home.css")


def css_media_block(css: str, prelude_fragment: str) -> str:
    text = COMMENT_RE.sub("", css)
    position = text.find(prelude_fragment)
    if position < 0:
        raise AssertionError(f"missing @media block containing {prelude_fragment!r}")
    start = text.index("{", position)
    depth = 0
    for cursor in range(start, len(text)):
        if text[cursor] == "{":
            depth += 1
        elif text[cursor] == "}":
            depth -= 1
            if depth == 0:
                return text[start + 1:cursor]
    raise AssertionError(f"unbalanced @media block containing {prelude_fragment!r}")


# ---------------------------------------------------------------------------
# Shared, read-only fixtures
# ---------------------------------------------------------------------------


class AboutFixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX_HTML.read_text(encoding="utf-8")
        cls.css = HOME_CSS.read_text(encoding="utf-8")
        cls.document = parse(cls.index)
        cls.about = find_by_id(cls.document, "about")
        if cls.about is None:
            raise AssertionError("#about section is missing")
        layouts = find_by_class(cls.about, "about-layout")
        if len(layouts) != 1:
            raise AssertionError(
                f"#about must hold exactly one .about-layout, found {len(layouts)}"
            )
        cls.layout = layouts[0]
        cls.intro = cls.block("about-intro")
        cls.founder = cls.block("about-founder")
        cls.cards = cls.block_list("about-founder__card")
        cls.footer = direct_child(cls.about, lambda node: has_class(node, "site-footer"))
        cls.home = json.loads(HOME_JSON.read_text(encoding="utf-8"))
        cls.manifest = {
            entry["path"]: entry
            for entry in json.loads(MANIFEST.read_text(encoding="utf-8"))["files"]
        }

    @classmethod
    def block(cls, name: str) -> dict:
        matches = cls.block_list(name)
        if len(matches) != 1:
            raise AssertionError(f".about-layout must hold exactly one .{name}, found {len(matches)}")
        return matches[0]

    @classmethod
    def block_list(cls, name: str) -> list:
        return find_by_class(cls.layout, name)

    def translated_spans(self, node: dict) -> list:
        return [item for item in descendants(node) if item["tag"] == "span" and "data-i18n" in item["attrs"]]

    def section_without_footer(self) -> list:
        """Every descendant of #about that is not the footer or inside it."""
        found = []
        for child in descendants(self.about):
            if child is self.footer:
                continue
            if self.footer is not None and child in descendants(self.footer):
                continue
            found.append(child)
        return found


# ---------------------------------------------------------------------------
# 1. Structure of the company-introduction block
# ---------------------------------------------------------------------------


class AboutStructureTests(AboutFixtures):
    def test_about_holds_the_intro_and_founder_once_each_in_order(self):
        for name in ABOUT_BLOCKS:
            with self.subTest(block=name):
                self.assertEqual(
                    len(find_by_class(self.about, name)),
                    1,
                    f".{name} must appear exactly once inside #about",
                )
        order = [
            name
            for node in descendants(self.about)
            for name in ABOUT_BLOCKS
            if has_class(node, name)
        ]
        self.assertEqual(
            order,
            list(ABOUT_BLOCKS),
            "#about renders the intro, then the founder cards",
        )
        self.assertEqual(
            [classes(child)[0] for child in elements(self.layout)],
            list(LAYOUT_BLOCKS),
            ".about-layout holds exactly the intro and the founder grid",
        )

    def test_founder_holds_exactly_three_cards(self):
        children = elements(self.founder)
        self.assertEqual(
            len(children),
            3,
            ".about-founder is a three-card grid and must hold exactly three children",
        )
        for child, card in zip(children, self.cards):
            with self.subTest(card=normalised_text(child)[:24]):
                self.assertEqual(child["tag"], "aside", ".about-founder holds aside cards")
                self.assertIn("about-founder__card", classes(child))
                self.assertIs(child, card)
        self.assertNotIn(
            "about-body",
            [name for child in elements(self.layout) for name in classes(child)],
            "the paragraph row is gone from the layout",
        )

    def test_intro_holds_one_heading_and_one_lede(self):
        headings = [node for node in descendants(self.intro) if node["tag"] == "h2"]
        self.assertEqual(len(headings), 1, ".about-intro needs exactly one h2")
        ledes = [node for node in elements(self.intro) if has_class(node, "about-lede")]
        self.assertEqual(len(ledes), 1, ".about-intro needs exactly one .about-lede")
        self.assertEqual(ledes[0]["tag"], "p", ".about-lede must be a paragraph")
        self.assertEqual(
            [child["tag"] for child in elements(self.intro)],
            ["h2", "p"],
            ".about-intro holds the heading then the lede",
        )
        for node in (headings[0], ledes[0]):
            self.assertEqual(len(self.translated_spans(node)), 1, f"{node['tag']} needs one span")

    def test_the_closing_paragraph_row_is_gone(self):
        self.assertEqual(
            find_by_class(self.layout, "about-body"),
            [],
            "the three-column body row was removed from the About section",
        )
        self.assertNotIn(
            "about-body",
            [name for child in elements(self.layout) for name in classes(child)],
            ".about-layout holds only the intro and the founder grid",
        )

    def test_the_principle_cards_are_gone(self):
        """The three cards under the about block were removed on request."""
        self.assertEqual(find_by_class(self.about, "about-principles"), [],
                         "#about must not render an .about-principles block")
        self.assertEqual([node for node in self.translated_spans(self.about)
                          if node["attrs"]["data-i18n"].startswith("home.about-principle-")],
                         [], "no principle keys may survive in the markup")
        self.assertEqual([key for key in self.home if key.startswith("home.about-principle-")],
                         [], "home.json must not keep the principle keys")
        self.assertNotIn(".about-principles", self.css,
                         "the stylesheet must not keep the principle rules")

    def test_each_card_holds_the_photo_and_its_translated_lines(self):
        self.assertEqual(len(self.cards), 3, ".about-founder must hold the three person cards")
        for card, (keys, photo_source, photo_size, name_text, role_text, alt_text) in zip(
            self.cards, CARDS
        ):
            with self.subTest(card=name_text):
                self.assertEqual(
                    [child["tag"] for child in elements(card)],
                    ["figure", "h3", "p"],
                    "a card holds the photo, the name and the role only",
                )
                figure, name, role = elements(card)
                self.assertIn("about-founder__photo", classes(figure))
                self.assertIn("about-founder__role", classes(role))
                self.assertEqual(
                    find_all(card, lambda node: has_class(node, "about-founder__bio")),
                    [],
                    "the bio line was dropped from every card",
                )

                images = [node for node in descendants(figure) if node["tag"] == "img"]
                self.assertEqual(len(images), 1, "the photo figure holds exactly one portrait")
                portrait = images[0]
                self.assertEqual(portrait["attrs"].get("src"), photo_source)
                self.assertEqual(portrait["attrs"].get("alt"), alt_text)
                self.assertEqual(portrait["attrs"].get("width"), str(photo_size[0]))
                self.assertEqual(portrait["attrs"].get("height"), str(photo_size[1]))

                for node, key in zip((name, role), keys):
                    with self.subTest(key=key):
                        spans = self.translated_spans(node)
                        self.assertEqual(len(spans), 1, f"{key} needs exactly one translated span")
                        self.assertEqual(spans[0]["attrs"]["data-i18n"], key)
                        self.assertEqual(
                            normalised_text(spans[0]),
                            " ".join(self.home[key]["en"].split()),
                            f"{key} must render the dictionary English",
                        )
                self.assertEqual(normalised_text(name), name_text)
                self.assertEqual(normalised_text(role), role_text)

    def test_cards_render_the_approved_names_and_roles(self):
        expected = [
            ("Mr. Haoyi ZHANG", "Founder and Director"),
            ("Dr. Jake CHAN", "Director"),
            ("Ir Prof. Siwei LIU", "Technical Advisor"),
        ]
        self.assertEqual(len(self.cards), len(expected))
        for card, (name_text, role_text) in zip(self.cards, expected):
            with self.subTest(card=name_text):
                name, role = elements(card)[1:3]
                self.assertEqual(normalised_text(self.translated_spans(name)[0]), name_text)
                self.assertEqual(normalised_text(self.translated_spans(role)[0]), role_text)


# ---------------------------------------------------------------------------
# 2. Copy is fully translated and matches the dictionary
# ---------------------------------------------------------------------------


class AboutCopyTests(AboutFixtures):
    def test_every_visible_text_node_is_a_translated_span(self):
        for node in self.section_without_footer():
            for raw in node["text"]:
                if not raw.strip():
                    continue
                with self.subTest(text=raw.strip()[:32]):
                    self.assertEqual(node["tag"], "span", "visible text must live in a span")
                    self.assertIn(
                        "data-i18n",
                        node["attrs"],
                        "every visible About text node needs a data-i18n key",
                    )

    def test_rendered_text_matches_the_dictionary_english(self):
        spans = self.translated_spans(self.layout)
        self.assertTrue(spans, "the About block must render translated spans")
        for span in spans:
            key = span["attrs"]["data-i18n"]
            with self.subTest(key=key):
                self.assertIn(key, self.home, f"{key} is missing from home.json")
                self.assertEqual(
                    normalised_text(span),
                    " ".join(self.home[key]["en"].split()),
                    f"{key} must render the dictionary English",
                )

    def test_about_keys_are_referenced_once_each_in_order(self):
        keys = [span["attrs"]["data-i18n"] for span in self.translated_spans(self.layout)]
        self.assertEqual(tuple(keys), EXPECTED_ABOUT_KEYS)
        for key in EXPECTED_ABOUT_KEYS:
            with self.subTest(key=key):
                self.assertEqual(
                    self.index.count(f'data-i18n="{key}"'),
                    1,
                    f"{key} must be referenced exactly once",
                )


# ---------------------------------------------------------------------------
# 3. Team cards, portraits and extra copy are gone
# ---------------------------------------------------------------------------


class AboutRetiredTeamTests(AboutFixtures):
    def test_no_class_containing_team_survives(self):
        for value in CLASS_ATTRIBUTE.findall(self.index):
            with self.subTest(value=value):
                self.assertNotIn("team", value.lower(), "a team class is still used")
        for marker in ("team-grid", "team-member", "team-photo", "team-copy", "team-role", "team-bio", "team-layout"):
            with self.subTest(marker=marker):
                self.assertNotIn(marker, self.index)
        self.assertEqual(
            re.findall(r"\.team[\w-]*", self.css),
            [],
            "no .team-* selector may survive in assets/home.css",
        )

    def test_no_team_key_survives_in_the_page_or_the_dictionary(self):
        self.assertEqual(
            re.findall(r"home\.team[\w-]*", self.index),
            [],
            "index.html must not reference a home.team-* key",
        )
        self.assertEqual(
            [key for key in self.home if re.fullmatch(r"home\.team[\w-]*", key)],
            [],
            "home.json must not carry a home.team-* key",
        )

    def test_section_names_no_retired_person(self):
        text = normalised_text(self.about)
        for name in RETIRED_NAMES:
            with self.subTest(name=name):
                self.assertNotIn(name, text, f"{name} must not appear in #about")
        for key in REMOVED_TEAM_KEYS:
            with self.subTest(key=key):
                self.assertNotIn(key, self.index, f"{key} is still referenced")

    def test_the_director_card_sits_between_the_founder_and_the_advisor(self):
        names = [
            normalised_text(node)
            for card in self.cards
            for node in elements(card)[1:2]
        ]
        self.assertEqual(
            names,
            ["Mr. Haoyi ZHANG", "Dr. Jake CHAN", "Ir Prof. Siwei LIU"],
            "the director card reads between the other two",
        )

    def test_the_retired_third_person_does_not_appear(self):
        text = normalised_text(self.about)
        for marker in RETIRED_PERSONS:
            with self.subTest(marker=marker):
                self.assertNotIn(marker, self.index, f"{marker} is still on index.html")
                self.assertNotIn(marker, text, f"{marker} must not appear in #about")

    def test_portraits_are_the_only_images_outside_the_footer(self):
        images = [node for node in descendants(self.about) if node["tag"] == "img"]
        self.assertIsNotNone(self.footer, ".site-footer must stay inside #about")
        self.assertEqual(self.footer["tag"], "footer")
        self.assertIn("site-footer", classes(self.footer))

        footer_images = [node for node in images if node in descendants(self.footer)]
        self.assertEqual(len(footer_images), 1, "the footer keeps exactly its one logo image")
        self.assertEqual(footer_images[0]["attrs"].get("src"), FOOTER_LOGO)

        content_images = [node for node in images if node not in footer_images]
        self.assertEqual(
            len(content_images), 3, "the three portraits are the only other images in #about"
        )
        self.assertEqual(
            [node["attrs"].get("src") for node in content_images],
            [FOUNDER_PHOTO, DIRECTOR_PHOTO, ADVISOR_PHOTO],
        )
        photo_figures = find_all(
            self.founder, lambda node: has_class(node, "about-founder__photo")
        )
        self.assertEqual(len(photo_figures), 3, "each card carries one photo figure")
        for portrait in content_images:
            self.assertTrue(
                any(portrait in descendants(figure) for figure in photo_figures),
                "both portraits live inside .about-founder__photo figures",
            )
        self.assertEqual(
            len(images),
            4,
            "#about holds the three portraits plus the footer logo, nothing else",
        )

    def test_portraits_are_shipped_at_their_declared_size_and_manifest_listed(self):
        for source, size, reader in (
            (FOUNDER_PHOTO, FOUNDER_PHOTO_SIZE, png_size),
            (DIRECTOR_PHOTO, DIRECTOR_PHOTO_SIZE, jpeg_size),
            (ADVISOR_PHOTO, ADVISOR_PHOTO_SIZE, jpeg_size),
        ):
            with self.subTest(source=source):
                path = REPO_ROOT / source
                self.assertTrue(path.is_file(), f"{source} must exist on disk")
                self.assertEqual(reader(path), size, f"{source} must be {size[0]}x{size[1]}")
                entry = self.manifest.get(source)
                self.assertIsNotNone(entry, f"{source} must be listed in package-manifest.json")
                payload = path.read_bytes()
                if "bytes" in entry:
                    self.assertEqual(entry["bytes"], len(payload), source)
                if "size" in entry:
                    self.assertEqual(entry["size"], len(payload), source)
                if "sha256" in entry:
                    self.assertEqual(
                        entry["sha256"], hashlib.sha256(payload).hexdigest(), source
                    )

    def test_retired_portrait_files_are_gone(self):
        for source in RETIRED_PHOTOS:
            with self.subTest(source=source):
                self.assertNotIn(source, self.index, f"{source} is still referenced")
                self.assertFalse((REPO_ROOT / source).exists(), f"{source} must be deleted")

    def test_footer_is_untouched(self):
        self.assertIsNotNone(self.footer, ".site-footer must stay inside #about")
        self.assertEqual(self.footer["attrs"].get("class"), "site-footer")
        self.assertTrue(find_by_class(self.footer, "footer-nav"), "the footer navigation must stay")
        self.assertTrue(find_by_class(self.footer, "footer-socials"), "the footer socials must stay")
        self.assertTrue(find_by_class(self.footer, "footer-legal"), "the legal links must stay")


# ---------------------------------------------------------------------------
# 4. Photo box styling
# ---------------------------------------------------------------------------


class AboutPhotoStyleTests(AboutFixtures):
    def test_founder_grid_is_three_equal_columns(self):
        rule = css_rule(self.css, GRID_SELECTOR)
        self.assertEqual(rule.get("display"), "grid")
        self.assertEqual(rule.get("grid-template-columns"), GRID_COLUMNS)

    def test_desktop_photo_is_a_240px_frame_matching_the_photo(self):
        rule = css_rule(self.css, PHOTO_SELECTOR)
        self.assertEqual(rule.get("width"), f"{PHOTO_WIDTH}px")
        self.assertEqual(rule.get("aspect-ratio"), "840/1080")
        self.assertEqual(rule.get("border-radius"), "10px")
        self.assertEqual(rule.get("overflow"), "hidden")

    def test_mobile_photo_shrinks_to_208px(self):
        mobile = css_media_block(self.css, "@media(max-width:760px)")
        rule = css_rule(mobile, PHOTO_SELECTOR)
        self.assertEqual(rule.get("width"), f"{PHOTO_MOBILE_WIDTH}px")


# ---------------------------------------------------------------------------
# 5. Dictionaries: all three languages, verbatim English
# ---------------------------------------------------------------------------


class HomeDictionaryTests(AboutFixtures):
    def test_card_keys_resolve_to_the_exact_english(self):
        for key, expected in CARD_ENGLISH.items():
            with self.subTest(key=key):
                self.assertTrue(key in self.home, f"home.json is missing {key}")
                self.assertEqual(
                    " ".join(self.home[key]["en"].split()),
                    " ".join(expected.split()),
                    f"{key}.en must be the exact approved English",
                )

    def test_card_keys_resolve_in_the_dictionary(self):
        for key in FOUNDER_KEYS + DIRECTOR_KEYS + ADVISOR_KEYS:
            with self.subTest(key=key):
                self.assertTrue(key in self.home, f"home.json is missing {key}")
                entry = self.home[key]
                self.assertEqual(set(entry), set(LANGUAGES), f"{key} language fields")
                self.assertTrue(entry["en"].strip(), f"{key}.en is empty")
        self.assertEqual(len(FOUNDER_KEYS), 2, "the founder card carries a name and a role")
        self.assertEqual(len(DIRECTOR_KEYS), 2, "the director card carries a name and a role")
        self.assertEqual(len(ADVISOR_KEYS), 2, "the advisor card carries a name and a role")

    def test_about_keys_carry_all_three_languages(self):
        for key in EXPECTED_ABOUT_KEYS:
            with self.subTest(key=key):
                self.assertTrue(key in self.home, f"home.json is missing {key}")
                entry = self.home[key]
                self.assertEqual(set(entry), set(LANGUAGES), f"{key} language fields")
                for language in LANGUAGES:
                    self.assertIsInstance(entry[language], str)
                    self.assertTrue(entry[language].strip(), f"{key}.{language} is empty")
                for language in ("zh-CN", "zh-TW"):
                    if key in UNTRANSLATED_KEYS:
                        self.assertEqual(
                            entry[language],
                            entry["en"],
                            f"{key}.{language} must keep the proper name unlocalised",
                        )
                        continue
                    self.assertNotEqual(
                        entry[language], entry["en"], f"{key}.{language} must be translated"
                    )

    def test_retired_about_and_team_keys_are_gone_from_the_dictionary(self):
        for key in REMOVED_TEAM_KEYS + REMOVED_ABOUT_KEYS:
            with self.subTest(key=key):
                self.assertFalse(key in self.home, f"{key} must be removed from home.json")

    def test_every_home_entry_is_complete(self):
        for key, entry in self.home.items():
            with self.subTest(key=key):
                self.assertIsInstance(entry, dict)
                self.assertEqual(set(entry), set(LANGUAGES))
                for language in LANGUAGES:
                    self.assertIsInstance(entry[language], str)
                    self.assertTrue(entry[language].strip())

    def test_referenced_about_keys_exist_in_the_dictionary(self):
        keys = [span["attrs"]["data-i18n"] for span in self.translated_spans(self.layout)]
        for key in keys:
            with self.subTest(key=key):
                self.assertTrue(
                    key in self.home, f"#about references unknown key {key}"
                )

    def test_every_home_key_used_in_the_page_exists_in_the_dictionary(self):
        for key in KEY_REFERENCE.findall(self.index):
            if not key.startswith(TRANSLATION_PREFIXES):
                continue
            with self.subTest(key=key):
                self.assertTrue(
                    key in self.home, f"index.html references unknown key {key}"
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
