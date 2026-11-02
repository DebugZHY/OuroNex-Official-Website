"""Static content regression tests for the About company-introduction block.

Scope (content unit only):

* ``#about`` holds exactly one ``.about-layout``; inside it, in source order,
  one ``.about-intro`` (one ``h2`` then one ``p.about-lede``) and one
  ``.about-founder`` (a two-column grid) that carries the body as its second
  child; the principles block that used to close the section was removed;
* ``.about-founder`` holds exactly two children: ``aside.about-founder__card``
  then ``div.about-body``; the card holds the portrait figure, the name ``h3``,
  the ``p.about-founder__role`` line and exactly two ``p.about-founder__bio``
  lines, and the body holds exactly three ``p``;
* the only images inside ``#about`` are the founder portrait
  (``assets/illustrations/haoyi-zhang.png``, 413x531, inside
  ``.about-founder__photo``) and the footer logo (inside
  ``footer.site-footer``); the portrait is present on disk, is 413x531 and is
  listed in ``package-manifest.json``;
* every visible text node in ``#about`` (footer excluded) sits inside a span
  carrying a ``data-i18n`` key, and every key resolves in ``home.json`` with the
  same English text rendered in the page, with the founder name/role exactly
  ``Haoyi ZHANG`` / ``Founder and Director``;
* nobody but the founder is named: ``Jake Chan``, ``Siwei Liu``,
  ``jake-chan`` and ``siwei-liu`` are absent from ``#about`` and
  ``index.html``;
* no ``class`` value containing ``team`` survives in ``index.html`` or
  ``assets/home.css``, and no ``home.team-*`` key survives in ``index.html`` or
  ``home.json``;
* ``home.json`` carries en / zh-CN / zh-TW for every About key.

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

# The nine keys the company-introduction block renders, in document order.
# ``.about-body`` now nests inside ``.about-founder``, after the founder card.
EXPECTED_ABOUT_KEYS = (
    "home.about-title",
    "home.about-lede",
    "home.about-founder-name",
    "home.about-founder-role",
    "home.about-founder-bio-1",
    "home.about-founder-bio-2",
    "home.about-body-1",
    "home.about-body-2",
    "home.about-body-3",
)

FOUNDER_KEYS = EXPECTED_ABOUT_KEYS[2:6]
BODY_KEYS = EXPECTED_ABOUT_KEYS[6:9]

# The three About blocks in document order (``about-body`` nests in the founder).
ABOUT_BLOCKS = ("about-intro", "about-founder", "about-body")
# The blocks that are direct children of ``.about-layout``.
LAYOUT_BLOCKS = ("about-intro", "about-founder")

# A person's name is not localised, so its three language fields stay identical.
# Every other About key must differ from its English text.
UNTRANSLATED_KEYS = ("home.about-founder-name",)

# The one portrait the About section ships, with its exact pixel size.
FOUNDER_PHOTO = "assets/illustrations/haoyi-zhang.png"
FOUNDER_PHOTO_SIZE = (413, 531)

# The English the founder card must render, byte for byte.
FOUNDER_ENGLISH = {
    "home.about-founder-name": "Haoyi ZHANG",
    "home.about-founder-role": "Founder and Director",
}

# Names and portrait files that no longer belong to #about. The founder renders
# as "Haoyi ZHANG" (upper-case surname), so the old spelling must stay absent
# rather than reappear as a second person.
RETIRED_PERSONS = (
    "Jake Chan",
    "Siwei Liu",
    "jake-chan",
    "siwei-liu",
)
RETIRED_NAMES = (
    "Jake Chan",
    "Ir Prof. Siwei Liu",
    "Siwei Liu",
)
RETIRED_PHOTOS = (
    "assets/illustrations/jake-chan.jpeg",
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


# ---------------------------------------------------------------------------
# Shared, read-only fixtures
# ---------------------------------------------------------------------------


class AboutFixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX_HTML.read_text(encoding="utf-8")
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
        cls.card = cls.block("about-founder__card")
        cls.photo = cls.block("about-founder__photo")
        cls.body = cls.block("about-body")
        cls.footer = direct_child(cls.about, lambda node: has_class(node, "site-footer"))
        cls.home = json.loads(HOME_JSON.read_text(encoding="utf-8"))
        cls.manifest = {
            entry["path"]: entry
            for entry in json.loads(MANIFEST.read_text(encoding="utf-8"))["files"]
        }

    @classmethod
    def block(cls, name: str) -> dict:
        matches = find_by_class(cls.layout, name)
        if len(matches) != 1:
            raise AssertionError(f".about-layout must hold exactly one .{name}, found {len(matches)}")
        return matches[0]

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
    def test_about_holds_the_four_blocks_once_each_in_order(self):
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
            "#about renders the intro then the founder (with the body)",
        )
        self.assertEqual(
            [classes(child)[0] for child in elements(self.layout)],
            list(LAYOUT_BLOCKS),
            ".about-layout holds exactly the intro and the founder",
        )

    def test_founder_holds_the_card_then_the_body(self):
        children = elements(self.founder)
        self.assertEqual(
            [child["tag"] for child in children],
            ["aside", "div"],
            ".about-founder is a two-column grid: the card then the body",
        )
        card, body = children
        self.assertEqual(classes(card), ["about-founder__card"])
        self.assertEqual(classes(body), ["about-body"])
        self.assertIs(body, self.body, "the nested .about-body is the one under test")
        self.assertIs(card, self.card)
        self.assertEqual(
            self.body["parent"],
            self.founder,
            ".about-body must sit inside .about-founder, not beside it",
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

    def test_body_holds_exactly_three_paragraphs(self):
        paragraphs = [node for node in elements(self.body) if node["tag"] == "p"]
        self.assertEqual(len(paragraphs), 3, ".about-body must hold exactly three p")
        self.assertEqual(
            [child["tag"] for child in elements(self.body)],
            ["p", "p", "p"],
            ".about-body holds only the three paragraphs",
        )
        for paragraph in paragraphs:
            with self.subTest(text=normalised_text(paragraph)[:32]):
                spans = self.translated_spans(paragraph)
                self.assertEqual(len(spans), 1, "each body paragraph needs one translated span")

    def test_the_principle_cards_are_gone(self):
        """The three cards under the about block were removed on request."""
        self.assertEqual(find_by_class(self.about, "about-principles"), [],
                         "#about must not render an .about-principles block")
        self.assertEqual([node for node in self.translated_spans(self.about)
                          if node["attrs"]["data-i18n"].startswith("home.about-principle-")],
                         [], "no principle keys may survive in the markup")
        self.assertEqual([key for key in self.home if key.startswith("home.about-principle-")],
                         [], "home.json must not keep the principle keys")
        self.assertNotIn(".about-principles", HOME_CSS.read_text(encoding="utf-8"),
                         "the stylesheet must not keep the principle rules")

    def test_founder_card_holds_the_photo_and_four_translated_lines(self):
        card = self.card
        self.assertEqual(
            [child["tag"] for child in elements(card)],
            ["figure", "h3", "p", "p", "p"],
            "the card holds the photo, the name, the role and the two bio lines",
        )
        photo, name, role, bio_one, bio_two = elements(card)
        self.assertIn("about-founder__photo", classes(photo))
        self.assertIs(photo, self.photo)
        self.assertIn("about-founder__role", classes(role))
        self.assertIn("about-founder__bio", classes(bio_one))
        self.assertIn("about-founder__bio", classes(bio_two))

        images = [node for node in descendants(photo) if node["tag"] == "img"]
        self.assertEqual(len(images), 1, "the founder photo figure holds exactly one portrait")
        portrait = images[0]
        self.assertEqual(portrait["attrs"].get("src"), FOUNDER_PHOTO)
        self.assertEqual(portrait["attrs"].get("alt"), "Haoyi ZHANG")
        self.assertEqual(portrait["attrs"].get("width"), str(FOUNDER_PHOTO_SIZE[0]))
        self.assertEqual(portrait["attrs"].get("height"), str(FOUNDER_PHOTO_SIZE[1]))

        for node, key in zip((name, role, bio_one, bio_two), FOUNDER_KEYS):
            with self.subTest(key=key):
                spans = self.translated_spans(node)
                self.assertEqual(len(spans), 1, f"{key} needs exactly one translated span")
                self.assertEqual(spans[0]["attrs"]["data-i18n"], key)
                self.assertEqual(
                    normalised_text(spans[0]),
                    " ".join(self.home[key]["en"].split()),
                    f"{key} must render the dictionary English",
                )
        for key, expected in FOUNDER_ENGLISH.items():
            with self.subTest(key=key):
                self.assertEqual(
                    self.home[key]["en"], expected, f"{key}.en must be the approved English"
                )
        name_span, role_span = (
            self.translated_spans(name)[0],
            self.translated_spans(role)[0],
        )
        self.assertEqual(normalised_text(name_span), "Haoyi ZHANG")
        self.assertEqual(normalised_text(role_span), "Founder and Director")


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
        css = HOME_CSS.read_text(encoding="utf-8")
        self.assertEqual(
            re.findall(r"\.team[\w-]*", css),
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

    def test_section_names_no_person(self):
        text = normalised_text(self.about)
        for name in RETIRED_NAMES:
            with self.subTest(name=name):
                self.assertNotIn(name, text, f"{name} must not appear in #about")
        for key in REMOVED_TEAM_KEYS:
            with self.subTest(key=key):
                self.assertNotIn(key, self.index, f"{key} is still referenced")

    def test_no_other_person_appears_in_the_section_or_the_page(self):
        text = normalised_text(self.about)
        for marker in RETIRED_PERSONS:
            with self.subTest(marker=marker):
                self.assertNotIn(marker, self.index, f"{marker} is still on index.html")
                self.assertNotIn(marker, text, f"{marker} must not appear in #about")

    def test_founder_photo_is_the_only_image_outside_the_footer(self):
        images = [node for node in descendants(self.about) if node["tag"] == "img"]
        self.assertIsNotNone(self.footer, ".site-footer must stay inside #about")
        self.assertEqual(self.footer["tag"], "footer")
        self.assertIn("site-footer", classes(self.footer))

        footer_images = [node for node in images if node in descendants(self.footer)]
        self.assertEqual(len(footer_images), 1, "the footer keeps exactly its one logo image")
        self.assertEqual(footer_images[0]["attrs"].get("src"), FOOTER_LOGO)

        content_images = [node for node in images if node not in footer_images]
        self.assertEqual(
            len(content_images), 1, "the founder portrait is the only other image in #about"
        )
        portrait = content_images[0]
        self.assertEqual(portrait["attrs"].get("src"), FOUNDER_PHOTO)
        self.assertIn(
            portrait,
            descendants(self.photo),
            "the portrait lives inside .about-founder__photo",
        )
        self.assertEqual(
            len(images),
            2,
            "#about holds the founder portrait plus the footer logo, nothing else",
        )

    def test_founder_photo_is_shipped_at_413x531_and_manifest_listed(self):
        path = REPO_ROOT / FOUNDER_PHOTO
        self.assertTrue(path.is_file(), f"{FOUNDER_PHOTO} must exist on disk")
        self.assertEqual(
            png_size(path), FOUNDER_PHOTO_SIZE, f"{FOUNDER_PHOTO} must be 413x531"
        )
        entry = self.manifest.get(FOUNDER_PHOTO)
        self.assertIsNotNone(entry, f"{FOUNDER_PHOTO} must be listed in package-manifest.json")
        payload = path.read_bytes()
        if "bytes" in entry:
            self.assertEqual(entry["bytes"], len(payload), FOUNDER_PHOTO)
        if "size" in entry:
            self.assertEqual(entry["size"], len(payload), FOUNDER_PHOTO)
        if "sha256" in entry:
            self.assertEqual(
                entry["sha256"], hashlib.sha256(payload).hexdigest(), FOUNDER_PHOTO
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
# 4. Dictionaries: all three languages, verbatim English
# ---------------------------------------------------------------------------


class HomeDictionaryTests(AboutFixtures):
    def test_founder_keys_resolve_to_the_exact_english(self):
        for key, expected in FOUNDER_ENGLISH.items():
            with self.subTest(key=key):
                self.assertIn(key, self.home, f"home.json is missing {key}")
                self.assertEqual(
                    " ".join(self.home[key]["en"].split()),
                    expected,
                    f"{key}.en must be the exact approved English",
                )

    def test_founder_and_body_keys_resolve_in_the_dictionary(self):
        for key in FOUNDER_KEYS + BODY_KEYS:
            with self.subTest(key=key):
                self.assertIn(key, self.home, f"home.json is missing {key}")
                entry = self.home[key]
                self.assertEqual(set(entry), set(LANGUAGES), f"{key} language fields")
                self.assertTrue(entry["en"].strip(), f"{key}.en is empty")
        self.assertEqual(len(FOUNDER_KEYS), 4, "name, role and the two bio lines")
        self.assertEqual(len(BODY_KEYS), 3, "three body paragraphs")

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

    def test_removed_team_keys_are_gone_from_the_dictionary(self):
        for key in REMOVED_TEAM_KEYS:
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
