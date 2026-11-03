"""SIDA feature tabs: one fixed-height stage per panel instead of three text cards.

Every ``.feature-panel`` now owns a single ``.feature-stage`` that fills a shared
fixed body height, so switching tabs never moves the download row below. The
stage content differs per tab: a React TagCloud of code names, a React Flow
project workflow, the professional-tool illustration, and a placeholder.

Self-contained stdlib checks (regex, div slicing, manifest hashing); no browser,
no server. The visual result is verified separately in Chrome.
"""

from __future__ import annotations

import hashlib
import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_HTML = REPO_ROOT / "index.html"
STAGE_CSS = REPO_ROOT / "assets" / "sida-panels.css"
FLOW_BUNDLE = REPO_ROOT / "assets" / "sida-workflow.js"
TOOLS_IMG = REPO_ROOT / "assets" / "illustrations" / "professional-tools.jpg"
MANIFEST = REPO_ROOT / "package-manifest.json"

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)

PANEL_IDS = ("feature-engineering", "feature-workflow", "feature-free", "feature-experts")

TAGCLOUD_BUNDLE = REPO_ROOT / "assets" / "sida-tagcloud.js"


def div_bounds(html: str, start: int) -> tuple:
    """Return (open-tag start offset, offset just past the matching </div>)."""
    depth = 0
    for match in re.finditer(r"<div\b|</div>", html[start:]):
        if match.group(0) == "<div":
            depth += 1
        else:
            depth -= 1
            if depth == 0:
                return start, start + match.end()
    raise AssertionError("unbalanced div block")


def declarations(css: str, selector: str) -> dict:
    match = re.search(re.escape(selector) + r"\s*\{([^{}]*)\}", css)
    if not match:
        raise AssertionError(f"missing rule {selector}")
    body = {}
    for item in match.group(1).split(";"):
        if ":" not in item:
            continue
        key, value = item.split(":", 1)
        body[key.strip()] = value.strip()
    return body


def split_media(css: str) -> tuple:
    """Return (base sheet, [(prelude, body), ...]) with @media blocks peeled out."""
    blocks = []
    base = css
    for match in list(re.finditer(r"@media([^{]+)\{", css)):
        start = match.end()
        depth = 1
        index = start
        while depth and index < len(css):
            if css[index] == "{":
                depth += 1
            elif css[index] == "}":
                depth -= 1
            index += 1
        blocks.append((match.group(1).strip(), css[start:index - 1]))
        base = base.replace(css[match.start():index], "")
    return base, blocks


class FeaturePanelStageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX_HTML.read_text(encoding="utf-8")
        cls.css = COMMENT_RE.sub("", STAGE_CSS.read_text(encoding="utf-8"))
        cls.base, cls.medias = split_media(cls.css)

        start = cls.index.index('<div class="feature-panels">')
        _, end = div_bounds(cls.index, start)
        cls.panels_block = cls.index[start:end]

    def panel(self, panel_id: str) -> str:
        match = re.search(
            r'<article[^>]*id="' + panel_id + r'".*?</article>', self.panels_block, re.S
        )
        self.assertIsNotNone(match, f"missing panel {panel_id}")
        return match.group(0)

    def media(self, needle: str) -> dict:
        for prelude, body in self.medias:
            if needle in prelude:
                return body
        raise AssertionError(f"missing the {needle} block")

    # -- one fixed stage per tab -------------------------------------------

    def test_each_panel_owns_exactly_one_stage(self) -> None:
        for panel_id in PANEL_IDS:
            block = self.panel(panel_id)
            with self.subTest(panel=panel_id):
                self.assertEqual(block.count('class="feature-stage'), 1)
                self.assertIn('role="tabpanel"', block)

    def test_the_text_cards_are_gone(self) -> None:
        self.assertNotIn("feature-detail-card", self.index)
        self.assertNotIn("feature-card-stack", self.index)
        for retired in ("Pain point", "Traditional agents", "Hong Kong library"):
            self.assertNotIn(retired, self.panels_block, retired)

    def test_the_download_row_sits_outside_the_fixed_body(self) -> None:
        download_at = self.index.index('<div class="download-row">')
        self.assertGreater(download_at, self.index.index(self.panels_block), "download follows the tabs")
        panels_rule = declarations(self.base, ".feature-panels")
        self.assertEqual(panels_rule.get("height"), "var(--stage-h)",
                         "all four tabs share one body height")
        self.assertIn("--stage-h", self.base.split(".feature-panel{")[0],
                      "the shared height is a token on the tab body")
        self.assertEqual(declarations(self.base, ".feature-stage").get("height"), "100%")
        self.assertEqual(declarations(self.base, ".feature-panel").get("height"), "100%")

    def test_the_fixed_height_is_a_fluid_clamp_with_a_mobile_release(self) -> None:
        token = re.search(r"--stage-h:([^;}]+)", self.base)
        self.assertIsNotNone(token, "the stage height is a token")
        self.assertTrue(token.group(1).strip().startswith("clamp("), token.group(1))
        mobile = self.media("max-width:760px")
        self.assertIn("height:auto", mobile.replace(" ", ""),
                      "phones let the stage size to its content")

    # -- Information Overload: the regulation tag cloud ---------------------

    def test_information_overload_hosts_the_tag_cloud(self) -> None:
        block = self.panel("feature-engineering")
        self.assertIn("data-sida-tagcloud", block)
        self.assertIn('class="sida-tagcloud"', block)
        self.assertNotIn("<table", block, "the matrix is replaced by the cloud")
        self.assertNotIn("keyword-matrix", block)

    def test_the_tag_cloud_bundle_is_wired_and_shipped(self) -> None:
        self.assertIn('src="assets/sida-tagcloud.js"', self.index)
        self.assertTrue(TAGCLOUD_BUNDLE.exists(), "the bundle is built")
        size = TAGCLOUD_BUNDLE.stat().st_size
        self.assertLess(size, 230 * 1024, f"bundle is {size} bytes")
        source = TAGCLOUD_BUNDLE.read_text(encoding="utf-8", errors="ignore")
        self.assertIn("OuroNexSidaTagCloud", source)

    def test_tag_cloud_host_fills_the_stage(self) -> None:
        host = declarations(self.base, ".sida-tagcloud")
        self.assertEqual(host.get("height"), "100%")
        self.assertEqual(host.get("position"), "relative")

    # -- Complex Workflow: the React Flow canvas ----------------------------

    def test_complex_workflow_hands_the_stage_to_the_flow_bundle(self) -> None:
        block = self.panel("feature-workflow")
        self.assertIn("data-sida-flow", block)
        self.assertNotIn("<table", block, "the workflow tab is a canvas, not a table")
        self.assertIn('src="assets/sida-workflow.js"', self.index, "the bundle is loaded")
        self.assertTrue(FLOW_BUNDLE.exists(), "the bundle is built")
        size = FLOW_BUNDLE.stat().st_size
        self.assertLess(size, 400 * 1024, f"bundle is {size} bytes")
        self.assertIn("OuroNexSidaFlow", FLOW_BUNDLE.read_text(encoding="utf-8", errors="ignore"))

    def test_flow_canvas_fills_the_stage(self) -> None:
        canvas = declarations(self.base, ".sida-flow")
        self.assertEqual(canvas.get("height"), "100%")
        self.assertEqual(canvas.get("position"), "relative")

    # -- Professional Tools: the illustration ------------------------------

    def test_professional_tools_shows_the_illustration(self) -> None:
        block = self.panel("feature-free")
        images = re.findall(r"<img\b[^>]*>", block)
        self.assertEqual(len(images), 1, "one illustration")
        image = images[0]
        self.assertIn('src="assets/illustrations/professional-tools.jpg"', image)
        self.assertIn('alt="', image)
        self.assertTrue(TOOLS_IMG.exists())
        self.assertIn('class="feature-shot"', block)
        shot = declarations(self.base, ".feature-shot img")
        self.assertEqual(shot.get("object-fit"), "contain", "the icon grid is never cropped")

    # -- Multidisciplinary Experts: the placeholder ------------------------

    def test_experts_tab_holds_a_placeholder_card(self) -> None:
        block = self.panel("feature-experts")
        self.assertIn('class="feature-placeholder"', block)
        self.assertNotIn("<table", block)
        self.assertNotIn("<img", block)

    # -- shipped assets ----------------------------------------------------

    def test_the_new_assets_are_in_the_package_manifest(self) -> None:
        entries = {entry["path"]: entry for entry in json.loads(MANIFEST.read_text(encoding="utf-8"))["files"]}
        for relative in (
            "assets/sida-panels.css",
            "assets/sida-workflow.js",
            "assets/sida-tagcloud.js",
            "assets/illustrations/professional-tools.jpg",
        ):
            with self.subTest(path=relative):
                self.assertIn(relative, entries)
                payload = (REPO_ROOT / relative).read_bytes()
                self.assertEqual(entries[relative]["sha256"], hashlib.sha256(payload).hexdigest())
                self.assertEqual(entries[relative]["bytes"], len(payload))


if __name__ == "__main__":
    unittest.main()
