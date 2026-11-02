"""Native wheel scrolling through the tall About section (#about -> footer).

The manager's browser reproduction: ``#about`` is 1205px tall inside a 566px
home viewport (offsetTop 2264, max scrollTop 2903).  The wheel handler called
``event.preventDefault()`` before deciding anything, so a wheel gesture inside
the tall section could neither scroll natively nor advance (``clampIndex`` keeps
the target on the last section) — the footer was unreachable by mouse wheel.

These tests pin the conservative fix: a pure helper, exported for Node, decides
whether the browser must keep the wheel, and the handler consults it *before*
``preventDefault()``.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
HOME_JS = REPO_ROOT / "assets" / "home.js"

# Manager-reported browser metrics for the reproduction.
ABOUT = {
    "sectionTop": 2264,
    "sectionHeight": 1205,
    "viewportHeight": 566,
    "maxScroll": 2903,
}
NORMAL = {
    "sectionTop": 1200,
    "sectionHeight": 566,
    "viewportHeight": 566,
    "maxScroll": 2903,
}
ABOUT_BOTTOM = ABOUT["sectionTop"] + ABOUT["sectionHeight"] - ABOUT["viewportHeight"]

HARNESS = """
import { pathToFileURL } from 'node:url';
const api = (await import(pathToFileURL(process.argv[2]).href)).default;
const fn = api.shouldUseNativeScroll;
const out = { exported: typeof fn };
if (typeof fn === 'function') {
  const about = { sectionTop: 2264, sectionHeight: 1205, viewportHeight: 566, maxScroll: 2903 };
  const normal = { sectionTop: 1200, sectionHeight: 566, viewportHeight: 566, maxScroll: 2903 };
  const tall = { sectionTop: 1000, sectionHeight: 1200, viewportHeight: 566, maxScroll: 5000 };
  const call = (metrics, deltaY, deltaX) =>
    fn({ ...metrics, deltaY: deltaY, deltaX: deltaX === undefined ? 0 : deltaX });
  out.cases = {
    aboutTopDown: call({ ...about, scrollTop: 2264 }, 120),
    aboutMiddleDown: call({ ...about, scrollTop: 2500 }, 120),
    aboutMiddleUp: call({ ...about, scrollTop: 2500 }, -120),
    aboutTopUp: call({ ...about, scrollTop: 2264 }, -120),
    aboutNearBottomDown: call({ ...about, scrollTop: 2900 }, 120),
    aboutBottomDown: call({ ...about, scrollTop: 2903 }, 120),
    normalTopDown: call({ ...normal, scrollTop: 1200 }, 120),
    normalBottomDown: call({ ...normal, scrollTop: 1200 }, 120),
    normalTopUp: call({ ...normal, scrollTop: 1200 }, -120),
    horizontalInTall: call({ ...about, scrollTop: 2500 }, 10, 120),
    emptyDelta: call({ ...about, scrollTop: 2500 }, 0),
    tallNonFinalAtBoundary: call({ ...tall, scrollTop: 1634 }, 120),
    tallNonFinalInside: call({ ...tall, scrollTop: 1600 }, 120),
    tallNonFinalUp: call({ ...tall, scrollTop: 1634 }, -120),
    noArguments: fn()
  };
}
process.stdout.write(JSON.stringify(out));
"""


def node_binary():
    candidates = (
        shutil.which("node"),
        shutil.which("node.exe"),
        "/mnt/d/nodejs/node.exe",
        r"D:\nodejs\node.exe",
        r"C:\Program Files\nodejs\node.exe",
    )
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    return None


def is_windows_binary(path: Path) -> bool:
    text = str(path)
    return text.lower().endswith(".exe") or re.match(r"^[A-Za-z]:", text) is not None


def windows_path(path: Path) -> str:
    match = re.match(r"^/mnt/([A-Za-z])/(.*)$", str(path))
    if match:
        return f"{match.group(1).upper()}:/{match.group(2)}"
    return str(path)


def run_harness(source: str) -> dict:
    node = node_binary()
    if node is None:
        raise unittest.SkipTest("node was not found in this environment")
    windows = is_windows_binary(node)
    base = "/mnt/d/tmp" if windows else tempfile.gettempdir()
    if not Path(base).is_dir():
        base = tempfile.gettempdir()
        windows = not windows
    directory = Path(tempfile.mkdtemp(prefix="ouro-about-wheel-", dir=base))
    try:
        script = directory / "harness.mjs"
        script.write_text(source, encoding="utf-8")
        script_arg = windows_path(script) if windows else str(script)
        module_arg = windows_path(HOME_JS) if windows else str(HOME_JS)
        result = subprocess.run(
            [str(node), script_arg, module_arg],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise AssertionError(f"node harness failed: {result.stderr or result.stdout}")
        return json.loads(result.stdout)
    finally:
        shutil.rmtree(directory, ignore_errors=True)


class HomeWheelSourceTests(unittest.TestCase):
    """The page uses native wheel scrolling without a gesture interceptor."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.source = HOME_JS.read_text(encoding="utf-8")

    def test_helper_is_exported_for_regression_harnesses(self):
        self.assertIn("function shouldUseNativeScroll(", self.source)
        self.assertRegex(
            self.source,
            r"shouldUseNativeScroll:\s*shouldUseNativeScroll",
            "the pure helper must be exported on the public API object",
        )

    def test_native_wheel_is_not_intercepted(self):
        self.assertNotIn("addEventListener('wheel'", self.source)
        self.assertNotIn("{ passive: false }", self.source)

    def test_section_gesture_thresholds_are_gone(self):
        for marker in ("WHEEL_THRESHOLD", "GESTURE_IDLE", "navigateSection"):
            self.assertNotIn(marker, self.source)


class ShouldUseNativeScrollTests(unittest.TestCase):
    """Numeric boundary behaviour of the exported helper, run in Node."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.result = run_harness(HARNESS)

    def cases(self) -> dict:
        self.assertEqual(
            self.result.get("exported"),
            "function",
            "assets/home.js must export shouldUseNativeScroll",
        )
        return self.result["cases"]

    def test_about_top_scroll_down_allows_native_scrolling(self):
        self.assertIs(self.cases()["aboutTopDown"], True)

    def test_about_middle_scroll_down_allows_native_scrolling(self):
        self.assertIs(self.cases()["aboutMiddleDown"], True)

    def test_about_middle_scroll_up_allows_native_scrolling(self):
        self.assertIs(self.cases()["aboutMiddleUp"], True)

    def test_about_top_scroll_up_keeps_previous_section_navigation(self):
        self.assertIs(
            self.cases()["aboutTopUp"],
            False,
            "at the section top the custom handler must still reach the previous section",
        )

    def test_true_bottom_scroll_down_does_not_bypass(self):
        cases = self.cases()
        self.assertIs(cases["aboutNearBottomDown"], True, "still room above the bottom")
        self.assertIs(
            cases["aboutBottomDown"],
            False,
            "at the true bottom the custom handler runs and clamps (no wrap)",
        )

    def test_normal_section_never_bypasses(self):
        cases = self.cases()
        self.assertIs(cases["normalTopDown"], False)
        self.assertIs(cases["normalBottomDown"], False)
        self.assertIs(cases["normalTopUp"], False)

    def test_horizontal_and_empty_gestures_never_bypass(self):
        cases = self.cases()
        self.assertIs(cases["horizontalInTall"], False, "horizontal wheel handling is unchanged")
        self.assertIs(cases["emptyDelta"], False)

    def test_tall_non_final_section_hands_over_at_its_own_bottom(self):
        cases = self.cases()
        self.assertIs(cases["tallNonFinalInside"], True)
        self.assertIs(
            cases["tallNonFinalAtBoundary"],
            False,
            "past the section's own bottom the next section navigation resumes",
        )
        self.assertIs(cases["tallNonFinalUp"], True)

    def test_helper_is_defensive_without_metrics(self):
        self.assertIs(self.cases()["noArguments"], False)


if __name__ == "__main__":
    unittest.main(verbosity=2)
