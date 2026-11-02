"""Hero product-demo carousel: markup, styles, images and looping helper."""

from __future__ import annotations

import json
import re
import struct
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX = REPO_ROOT / "index.html"
HOME_CSS = REPO_ROOT / "assets" / "home.css"
HOME_JS = REPO_ROOT / "assets" / "home.js"
ILLUSTRATIONS = REPO_ROOT / "assets" / "illustrations"
SLIDES = [ILLUSTRATIONS / f"home-{index}.png" for index in range(1, 5)]


class HeroDemoMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX.read_text(encoding="utf-8")
        cls.css = HOME_CSS.read_text(encoding="utf-8")
        cls.js = HOME_JS.read_text(encoding="utf-8")

    def test_four_images_are_in_order(self) -> None:
        found = re.findall(
            r'<figure[^>]*data-demo-slide[^>]*>\s*<img[^>]*src="assets/illustrations/(home-[1-4]\.png)"',
            self.index,
            re.DOTALL,
        )
        self.assertEqual(found, [f"home-{index}.png" for index in range(1, 5)])

    def test_four_numbered_controls_target_the_slides(self) -> None:
        targets = re.findall(r'data-demo-target="(\d)"', self.index)
        self.assertEqual(targets, ["0", "1", "2", "3"])
        self.assertEqual(
            len(re.findall(r'<button[^>]*class="hero-demo__control', self.index)), 4
        )
        self.assertIn('data-demo-interval="10000"', self.index)
        self.assertIn("Choose a product demonstration image", self.index)

    def test_placeholder_is_replaced(self) -> None:
        self.assertNotIn("hero-demo__symbol", self.index)
        self.assertNotIn("home.product-demonstration", self.index)
        self.assertNotIn("home.coming-soon", self.index)
        self.assertIn('aria-roledescription="carousel"', self.index)

    def test_carousel_styles_fill_the_same_sized_rounded_box(self) -> None:
        self.assertRegex(self.css, r"\.hero-demo\{[^}]*grid-template-rows:52px minmax\(0,1fr\) auto")
        self.assertRegex(self.css, r"\.hero-demo\{[^}]*border-radius:16px")
        self.assertRegex(self.css, r"\.hero-demo__stage\{[^}]*position:relative")
        self.assertRegex(self.css, r"\.hero-demo__slide\{[^}]*position:absolute")
        self.assertRegex(self.css, r"\.hero-demo__slide img\{[^}]*object-fit:cover")
        self.assertRegex(self.css, r"\.hero-demo__slide\.is-active\{[^}]*opacity:1")
        self.assertRegex(self.css, r"\.hero-demo__controls\{[^}]*justify-content:center")
        self.assertRegex(self.css, r"\.hero-demo__control\{[^}]*border-radius:999px")
        self.assertRegex(
            self.css,
            r"\.hero-demo\{[^}]*grid-template-rows:42px minmax\(0,1fr\) auto",
        )

    def test_images_exist_at_the_same_size(self) -> None:
        for path in SLIDES:
            with self.subTest(path=path.name):
                self.assertTrue(path.exists(), path)
                data = path.read_bytes()
                self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
                width, height = struct.unpack(">II", data[16:24])
                self.assertEqual((width, height), (3200, 2200))

    def test_javascript_loops_after_the_last_slide(self) -> None:
        self.assertIn("DEMO_INTERVAL_MS = 10000", self.js)
        self.assertIn("function nextDemoIndex(index, count)", self.js)
        self.assertIn("initHeroDemo(doc, view);", self.js)
        self.assertIn("DEMO_INTERVAL_MS: DEMO_INTERVAL_MS", self.js)
        script = (
            "const api=require(process.argv[1]);"
            "console.log(JSON.stringify([[0,4],[1,4],[3,4],[9,4],[-1,4],[0,0]]"
            ".map(([i,n])=>api.nextDemoIndex(i,n))))"
        )
        result = subprocess.run(
            ["node", "-e", script, str(HOME_JS)],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(json.loads(result.stdout), [1, 2, 0, 0, 1, 0])


if __name__ == "__main__":
    unittest.main()
