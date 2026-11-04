"""The director's portrait is a wide event photo, so it is zoomed slightly.

The three About cards share one frame size; only the image inside the director's
frame is scaled up, otherwise his head reads smaller than the two studio portraits.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX = REPO_ROOT / "index.html"
HOME_CSS = REPO_ROOT / "assets" / "home.css"


class DirectorPhotoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX.read_text(encoding="utf-8")
        cls.css = HOME_CSS.read_text(encoding="utf-8")

    def test_director_frame_carries_its_own_class(self) -> None:
        figure = re.search(r'<figure class="([^"]*)">\s*<img alt="Jake CHAN"', self.index)
        self.assertIsNotNone(figure, "the director's portrait must stay in the About block")
        self.assertIn("about-founder__photo--director", figure.group(1))
        self.assertIn("about-founder__photo--cover", figure.group(1), "the frame still crops with cover")

    def test_only_the_director_is_zoomed(self) -> None:
        for alt in ("Haoyi ZHANG", "Siwei LIU"):
            figure = re.search(r'<figure class="([^"]*)">\s*<img alt="%s"' % alt, self.index)
            self.assertIsNotNone(figure)
            self.assertNotIn("--director", figure.group(1), f"{alt} keeps the standard portrait crop")

    def test_zoom_keeps_the_top_of_the_hair(self) -> None:
        rule = re.search(r"\.about-founder__photo--director img\{([^}]*)\}", self.css)
        self.assertIsNotNone(rule, "the zoom rule must exist")
        body = rule.group(1)
        self.assertIn("transform:scale(1.12)", body, "a slight enlargement, not a re-crop")
        self.assertIn("transform-origin:50% 26%", body, "the origin sits high so the hair is not clipped")

    def test_frame_geometry_is_shared(self) -> None:
        self.assertIn(".about-founder__photo{margin:0;width:240px;aspect-ratio:840/1080", self.css)
        self.assertNotRegex(self.css, r"\.about-founder__photo--director\{[^}]*width:")


if __name__ == "__main__":
    unittest.main()
