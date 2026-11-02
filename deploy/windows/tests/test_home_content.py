"""Static content regression tests for the About roles and biographies.

Scope (content unit only):

* each ``article.team-member`` keeps its ``.team-photo > img`` and the existing
  untranslated ``h2`` name carrying ``data-user-input``;
* the name, role and biography are wrapped by ``div.team-copy``, which directly
  follows ``.team-photo`` (the stylesheet relies on ``.team-photo + .team-copy``);
* ``p.team-role`` sits directly below the name and holds one translated span;
* ``div.team-bio`` holds one concise ``p`` with one translated span;
* the English role/bio copy is verbatim and mapped to the right person;
* ``home.json`` carries en / zh-CN / zh-TW for every About key;
* no section headings and no extra visible copy are added.

Everything here is source inspection: no browser, no server, no network.
"""

from __future__ import annotations

import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_HTML = REPO_ROOT / "index.html"
HOME_JSON = REPO_ROOT / "assets" / "i18n" / "home.json"

LANGUAGES = ("en", "zh-CN", "zh-TW")
TRANSLATION_PREFIXES = ("home.",)

# Verbatim copy from the content brief. Do not reformat: the em dashes
# (U+2014) and the right single quotation marks (U+2019) are part of the text.
EXPECTED_MEMBERS = (
    {
        "name": "Jake Chan",
        "photo": "assets/illustrations/jake-chan.jpeg",
        "role_key": "home.team-jake-role",
        "role": "Director",
        "bios": (
            (
                "home.team-jake-bio-1",
                "Civil engineering PhD and Director of OuroNex, connecting rigorous engineering with global business strategy.",
            ),
        ),
    },
    {
        "name": "Haoyi Zhang",
        "photo": "assets/illustrations/haoyi-zhang.png",
        "role_key": "home.team-haoyi-role",
        "role": "Director",
        "bios": (
            (
                "home.team-haoyi-bio-1",
                "Founder and Director of OuroNex, working across AI, computational mechanics and structural analysis.",
            ),
        ),
    },
    {
        "name": "Ir Prof. Siwei Liu",
        "photo": "assets/illustrations/siwei-liu.jpeg",
        "role_key": "home.team-siwei-role",
        "role": "Technical Advisor",
        "bios": (
            (
                "home.team-siwei-bio-1",
                "Technical Advisor and structural engineering researcher, contributing to regional and national design standards.",
            ),
        ),
    },
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
HEADINGS = ("h1", "h2", "h3", "h4", "h5", "h6")


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


def text_segments(node: dict) -> list:
    """Non-empty text nodes in document order (one per visible copy block)."""
    segments = [text.strip() for text in node["text"] if text.strip()]
    for child in node["children"]:
        segments.extend(text_segments(child))
    return segments


def translation_keys(node: dict) -> list:
    keys = []
    for attribute, value in node["attrs"].items():
        if attribute == "data-i18n" or attribute.startswith("data-i18n-"):
            keys.append(value)
    return keys


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
        grids = find_all(cls.about, lambda node: has_class(node, "team-grid"))
        if len(grids) != 1:
            raise AssertionError(f"#about must hold exactly one .team-grid, found {len(grids)}")
        cls.grid = grids[0]
        cls.members = [
            child for child in cls.grid["children"] if has_class(child, "team-member")
        ]
        cls.home = json.loads(HOME_JSON.read_text(encoding="utf-8"))

    def member(self, index: int) -> dict:
        self.assertGreater(len(self.members), index, f"missing team member #{index + 1}")
        return self.members[index]

    def copy(self, index: int) -> dict:
        member = self.member(index)
        node = direct_child(member, lambda child: has_class(child, "team-copy"))
        self.assertIsNotNone(node, f"member #{index + 1} has no div.team-copy")
        return node


# ---------------------------------------------------------------------------
# 1. Existing photos, names and structure are preserved
# ---------------------------------------------------------------------------


class AboutStructureTests(AboutFixtures):
    def test_exactly_three_members_in_order(self):
        self.assertEqual(len(self.members), 3)
        for index, expected in enumerate(EXPECTED_MEMBERS):
            headings = find_all(
                self.member(index), lambda node: node["tag"] == "h2"
            )
            self.assertEqual(len(headings), 1, f"member #{index + 1} h2 count")
            self.assertEqual(normalised_text(headings[0]), expected["name"])

    def test_each_member_keeps_its_photo_and_copy_order(self):
        for index, expected in enumerate(EXPECTED_MEMBERS):
            member = self.member(index)
            children = elements(member)
            self.assertGreaterEqual(len(children), 2, f"member #{index + 1} children")
            photo, copy = children[0], children[1]
            self.assertTrue(has_class(photo, "team-photo"), "first child must be .team-photo")
            self.assertTrue(has_class(copy, "team-copy"), "second child must be .team-copy")
            self.assertEqual(
                photo["tag"], "div", ".team-photo must stay a div"
            )
            images = elements(photo)
            self.assertEqual(len(images), 1, ".team-photo must hold exactly one img")
            image = images[0]
            self.assertEqual(image["tag"], "img")
            self.assertEqual(image["attrs"].get("src"), expected["photo"])
            self.assertEqual(image["attrs"].get("alt"), expected["name"])

    def test_name_stays_untranslated_with_data_user_input(self):
        for index, expected in enumerate(EXPECTED_MEMBERS):
            heading = find_all(self.member(index), lambda node: node["tag"] == "h2")[0]
            self.assertIn("data-user-input", heading["attrs"])
            self.assertEqual(translation_keys(heading), [], "names must stay untranslated")
            self.assertEqual(elements(heading), [], "h2 must hold plain text only")
            self.assertEqual(normalised_text(heading), expected["name"])

    def test_copy_holds_name_then_role_then_bio(self):
        for index, expected in enumerate(EXPECTED_MEMBERS):
            copy = self.copy(index)
            tags = [child["tag"] for child in copy["children"]]
            self.assertEqual(tags, ["h2", "p", "div"], f"member #{index + 1} .team-copy order")
            role, bio = copy["children"][1], copy["children"][2]
            self.assertTrue(has_class(role, "team-role"), "role must be p.team-role")
            self.assertTrue(has_class(bio, "team-bio"), "bio must be div.team-bio")
            self.assertEqual(
                normalised_text(copy["children"][0]), expected["name"]
            )


# ---------------------------------------------------------------------------
# 2. Role and biography markup carries exactly one translated span each
# ---------------------------------------------------------------------------


class AboutCopyTests(AboutFixtures):
    def assert_translated_paragraph(self, node: dict, key: str, text: str, where: str):
        self.assertEqual(node["tag"], "p", where)
        children = elements(node)
        self.assertEqual(len(children), 1, f"{where}: expected exactly one child span")
        span = children[0]
        self.assertEqual(span["tag"], "span", where)
        self.assertEqual(span["attrs"].get("data-i18n"), key, where)
        self.assertEqual(normalised_text(span), text, where)
        self.assertEqual(
            "".join(node["text"]).strip(), "", f"{where}: no untranslated loose text"
        )

    def test_role_sits_directly_below_the_name(self):
        for index, expected in enumerate(EXPECTED_MEMBERS):
            copy = self.copy(index)
            role = copy["children"][1]
            self.assertTrue(has_class(role, "team-role"))
            self.assert_translated_paragraph(
                role,
                expected["role_key"],
                expected["role"],
                f"member #{index + 1} role",
            )

    def test_bio_has_exactly_one_translated_paragraph(self):
        for index, expected in enumerate(EXPECTED_MEMBERS):
            bio = self.copy(index)["children"][2]
            self.assertTrue(has_class(bio, "team-bio"))
            self.assertEqual(bio["tag"], "div", "bio container must be a div")
            paragraphs = elements(bio)
            self.assertEqual(
                len(paragraphs), 1, f"member #{index + 1} must have exactly one concise bio paragraph"
            )
            for paragraph, (key, text) in zip(paragraphs, expected["bios"]):
                self.assert_translated_paragraph(
                    paragraph, key, text, f"member #{index + 1} {key}"
                )

    def test_about_keys_are_referenced_once_each(self):
        for expected in EXPECTED_MEMBERS:
            for key in [expected["role_key"]] + [key for key, _ in expected["bios"]]:
                self.assertEqual(
                    self.index.count(f'data-i18n="{key}"'),
                    1,
                    f"{key} must be referenced exactly once",
                )


# ---------------------------------------------------------------------------
# 3. No added headings or extra visible copy
# ---------------------------------------------------------------------------


class AboutNoExtraCopyTests(AboutFixtures):
    def test_no_new_section_headings(self):
        headings = [node for node in descendants(self.about) if node["tag"] in HEADINGS]
        self.assertEqual([node["tag"] for node in headings], ["h2", "h2", "h2"])
        self.assertEqual(
            [normalised_text(node) for node in headings],
            [expected["name"] for expected in EXPECTED_MEMBERS],
        )

    def test_team_grid_visible_text_is_only_names_roles_and_bios(self):
        expected = []
        for member in EXPECTED_MEMBERS:
            expected.append(member["name"])
            expected.append(member["role"])
            expected.extend(text for _, text in member["bios"])
        self.assertEqual(text_segments(self.grid), expected)

    def test_footer_and_photos_are_untouched(self):
        footer = direct_child(self.about, lambda node: has_class(node, "home-footer"))
        self.assertIsNotNone(footer, ".home-footer must stay inside #about")
        self.assertIn("home.feature-engineering-copy-3", self.index)
        self.assertIn("home.feature-experts-copy-3", self.index)


# ---------------------------------------------------------------------------
# 4. Dictionaries: all three languages, verbatim English
# ---------------------------------------------------------------------------


class HomeDictionaryTests(AboutFixtures):
    def test_about_keys_carry_all_three_languages(self):
        for expected in EXPECTED_MEMBERS:
            entries = [(expected["role_key"], expected["role"])]
            entries.extend(expected["bios"])
            for key, english in entries:
                with self.subTest(key=key):
                    self.assertTrue(
                        key in self.home, f"home.json is missing {key}"
                    )
                    entry = self.home[key]
                    self.assertEqual(set(entry), set(LANGUAGES), f"{key} language fields")
                    for language in LANGUAGES:
                        self.assertIsInstance(entry[language], str)
                        self.assertTrue(entry[language].strip(), f"{key}.{language} is empty")
                    self.assertEqual(entry["en"], english, f"{key}.en must be verbatim")
                    for language in ("zh-CN", "zh-TW"):
                        self.assertNotEqual(
                            entry[language], english, f"{key}.{language} must be translated"
                        )

    def test_every_home_entry_is_complete(self):
        for key, entry in self.home.items():
            with self.subTest(key=key):
                self.assertIsInstance(entry, dict)
                self.assertEqual(set(entry), set(LANGUAGES))
                for language in LANGUAGES:
                    self.assertIsInstance(entry[language], str)
                    self.assertTrue(entry[language].strip())

    def test_referenced_about_keys_exist_in_the_dictionary(self):
        for key in KEY_REFERENCE.findall(self.index):
            if not key.startswith(TRANSLATION_PREFIXES):
                continue
            with self.subTest(key=key):
                self.assertTrue(
                    key in self.home, f"index.html references unknown key {key}"
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
