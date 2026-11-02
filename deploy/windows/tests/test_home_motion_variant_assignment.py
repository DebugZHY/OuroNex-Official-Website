"""Per-item motion variants for the Home sections (JS unit).

The stylesheet owns one ``onx-<category>-in`` / ``onx-<category>-out`` keyframe
pair per category; this unit only classifies. Pins:

* ``motionVariantFor`` is a pure, exported helper implementing the 17-rule
  priority contract (12 categories plus the ``rise`` fallback);
* every collected item receives ``data-motion-variant`` in the same pass that
  writes ``data-motion-item`` — including hidden tab panels, never waiting for
  visibility;
* no inline ``opacity``/``transform``/``transition``/``animation`` is written and
  ``--motion-delay`` still is;
* the 17 selector groups, order, IntersectionObserver, reduced-motion handling
  and existing exports are untouched.

Static analysis plus a Node harness driving fake ``element.matches`` objects; no
browser, no server.
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

SELECTOR_GROUPS = (
    ".hero-copy > *",
    ".hero-demo",
    ".feature-tab-list > button",
    ".feature-panel",
    ".download-actions > .button",
    ".download-actions > .button-outline",
    ".download-actions > .release-note",
    ".plan-strip > .plan-mini",
    ".plan-table-scroll",
    ".delivery > h2",
    ".delivery-grid > article",
    ".process > h2",
    ".process-list > article",
    ".team-grid > .team-member",
    ".home-footer > .footer-brand-block",
    ".home-footer > .footer-copyright",
    ".home-footer > .footer-content",
)

CATEGORIES = (
    "headline",
    "actions",
    "copy",
    "perspective",
    "slide",
    "mask",
    "pop",
    "fade",
    "flip",
    "depth",
    "drift",
    "float",
)

HARNESS = r"""
import { pathToFileURL } from 'node:url';
const api = (await import(pathToFileURL(process.argv[2]).href)).default;
const fn = api.motionVariantFor;
const out = { exported: typeof fn };
if (typeof fn === 'function') {
  const make = (matched) => ({ matches: (selector) => matched.indexOf(selector) !== -1 });
  const cases = [
    ['headline', ['.hero-copy h1', '.hero-copy > *']],
    ['actions', ['.hero-copy .hero-actions', '.hero-copy > *']],
    ['copy', ['.hero-copy > *']],
    ['perspective', ['.hero-demo']],
    ['slide', ['.feature-tab-list > button']],
    ['slide', ['.delivery > h2']],
    ['slide', ['.process > h2']],
    ['mask', ['.feature-panel']],
    ['mask', ['.plan-table-scroll']],
    ['pop', ['.download-actions > .button']],
    ['pop', ['.download-actions > .button-outline']],
    ['fade', ['.download-actions > .release-note']],
    ['fade', ['.home-footer > .footer-brand-block']],
    ['fade', ['.home-footer > .footer-copyright']],
    ['flip', ['.plan-strip > .plan-mini']],
    ['depth', ['.delivery-grid > article']],
    ['drift', ['.process-list > article']],
    ['drift', ['.home-footer > .footer-content']],
    ['float', ['.team-grid > .team-member']],
    ['rise', []],
    ['rise', ['.unrelated-selector']]
  ];
  out.results = cases.map(([expected, matched]) => ({
    expected: expected,
    actual: fn(make(matched)),
    matched: matched
  }));
  out.misses = out.results.filter((item) => item.actual !== item.expected);
  out.categories = Array.from(new Set(cases.map(([expected]) => expected)));
  out.guardNull = fn(null);
  out.guardEmpty = fn({});
  out.guardNonMatching = fn({ matches: () => false });
}
process.stdout.write(JSON.stringify(out));
"""


def node_binary():
    for candidate in (
        shutil.which("node"),
        shutil.which("node.exe"),
        "/mnt/d/nodejs/node.exe",
        r"D:\nodejs\node.exe",
        r"C:\Program Files\nodejs\node.exe",
    ):
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


def path_argument(path: Path, windows: bool) -> str:
    return windows_path(path) if windows else str(path)


def run_node(*arguments: str, source: str | None = None) -> subprocess.CompletedProcess:
    node = node_binary()
    if node is None:
        raise unittest.SkipTest("node was not found in this environment")
    windows = is_windows_binary(node)
    base = "/mnt/d/tmp" if windows else tempfile.gettempdir()
    if not Path(base).is_dir():
        base = tempfile.gettempdir()
        windows = not windows
    directory = Path(tempfile.mkdtemp(prefix="ouro-motion-variant-", dir=base))
    try:
        args = [str(node)]
        if source is None:
            args.extend(arguments)
        else:
            script = directory / "harness.mjs"
            script.write_text(source, encoding="utf-8")
            args.append(path_argument(script, windows))
            args.extend(arguments)
        return subprocess.run(args, capture_output=True, text=True, timeout=120)
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def brace_body(text: str, start: int) -> str:
    depth = 0
    for position in range(start, len(text)):
        if text[position] == "{":
            depth += 1
        elif text[position] == "}":
            depth -= 1
            if depth == 0:
                return text[start:position + 1]
    raise AssertionError("unbalanced braces")


class MotionSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.js = HOME_JS.read_text(encoding="utf-8")
        marker = cls.js.index("function initSectionMotion(")
        cls.motion = brace_body(cls.js, cls.js.index("{", marker))

    def test_variant_helper_is_defined_and_exported(self):
        self.assertIn("function motionVariantFor(", self.js)
        self.assertRegex(
            self.js,
            r"motionVariantFor:\s*motionVariantFor",
            "the pure classifier must be exported for the Node harness",
        )

    def test_variant_is_written_in_the_marking_pass(self):
        loop = self.motion.index("items.forEach(function (item) {")
        pass_body = brace_body(self.motion, loop + len("items.forEach(function (item) "))
        item = pass_body.index("setAttribute('data-motion-item'")
        variant = pass_body.find("setAttribute('data-motion-variant'")
        self.assertGreaterEqual(variant, 0, "data-motion-variant must be written at runtime")
        self.assertLess(item, variant, "the variant is set after the item marker")
        self.assertIn("motionVariantFor(item)", pass_body)
        between = pass_body[item:variant]
        self.assertNotIn(
            "closest('[hidden]')", between, "hidden panels must still be classified"
        )
        self.assertNotIn("if (", between, "classification must not wait for visibility")
        delay = self.motion.find("--motion-delay")
        self.assertGreater(delay, self.motion.index("setAttribute('data-motion-variant'"))
        self.assertIn("item.style.setProperty('--motion-delay'", self.motion)

    def test_selector_groups_are_unchanged(self):
        block = self.js[self.js.index("var MOTION_ITEM_SELECTOR = ["):]
        block = block[: block.index("].join(', ')")]
        found = re.findall(r"'([^']+)'", block)
        self.assertEqual(tuple(found), SELECTOR_GROUPS, "the 17 groups and their order must stay")
        self.assertIn("querySelectorAll(MOTION_ITEM_SELECTOR)", self.js)

    def test_reduced_motion_and_observer_are_intact(self):
        for marker in (
            "prefers-reduced-motion: reduce",
            "typeof view.IntersectionObserver !== 'function'",
            "new view.IntersectionObserver(",
            "setMotionState(target, 'in')",
            "setMotionState(target, 'out')",
            "'data-section-motion', 'on'",
            "'data-section-motion', 'reduced'",
            "motionDelayFor(",
            "root: home",
            "threshold: [0, 0.02, 0.08, 0.24, 0.5, 0.8]",
            "observer.disconnect()",
        ):
            self.assertIn(marker, self.motion, f"motion behaviour lost: {marker}")

    def test_no_inline_animation_properties_are_written(self):
        for forbidden in (
            "style.opacity",
            "style.transform",
            "style.transition",
            "style.animation",
            "setProperty('opacity'",
            "setProperty('transform'",
            "setProperty('transition'",
            "setProperty('animation'",
            'setProperty("opacity"',
            'setProperty("transform"',
        ):
            self.assertNotIn(forbidden, self.js, f"the JS must not animate inline: {forbidden}")


class MotionVariantBehaviourTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = run_node(path_argument(HOME_JS, is_windows_binary(node_binary() or Path("node"))), source=HARNESS)
        if result.returncode != 0:
            raise AssertionError(f"node harness failed: {result.stderr or result.stdout}")
        cls.data = json.loads(result.stdout)

    def test_helper_is_a_function(self):
        self.assertEqual(self.data.get("exported"), "function", "assets/home.js must export motionVariantFor")

    def test_every_selector_maps_to_its_category(self):
        self.assertEqual(self.data.get("exported"), "function")
        self.assertEqual(self.data["misses"], [], f"wrong variants: {self.data['misses']}")

    def test_all_twelve_categories_plus_the_fallback_are_reachable(self):
        self.assertEqual(self.data.get("exported"), "function")
        produced = {item["actual"] for item in self.data["results"]}
        self.assertEqual(produced, set(CATEGORIES) | {"rise"})

    def test_priority_favours_the_specific_hero_and_action_rules(self):
        self.assertEqual(self.data.get("exported"), "function")
        by_matched = {
            tuple(item["matched"]): item["actual"] for item in self.data["results"]
        }
        self.assertEqual(by_matched[(".hero-copy h1", ".hero-copy > *")], "headline")
        self.assertEqual(by_matched[(".hero-copy .hero-actions", ".hero-copy > *")], "actions")
        self.assertEqual(by_matched[(".hero-copy > *",)], "copy")

    def test_non_elements_and_unmatched_elements_fall_back_to_rise(self):
        self.assertEqual(self.data.get("exported"), "function")
        self.assertEqual(self.data["guardNull"], "rise")
        self.assertEqual(self.data["guardEmpty"], "rise")
        self.assertEqual(self.data["guardNonMatching"], "rise")

    def test_home_js_parses(self):
        node = node_binary()
        if node is None:
            self.skipTest("node was not found in this environment")
        windows = is_windows_binary(node)
        result = run_node("--check", path_argument(HOME_JS, windows))
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
