"""Public auth pages reuse the Home header, and its pills carry the CTA glow.

Scope:

* ``accounts/_site_header.html`` is the single copy of the public header and both
  ``login.html`` and ``register.html`` include it exactly once;
* that header is the Home header: same brand lockup, same five nav items in the
  same order with the same i18n keys, same language switcher and the same
  Log in / Register pills (only the link targets point back at ``/index.html``);
* ``site.css`` mirrors the Home header metrics for the ``auth-page`` body class,
  and both auth pages load ``site.css`` and ``site.js``;
* the pills paint a pointer-tracked glow (``--mx``/``--my``) for the Log in
  outline pill and the Register primary pill, with touch and reduced-motion
  fallbacks, and ``site.js`` writes those custom properties.

Source inspection only: no server, no browser, no database.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
TEMPLATES = REPO_ROOT / "backend" / "templates" / "accounts"
HEADER_HTML = TEMPLATES / "_site_header.html"
LOGIN_HTML = TEMPLATES / "login.html"
REGISTER_HTML = TEMPLATES / "register.html"
INDEX_HTML = REPO_ROOT / "index.html"
SITE_CSS = REPO_ROOT / "assets" / "site.css"
HOME_CSS = REPO_ROOT / "assets" / "home.css"
SITE_JS = REPO_ROOT / "assets" / "site.js"

INCLUDE_TAG = "{% include 'accounts/_site_header.html' %}"

NAV_LABELS = ["Home", "SIDA", "Price", "Business", "About"]
NAV_KEYS = [
    "shared.home.5c1d84",
    "shared.sida.9da1bc",
    "shared.price.3e8248",
    "shared.business.d6663d",
    "shared.about.6b21fb",
]

# Selectors whose declarations the auth pages must share with the Home header.
MIRRORED = [
    ".brand",
    ".brand img",
    ".brand>span",
    ".nav-shell",
    ".desktop-nav",
    ".nav-primary",
    ".nav-primary a",
    ".desktop-nav .nav-secondary .language-switcher",
    ".desktop-nav .nav-secondary .language-switcher button",
]

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def sheet(path: Path) -> str:
    return COMMENT_RE.sub("", read(path))


def rule_declarations(css: str, selector: str) -> list[dict[str, str]]:
    """Every declaration block of one exact selector, in file order."""
    found = []
    for body in re.findall(re.escape(selector) + r"\{([^{}]*)\}", css):
        declarations = {}
        for declaration in body.split(";"):
            if ":" not in declaration:
                continue
            prop, _, value = declaration.partition(":")
            declarations[prop.strip()] = value.strip()
        found.append(declarations)
    return found


def header_markup(html: str) -> str:
    start = html.index('<header class="site-header">')
    end = html.index("</header>", start) + len("</header>")
    return html[start:end]


class AuthHeaderMarkupTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.header = read(HEADER_HTML)
        cls.index_header = header_markup(read(INDEX_HTML))
        cls.login = read(LOGIN_HTML)
        cls.register = read(REGISTER_HTML)

    def test_partial_is_the_home_brand_lockup(self) -> None:
        self.assertIn('<header class="site-header">', self.header)
        self.assertIn(
            '<img alt="" height="48" src="/assets/ouronex-mark.svg" width="80"/>',
            self.header,
            "the auth header must show the Home 80x48 brand mark",
        )
        self.assertIn('class="brand"', self.header)
        self.assertIn('data-i18n="shared.ouronex.3343a9"', self.header)

    def test_every_auth_page_includes_the_one_header(self) -> None:
        for name, html in (("login", self.login), ("register", self.register)):
            self.assertEqual(
                html.count(INCLUDE_TAG),
                1,
                f"{name}.html must include the shared header exactly once",
            )
            self.assertNotIn(
                'class="site-header"',
                html,
                f"{name}.html must not keep a second, hand-written header",
            )
            self.assertIn(
                '<body class="auth-page"',
                html,
                f"{name}.html body needs the auth-page class that sizes the header",
            )
            self.assertIn('/assets/site.css', html, f"{name}.html must load site.css")
            self.assertIn('/assets/site.js', html, f"{name}.html must load site.js")

    def test_register_page_keeps_no_standalone_language_switcher(self) -> None:
        self.assertNotIn("language-switcher--standalone", self.register)
        self.assertEqual(self.register.count('class="language-switcher"'), 0)
        self.assertEqual(self.header.count('class="language-switcher"'), 1)

    def test_nav_items_match_the_home_header(self) -> None:
        primary = re.search(r'<div class="nav-primary">(.*?)</div>', self.header, re.S)
        self.assertIsNotNone(primary)
        items = re.findall(
            r'<a href="([^"]+)"><span data-i18n="([^"]+)">([^<]+)</span></a>',
            primary.group(1),
        )
        self.assertEqual([label for _, _, label in items], NAV_LABELS)
        self.assertEqual([key for _, key, _ in items], NAV_KEYS)
        for href, _, label in items:
            self.assertEqual(
                href, f"/index.html#{label.lower()}", f"{label} must return to its Home section"
            )

        home_primary = re.search(
            r'<div class="nav-primary">(.*?)</div>', self.index_header, re.S
        )
        self.assertIsNotNone(home_primary)
        home_items = re.findall(
            r'<span data-i18n="([^"]+)">([^<]+)</span>', home_primary.group(1)
        )
        self.assertEqual(home_items, [(key, label) for _, key, label in items])

    def test_pills_are_the_home_pills(self) -> None:
        self.assertIn('<a data-signin="" href="/login/">', self.header)
        self.assertIn(
            '<span data-i18n="shared.log-in.f7c400">Log in</span>', self.header
        )
        self.assertIn('<a data-register="" href="/register/">', self.header)
        self.assertIn(
            '<span data-i18n="shared.register.d67299">Register</span>', self.header
        )
        home_secondary = re.search(
            r'<div class="nav-secondary">(.*?)</div>\s*</nav>', self.index_header, re.S
        )
        self.assertIsNotNone(home_secondary)
        for fragment in (
            '<a data-signin="" href="/login/">',
            '<span data-i18n="shared.log-in.f7c400">Log in</span>',
            '<a data-register="" href="/register/">',
            '<span data-i18n="shared.register.d67299">Register</span>',
        ):
            self.assertIn(
                fragment,
                home_secondary.group(1),
                "the auth header must repeat the Home pill markup byte for byte",
            )


class AuthHeaderStyleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.site = sheet(SITE_CSS)
        cls.home = sheet(HOME_CSS)

    def test_auth_header_metrics_mirror_the_home_header(self) -> None:
        for selector in MIRRORED:
            home_rules = rule_declarations(self.home, f".home-page {selector}")
            auth_rules = rule_declarations(self.site, f".auth-page {selector}")
            self.assertTrue(home_rules, f"home.css: no rule for .home-page {selector}")
            self.assertEqual(
                auth_rules,
                home_rules,
                f"site.css: .auth-page {selector} must keep the Home declarations "
                f"{home_rules}, found {auth_rules}",
            )

    def test_auth_header_height_matches_home(self) -> None:
        home = rule_declarations(self.home, ".home-page")
        auth = rule_declarations(self.site, ".auth-page")
        self.assertEqual(
            [rule.get("--header-height") for rule in auth],
            [rule.get("--header-height") for rule in home],
            "the auth header must reserve the same height as the Home header",
        )

    def test_pills_carry_the_pointer_glow(self) -> None:
        signin = ".desktop-nav .nav-secondary [data-signin]:not(.is-authenticated)"
        register = ".desktop-nav .nav-secondary [data-register]"
        base = rule_declarations(self.site, f"{signin},\n{register}")
        self.assertTrue(
            any(rule.get("--mx") == "50%" and rule.get("--my") == "50%" for rule in base),
            "the glows need a centred default so a keyboard user sees no stale light",
        )

        glow = rule_declarations(self.site, f"{signin}::before,\n{register}::before")
        self.assertTrue(glow, "site.css must paint the pill glow in ::before")
        paint = glow[0]
        self.assertEqual(paint.get("position"), "absolute")
        self.assertEqual(paint.get("opacity"), "0")
        self.assertIn(
            "radial-gradient(170px circle at var(--mx) var(--my)",
            paint.get("background", ""),
            "Register reuses the Explore the Apps glow",
        )

        outline = rule_declarations(self.site, f"{signin}::before")
        self.assertTrue(outline, "Log in needs its own dimmer outline glow")
        self.assertIn(
            "radial-gradient(180px circle at var(--mx) var(--my)",
            outline[0].get("background", ""),
            "Log in reuses the Customized Service glow",
        )

        labels = rule_declarations(self.site, f"{signin}>span,\n{register}>span")
        self.assertTrue(labels, "the pill labels must sit above the glow")
        self.assertEqual(labels[0].get("z-index"), "1")

        self.assertEqual(
            [rule.get("opacity") for rule in rule_declarations(self.site, f"{register}:hover::before")],
            ["1"],
        )
        self.assertEqual(
            [
                rule.get("opacity")
                for rule in rule_declarations(self.site, f"{signin}:hover::before")
            ],
            [".45"],
        )

    def test_glow_is_disabled_for_touch_and_reduced_motion(self) -> None:
        self.assertIn(
            "@media(hover:none){.desktop-nav .nav-secondary [data-signin]::before,"
            ".desktop-nav .nav-secondary [data-register]::before{display:none}}",
            self.site,
            "a touch device must not paint a resting glow",
        )
        self.assertIn(
            "@media(prefers-reduced-motion:reduce){.desktop-nav .nav-secondary "
            "[data-signin]::before,.desktop-nav .nav-secondary [data-register]"
            "::before{display:none}}",
            self.site,
            "reduced motion must drop the pill glow",
        )


class HeaderGlowScriptTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.js = read(SITE_JS)

    def test_site_js_tracks_the_pointer_on_the_header_pills(self) -> None:
        self.assertIn(
            ".nav-secondary [data-signin]:not(.is-authenticated), .nav-secondary [data-register]",
            self.js,
        )
        self.assertIn("addEventListener('pointermove'", self.js)
        self.assertIn("setProperty('--mx'", self.js)
        self.assertIn("setProperty('--my'", self.js)
        self.assertIn("reducedMotion.matches", self.js)
        self.assertIn("event.pointerType === 'touch'", self.js)


if __name__ == "__main__":
    unittest.main()
