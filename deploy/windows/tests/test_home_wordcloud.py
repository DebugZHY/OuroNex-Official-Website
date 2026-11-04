"""The Information Overload panel is a word cloud over the Buildings Department index.

The vocabulary is the Buildings Department's own list of codes, design manuals and
guidelines, plus the section headings those documents carry. The layout follows the
react-d3-cloud arrangement: weight drives font size, the heaviest word owns the
centre, and the rest walk an Archimedean spiral until a free slot is found.

Source inspection only: the browser behaviour is covered by the CDP probe.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX = REPO_ROOT / "index.html"
HOME_CSS = REPO_ROOT / "assets" / "home.css"
CLOUD = REPO_ROOT / "assets" / "sida-wordcloud.js"
DICTIONARY = REPO_ROOT / "assets" / "i18n" / "home.json"
MANIFEST = REPO_ROOT / "package-manifest.json"

PUBLICATIONS = [
    "Code of Practice for the Structural Use of Concrete 2013",
    "Code of Practice for the Structural Use of Steel 2011",
    "Code of Practice on Wind Effects in Hong Kong 2019",
    "Code of Practice for Dead and Imposed Loads 2011",
    "Code of Practice for Foundations 2017",
    "Code of Practice for Fire Safety in Buildings 2011",
    "Code of Practice for Precast Concrete Construction 2016",
    "Code of Practice for Structural Use of Glass 2018",
    "Code of Practice for the Provision of Means of Escape in Case of Fire 1996",
    "Code of Practice for the Provision of Means of Access for Firefighting and Rescue 2004",
    "Code of Practice for Fire Resisting Construction 1996",
    "Code of Practice for Building Works for Lifts and Escalators 2011",
    "Code of Practice on Access for External Maintenance 2021",
    "Code of Practice for Demolition of Buildings 2004",
    "Code of Practice for Site Supervision 2009",
    "Technical Memorandum for Supervision Plans 2009",
    "Code of Practice for Overall Thermal Transfer Value in Buildings 1995",
    "Code of Practice for Oil Storage Installations 1992",
    "Code of Practice for the Mandatory Building Inspection Scheme",
    "Design Manual - Barrier Free Access 2008",
    "Design Manual on Universal Accessibility 2026",
    "Guidelines on Design and Construction Requirements for Energy Efficiency of Residential Buildings 2014",
    "General Guidelines on Minor Works Control System",
    "Technical Guidelines on Minor Works Control System",
    "Practice Guidebook for Adaptive Re-use of and Alteration and Addition Works to Heritage Buildings 2012",
    "Guidelines on the Design and Construction of Bamboo Scaffolds",
    "Guidelines on Prevention of Water Seepage in New Buildings",
    "Guidelines on Maintenance and Repair of Drainage System and Sanitary Fitments",
    "Guide on Erection & Maintenance of Advertising Signs",
    "Guidelines for Identification of Abandoned or Dangerous Signboards",
    "Building Maintenance Guidebook",
    "Introductory Guide on Greening in Buildings",
    "Guidelines for Using Building Information Modelling in General Building Plans Submission 2019",
    "Guide to Fire Safety Design for Caverns 1994",
]


class WordCloudMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX.read_text(encoding="utf-8")
        cls.css = HOME_CSS.read_text(encoding="utf-8")
        cls.cloud = CLOUD.read_text(encoding="utf-8")

    def test_panel_hosts_the_cloud(self) -> None:
        host = re.search(r'<div[^>]*data-sida-wordcloud=""[^>]*>', self.index)
        self.assertIsNotNone(host, "the Information Overload panel needs a cloud host")
        self.assertIn("sida-tagcloud", host.group(0), "the shared panel frame stays")
        self.assertIn('data-i18n-aria-label="home.code-index-label"', host.group(0))

    def test_page_loads_the_cloud_script(self) -> None:
        self.assertIn('<script defer="" src="assets/sida-wordcloud.js"></script>', self.index)
        self.assertNotIn("assets/sida-tagcloud.js", self.index, "the retired tag list is not loaded")

    def test_vocabulary_is_the_department_list(self) -> None:
        codes = len(re.findall(r"kind: 'code'", self.cloud))
        manuals = len(re.findall(r"kind: 'manual'", self.cloud))
        guides = len(re.findall(r"kind: 'guide'", self.cloud))
        self.assertGreaterEqual(codes, 18, "every code of practice on the page is present")
        self.assertGreaterEqual(manuals, 2)
        self.assertGreaterEqual(guides, 13)
        missing = [title for title in PUBLICATIONS if title.split(" (")[0][:46] not in self.cloud]
        self.assertEqual(missing, [], "publication titles must come from the department index")

    def test_each_word_keeps_its_official_title(self) -> None:
        entries = re.findall(r"\{ text: '[^']+', weight: \d+, kind: '[a-z]+', title: ", self.cloud)
        self.assertGreaterEqual(len(entries), 70, "every short label needs a full title for the tooltip")

    def test_labels_show_the_whole_name_without_the_year(self) -> None:
        labels = re.findall(r"\{ text: '([^']+)',", self.cloud)
        with_years = [label for label in labels if re.search(r"\b(?:19|20)\d{2}\b", label)]
        self.assertEqual(with_years, [], "the display label drops the edition year")
        for full_name in (
            "Structural Use of Concrete",
            "Structural Use of Steel",
            "Wind Effects in Hong Kong",
            "Dead and Imposed Loads",
            "Means of Escape in Case of Fire",
            "Means of Access for Firefighting and Rescue",
            "Building Works for Lifts and Escalators",
            "Energy Efficiency of Residential Buildings",
        ):
            self.assertIn(f"text: '{full_name}'", self.cloud, "the short forms are gone")

    def test_tooltip_still_names_the_official_document(self) -> None:
        for official in (
            "Code of Practice for the Structural Use of Concrete 2013",
            "Code of Practice on Wind Effects in Hong Kong 2019",
            "Design Manual - Barrier Free Access 2008",
        ):
            self.assertIn(f"title: '{official}", self.cloud)

    def test_long_names_wrap_instead_of_being_cut(self) -> None:
        self.assertIn("function splitLabel(", self.cloud)
        self.assertIn("var wrapLength = maxLineWidth < 480 ? 22 : 32;", self.cloud)
        self.assertIn("var lines = box.lines || [box.word.text];", self.cloud, "two-line labels render as two <text> rows")

    def test_section_terms_carry_the_document_they_come_from(self) -> None:
        for term in ("Limit state design", "Section classification", "Composite construction", "Gust factor", "Crack width", "Pile capacity"):
            self.assertIn(term, self.cloud)
        self.assertGreaterEqual(len(re.findall(r"kind: 'term'", self.cloud)), 30, "section headings widen the index")


class WordCloudLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.cloud = CLOUD.read_text(encoding="utf-8")
        cls.css = HOME_CSS.read_text(encoding="utf-8")

    def test_weights_become_font_sizes_along_a_spiral(self) -> None:
        self.assertIn("SPIRAL_TURN", self.cloud)
        self.assertIn("var radius = SPIRAL_STEP * angle;", self.cloud)
        self.assertIn("function overlaps(", self.cloud, "collisions are resolved, not painted over")
        self.assertIn("style.minSize + (style.maxSize - style.minSize) * Math.pow(word.ratio, 1.7)", self.cloud,
                      "the weight curve keeps a few big names and many small ones")

    def test_publications_are_placed_before_section_terms(self) -> None:
        self.assertIn("publication: word.kind !== 'term'", self.cloud)
        self.assertIn("if (a.publication !== b.publication) return a.publication ? -1 : 1;", self.cloud)

    def test_leftover_words_shrink_instead_of_vanishing(self) -> None:
        self.assertIn("var SCALES = [0.86, 0.74, 0.64, 0.56, 0.48]", self.cloud)
        self.assertIn("if (shrunk.size < 7.6)", self.cloud)

    def test_the_cloud_never_turns_itself(self) -> None:
        self.assertNotIn("setInterval", self.cloud)
        self.assertNotIn("setAnimationLoop", self.cloud)
        self.assertNotIn("requestAnimationFrame", self.cloud, "the cloud is drawn once per size")

    def test_words_redraw_on_resize(self) -> None:
        self.assertIn("new ResizeObserver(schedule).observe(host)", self.cloud)
        self.assertIn("setTimeout(function () {", self.cloud)

    def test_hover_dims_the_rest_and_motion_is_optional(self) -> None:
        self.assertIn(".sida-wordcloud__svg:hover .sida-wordcloud__word text{opacity:.42}", self.css)
        self.assertIn(".sida-wordcloud__svg .sida-wordcloud__word text:hover{fill:#fff;opacity:1}", self.css)
        self.assertRegex(
            self.css,
            r"@media\(prefers-reduced-motion:reduce\)\{\.sida-wordcloud__word text\{transition:none\}\}",
        )

    def test_each_family_has_its_own_tint(self) -> None:
        for kind in ("code", "manual", "guide"):
            self.assertIn(f".sida-wordcloud__word--{kind} text{{fill:var(--wc-{kind})", self.css)


class WordCloudAccessibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.cloud = CLOUD.read_text(encoding="utf-8")
        cls.dictionary = json.loads(DICTIONARY.read_text(encoding="utf-8"))

    def test_the_svg_names_itself_from_the_translated_label(self) -> None:
        self.assertIn("svg.setAttribute('role', 'img')", self.cloud)
        self.assertIn("host.getAttribute('aria-label')", self.cloud)

    def test_label_is_translated(self) -> None:
        entry = self.dictionary.get("home.code-index-label")
        self.assertIsNotNone(entry)
        for language in ("en", "zh-CN", "zh-TW"):
            self.assertTrue(entry.get(language), f"missing {language}")

    def test_asset_is_allowlisted(self) -> None:
        paths = {entry["path"] for entry in json.loads(MANIFEST.read_text(encoding="utf-8"))["files"]}
        self.assertIn("assets/sida-wordcloud.js", paths)
        self.assertNotIn("assets/sida-tagcloud.js", paths, "the retired bundle must not ship")


if __name__ == "__main__":
    unittest.main()
