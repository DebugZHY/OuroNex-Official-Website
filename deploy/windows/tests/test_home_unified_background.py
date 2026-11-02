"""Regression tests for native free scrolling and the unified Home background layer.

Scope of this module:

* the page scrolls natively: no custom ``wheel`` listener, no keyboard
  section jumping, no ``preventDefault`` on PageUp/PageDown/Home/End;
* anchor clicks still scroll smoothly to the target section;
* one shared ``div.home-backgrounds`` container is inserted before
  ``main#main.home-scroll`` and receives every section's background host tagged
  with ``data-background-section``;
* ``updateActive`` keeps ``home.dataset.activeSection`` and syncs ``.is-active``
  on the matching host only, with no extra animation loop and no per-frame
  opacity writes;
* the existing alerts, background sources, fetch/DOMParser injection, motion and
  helper exports survive.

Static source analysis plus one Node run of the real module; no browser.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
HOME_JS = REPO_ROOT / "assets" / "home.js"
INDEX_HTML = REPO_ROOT / "index.html"

SECTION_IDS = ("home", "sida", "price", "business", "about")
SVG_SOURCES = (
    "perspective-grid",
    "contour-field",
    "facade-lines",
    "isometric-frame",
    "vertical-city",
    "wave-mesh",
)
HELPER_EXPORTS = (
    "clampIndex",
    "selectBackgroundSource",
    "selectHeroSource",
    "planSectionBackgrounds",
    "sectionIndexFor",
    "shouldIgnoreWheel",
    "shouldUseNativeScroll",
    "loadSectionBackgrounds",
    "initSectionBackgrounds",
    "initSectionMotion",
)
NEW_EXPORTS = ("initUnifiedBackgrounds",)


def find_node() -> str | None:
    override = os.environ.get("NODE_EXE")
    candidates = [
        override,
        shutil.which("node"),
        shutil.which("node.exe"),
        r"D:\nodejs\node.exe",
        r"C:\Program Files\nodejs\node.exe",
        "/mnt/d/nodejs/node.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def function_body(source: str, name: str) -> str:
    """Return the balanced ``{...}`` body of ``function <name>(`` in ``source``."""
    match = re.search(r"function\s+%s\s*\(" % re.escape(name), source)
    assert match is not None, f"function {name} is missing"
    start = source.index("{", match.end() - 1)
    depth = 0
    state = None
    index = start
    while index < len(source):
        char = source[index]
        if state is None:
            pair = source[index : index + 2]
            if pair == "//":
                state = "line"
                index += 2
                continue
            if pair == "/*":
                state = "block"
                index += 2
                continue
            if char in "'\"`":
                state = char
                index += 1
                continue
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return source[start : index + 1]
        elif state == "line":
            if char == "\n":
                state = None
        elif state == "block":
            if char == "*" and source[index + 1 : index + 2] == "/":
                state = None
                index += 2
                continue
        else:
            if char == "\\":
                index += 2
                continue
            if char == state:
                state = None
        index += 1
    raise AssertionError(f"function {name} has an unbalanced body")


class UnifiedBackgroundSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = HOME_JS.read_text(encoding="utf-8")
        cls.index = INDEX_HTML.read_text(encoding="utf-8")
        cls.init_body = function_body(cls.source, "init")
        cls.update_active_body = function_body(cls.source, "updateActive")
        cls.exports = re.search(r"return Object\.freeze\(\{(.*?)\n  \}\);", cls.source, re.S)

    # -- shared container --------------------------------------------------

    def test_shared_background_container_is_created(self) -> None:
        self.assertIn("'home-backgrounds'", self.source)
        self.assertRegex(
            self.source,
            r"createElement\('div'\)",
            "the shared container must be a div created at runtime",
        )
        self.assertRegex(
            self.source,
            r"container\.className\s*=\s*BACKGROUND_CONTAINER_CLASS|container\.className\s*=\s*'home-backgrounds'",
            "the container must carry the home-backgrounds class",
        )

    def test_container_is_inserted_before_the_scroller(self) -> None:
        self.assertRegex(
            self.source,
            r"insertBefore\(container,\s*home\)",
            "the container must be inserted in front of main#main.home-scroll",
        )
        self.assertIn("main#main.home-scroll", self.source)

    def test_section_hosts_move_into_the_container_with_section_ids(self) -> None:
        self.assertIn("data-background-section", self.source)
        self.assertRegex(
            self.source,
            r"setAttribute\('data-background-section'",
            "each moved host must carry its section id",
        )
        self.assertRegex(
            self.source,
            r"container\.appendChild\(entry\.host\)|container\.appendChild\(host\)",
            "hosts must be appended to the shared container",
        )
        body = function_body(self.source, "initUnifiedBackgrounds")
        self.assertIn("data-background-section", body)
        self.assertIn("appendChild", body)
        self.assertNotIn("cloneNode", self.source, "hosts must be moved, not cloned")

    def test_moved_hosts_keep_their_background_contract(self) -> None:
        for marker in (
            "BACKGROUND_HOST_SELECTOR",
            "'hero-media'",
            "data-section-background",
            "host.dataset.background = source",
            "host.replaceChildren(svg)",
            "view.fetch(source)",
        ):
            self.assertIn(marker, self.source, f"background host contract lost: {marker}")
        # Hosts that were already moved are still discoverable by section id.
        self.assertIn("[data-section-background][data-background-section]", self.source)

    def test_backgrounds_are_prepared_before_the_first_active_sync(self) -> None:
        container_at = self.init_body.find("initUnifiedBackgrounds(doc)")
        self.assertGreater(container_at, -1, "init must build the unified background layer")
        first_sync = self.init_body.find("updateActive()")
        self.assertGreater(first_sync, container_at, "the container must exist before the first sync")

    # -- active host sync --------------------------------------------------

    def test_active_section_and_active_host_are_synced(self) -> None:
        self.assertIn("home.dataset.activeSection", self.update_active_body)
        self.assertRegex(
            self.update_active_body,
            r"classList\.toggle\('is-active'",
            "updateActive must cross-fade the matching host",
        )
        self.assertIn("backgroundEntries", self.update_active_body)
        self.assertIn(
            "backgroundEntries",
            self.init_body,
            "the host entries must be captured during init",
        )

    def test_no_second_animation_loop_and_no_per_frame_opacity(self) -> None:
        clock_lines = [
            line.strip()
            for line in self.source.splitlines()
            if "requestAnimationFrame" in line or "cancelAnimationFrame" in line
        ]
        self.assertEqual(
            clock_lines,
            [
                "var raf = view.requestAnimationFrame",
                "? view.requestAnimationFrame.bind(view)",
                "var caf = view.cancelAnimationFrame",
                "? view.cancelAnimationFrame.bind(view)",
            ],
            "the existing single raf/caf helper must stay the only animation clock",
        )
        self.assertNotIn("setInterval", self.source)
        for forbidden in ("style.opacity", "opacity:", "requestAnimationFrame", "setInterval"):
            self.assertNotIn(
                forbidden,
                self.update_active_body,
                f"updateActive must not animate per frame: {forbidden}",
            )
        for forbidden in ("requestAnimationFrame", "setInterval", "style.opacity"):
            self.assertNotIn(
                forbidden,
                function_body(self.source, "initUnifiedBackgrounds"),
                f"the container setup must stay static: {forbidden}",
            )

    # -- native scrolling --------------------------------------------------

    def test_no_custom_wheel_handler_remains(self) -> None:
        self.assertNotIn("addEventListener('wheel'", self.source)
        self.assertNotIn('addEventListener("wheel"', self.source)
        self.assertNotRegex(self.source, r"['\"]wheel['\"]")
        self.assertNotIn("WHEEL_THRESHOLD", self.source)
        self.assertNotIn("GESTURE_IDLE", self.source)

    def test_keyboard_section_jumping_is_gone(self) -> None:
        self.assertNotIn("PageDown", self.source)
        self.assertNotIn("PageUp", self.source)
        self.assertNotIn("addEventListener('keydown'", self.source)
        self.assertNotIn("event.key", self.source)
        self.assertNotIn("navigateSection", self.source)

    def test_native_scroll_helpers_stay_exported_for_compatibility(self) -> None:
        self.assertIsNotNone(self.exports, "the export block is required")
        block = self.exports.group(1)
        for name in HELPER_EXPORTS + NEW_EXPORTS:
            with self.subTest(export=name):
                self.assertRegex(block, r"\b%s\s*:" % re.escape(name))
        self.assertIn("shouldIgnoreWheel", self.source)
        self.assertIn("shouldUseNativeScroll", self.source)

    def test_anchor_clicks_still_scroll_to_the_section(self) -> None:
        for marker in (
            "navLinks.forEach",
            "navigate(target, { force: true })",
            "scrollToHash",
            "hashchange",
            "history.pushState",
            "sectionTop(",
        ):
            self.assertIn(marker, self.source, f"anchor scrolling lost: {marker}")

    # -- preserved behaviour ----------------------------------------------

    def test_alerts_background_sources_and_motion_are_preserved(self) -> None:
        for marker in (
            "'Available soon'",
            "'Coming soon'",
            "AVAILABLE_SOON_SELECTOR",
            "COMING_SOON_SELECTOR",
            "DOMParser",
            "parseSvg",
            "injectBackground",
            "initSectionMotion",
            "MOTION_ITEM_SELECTOR",
            "data-home-section",
            "prefers-reduced-motion: reduce",
        ):
            self.assertIn(marker, self.source, f"existing behaviour lost: {marker}")
        for name in SVG_SOURCES:
            with self.subTest(source=name):
                self.assertIn(f"assets/backgrounds/{name}.svg", self.source)

    def test_markup_still_offers_five_section_hosts_to_move(self) -> None:
        self.assertEqual(self.index.count("data-home-section"), 5)
        self.assertEqual(self.index.count("data-section-background"), 5)
        for section_id in SECTION_IDS:
            with self.subTest(section=section_id):
                self.assertRegex(
                    self.index,
                    r'<section[^>]*id="%s"[^>]*>\s*<div[^>]*data-section-background'
                    % re.escape(section_id),
                    "each section needs a direct background host",
                )


class UnifiedBackgroundNodeTests(unittest.TestCase):
    NODE = find_node()

    def setUp(self) -> None:
        if not self.NODE:
            self.skipTest("Node executable not found")

    def run_node(self, source: str) -> dict:
        result = subprocess.run(
            [self.NODE, "-e", source],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=120,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        return json.loads(result.stdout.strip().splitlines()[-1])

    def test_module_exports_the_compatibility_helpers(self) -> None:
        data = self.run_node(
            r"""
const api = require('./assets/home.js');
process.stdout.write(JSON.stringify({
  initUnifiedBackgrounds: typeof api.initUnifiedBackgrounds,
  initSectionBackgrounds: typeof api.initSectionBackgrounds,
  sectionIndexFor: typeof api.sectionIndexFor,
  planSectionBackgrounds: typeof api.planSectionBackgrounds,
  shouldIgnoreWheel: typeof api.shouldIgnoreWheel,
  shouldUseNativeScroll: typeof api.shouldUseNativeScroll,
  comingSoon: api.COMING_SOON_SELECTOR,
  nearest: api.sectionIndexFor(140, [0, 100, 200, 300, 400]),
  fiveSources: api.planSectionBackgrounds(() => 0, false, 5).length,
  tallSectionKeepsWheel: api.shouldUseNativeScroll({
    deltaX: 0, deltaY: 120, scrollTop: 2264, viewportHeight: 566,
    sectionTop: 2264, sectionHeight: 1205, maxScroll: 2903
  }),
  shortSectionAdvances: api.shouldUseNativeScroll({
    deltaX: 0, deltaY: 120, scrollTop: 1200, viewportHeight: 566,
    sectionTop: 1200, sectionHeight: 566, maxScroll: 2903
  })
}));
"""
        )
        self.assertEqual(data["initUnifiedBackgrounds"], "function")
        for key in (
            "initSectionBackgrounds",
            "sectionIndexFor",
            "planSectionBackgrounds",
            "shouldIgnoreWheel",
            "shouldUseNativeScroll",
        ):
            with self.subTest(export=key):
                self.assertEqual(data[key], "function")
        self.assertEqual(data["comingSoon"], "[data-coming-soon]")
        self.assertEqual(data["nearest"], 1)
        self.assertEqual(data["fiveSources"], 5)
        self.assertIs(data["tallSectionKeepsWheel"], True)
        self.assertIs(data["shortSectionAdvances"], False)


if __name__ == "__main__":
    unittest.main(verbosity=2)
