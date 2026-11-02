"""The public auth pages wear the Home animated background.

Scope:

* ``accounts/_background.html`` is the one host element, included once by both
  ``login.html`` and ``register.html`` alongside ``/assets/auth-bg.js``;
* ``assets/auth-bg.js`` injects one of the six Home background SVGs, chosen at
  random per load, as inline markup with scripts stripped, exactly like the Home
  hero does in ``assets/home.js``;
* ``site.css`` gives the layer the Home crop, mirror, grade and edge fade, and
  keeps it behind the card;
* every background SVG plus the script is in ``package-manifest.json``, because
  the Django allowlist serves nothing else.

Source inspection only: no server, no browser.
"""

from __future__ import annotations

import hashlib
import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
TEMPLATES = REPO_ROOT / "backend" / "templates" / "accounts"
BACKGROUND_HTML = TEMPLATES / "_background.html"
LOGIN_HTML = TEMPLATES / "login.html"
REGISTER_HTML = TEMPLATES / "register.html"
AUTH_BG_JS = REPO_ROOT / "assets" / "auth-bg.js"
HOME_JS = REPO_ROOT / "assets" / "home.js"
SITE_CSS = REPO_ROOT / "assets" / "site.css"
MANIFEST = REPO_ROOT / "package-manifest.json"

INCLUDE_TAG = "{% include 'accounts/_background.html' %}"
SCRIPT_TAG = '<script defer="" src="/assets/auth-bg.js"></script>'
COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def sheet(path: Path) -> str:
    return COMMENT_RE.sub("", read(path))


def rules(css: str) -> list[tuple[list[str], dict[str, str]]]:
    found = []
    for match in RULE_RE.finditer(css):
        selectors = [part.strip() for part in match.group(1).split(",") if part.strip()]
        if not selectors or any(selector.startswith("@") for selector in selectors):
            continue
        declarations = {}
        for declaration in match.group(2).split(";"):
            if ":" not in declaration:
                continue
            prop, _, value = declaration.partition(":")
            declarations[prop.strip()] = value.strip()
        if declarations:
            found.append((selectors, declarations))
    return found


def base(css: str, selector: str) -> dict[str, str]:
    for selectors, declarations in rules(css):
        if selector in selectors:
            return declarations
    raise AssertionError(f"{selector}: no such rule")


def media_block(css: str, prelude: str, marker: str = "") -> str:
    """Body of the first prelude block that contains `marker` (site.css repeats 760px)."""
    index = -1
    while True:
        index = css.find(prelude, index + 1)
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
                    body = css[start + 1 : position]
                    if marker in body:
                        return body
                    break


def js_sources(script: str) -> list[str]:
    block = re.search(r"const BACKGROUND_SOURCES = \[(.*?)\];", script, re.S)
    assert block, "auth-bg.js has no BACKGROUND_SOURCES array"
    return re.findall(r"'([^']+)'", block.group(1))


class AuthBackgroundMarkupTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.partial = read(BACKGROUND_HTML)
        cls.login = read(LOGIN_HTML)
        cls.register = read(REGISTER_HTML)

    def test_host_partial_is_decorative_and_empty(self) -> None:
        markup = self.partial.strip()
        self.assertIn('class="auth-background"', markup)
        self.assertIn("data-auth-background", markup)
        self.assertIn('aria-hidden="true"', markup)
        self.assertNotIn("<img", markup, "the layer is painted from injected inline SVG, not an img")
        self.assertNotIn("<script", markup)
        self.assertEqual(markup.count("<div"), 1)

    def test_both_auth_pages_mount_the_layer_and_the_script(self) -> None:
        for name, html in (("login", self.login), ("register", self.register)):
            with self.subTest(page=name):
                self.assertEqual(html.count(INCLUDE_TAG), 1, f"{name}.html must mount the layer once")
                self.assertEqual(html.count(SCRIPT_TAG), 1, f"{name}.html must load auth-bg.js once")
                self.assertIn('<body class="auth-page"', html)
                self.assertLess(
                    html.index(INCLUDE_TAG),
                    html.index("{% include 'accounts/_site_header.html' %}"),
                    "the background layer sits before the shared header in the body",
                )


class AuthBackgroundScriptTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.js = read(AUTH_BG_JS)
        cls.home = read(HOME_JS)

    def test_source_list_matches_the_home_hero(self) -> None:
        home = re.search(r"var HERO_SOURCES = Object\.freeze\(\[(.*?)\]\);", self.home, re.S)
        self.assertIsNotNone(home, "home.js HERO_SOURCES not found")
        home_sources = [value.rsplit("/", 1)[-1] for value in re.findall(r"'([^']+)'", home.group(1))]
        auth_sources = [value.rsplit("/", 1)[-1] for value in js_sources(self.js)]
        self.assertEqual(
            auth_sources,
            home_sources,
            "the auth pages must offer exactly the Home background set, in the same order",
        )

    def test_paths_are_root_absolute(self) -> None:
        for source in js_sources(self.js):
            self.assertTrue(
                source.startswith("/assets/backgrounds/"),
                f"{source}: /login/ and /register/ are not the site root, so a relative path 404s",
            )

    def test_injection_matches_the_home_recipe(self) -> None:
        for fragment in (
            "document.querySelector('[data-auth-background]')",
            "Math.random()",
            "DOMParser",
            "document.importNode",
            "querySelectorAll('script')",
            "setAttribute('aria-hidden', 'true')",
            "setAttribute('focusable', 'false')",
            "host.dataset.background = source",
            "host.replaceChildren(copy)",
        ):
            self.assertIn(fragment, self.js, f"auth-bg.js is missing {fragment!r}")

    def test_a_failed_fetch_leaves_the_page_usable(self) -> None:
        self.assertIn(".catch(", self.js)
        self.assertNotIn("throw ", self.js.split(".catch(")[-1])


class AuthBackgroundStyleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet(SITE_CSS)
        cls.mobile = media_block(cls.css, "@media(max-width:760px)", ".auth-background")

    def test_layer_stays_behind_the_card(self) -> None:
        layer = base(self.css, ".auth-page .auth-background")
        self.assertEqual(layer.get("position"), "fixed")
        self.assertEqual(layer.get("z-index"), "-1", "the card must paint above the background")
        self.assertEqual(layer.get("overflow"), "hidden")
        self.assertEqual(layer.get("background"), "var(--bg)")

    def test_vector_keeps_the_home_mirror_and_grade(self) -> None:
        svg = base(self.css, ".auth-page .auth-background>svg")
        self.assertEqual(
            svg.get("transform"),
            "scaleX(-1)",
            "the mirror must be the only transform: the vector covers the viewport itself",
        )
        self.assertEqual(svg.get("filter"), "brightness(1.75) saturate(1.25)")
        home = sheet(REPO_ROOT / "assets" / "home.css")
        self.assertIn("filter:brightness(1.75) saturate(1.25)", home, "grade drifted from Home")

    def test_no_lateral_offset_opens_a_gap_on_the_left(self) -> None:
        svg_rules = [
            declarations
            for selectors, declarations in rules(self.css)
            if any(
                selector.startswith(".auth-page .auth-background") and selector.endswith(">svg")
                for selector in selectors
            )
        ]
        self.assertTrue(svg_rules, "the background vector needs sizing rules")
        for declarations in svg_rules:
            for prop in ("transform", "left", "right", "margin-left", "translate"):
                value = declarations.get(prop, "")
                self.assertNotIn(
                    "translate",
                    value,
                    f"{prop}:{value} shifts the mirrored vector and leaves an empty strip on the left",
                )
            self.assertNotIn(
                "translate",
                declarations.get("object-position", ""),
                "an offset object-position is inert on inline SVG but signals a shifted crop",
            )

    def test_edge_fade_matches_the_home_overlay(self) -> None:
        overlay = base(self.css, ".auth-page .auth-background::after").get("background", "")
        self.assertIn("linear-gradient(90deg,rgba(8,14,23,.72) 0%", overlay)
        self.assertIn("rgba(8,14,23,.24) 45%", overlay)
        self.assertIn("rgba(8,14,23,.08) 100%", overlay)

    def test_mobile_only_dims_the_layer(self) -> None:
        self.assertEqual(base(self.mobile, ".auth-page .auth-background").get("opacity"), ".85")
        try:
            svg = base(self.mobile, ".auth-page .auth-background>svg")
        except AssertionError:
            return
        self.assertNotIn("translate", svg.get("transform", ""), "mobile must not re-open the gap")


class AuthBackgroundManifestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = json.loads(read(MANIFEST))
        cls.entries = {entry["path"]: entry for entry in cls.manifest["files"]}

    def test_the_script_is_served_and_hashed(self) -> None:
        entry = self.entries.get("assets/auth-bg.js")
        self.assertIsNotNone(entry, "assets/auth-bg.js must be in the allowlist or it 404s")
        payload = AUTH_BG_JS.read_bytes()
        self.assertEqual(entry["bytes"], len(payload))
        self.assertEqual(entry["sha256"], hashlib.sha256(payload).hexdigest())
        self.assertEqual(entry["size"], len(payload))

    def test_every_background_svg_is_served(self) -> None:
        for source in js_sources(read(AUTH_BG_JS)):
            with self.subTest(source=source):
                self.assertIn(source.lstrip("/"), self.entries, f"{source} is not in the allowlist")


if __name__ == "__main__":
    unittest.main()
