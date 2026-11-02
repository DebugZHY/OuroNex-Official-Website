"""Contract tests for the interactive Business flowchart canvas.

The diagram ships as a prebuilt bundle (`@xyflow/react` + React 18, compiled by
esbuild in `tools/business-flow`). The static HTML copy of the flow stays in the
page as the no-JS fallback, so both layers are pinned here.
"""

from __future__ import annotations

import hashlib
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
INDEX = ROOT / "index.html"
MANIFEST = ROOT / "package-manifest.json"
BUNDLE_JS = ROOT / "assets" / "business-flow.js"
BUNDLE_CSS = ROOT / "assets" / "business-flow.css"
TOOL = ROOT / "tools" / "business-flow"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class FlowAssetWiringTests(unittest.TestCase):
    def setUp(self) -> None:
        self.html = read(INDEX)

    def test_the_page_loads_the_bundle_stylesheet(self) -> None:
        self.assertIn('<link href="assets/business-flow.css" rel="stylesheet"', self.html)

    def test_the_bundle_is_never_loaded_eagerly(self) -> None:
        eager = re.findall(r'<script[^>]+src="assets/business-flow\.js"', self.html)
        self.assertEqual(eager, [], "the canvas bundle must load on demand, not with the page")

    def test_a_loader_fetches_the_bundle_near_the_section(self) -> None:
        start = self.html.index("data-flow-root")
        loader = self.html.rindex("<script>", 0, start)
        block = self.html[loader : self.html.index("</script>", loader)]
        self.assertIn('assets/business-flow.js', block)
        self.assertIn("IntersectionObserver", block)
        self.assertIn("DOMContentLoaded", block, "the loader runs in head and needs the section in the DOM")

    def test_the_canvas_host_wraps_the_static_fallback(self) -> None:
        start = self.html.index('<div class="business-flow" data-flow-root>')
        end = self.html.index('class="business-cta"', start)
        block = self.html[start:end]
        self.assertIn("data-flow-canvas", block)
        self.assertIn('class="flow" data-flow-fallback', block)
        self.assertLess(
            block.index("data-flow-canvas"),
            block.index("data-flow-fallback"),
            "the canvas has to be the first child so the fallback can be swapped out",
        )

    def test_the_host_is_labelled_for_assistive_tech(self) -> None:
        self.assertIn('role="group"', self.html)
        self.assertRegex(self.html, r'data-flow-canvas[^>]*role="group"')

    def test_the_controls_carry_translated_labels(self) -> None:
        bundle = read(BUNDLE_JS)
        for key in ("flow-zoom-in", "flow-zoom-out", "flow-reset", "flow-hint"):
            self.assertIn(key, bundle, f"{key} must reach the canvas controls")


class FlowBundleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.js = read(BUNDLE_JS)
        self.css = read(BUNDLE_CSS)

    def test_both_assets_are_built_and_sized(self) -> None:
        self.assertGreater(BUNDLE_JS.stat().st_size, 120_000)
        self.assertGreater(BUNDLE_CSS.stat().st_size, 15_000)

    def test_the_bundle_exposes_one_mount_entry_point(self) -> None:
        self.assertIn("OuroNexBusinessFlow", self.js)
        self.assertIn("IntersectionObserver", self.js, "the canvas must mount lazily")

    def test_the_bundle_embeds_react_flow(self) -> None:
        self.assertIn("react-flow", self.js)
        self.assertIn("OuroNexBusinessFlow", self.js)

    def test_the_bundle_reads_the_i18n_runtime(self) -> None:
        self.assertIn("ouronex:languagechange", self.js)

    def test_every_card_tone_is_styled(self) -> None:
        self.assertIn(".bf-card{", self.css, "the entry cards use the base card skin")
        for tone in ("gate", "lane", "delivery"):
            self.assertIn(f".bf-card--{tone}", self.css)

    def test_hover_uses_one_pointer_handler(self) -> None:
        source = read(TOOL / "src" / "index.jsx")
        # Per-node enter/leave handlers re-fired on every highlight re-render and
        # fed a class-toggle loop (~370 mutations/s) that flashed the connectors.
        self.assertNotIn("onNodeMouseEnter", source)
        self.assertNotIn("onNodeMouseLeave", source)
        self.assertIn(".react-flow__node", source)
        self.assertIn("onPointerMove", source)

    def test_hover_does_not_rebuild_the_graph(self) -> None:
        source = read(TOOL / "src" / "index.jsx")
        self.assertIn("memo(function FlowCard", source)
        self.assertIn("nodesDraggable: false", source)

    def test_bundle_stays_within_its_budget(self) -> None:
        size = BUNDLE_JS.stat().st_size
        self.assertLess(size, 260_000, f"bundle grew to {size} bytes")

    def test_handles_are_hidden_but_edges_are_not(self) -> None:
        marker = ".bf-canvas .react-flow__handle{"
        self.assertIn(marker, self.css)
        handle_rule = self.css[self.css.index(marker) :][:260]
        self.assertIn("opacity:0", handle_rule)
        self.assertIn(".bf-canvas .react-flow__edge-path{", self.css)


class FlowManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        manifest = json.loads(read(MANIFEST))
        self.entries = {entry["path"]: entry for entry in manifest["files"]}

    def test_both_assets_are_published_in_the_manifest(self) -> None:
        for rel in ("assets/business-flow.js", "assets/business-flow.css"):
            self.assertIn(rel, self.entries)

    def test_manifest_hashes_match_the_built_files(self) -> None:
        for rel in ("assets/business-flow.js", "assets/business-flow.css"):
            entry = self.entries[rel]
            blob = (ROOT / rel).read_bytes()
            self.assertEqual(entry["bytes"], len(blob), f"{rel} bytes are stale")
            self.assertEqual(
                entry["sha256"], hashlib.sha256(blob).hexdigest(), f"{rel} hash is stale"
            )


class FlowToolchainTests(unittest.TestCase):
    def test_the_source_tree_is_kept_for_rebuilds(self) -> None:
        for rel in ("package.json", "build.mjs", "src/index.jsx", "src/styles.css"):
            self.assertTrue((TOOL / rel).is_file(), f"tools/business-flow/{rel} is missing")

    def test_package_json_pins_the_renderer(self) -> None:
        pkg = json.loads(read(TOOL / "package.json"))
        self.assertIn("@xyflow/react", pkg["dependencies"])
        self.assertIn("preact", pkg["dependencies"])
        self.assertEqual(pkg["scripts"]["build"], "node build.mjs")

    def test_the_build_compiles_against_preact(self) -> None:
        build_script = read(TOOL / "build.mjs")
        self.assertIn("preact/compat", build_script)
        self.assertNotIn("react.development", read(BUNDLE_JS))

    def test_node_modules_is_ignored(self) -> None:
        ignored = read(ROOT / ".gitignore")
        self.assertIn("node_modules", ignored)


class FlowCopyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dictionary = json.loads(read(ROOT / "assets" / "i18n" / "home.json"))

    def test_control_labels_exist_in_every_locale(self) -> None:
        for key in ("flow-zoom-in", "flow-zoom-out", "flow-reset", "flow-hint"):
            entry = self.dictionary[f"home.{key}"]
            self.assertEqual({"en", "zh-CN", "zh-TW"}, set(entry), f"{key} locale set")
            for locale, value in entry.items():
                self.assertTrue(value.strip(), f"{key}/{locale} is empty")

    def test_card_copy_stays_short_enough_for_a_node(self) -> None:
        for key, entry in self.dictionary.items():
            if not key.startswith("home.flow-") or not key.endswith("-copy"):
                continue
            self.assertLessEqual(
                len(entry["en"]), 72, f"{key} is too long for a diagram node"
            )


if __name__ == "__main__":
    unittest.main()
