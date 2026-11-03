"""Home and SIDA CTA effect regression tests."""

from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


class HomeCtaEffectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        cls.css = (REPO_ROOT / "assets" / "home.css").read_text(encoding="utf-8")
        cls.site_css = (REPO_ROOT / "assets" / "site.css").read_text(encoding="utf-8")
        cls.js = (REPO_ROOT / "assets" / "home.js").read_text(encoding="utf-8")

    def test_primary_navigation_uses_20px(self) -> None:
        self.assertIn(".home-page .nav-primary a{font-size:20px}", self.css)

    def test_hero_title_splits_into_a_brand_and_a_smaller_qualifier(self) -> None:
        self.assertIn(
            '<span class="hero-title__name" data-i18n="home.hero-slogan">SIDA</span>',
            self.index,
        )
        self.assertIn(
            '<span class="hero-title__rest" data-user-input=""><span class="hero-title__accent">S</span>uper-'
            '<span class="hero-title__accent">i</span>ntelligent <span class="hero-title__accent">D</span>esign '
            '<span class="hero-title__accent">A</span>gent</span>',
            self.index,
        )
        self.assertIn("font-size:var(--sida-size)", self.css)
        self.assertIn("font-size:calc(var(--sida-size) * var(--sida-rest))", self.css)
        self.assertIn("font-weight:800", self.css)
        self.assertIn(".hero-description{margin:0;max-width:42rem;color:#c1cfdf", self.css)
        self.assertNotIn(".hero-description::before", self.css)
        self.assertIn(".hero-title__accent{color:#84b8ff;-webkit-text-fill-color:#84b8ff}", self.css)

    def test_hero_description_is_one_line(self) -> None:
        self.assertEqual(self.index.count('class="hero-description-line"'), 1)
        self.assertIn("From planning to design, SIDA automates every engineering stages with built-in experts and customizable extensions, connects your project files, professional tools and turn the needs into deliverables.", self.index)
        self.assertNotIn("home.hero-description-2", self.index)
        self.assertIn(".hero-description-line{display:block}", self.css)

    def test_ctas_have_gradients_breathing_and_pointer_glow(self) -> None:
        self.assertIn("background:linear-gradient(115deg,rgba(169,197,255,.75)", self.css)
        # The breathing keyframes are shared with the header pills and now live in site.css.
        shared = self.css + self.site_css
        self.assertIn("@keyframes onx-cta-primary-breathe", shared)
        self.assertIn("@keyframes onx-cta-outline-breathe", shared)
        self.assertIn("radial-gradient(170px circle at var(--mx) var(--my)", self.css)
        self.assertIn("function initPointerGlow()", self.js)
        self.assertIn("button.addEventListener('pointermove'", self.js)
        self.assertIn("pending.button.style.setProperty('--mx'", self.js)
        self.assertIn("initPointerGlow();", self.js)

    def test_outline_and_early_access_share_a_thin_rest_border_and_3px_hover_ring(self) -> None:
        self.assertIn(
            ".hero-actions .early-access,.sida-section .download-actions .early-access{border:1px solid #7894c9;"
            "--cta-ring:#c2d7ff;",
            self.css,
        )
        self.assertIn(
            ".hero-actions .button:hover,.hero-actions .early-access:hover,"
            ".sida-section .download-actions .button:hover,.sida-section .download-actions .early-access:hover{"
            "transform:none;border-color:var(--cta-ring,#c2d7ff)",
            self.css,
        )
        self.assertIn(
            ".sida-section .download-actions .early-access:hover::after{opacity:1;border-width:2px}",
            self.css,
        )

    def test_reduced_motion_disables_cta_animation_and_glow(self) -> None:
        reduced = self.css[self.css.index("@media(prefers-reduced-motion:reduce)"):]
        self.assertIn("animation:none!important", reduced)
        self.assertIn("display:none", reduced)
        self.assertIn("transform:none!important", reduced)
        self.assertIn("if (reduced.matches || event.pointerType === 'touch') return;", self.js)


if __name__ == "__main__":
    unittest.main()
