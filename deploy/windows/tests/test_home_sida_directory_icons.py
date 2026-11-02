"""SIDA directory icons: one inline decorative SVG per feature tab.

Frozen contract pinned here:

1. the four tab buttons appear in the order
   ``#tab-engineering``, ``#tab-workflow``, ``#tab-free``, ``#tab-experts``;
2. each button's **first child** is an inline ``<svg class="directory-icon">``
   whose ``data-directory-icon`` is ``documents``, ``flow``, ``wrench``,
   ``expert`` respectively;
3. the SVGs are decorative (``aria-hidden="true"``, ``focusable="false"``,
   ``viewBox="0 0 24 24"``), contribute no visible text and reference no
   external icon asset, and the existing label spans / i18n keys are unchanged;
4. the stylesheet lays each button out as icon + label columns and renders
   ``.directory-icon`` as a 45 x 45 px soft-glow line icon in the base rules
   (smaller sizes are allowed in responsive rules, never larger).

Stdlib only (``html.parser`` + regex); reads ``index.html`` and
``assets/home.css`` through the existing repo paths. No browser, no server.
"""

from __future__ import annotations

import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_HTML = REPO_ROOT / "index.html"
HOME_CSS = REPO_ROOT / "assets" / "home.css"

VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
    "param", "source", "track", "wbr",
}

# tab id, data-directory-icon value, i18n key, visible label
TABS = (
    ("tab-engineering", "documents", "home.feature-engineering-title", "Massive Information"),
    ("tab-workflow", "flow", "home.feature-workflow-title", "Complex Workflow"),
    ("tab-free", "wrench", "home.feature-free-title", "Professional Tools"),
    ("tab-experts", "expert", "home.feature-experts-title", "Multidisciplinary Experts"),
)

ICON_CLASS = "directory-icon"
ICON_SELECTOR = ".feature-tab-list ." + ICON_CLASS
BUTTON_SELECTOR = ".feature-tab-list button"
VIEWBOX = "0 0 24 24"
BASE_SIZE = 45.0

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")


# --------------------------------------------------------------------------- html
class _Tree(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = {"tag": "#document", "attrs": {}, "children": [], "text": [], "parent": None}
        self._stack = [self.root]

    def _node(self, tag, attrs):
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


def classes(node: dict) -> list:
    return (node["attrs"].get("class") or "").split()


def has_class(node: dict, name: str) -> bool:
    return name in classes(node)


def text_of(node: dict) -> str:
    parts = list(node["text"])
    for child in node["children"]:
        parts.append(text_of(child))
    return "".join(parts)


# --------------------------------------------------------------------------- css
def sheet() -> str:
    return COMMENT_RE.sub("", HOME_CSS.read_text(encoding="utf-8"))


def normalise(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").lower())


def parse(body: str) -> dict:
    declarations = {}
    for declaration in body.split(";"):
        if ":" not in declaration:
            continue
        prop, _, value = declaration.partition(":")
        declarations[prop.strip().lower()] = re.sub(r"\s+", " ", value.strip().lower())
    return declarations


def rules(css: str) -> list:
    found = []
    for match in RULE_RE.finditer(css):
        selectors = [normalise(part) for part in match.group(1).split(",") if part.strip()]
        if not selectors or any(selector.startswith("@") for selector in selectors):
            continue
        declarations = parse(match.group(2))
        if declarations:
            found.append((selectors, declarations))
    return found


def base_rule(css: str, selector: str) -> dict:
    target = normalise(selector)
    for selectors, declarations in rules(css):
        if target in selectors:
            return declarations
    raise AssertionError(f"{selector}: no rule found in assets/home.css")


def is_blue(value: str) -> bool:
    text = normalise(value)
    if not text:
        return False
    if "var(--accent" in text or "var(--account-accent" in text:
        return True
    for match in re.finditer(r"#([0-9a-f]{3}|[0-9a-f]{6})\b", text):
        hex_digits = match.group(1)
        if len(hex_digits) == 3:
            hex_digits = "".join(digit * 2 for digit in hex_digits)
        red = int(hex_digits[0:2], 16)
        green = int(hex_digits[2:4], 16)
        blue = int(hex_digits[4:6], 16)
        if blue > red + 24 and blue > green + 8 and blue >= 0x60:
            return True
    return False


def px(value: str) -> float:
    text = (value or "").strip()
    if text == "0":
        return 0.0
    match = re.match(r"(\d+(?:\.\d+)?)px", text)
    if not match:
        raise AssertionError(f"not a px value: {value!r}")
    return float(match.group(1))


class DirectoryIconMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX_HTML.read_text(encoding="utf-8")
        parser = _Tree()
        parser.feed(cls.index)
        parser.close()
        cls.buttons = []
        stack = [parser.root]
        while stack:
            node = stack.pop()
            stack.extend(node["children"])
            if node["tag"] == "button" and node["attrs"].get("id", "").startswith("tab-"):
                cls.buttons.append(node)
        # keep document order
        cls.buttons.sort(key=lambda node: cls.index.index(f'id="{node["attrs"]["id"]}"'))

    def button(self, tab_id: str) -> dict:
        for node in self.buttons:
            if node["attrs"].get("id") == tab_id:
                return node
        raise AssertionError(f"missing tab button #{tab_id}")

    def icon(self, tab_id: str) -> dict:
        children = [child for child in self.button(tab_id)["children"] if child["tag"] != "#text"]
        self.assertTrue(children, f"#{tab_id} has no element children")
        return children[0]

    # -- order + count ---------------------------------------------------

    def test_four_tab_buttons_in_the_frozen_order(self):
        self.assertEqual([node["attrs"]["id"] for node in self.buttons],
                         [tab for tab, _icon, _key, _label in TABS])

    def test_exactly_four_directory_icons_exist(self):
        self.assertEqual(self.index.count(f'class="{ICON_CLASS}"'), 4)
        values = re.findall(r'data-directory-icon="([^"]+)"', self.index)
        self.assertEqual(values, [icon for _tab, icon, _key, _label in TABS])

    # -- first child is the inline svg -----------------------------------

    def test_each_button_starts_with_its_inline_directory_icon(self):
        for tab_id, icon_name, _key, _label in TABS:
            with self.subTest(tab=tab_id):
                first = self.icon(tab_id)
                self.assertEqual(first["tag"], "svg", f"#{tab_id} must start with an inline <svg>")
                self.assertTrue(has_class(first, ICON_CLASS),
                                f"#{tab_id} first child needs class={ICON_CLASS}")
                self.assertEqual(first["attrs"].get("data-directory-icon"), icon_name)
                self.assertGreaterEqual(len(first["children"]), 1,
                                        f"#{tab_id} icon must contain drawing elements")

    def test_icons_do_not_reference_external_assets(self):
        for tab_id, _icon_name, _key, _label in TABS:
            with self.subTest(tab=tab_id):
                svg = self.icon(tab_id)
                for attribute in ("href", "xlink:href", "src"):
                    self.assertNotIn(attribute, svg["attrs"],
                                     f"#{tab_id} icon must be inline, not {attribute}")
        self.assertNotRegex(self.index, r'<img[^>]*directory-icon')

    # -- decorative / viewBox --------------------------------------------

    def test_icons_are_decorative_and_use_the_24_unit_viewbox(self):
        for tab_id, _icon_name, _key, _label in TABS:
            with self.subTest(tab=tab_id):
                attrs = self.icon(tab_id)["attrs"]
                self.assertEqual(attrs.get("aria-hidden"), "true")
                self.assertEqual(attrs.get("focusable"), "false")
                # html.parser lowercases attribute names, so read both spellings.
                view_box = attrs.get("viewbox", attrs.get("viewBox", ""))
                self.assertEqual(re.sub(r"\s+", " ", view_box), VIEWBOX)

    def test_icons_contribute_no_visible_text(self):
        for tab_id, _icon_name, _key, _label in TABS:
            with self.subTest(tab=tab_id):
                svg = self.icon(tab_id)
                self.assertEqual(text_of(svg).strip(), "", f"#{tab_id} icon must not add text")
                self.assertEqual(
                    [node for node in self._descendants(svg) if node["tag"] == "text"],
                    [],
                    f"#{tab_id} icon must not use <text> elements",
                )

    # -- labels / i18n unchanged -----------------------------------------

    def test_button_labels_and_i18n_keys_are_preserved(self):
        for tab_id, _icon_name, key, label in TABS:
            with self.subTest(tab=tab_id):
                button = self.button(tab_id)
                spans = [
                    node for node in self._descendants(button)
                    if node["attrs"].get("data-i18n") == key
                ]
                self.assertEqual(len(spans), 1, f"#{tab_id} must keep data-i18n={key}")
                self.assertEqual(text_of(spans[0]).strip(), label)
                self.assertEqual(" ".join(text_of(button).split()), label,
                                 f"#{tab_id} visible text must stay exactly its label")

    @staticmethod
    def _descendants(node: dict) -> list:
        found = []
        for child in node["children"]:
            found.append(child)
            found.extend(DirectoryIconMarkupTests._descendants(child))
        return found


class DirectoryIconStyleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()

    def test_button_lays_out_icon_and_label_columns(self):
        button = base_rule(self.css, BUTTON_SELECTOR)
        display = button.get("display", "")
        self.assertIn(display, {"grid", "flex", "inline-grid", "inline-flex"},
                      f"the tab button must lay out icon + label, found display={display!r}")
        if display.endswith("grid"):
            columns = button.get("grid-template-columns", "")
            self.assertGreaterEqual(len(columns.split()), 2,
                                    f"expected an icon + label column pair, found {columns!r}")
        else:
            self.assertIn(button.get("flex-direction", "row"), {"row", "row-reverse"})
        self.assertTrue(button.get("gap") or button.get("column-gap"),
                        "icon and label need a gap")
        self.assertIn(button.get("align-items", "center"),
                      {"center", "start", "baseline", "flex-start"})

    def test_directory_icon_is_a_45px_blue_line(self):
        icon = base_rule(self.css, ICON_SELECTOR)
        self.assertEqual(px(icon.get("width")), BASE_SIZE)
        self.assertEqual(px(icon.get("height")), BASE_SIZE)
        colour = " ".join(
            filter(None, (icon.get("color", ""), icon.get("fill", ""), icon.get("stroke", "")))
        )
        self.assertTrue(is_blue(colour), f"the directory icon must be blue, found {colour!r}")
        self.assertIn("drop-shadow", normalise(icon.get("filter", "")),
                      "the rail icons carry the soft glow")

    def test_responsive_rules_only_shrink_the_icon(self):
        base_css, medias = _split_media(self.css)
        self.assertIn(ICON_CLASS, base_css, "the base rules must style the directory icon")
        for prelude, body in medias:
            for selectors, declarations in rules(body):
                if normalise(ICON_SELECTOR) not in selectors:
                    continue
                for prop in ("width", "height"):
                    if prop in declarations:
                        self.assertLessEqual(
                            px(declarations[prop]), BASE_SIZE,
                            f"{prelude}: the icon may shrink, not grow ({prop})",
                        )


def _split_media(css: str):
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
        prelude = re.sub(r"\s+", "", css[position + len("@media"):brace].lower())
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
        medias.append((prelude, css[brace + 1:end]))
        index = end + 1
    return "".join(base_parts), medias


if __name__ == "__main__":
    unittest.main(verbosity=2)
