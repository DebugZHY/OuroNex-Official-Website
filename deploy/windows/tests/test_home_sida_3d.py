"""The 3D SIDA mark in the download band, and the duplicated early-access pill.

The Home page carries a small WebGL tile in the open space left of the download
buttons. It is a static object: nothing may turn it on its own, only a pointer
drag may rotate it, so the embed may not hold an idle animation loop.

The same band gains a third pill: ``Request early access`` copied from the hero
CTA without its arrow, pointing at ``/early-access.html``.

Source inspection only: no browser, no server, no network.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
HOME = REPO_ROOT / "index.html"
HOME_CSS = REPO_ROOT / "assets" / "home.css"
BUNDLE = REPO_ROOT / "assets" / "sida-3d.js"
EMBED = REPO_ROOT / "SIDA-Logo-3D" / "app" / "src" / "embed.js"
MANIFEST = REPO_ROOT / "package-manifest.json"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


class DownloadBandMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = read(HOME)

    def test_band_holds_a_3d_host_before_the_buttons(self) -> None:
        host = self.html.index('class="sida-3d"')
        actions = self.html.index('class="download-actions"')
        self.assertLess(host, actions, "the 3D host sits left of the download buttons")
        self.assertIn('data-sida-3d=""', self.html, "the host marks itself for the embed")

    def test_page_loads_the_embed_bundle(self) -> None:
        self.assertIn('<script defer="" src="assets/sida-3d.js"></script>', self.html)

    def test_third_pill_copies_the_hero_cta_without_an_arrow(self) -> None:
        mac = self.html.index("Download for Mac")
        request = self.html.index('class="button early-access"')
        note = self.html.index('class="release-note"')
        self.assertLess(mac, request, "the copy follows the two download pills")
        self.assertLess(request, note, "the copy stays on the button row, above the release note")
        anchor = self.html[self.html.rindex("<a", 0, request):self.html.index("</a>", request)]
        self.assertIn('href="/early-access.html"', anchor)
        self.assertIn('data-i18n="home.request-access"', anchor)
        self.assertNotIn("→", anchor, "the band copy drops the hero arrow")


class DownloadBandStyleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = read(HOME_CSS)

    def rule(self, selector: str) -> str:
        match = re.search(re.escape(selector) + r"\{([^}]*)\}", self.css)
        self.assertIsNotNone(match, f"{selector} must exist")
        return match.group(1).replace(" ", "")

    def test_3d_host_is_pinned_to_the_content_column(self) -> None:
        rule = self.rule(".sida-3d")
        self.assertIn("position:absolute", rule)
        self.assertIn("left:max(60px,calc((100%-1180px)/2))", rule, "aligned with the feature paragraph")
        self.assertIn("aspect-ratio:1", rule)

    def test_3d_host_does_not_outgrow_the_band(self) -> None:
        rule = self.rule(".sida-3d")
        width = re.search(r"width:min\((\d+)px", rule)
        self.assertIsNotNone(width)
        self.assertLessEqual(int(width.group(1)), 160, "wider than this and it reaches the Windows pill")

    def test_canvas_reads_as_draggable(self) -> None:
        rule = self.rule(".sida-3d canvas")
        self.assertIn("cursor:grab", rule)
        self.assertIn("touch-action:none", rule, "touch drags must not scroll the page")
        self.assertIn("cursor:grabbing", self.rule(".sida-3d canvas.is-dragging"))

    def test_narrow_viewports_stack_the_host(self) -> None:
        media = re.search(r"@media\(max-width:1199px\)\{\.sida-3d\{([^}]*)\}", self.css)
        self.assertIsNotNone(media, "the host must leave the absolute slot on narrow screens")
        self.assertIn("position:static", media.group(1).replace(" ", ""))

    def test_band_pill_keeps_a_usable_width(self) -> None:
        rules = re.findall(r"\.download-actions \.early-access\{([^}]*)\}", self.css)
        self.assertTrue(any("min-width:200px" in rule.replace(" ", "") for rule in rules),
                        "the copied pill needs a floor so it does not shrink to its text")


class EmbedBehaviourTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.embed = read(EMBED)

    def test_embed_never_turns_the_model_by_itself(self) -> None:
        self.assertNotIn("autoRotate", self.embed, "the mark must stand still until it is dragged")
        self.assertNotIn("setAnimationLoop", self.embed, "no always-on render loop")
        self.assertNotIn("Clock(", self.embed, "no time-driven animation")
        self.assertNotIn("Velocity", self.embed, "no inertia: the model freezes the moment the drag ends")

    def test_drag_handlers_drive_the_rotation(self) -> None:
        for event in ("pointerdown", "pointermove", "pointerup", "pointercancel"):
            self.assertIn(f"addEventListener('{event}'", self.embed, f"{event} must be handled")
        self.assertIn("pivot.rotation.set(pitch, yaw, 0)", self.embed)

    def test_motion_is_driven_only_by_the_pointer(self) -> None:
        self.assertEqual(self.embed.count("pivot.rotation.set(pitch, yaw, 0)"), 1,
                         "angles are written in one place, from pointer deltas")
        self.assertIn("pitch = THREE.MathUtils.clamp(pitch + dy * 0.006", self.embed)
        self.assertIn("yaw += dx * 0.008;", self.embed)

    def test_the_resting_pose_looks_the_viewer_in_the_face(self) -> None:
        self.assertIn("const VIEW = VIEW_DIRECTION.clone().normalize()", self.embed)
        self.assertIn("const DEFAULT_YAW = Math.asin(VIEW.x)", self.embed)
        self.assertIn("const DEFAULT_PITCH = -Math.asin(VIEW.y / Math.cos(DEFAULT_YAW))", self.embed,
                      "the camera sits off the +Z axis; the pose has to cancel that offset")
        self.assertIn("let yaw = DEFAULT_YAW;", self.embed)
        self.assertIn("let pitch = DEFAULT_PITCH;", self.embed)

    def test_double_click_restores_that_pose(self) -> None:
        handler = re.search(r"canvas\.addEventListener\('dblclick',\s*\(\)\s*=>\s*\{(.*?)\}\);", self.embed, re.S)
        self.assertIsNotNone(handler, "double-click must be wired on the canvas")
        body = handler.group(1)
        self.assertIn("yaw = DEFAULT_YAW", body)
        self.assertIn("pitch = DEFAULT_PITCH", body)
        self.assertIn("requestDraw()", body, "the reset has to repaint the canvas")
        self.assertIn("double-click to reset", self.embed, "the canvas label has to advertise the gesture")

    def test_bundle_ships_and_is_allowlisted(self) -> None:
        self.assertTrue(BUNDLE.is_file(), "the built bundle must sit in assets/")
        paths = {entry["path"] for entry in json.loads(read(MANIFEST))["files"]}
        self.assertIn("assets/sida-3d.js", paths, "the dev server only serves allowlisted files")


if __name__ == "__main__":
    unittest.main()
