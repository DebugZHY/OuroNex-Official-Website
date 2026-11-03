"""Hero lockup: the SIDA tile, the wordmark and the tagline share one width.

The hero opens with ``.hero-title__lockup`` (the logo tile then the SIDA
wordmark) and closes with ``.hero-title__rest`` (Super-intelligent Design
Agent). Both lines ride the single ``--sida-size`` token, so the tagline is
sized to span exactly the tile-plus-wordmark width wherever the desktop
ladder applies.

Self-contained stdlib checks (regex + text slicing); no browser, no server.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_HTML = REPO_ROOT / "index.html"
HOME_CSS = REPO_ROOT / "assets" / "home.css"

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)


def css_text() -> str:
    return COMMENT_RE.sub("", HOME_CSS.read_text(encoding="utf-8"))


class HeroLockupMarkupTest(unittest.TestCase):
    def setUp(self) -> None:
        self.index = INDEX_HTML.read_text(encoding="utf-8")

    def test_the_lockup_opens_the_heading_with_the_tile_then_the_wordmark(self) -> None:
        match = re.search(r'<h1 id="hero-title"><span class="hero-title__lockup">(.*?)</span></span>',
                          self.index, re.S)
        self.assertIsNotNone(match, "the heading must open with the logo lockup")
        inner = match.group(1)
        self.assertLess(inner.index("hero-title__logo"), inner.index("hero-title__name"),
                        "the tile sits left of the wordmark")
        self.assertIn('alt=""', inner, "the tile is decorative: the wordmark carries the name")

    def test_the_tagline_follows_the_lockup_as_its_own_block(self) -> None:
        lockup = self.index.index('class="hero-title__lockup"')
        rest = self.index.index('class="hero-title__rest"')
        self.assertLess(lockup, rest, "the tagline is the second line of the heading")
        self.assertIn('class="hero-title__accent"', self.index[rest:rest + 700])


class HeroLockupStyleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.css = css_text()

    def test_one_token_sizes_the_wordmark_and_the_tagline(self) -> None:
        self.assertIn("--sida-size:clamp(64px,10.6vw,136px)", self.css)
        self.assertIn("--sida-rest:.2023", self.css)
        self.assertIn(".hero-title__name{display:block;font-size:var(--sida-size)", self.css)
        self.assertIn("font-size:calc(var(--sida-size) * var(--sida-rest))", self.css)

    def test_the_tile_is_sized_and_rounded_off_the_same_token(self) -> None:
        self.assertIn(".hero-title__logo{flex:none;height:calc(var(--sida-size) * .86);width:auto;"
                      "border-radius:23%", self.css)

    def test_the_lockup_is_one_flex_line(self) -> None:
        self.assertIn(".hero-title__lockup{display:flex;align-items:center;"
                      "gap:calc(var(--sida-size) * .08)}", self.css)

    def test_the_desktop_tagline_never_wraps(self) -> None:
        self.assertIn("white-space:nowrap", self.css)
        narrow_at = self.css.index("@media(max-width:760px)")
        self.assertGreater(self.css.index("--sida-rest:.42"), narrow_at,
                           "phones keep the tagline readable")
        self.assertGreater(self.css.index(".hero-title__rest{white-space:normal}"), narrow_at,
                           "phones let the tagline wrap")


if __name__ == "__main__":
    unittest.main(verbosity=2)
