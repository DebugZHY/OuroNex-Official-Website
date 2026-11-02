"""Font stability for the authenticated account shell (no Dashboard text jitter).

Manager evidence: every Dashboard navigation reached DOMContentLoaded with
``document.fonts.status === 'loading'`` and then flipped to ``loaded`` because the
six account faces used ``font-display: swap``.  The conservative fix is
``font-display: optional`` plus a preload of the six existing woff2 files in each
account template, so the custom font is ready for first paint and a slow face can
no longer replace a painted fallback.

Only the real product files are read: no browser, no server.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
ACCOUNT_CSS = REPO_ROOT / "assets" / "account.css"
TEMPLATES = REPO_ROOT / "backend" / "templates" / "accounts"
FONT_DIR = REPO_ROOT / "assets" / "fonts"

# Six faces declared by account.css, in file order.
FACES = (
    ("ONX Board", "400", "manrope-400.woff2"),
    ("ONX Board", "500", "manrope-500.woff2"),
    ("ONX Board", "600", "manrope-600.woff2"),
    ("ONX Board", "700", "manrope-700.woff2"),
    ("ONX Board Mono", "400", "ibm-plex-mono-400.woff2"),
    ("ONX Board Mono", "500", "ibm-plex-mono-500.woff2"),
)

STYLES = {
    "profile.html": ("/assets/i18n.css", "/assets/account.css"),
    "security.html": ("/assets/i18n.css", "/assets/account.css"),
    "token_usage.html": (
        "/assets/i18n.css",
        "/assets/account.css",
        "/assets/token-usage.css",
    ),
}
SCRIPTS = {
    "profile.html": (
        "/assets/i18n/shared.js",
        "/assets/i18n/dynamic.js",
        "/assets/i18n/account-dashboard.js",
        "/assets/i18n/account-profile.js",
        "/assets/i18n.js",
    ),
    "security.html": (
        "/assets/i18n/shared.js",
        "/assets/i18n/dynamic.js",
        "/assets/i18n/account-dashboard.js",
        "/assets/i18n/account-security.js",
        "/assets/i18n.js",
    ),
    "token_usage.html": (
        "/assets/i18n/shared.js",
        "/assets/i18n/dynamic.js",
        "/assets/i18n/account-dashboard.js",
        "/assets/i18n.js",
        "/assets/token-usage.js",
    ),
}
PAGES = tuple(STYLES)

LINK_RE = re.compile(r"<link\b[^>]*>", re.I)
ATTR_RE = re.compile(r"([\w-]+)\s*=\s*\"([^\"]*)\"")
FACE_RE = re.compile(r"@font-face\s*\{(.*?)\}", re.S)
COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def links(markup: str) -> list:
    return LINK_RE.findall(markup)


def attributes(markup: str) -> dict:
    return {name.lower(): value for name, value in ATTR_RE.findall(markup)}


def stylesheet_hrefs(markup: str) -> list:
    found = []
    for link in links(markup):
        attrs = attributes(link)
        if attrs.get("rel", "").lower() == "stylesheet" and "href" in attrs:
            found.append(attrs["href"])
    return found


def font_preloads(markup: str) -> list:
    found = []
    for link in links(markup):
        attrs = attributes(link)
        if (
            attrs.get("rel", "").lower() == "preload"
            and attrs.get("as", "").lower() == "font"
        ):
            found.append(attrs)
    return found


class AccountFontPreloadTests(unittest.TestCase):
    def test_three_account_templates_exist(self):
        for name in PAGES:
            self.assertTrue((TEMPLATES / name).is_file(), f"missing template {name}")

    def test_every_account_page_preloads_all_six_faces_before_account_css(self):
        expected = [f"/assets/fonts/{face[2]}" for face in FACES]
        for name in PAGES:
            markup = read(TEMPLATES / name)
            with self.subTest(template=name):
                preloads = font_preloads(markup)
                self.assertEqual(
                    [preload.get("href") for preload in preloads],
                    expected,
                    f"{name}: the six font preloads must appear in declaration order",
                )
                for preload in preloads:
                    self.assertTrue(preload["href"].startswith("/assets/fonts/"))
                    self.assertEqual(preload.get("type"), "font/woff2")
                    self.assertIn("crossorigin", preload, "font preloads need crossorigin")

    def test_preloads_precede_both_stylesheets(self):
        for name in PAGES:
            markup = read(TEMPLATES / name)
            with self.subTest(template=name):
                self.assertEqual(len(font_preloads(markup)), 6, f"{name}: six preloads expected")
                first_preload = markup.find('as="font"')
                self.assertGreaterEqual(first_preload, 0, f"{name}: no font preload found")
                self.assertLess(
                    first_preload,
                    markup.find('/assets/i18n.css'),
                    f"{name}: font preloads must come before i18n.css",
                )
                self.assertLess(
                    first_preload,
                    markup.find('/assets/account.css'),
                    f"{name}: font preloads must come before account.css",
                )
                self.assertLess(
                    markup.rfind('/assets/fonts/'),
                    markup.find('/assets/account.css'),
                    f"{name}: every preload must precede account.css",
                )

    def test_preloaded_files_exist_and_are_the_declared_ones(self):
        for _family, _weight, filename in FACES:
            path = FONT_DIR / filename
            with self.subTest(font=filename):
                self.assertTrue(path.is_file(), f"missing font file {filename}")
                self.assertGreater(path.stat().st_size, 1024)
                self.assertEqual(path.read_bytes()[:4], b"wOF2", "not a woff2 file")

    def test_stylesheet_and_script_order_is_untouched(self):
        for name in PAGES:
            markup = read(TEMPLATES / name)
            with self.subTest(template=name):
                self.assertEqual(stylesheet_hrefs(markup), list(STYLES[name]))
                self.assertEqual(markup.count('/assets/account.css'), 1)
                scripts = re.findall(r'<script[^>]+src="([^"]+)"', markup)
                self.assertEqual(scripts, list(SCRIPTS[name]))
                self.assertIn('data-i18n-page="account-', markup)


class AccountFontFaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = read(ACCOUNT_CSS)
        cls.faces = [
            dict(
                (prop.strip().lower(), value.strip())
                for prop, _, value in (
                    declaration.partition(":") for declaration in body.split(";")
                )
                if prop.strip()
            )
            for body in FACE_RE.findall(COMMENT_RE.sub("", cls.css))
        ]

    def test_six_account_faces_are_declared(self):
        self.assertEqual(len(self.faces), 6, [face.get("font-family") for face in self.faces])

    def test_no_face_uses_font_display_swap(self):
        self.assertNotRegex(
            COMMENT_RE.sub("", self.css).lower(),
            r"font-display\s*:\s*swap",
            "no account face may swap after first paint",
        )
        for face in self.faces:
            self.assertEqual(
                face.get("font-display"),
                "optional",
                f"{face.get('font-family')} {face.get('font-weight')} must use optional",
            )

    def test_family_names_weights_and_files_are_unchanged(self):
        actual = [
            (
                face.get("font-family", "").strip("'\""),
                face.get("font-weight"),
                re.search(r"fonts/([\w.-]+\.woff2)", face.get("src", "")).group(1),
            )
            for face in self.faces
        ]
        self.assertEqual(actual, list(FACES))


if __name__ == "__main__":
    unittest.main(verbosity=2)
