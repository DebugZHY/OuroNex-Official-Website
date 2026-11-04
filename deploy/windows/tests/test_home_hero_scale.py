"""The hero product shot runs 30% wider than its column on desktop.

The card keeps its own aspect ratio, so a wider card is a taller card too. Below
1301px the column already carries the whole width, and the bleed would leave the
copy without room, so the enlargement is desktop-only.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
HOME_CSS = REPO_ROOT / "assets" / "home.css"


class HeroScaleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = HOME_CSS.read_text(encoding="utf-8")

    def _block(self) -> str:
        match = re.search(r"@media\(min-width:1301px\)\{(.*?)\}\s*$", self.css, re.S)
        self.assertIsNotNone(match, "the desktop enlargement block must exist")
        return match.group(1)

    def test_card_is_thirty_percent_wider_than_its_column(self) -> None:
        block = self._block()
        self.assertIn(".hero-demo{justify-self:start;width:130%;max-width:none}", block)

    def test_card_bleeds_to_the_right(self) -> None:
        block = self._block()
        self.assertIn("justify-self:start", block, "the card starts at the column edge and overflows right")

    def test_bleed_edge_fades_into_the_page(self) -> None:
        block = self._block()
        self.assertIn("mask-image:linear-gradient(90deg,#000 0,#000 82%,rgba(0,0,0,.45) 93%,transparent 100%)", block)
        self.assertIn("-webkit-mask-image:", block, "Safari still needs the prefixed property")

    def test_the_column_keeps_its_own_geometry(self) -> None:
        block = self._block()
        self.assertIn(
            ".hero-inner{grid-template-columns:minmax(0,1fr) minmax(0,min(884px,calc(100% - 540px)))}",
            block,
            "the copy column must not shrink to make room for the bleed",
        )

    def test_phone_and_tablet_keep_the_card_inside_its_column(self) -> None:
        self.assertIn(".hero-demo{justify-self:stretch}", self.css, "the single-column layout stretches the card")
        self.assertNotRegex(self.css, r"@media\(max-width:1300px\)\{[^}}]*width:130%")

    def test_aspect_ratio_is_untouched(self) -> None:
        self.assertIn(".hero-demo__stage{position:relative;display:block;width:100%;aspect-ratio:3200/2200", self.css)


if __name__ == "__main__":
    unittest.main()
