"""Category-specific Home entrance and exit animation contracts."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CSS_PATH = ROOT / "assets" / "home.css"
VARIANTS = (
    "headline", "copy", "actions", "perspective", "slide", "mask",
    "pop", "fade", "flip", "depth", "drift", "float",
)
MECHANISMS = {
    "headline": ("rotatex", "clip-path"),
    "copy": ("translatex", "blur("),
    "actions": ("scale(", "70%"),
    "perspective": ("rotatey", "perspective("),
    "slide": ("translatex", "clip-path"),
    "mask": ("clip-path", "inset("),
    "pop": ("scale(", "70%"),
    "fade": ("filter", "blur("),
    "flip": ("rotatex", "perspective("),
    "depth": ("scale(", "blur("),
    "drift": ("translatex", "rotate("),
    "float": ("translate3d", "rotate("),
}


def compact(text: str) -> str:
    return re.sub(r"\s+", "", text.lower())


class HomeMotionVariantsCssTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = CSS_PATH.read_text(encoding="utf-8")
        cls.squashed = compact(re.sub(r"/\*.*?\*/", "", cls.css, flags=re.S))

    def keyframe_body(self, name: str) -> str:
        match = re.search(r"@keyframes\s+" + re.escape(name) + r"\s*\{(.*?)\n\}", self.css, re.S)
        assert match is not None, f"missing @keyframes {name}"
        return compact(match.group(1))

    def test_twelve_categories_have_distinct_enter_and_exit_keyframes(self) -> None:
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                enter = self.keyframe_body(f"onx-{variant}-in")
                exit_ = self.keyframe_body(f"onx-{variant}-out")
                self.assertIn("0%{opacity:0", enter)
                self.assertTrue("100%{opacity:1" in enter or "100%{" in enter and "opacity:1" in enter)
                self.assertIn("0%{opacity:1", exit_)
                self.assertTrue("100%{opacity:0" in exit_ or "100%{" in exit_ and "opacity:0" in exit_)
                self.assertNotEqual(enter, exit_)

    def test_each_category_uses_its_own_state_rules(self) -> None:
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                selector = f"[data-motion-variant={variant}]"
                self.assertIn(selector, self.squashed)
                self.assertIn(f"{selector}[data-motion-state=in]", self.squashed)
                self.assertIn(f"{selector}[data-motion-state=out]", self.squashed)
                self.assertIn(f"animation-name:onx-{variant}-in", self.squashed)
                self.assertIn(f"animation-name:onx-{variant}-out", self.squashed)

    def test_categories_use_the_promised_motion_mechanics(self) -> None:
        for variant, markers in MECHANISMS.items():
            body = self.keyframe_body(f"onx-{variant}-in")
            for marker in markers:
                self.assertIn(compact(marker), body, f"{variant} lacks {marker}")

    def test_initial_headline_mask_keeps_an_observable_region(self) -> None:
        body = self.keyframe_body("onx-headline-in")
        first = body.split("65%", 1)[0]
        self.assertIn(compact("clip-path:inset(0 0 88% 0)"), first)
        self.assertNotIn(compact("clip-path:inset(0 0 100% 0)"), first)

    def test_slide_retains_its_visible_strip_at_the_mobile_left_edge(self) -> None:
        self.assertIn(compact("translateX(46px)"), self.keyframe_body("onx-slide-in"))
        self.assertIn(compact("translateX(22px)"), self.keyframe_body("onx-slide-out"))

    def test_exit_masks_do_not_block_reentry_observation(self) -> None:
        for variant in ("headline", "slide", "mask"):
            body = self.keyframe_body(f"onx-{variant}-out")
            self.assertIn("88%", body)
            self.assertNotRegex(body, r"clip-path:inset\([^)]*100%")

    def test_variant_rules_stay_scoped_to_motion_on(self) -> None:
        for match in re.finditer(r"([^{}]+)\{([^{}]*animation-name:onx-(?:" + "|".join(VARIANTS) + r")-(?:in|out)[^{}]*)\}", self.css, re.S):
            selector = compact(match.group(1))
            self.assertIn("data-section-motion=on", selector, match.group(1))

    def test_reduced_attribute_clears_transform_mask_and_filter(self) -> None:
        match = re.search(r"body\.home-page\[data-section-motion=reduced\]\s*\[data-motion-item\]\{([^}]*)\}", self.css)
        assert match is not None
        body = compact(match.group(1))
        for declaration in ("opacity:1!important", "transform:none!important", "animation:none!important", "clip-path:none!important", "filter:none!important"):
            self.assertIn(declaration, body)

    def test_reduced_media_clears_transform_mask_and_filter(self) -> None:
        match = re.search(r"@media\(prefers-reduced-motion:reduce\)\{(.*)\}\s*$", self.css, re.S)
        assert match is not None
        body = compact(match.group(1))
        self.assertIn("[data-motion-item]", body)
        self.assertIn("clip-path:none!important", body)
        self.assertIn("filter:none!important", body)
        self.assertIn("animation:none!important", body)


if __name__ == "__main__":
    unittest.main()
