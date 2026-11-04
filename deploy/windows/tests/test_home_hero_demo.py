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
        self.assertRegex(self.css, r"\.hero-demo__slide img\{[^}]*object-fit:cover")
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

    def test_each_slide_declares_its_real_pixel_size(self) -> None:
        declared = {}
        for match in re.finditer(
            r'<img[^>]*src="assets/illustrations/(home-[1-4]\.png)"[^>]*>', self.index
        ):
            tag = match.group(0)
            size = (int(re.search(r'width="(\d+)"', tag).group(1)),
                    int(re.search(r'height="(\d+)"', tag).group(1)))
            declared[match.group(1)] = size
        self.assertEqual(sorted(declared), ["home-1.png", "home-2.png", "home-3.png", "home-4.png"])
        for path in SLIDES:
            with self.subTest(path=path.name):
                self.assertTrue(path.exists(), path)
                data = path.read_bytes()
                self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
                real = struct.unpack(">II", data[16:24])
                self.assertEqual(declared[path.name], real, "attributes describe the real pixels")

    def test_the_third_slide_is_centred_rather_than_left_anchored(self) -> None:
        figure = re.search(r'<figure class="hero-demo__slide hero-demo__slide--center"[^>]*>'
                           r'\s*<img[^>]*home-3\.png', self.index, re.S)
        self.assertIsNotNone(figure, "the model sits centre-right, so the crop is centred")
        rule = re.search(r"\.hero-demo__slide--center img\{([^}]*)\}", self.css)
        self.assertIsNotNone(rule)
        self.assertIn("object-position:center", rule.group(1).replace(" ", ""),
                      "the middle of the wide artwork is what survives the crop")

    def test_the_stage_keeps_one_aspect_so_slides_never_resize(self) -> None:
        rule = re.search(r"\.hero-demo__stage\{([^}]*)\}", self.css)
        self.assertIsNotNone(rule)
        self.assertIn("aspect-ratio:3200/2200", rule.group(1).replace(" ", ""))

    def test_slide_art_fills_the_frame_and_gives_up_the_bottom_right(self) -> None:
        img = re.search(r"\.hero-demo__slide img\{([^}]*)\}", self.css)
        self.assertIsNotNone(img)
        body = img.group(1).replace(" ", "")
        self.assertIn("object-fit:cover", body, "no gap may show around the artwork")
        self.assertIn("object-position:lefttop", body,
                      "overflow is spent on the bottom and right, never on the header")
        self.assertNotIn("letterbox", self.css.lower())

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



class HeroDemoToggleTests(unittest.TestCase):
    """A dedicated play/pause pill owns the countdown; the picture stays inert."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX.read_text(encoding="utf-8")
        cls.css = HOME_CSS.read_text(encoding="utf-8")
        cls.js = HOME_JS.read_text(encoding="utf-8")
        cls.dictionary = json.loads((REPO_ROOT / "assets" / "i18n" / "home.json").read_text(encoding="utf-8"))

    def test_the_stage_no_longer_takes_focus(self) -> None:
        stage = re.search(r'<div class="hero-demo__stage"[^>]*>', self.index)
        self.assertIsNotNone(stage)
        self.assertNotIn("tabindex", stage.group(0), "a focusable picture paints a frame on click")

    def test_no_rule_draws_a_focus_frame(self) -> None:
        self.assertNotRegex(self.css, r"\.hero-demo__stage:focus(-visible)?[^{]*\{[^}]*opacity:1")
        self.assertNotIn(".hero-demo.is-focused", self.css, "the focused state is retired")
        self.assertIn(".hero-demo__stage::before{content:none}", self.css, "the frame overlay is gone")

    def test_toggle_follows_the_switching_dots(self) -> None:
        controls = re.search(r'<div class="hero-demo__controls"[^>]*>(.*?)</div>', self.index, re.DOTALL)
        self.assertIsNotNone(controls)
        body = controls.group(1)
        self.assertLess(body.index("04</button>"), body.index('data-demo-toggle=""'))
        toggle = re.search(r'<button[^>]*data-demo-toggle=""[^>]*>', body)
        self.assertIsNotNone(toggle)
        self.assertIn('aria-labelledby="demo-pause-label"', toggle.group(0),
                      "the button names itself through a translated span, not a script string")
        self.assertNotIn("aria-label=", toggle.group(0))
        self.assertIn("hero-demo__toggle-icon--pause", body)
        self.assertIn("hero-demo__toggle-icon--play", body)
        self.assertIn('<span class="sr-only" data-i18n="home.demo-pause" id="demo-pause-label">', body)
        self.assertIn('<span class="sr-only" data-i18n="home.demo-play" id="demo-play-label">', body)

    def test_toggle_draws_a_round_button_past_the_dots(self) -> None:
        rule = re.search(r"\.hero-demo__toggle\{([^}]*)\}", self.css)
        self.assertIsNotNone(rule)
        body = rule.group(1)
        self.assertIn("width:26px", body)
        self.assertIn("height:26px", body)
        self.assertIn("border-radius:999px", body)
        self.assertIn("margin-left:10px", body)
        self.assertIn("border:1px solid rgba(255,255,255,.2)", body)

    def test_paused_state_swaps_the_icon_and_parks_the_fill(self) -> None:
        self.assertIn("[data-demo-playing=false] .hero-demo__toggle-icon--pause{display:none}", self.css)
        self.assertIn("[data-demo-playing=false] .hero-demo__toggle-icon--play{display:block}", self.css)
        paused = re.search(r"\[data-demo-playing=false\] \.hero-demo__control\.is-active::after\{([^}]*)\}", self.css)
        self.assertIsNotNone(paused, "the active dot stops filling while paused")
        self.assertIn("animation-play-state:paused", paused.group(1))

    def test_click_on_the_picture_no_longer_parks_the_carousel(self) -> None:
        self.assertNotIn("stage.addEventListener", self.js, "the stage keeps no listeners")
        self.assertNotIn("DEMO_STAGE_SELECTOR", self.js, "the stage is no longer looked up")
        self.assertNotIn("is-focused", self.js)

    def test_toggle_controls_the_timer(self) -> None:
        handler = re.search(r"toggle\.addEventListener\('click'.*?\}\);", self.js, re.DOTALL)
        self.assertIsNotNone(handler, "the pill must handle clicks")
        self.assertIn("setPlaying(!playing)", handler.group(0))
        self.assertIn("root.setAttribute('data-demo-playing', playing ? 'true' : 'false')", self.js)
        self.assertIn("toggle.setAttribute('aria-labelledby', playing ? 'demo-pause-label' : 'demo-play-label')", self.js)
        self.assertNotIn("data-i18n", self.js, "home.js must not carry dictionary keys")
        start = re.search(r"function start\(\) \{([^}]*)\}", self.js)
        self.assertIsNotNone(start)
        self.assertIn("if (!playing) return;", start.group(1), "a paused carousel must not schedule a tick")
        pause = re.search(r"function pause\(\) \{([^}]*)\}", self.js)
        self.assertIsNotNone(pause)
        self.assertIn("remaining - (now() - startedAt)", pause.group(1), "pause books the time already spent")

    def test_resume_restarts_the_fill_with_the_timer(self) -> None:
        """A pause freezes the fill mid-way; without a real restart the bar finishes long
        before the slide turns and the carousel looks stuck."""
        start_at = self.js.index("function restartFill()")
        body = self.js[start_at : self.js.index("\n    }", start_at)]
        self.assertIn("classList.remove('is-active')", body)
        self.assertIn("setAttribute('aria-pressed', 'false')", body,
                      "the pressed state arms the fill too, so it must drop with the class")
        self.assertIn("void active.offsetWidth", body, "the removal needs a style flush")
        self.assertIn("classList.add('is-active')", body)
        self.assertIn("setAttribute('aria-pressed', 'true')", body)
        play = re.search(r"if \(playing\) \{(.*?)\} else \{", self.js, re.DOTALL)
        self.assertIsNotNone(play)
        self.assertIn("remaining = interval", play.group(1))
        self.assertIn("restartFill()", play.group(1))
        self.assertIn("start()", play.group(1))

    def test_returning_to_the_tab_also_restarts_the_slide(self) -> None:
        handler = re.search(r"doc\.addEventListener\('visibilitychange'.*?\}\);", self.js, re.DOTALL)
        self.assertIsNotNone(handler)
        body = handler.group(0)
        self.assertIn("if (!playing) return;", body, "a parked carousel stays parked")
        self.assertIn("restartFill()", body,
                      "the fill kept running while hidden, so both clocks start over")

    def test_pause_label_is_translated(self) -> None:
        for key in ("home.demo-pause", "home.demo-play"):
            self.assertIn(key, self.dictionary, f"{key} needs a dictionary entry")
            for language in ("en", "zh-CN", "zh-TW"):
                self.assertTrue(self.dictionary[key].get(language), f"{key} misses {language}")
