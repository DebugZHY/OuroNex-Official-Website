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
        self.assertRegex(self.css, r"\.hero-demo\{[^}]*display:flex")
        self.assertRegex(self.css, r"\.hero-demo\{[^}]*flex-direction:column")
        self.assertRegex(self.css, r"\.hero-demo__stage\{[^}]*position:relative")
        self.assertRegex(self.css, r"\.hero-demo__stage\{[^}]*border-radius:16px")
        self.assertRegex(self.css, r"\.hero-demo__slide\{[^}]*position:absolute")
        self.assertRegex(self.css, r"\.hero-demo__slide img\{[^}]*object-fit:cover",
                          "the art fills the frame; no letterbox may show")
        self.assertRegex(self.css, r"\.hero-demo__slide\.is-active\{[^}]*opacity:1")
        self.assertRegex(self.css, r"\.hero-demo__controls\{[^}]*justify-content:center")
        self.assertRegex(self.css, r"\.hero-demo__control\{[^}]*border-radius:999px")

    def test_the_switch_row_has_no_container_behind_it(self) -> None:
        rule = re.search(r"\.hero-demo__controls\{([^}]*)\}", self.css)
        self.assertIsNotNone(rule)
        body = rule.group(1)
        self.assertIn("background:none", body, "no pill behind the switches")
        self.assertIn("border:0", body, "no outline behind the switches")
        self.assertIn("box-shadow:none", body)
        self.assertIn("backdrop-filter:none", body)

    def test_the_declared_size_matches_the_real_pixels(self) -> None:
        by_name = {path.name: path for path in SLIDES}
        declared = {}
        for match in re.finditer(
            r'<img[^>]*src="assets/illustrations/(home-[1-4]\.png)"[^>]*>', self.index
        ):
            tag = match.group(0)
            declared[match.group(1)] = (
                int(re.search(r'width="(\d+)"', tag).group(1)),
                int(re.search(r'height="(\d+)"', tag).group(1)),
            )
        self.assertEqual(sorted(declared), sorted(by_name))
        for name, size in declared.items():
            with self.subTest(slide=name):
                data = by_name[name].read_bytes()
                self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
                self.assertEqual(struct.unpack(">II", data[16:24]), size,
                                 "the attributes describe the real pixels")

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



    def test_the_third_slide_is_centred_rather_than_left_anchored(self) -> None:
        figure = re.search(r'<figure class="hero-demo__slide hero-demo__slide--center"[^>]*>'
                           r'\s*<img[^>]*home-3\.png', self.index, re.S)
        self.assertIsNotNone(figure, "the model sits centre-right, so the crop is centred")
        rule = re.search(r"\.hero-demo__slide--center img\{([^}]*)\}", self.css)
        self.assertIsNotNone(rule)
        self.assertIn("object-position:center", rule.group(1).replace(" ", ""),
                      "the middle of the wide artwork is what survives the crop")


class HeroDemoFocusTests(unittest.TestCase):
    """Clicking the demo image parks the carousel until focus moves away."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX.read_text(encoding="utf-8")
        cls.css = HOME_CSS.read_text(encoding="utf-8")
        cls.js = HOME_JS.read_text(encoding="utf-8")

    def test_the_stage_can_take_focus(self) -> None:
        stage = re.search(r'<div class="hero-demo__stage"[^>]*>', self.index)
        self.assertIsNotNone(stage)
        self.assertIn('tabindex="0"', stage.group(0))

    def test_focus_draws_a_translucent_frame(self) -> None:
        rule = re.search(r"\.hero-demo__stage::before\{([^}]*)\}", self.css)
        self.assertIsNotNone(rule, "the frame is an overlay, not a background shadow")
        body = rule.group(1)
        self.assertIn("position:absolute", body)
        self.assertIn("border:1px solid rgba(255,255,255,.5)", body)
        self.assertIn("border-radius:inherit", body)
        self.assertIn("pointer-events:none", body)
        self.assertIn("opacity:0", body)
        self.assertRegex(body, r"z-index:[1-9]")
        shown = re.search(r"\.hero-demo__stage:focus::before[^{]*\{([^}]*)\}", self.css)
        self.assertIsNotNone(shown)
        self.assertIn("opacity:1", shown.group(1))
        self.assertNotRegex(
            self.css,
            r"\.hero-demo__stage(:focus)?\{[^}]*box-shadow:inset",
            "an inset shadow would be painted under the slides",
        )

    def test_the_stage_is_a_rounded_rectangle(self) -> None:
        rule = re.search(r"\.hero-demo__stage\{([^}]*)\}", self.css)
        self.assertIsNotNone(rule)
        self.assertIn("border-radius:16px", rule.group(1))
        self.assertIn("overflow:hidden", rule.group(1))

    def test_focus_keeps_the_translucent_white_groove_and_pauses_the_fill(self) -> None:
        groove = re.search(r"\.hero-demo__control\.is-active::before[^{]*\{([^}]*)\}", self.css)
        self.assertIsNotNone(groove)
        self.assertIn("rgba(255,255,255,.26)", groove.group(1), "the groove is translucent white")
        self.assertIsNone(
            re.search(r"\.hero-demo\.is-focused[^{]*::before\{", self.css),
            "focus must not repaint the groove",
        )
        paused = re.search(
            r"\.hero-demo\.is-focused \.hero-demo__control\.is-active::after\{([^}]*)\}", self.css
        )
        self.assertIsNotNone(paused)
        self.assertIn("animation-play-state:paused", paused.group(1))

    def test_focus_pauses_the_countdown_and_blur_resumes_it(self) -> None:
        self.assertIn("var DEMO_STAGE_SELECTOR = '.hero-demo__stage';", self.js)
        handler = re.search(r"stage\.addEventListener\('focus'.*?\}\);", self.js, re.DOTALL)
        self.assertIsNotNone(handler)
        self.assertIn("classList.add('is-focused')", handler.group(0))
        self.assertIn("pause();", handler.group(0))
        blur = re.search(r"stage\.addEventListener\('blur'.*?\}\);", self.js, re.DOTALL)
        self.assertIsNotNone(blur)
        self.assertIn("classList.remove('is-focused')", blur.group(0))
        self.assertIn("start();", blur.group(0))
        self.assertNotIn("restartFill", self.js, "blur books the spent time instead of refilling")
        self.assertNotIn("is-fill-reset", self.css)
        pause = re.search(r"function pause\(\) \{([^}]*)\}", self.js)
        self.assertIsNotNone(pause, "the countdown books the time already spent")
        self.assertIn("remaining - (now() - startedAt)", pause.group(1))
        starting = re.search(r"function start\(\) \{", self.js)
        self.assertIsNotNone(starting)
        self.assertIn("}, remaining);", self.js, "blur waits only the time that is left")


if __name__ == "__main__":
    unittest.main()
