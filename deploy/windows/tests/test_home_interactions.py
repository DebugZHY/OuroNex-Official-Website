"""Regression tests for the Home interaction revision.

Scope of this module (interaction unit only):

* five direct ``[data-home-section]`` sections, each with one direct-child
  ``<div aria-hidden="true" class="hero-media" data-section-background>`` host;
* one randomized dynamic background per section, drawn only from the six SVG
  engines in ``assets/backgrounds``;
* native ``alert('Available soon')`` for every download trigger and for the
  Enterprise Contact Sales control, plus ``alert('Coming soon')`` for the
  enabled Request early access control, with the custom ``dialog`` removed;
* the About company-introduction block (intro, the founder card and the body);
* preserved five-section structure, content and one-section navigation helpers.

Everything here is source/static analysis plus pure-JS checks executed with the
Node binary.  No browser and no server is started by this module.
"""

from __future__ import annotations

import html as html_module
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_HTML = REPO_ROOT / "index.html"
HOME_JS = REPO_ROOT / "assets" / "home.js"
HOME_I18N_JSON = REPO_ROOT / "assets" / "i18n" / "home.json"
HOME_I18N_JS = REPO_ROOT / "assets" / "i18n" / "home.js"
MOTION_JS = REPO_ROOT / "assets" / "motion.js"
BACKGROUND_DIR = REPO_ROOT / "assets" / "backgrounds"
ILLUSTRATION_DIR = REPO_ROOT / "assets" / "illustrations"

SECTION_IDS = ("home", "sida", "price", "business", "about")

BACKGROUND_HOST_HTML = (
    '<div aria-hidden="true" class="hero-media" data-section-background></div>'
)

SVG_BACKGROUNDS = (
    "perspective-grid",
    "contour-field",
    "facade-lines",
    "isometric-frame",
    "vertical-city",
    "wave-mesh",
)
SVG_SOURCES = tuple(f"assets/backgrounds/{name}.svg" for name in SVG_BACKGROUNDS)
GRID_SOURCE = "business-grid"
ALERT_MESSAGE = "Available soon"
COMING_SOON_MESSAGE = "Coming soon"
DOWNLOAD_LABELS = {
    "home.windows": "Download for Windows",
    "home.mac": "Download for Mac",
}

# Headings are locked so the change cannot introduce new visible copy.
# The twelve SIDA detail-card titles are requested content, so they are part of
# the locked heading order before the Price section.
SIDA_CARD_TITLES = (
    "Pain point",
    "Comparison",
    "Confidentiality",
    "Pain point",
    "Traditional agents",
    "Visual flowcharts",
    "Pain point",
    "Built-in tools",
    "Computer use",
    "Pain point",
    "Specialist bots",
    "Hong Kong library",
)

EXPECTED_HEADINGS = (
    ("h1", "SIDA - Superintelligent Design Agent"),
    ("h3", "Pain point"),
    ("h3", "Comparison"),
    ("h3", "Confidentiality"),
    ("h3", "Pain point"),
    ("h3", "Traditional agents"),
    ("h3", "Visual flowcharts"),
    ("h3", "Pain point"),
    ("h3", "Built-in tools"),
    ("h3", "Computer use"),
    ("h3", "Pain point"),
    ("h3", "Specialist bots"),
    ("h3", "Hong Kong library"),
    ("h2", "Pay as you go"),
    ("h2", "Lite"),
    ("h2", "Standard"),
    ("h2", "Professional"),
    ("h2", "Enterprise"),
    ("h2", "What we deliver"),
    ("h3", "Free Documentation"),
    ("h3", "Project Planning"),
    ("h3", "Design Optimization"),
    ("h3", "BIM Modelling"),
    ("h2", "How we work with you"),
    ("h3", "On-site consultation"),
    ("h3", "Scoped proposal"),
    ("h3", "Pilot first"),
    ("h2", "An engineering-led AI company"),
    ("h3", "Haoyi ZHANG"),
)

VOID_TAGS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class _SectionCollector(HTMLParser):
    """Collects [data-home-section] elements with their direct children."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.sections: list[dict] = []
        self._depth = 0
        self._section_depth: int | None = None
        self._current: dict | None = None

    def _record_child(self, tag: str, attrs: dict) -> None:
        if self._current is None or self._section_depth is None:
            return
        if self._depth == self._section_depth + 1:
            self._current["children"].append(
                {"tag": tag, "attrs": attrs, "classes": (attrs.get("class") or "").split()}
            )

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        self._record_child(tag, attributes)
        if "data-home-section" in attributes:
            self._current = {
                "tag": tag,
                "id": attributes.get("id") or "",
                "attrs": attributes,
                "children": [],
            }
            self.sections.append(self._current)
            self._section_depth = self._depth
        if tag not in VOID_TAGS:
            self._depth += 1

    def handle_startendtag(self, tag, attrs):
        self._record_child(tag, dict(attrs))

    def handle_endtag(self, tag):
        if tag in VOID_TAGS:
            return
        self._depth -= 1
        if self._section_depth is not None and self._depth <= self._section_depth:
            self._current = None
            self._section_depth = None


def parse_sections(html: str) -> list[dict]:
    parser = _SectionCollector()
    parser.feed(html)
    parser.close()
    return parser.sections


def headings(html: str) -> list[tuple[str, str]]:
    found = []
    for match in re.finditer(r"<(h[1-6])\b[^>]*>(.*?)</\1>", html, re.S):
        text = html_module.unescape(re.sub(r"<[^>]+>", "", match.group(2)))
        found.append((match.group(1), text.strip()))
    return found


def find_node() -> str | None:
    override = os.environ.get("NODE_EXE")
    candidates = [override, shutil.which("node"), shutil.which("node.exe")]
    candidates.extend(
        [
            r"D:\nodejs\node.exe",
            r"C:\Program Files\nodejs\node.exe",
            r"C:\Program Files (x86)\nodejs\node.exe",
        ]
    )
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


class HomeFixtures(unittest.TestCase):
    """Shared, read-only fixtures."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.index = read_text(INDEX_HTML)
        cls.home_js = read_text(HOME_JS)
        cls.motion_js = read_text(MOTION_JS) if MOTION_JS.is_file() else ""
        cls.sections = parse_sections(cls.index)


class SectionBackgroundHostTests(HomeFixtures):
    def test_five_ordered_data_home_sections(self):
        self.assertEqual(len(self.sections), 5, "Home must keep exactly five sections")
        self.assertEqual([section["id"] for section in self.sections], list(SECTION_IDS))
        for section in self.sections:
            self.assertEqual(section["tag"], "section")

    def test_each_section_has_one_direct_background_host(self):
        self.assertEqual(len(self.sections), 5)
        for section in self.sections:
            hosts = [
                child
                for child in section["children"]
                if "data-section-background" in child["attrs"]
            ]
            self.assertEqual(
                len(hosts),
                1,
                f"#{section['id']} needs exactly one direct [data-section-background] host",
            )
            host = hosts[0]
            self.assertEqual(host["tag"], "div")
            self.assertIn("hero-media", host["classes"])
            self.assertEqual(host["attrs"].get("aria-hidden"), "true")

    def test_background_host_markup_is_exact_and_not_nested(self):
        self.assertEqual(
            self.index.count(BACKGROUND_HOST_HTML),
            5,
            "Every section host must use the exact agreed markup",
        )
        self.assertEqual(
            self.index.count("data-section-background"),
            5,
            "No extra or nested background hosts may be added",
        )

    def test_no_new_headings_or_visible_section_copy(self):
        self.assertEqual(headings(self.index), list(EXPECTED_HEADINGS))

    def test_header_navigation_opens_with_home(self):
        nav = re.search(r'<div class="nav-primary">(.*?)</div>', self.index, re.S)
        self.assertIsNotNone(nav, "the primary navigation block must exist")
        links = re.findall(
            r'<a href="([^"]+)"><span data-i18n="([^"]+)">([^<]+)</span></a>', nav.group(1)
        )
        self.assertEqual(
            [(text, href) for href, _key, text in links],
            [
                ("Home", "#home"),
                ("Features", "#sida"),
                ("Price", "#price"),
                ("Business", "#business"),
                ("About", "#about"),
            ],
            "Home is the first entry and Features now scrolls to the SIDA section",
        )
        self.assertEqual(
            nav.group(1).count("data-nav-placeholder"),
            1,
            "Application is the only inert nav entry left",
        )
        self.assertIn(
            '<a href="#sida"><span data-i18n="shared.features">Features</span></a>',
            nav.group(1),
            "Features must be a live link to the SIDA section",
        )
        shared = json.loads(
            (REPO_ROOT / "assets" / "i18n" / "shared.json").read_text(encoding="utf-8")
        )
        key = links[0][1]
        self.assertIn(key, shared, "the Home label must resolve in the shared dictionary")

    def test_existing_section_content_is_preserved(self):
        for marker in (
            'class="wrap hero-inner"',
            'class="hero-demo"',
            'class="feature-tabs" data-tabs=""',
            'class="download-row"',
            'class="download-actions"',
            'class="release-note"',
            'class="plan-strip"',
            'class="plan-table-scroll"',
            'class="delivery-grid"',
            'class="process-list"',
            'class="wrap about-layout"',
            'class="site-footer"',
        ):
            self.assertIn(marker, self.index, f"missing preserved content: {marker}")
        for section_id in SECTION_IDS:
            self.assertIn(f'id="{section_id}"', self.index)


class NativeAvailableSoonTests(HomeFixtures):
    def test_custom_download_dialog_markup_is_gone(self):
        for forbidden in (
            "<dialog",
            "download-dialog",
            "download-message",
            "data-dialog-close",
        ):
            self.assertNotIn(forbidden, self.index, f"custom dialog remnant: {forbidden}")

    def test_custom_dialog_javascript_is_gone(self):
        for forbidden in (
            "showModal",
            "download-dialog",
            "data-dialog-close",
            "initDownloadDialog",
            "fallbackOpen",
        ):
            self.assertNotIn(forbidden, self.home_js, f"custom dialog JS remnant: {forbidden}")

    def test_download_triggers_are_native_alert_buttons(self):
        triggers = re.findall(r"<[^>]*data-download[^>]*>", self.index)
        self.assertEqual(len(triggers), 2, "Windows and Mac download triggers must remain")
        for trigger in triggers:
            self.assertTrue(trigger.startswith("<button"), trigger)
            self.assertNotIn("href", trigger, "download triggers must not navigate")
        self.assertEqual(
            self.index.count('<button class="button" data-download="" type="button">'), 2
        )

    def test_contact_sales_is_a_safe_native_alert_trigger(self):
        self.assertNotIn("contact.html", self.index)
        self.assertNotIn("/contact/", self.index)
        self.assertEqual(self.index.count("data-available-soon"), 5)
        contact_control = re.search(
            r'<[^>]*data-available-soon[^>]*>(?=[^<]*<span data-i18n="home.contact-sales")',
            self.index,
        )
        self.assertIsNotNone(contact_control)
        markup = contact_control.group(0)
        self.assertNotIn("href", markup)
        self.assertTrue(markup.startswith("<button"), markup)
        self.assertIn('data-i18n="home.contact-sales"', self.index)

    def test_home_js_alerts_with_exact_untranslated_message(self):
        self.assertRegex(
            self.home_js,
            r"\.alert\(\s*'Available soon'\s*\)",
            "Home must call the native alert with the exact English message",
        )
        self.assertNotIn(
            "Available soon",
            self.index,
            "The native alert message must not live in translatable markup",
        )
        self.assertNotIn(
            "data-i18n",
            self.home_js,
            "Home JS must not translate the native alert message",
        )

    def test_download_actions_and_release_note_kept_for_stacking(self):
        actions = self.index.find('class="download-actions"')
        windows = self.index.find("home.windows")
        mac = self.index.find("home.mac")
        note = self.index.find("home.public-release")
        self.assertGreater(actions, -1)
        self.assertLess(actions, windows)
        self.assertLess(windows, mac)
        self.assertLess(mac, note)
        self.assertIn('class="release-note"', self.index)
        self.assertIn('<div class="download-row">', self.index)


class SidaDownloadActionsTests(HomeFixtures):
    ACTIONS_RE = re.compile(r'<div class="download-actions">(.*?)</div>', re.S)
    BUTTON_RE = re.compile(r"<button\b[^>]*>")

    def actions_block(self):
        match = self.ACTIONS_RE.search(self.index)
        self.assertIsNotNone(match, "the SIDA download-actions container is required")
        return match.group(1)

    def button_segments(self, block):
        matches = list(self.BUTTON_RE.finditer(block))
        return [
            block[match.start() : matches[index + 1].start() if index + 1 < len(matches) else len(block)]
            for index, match in enumerate(matches)
        ]

    def test_english_download_labels_are_exact(self):
        block = self.actions_block()
        self.assertIn(
            'data-i18n="home.windows">Download for Windows</span>', block,
            "Windows button must read exactly Download for Windows",
        )
        self.assertIn(
            'data-i18n="home.mac">Download for Mac</span>', block,
            "Mac button must read exactly Download for Mac",
        )
        self.assertNotIn(">Windows</span>", self.index, "the bare Windows label must be gone")
        self.assertNotIn(">Mac</span>", self.index, "the bare Mac label must be gone")

    def test_download_buttons_have_platform_icons_before_labels(self):
        segments = self.button_segments(self.actions_block())
        self.assertEqual(len(segments), 2)
        for index, key in ((0, "home.windows"), (1, "home.mac")):
            with self.subTest(key=key):
                match = re.search(r'<svg\b[^>]*class="download-icon"', segments[index])
                icon = match.start() if match else -1
                label = segments[index].find(f'data-i18n="{key}"')
                self.assertGreaterEqual(icon, 0, f"{key}: missing platform icon")
                self.assertGreater(label, icon, f"{key}: icon must precede the label")
                self.assertIn('aria-hidden="true"', segments[index])
                self.assertIn('focusable="false"', segments[index])

    def test_dictionaries_carry_the_labels_in_all_three_languages(self):
        source = json.loads(read_text(HOME_I18N_JSON))
        runtime = json.loads(
            read_text(HOME_I18N_JS)
            .split("Object.assign(window.OuroNexI18n || {}, ", 1)[1]
            .rsplit(");", 1)[0]
        )
        for key, label in DOWNLOAD_LABELS.items():
            with self.subTest(key=key):
                self.assertIn(key, source)
                self.assertEqual(source[key]["en"], label)
                self.assertEqual(runtime[key], source[key], f"{key}: runtime dictionary is stale")
                platform = "Windows" if "windows" in key else "Mac"
                for language in ("zh-CN", "zh-TW"):
                    value = source[key][language]
                    self.assertTrue(value.strip(), f"{key}.{language} must be translated")
                    self.assertNotEqual(value, label, f"{key}.{language} is not translated")
                    self.assertRegex(
                        value, r"[\u4e00-\u9fff]", f"{key}.{language} must be Chinese: {value!r}"
                    )
                    self.assertIn(platform, value, f"{key}.{language} must name {platform}")

    def test_two_download_buttons_share_one_container(self):
        block = self.actions_block()
        segments = self.button_segments(block)
        self.assertEqual(len(segments), 2, f"expected the two downloads in one row, found {segments}")
        self.assertIn('data-download=""', segments[0])
        self.assertIn('data-i18n="home.windows"', segments[0])
        self.assertIn('data-download=""', segments[1])
        self.assertIn('data-i18n="home.mac"', segments[1])
        self.assertIn('class="release-note"', segments[1], "the note follows the two buttons")
        self.assertEqual(block.count('data-download=""'), 2)
        self.assertEqual(block.count('data-coming-soon=""'), 0, "early access moved out of the download row")
        row_start = self.index.find('<div class="download-row">')
        self.assertGreater(row_start, -1, "the download-row wrapper must stay")
        row = self.index[row_start : self.index.find("</section>", row_start)]
        self.assertEqual(row.count("<button"), 2, "both downloads must sit in the row")

    def test_request_early_access_is_enabled_and_native(self):
        control = re.search(r'<button[^>]*data-coming-soon[^>]*>', self.index)
        self.assertIsNotNone(control, "the Request early access control is required")
        markup = control.group(0)
        self.assertNotIn("disabled", markup, "early access must no longer be disabled")
        self.assertNotIn("href", markup, "early access must not navigate")
        self.assertNotIn("onclick", markup, "early access must use the shared click handler")
        self.assertIn('type="button"', markup)
        self.assertIn('data-i18n="home.request-access"', self.index)

    def test_coming_soon_uses_the_existing_native_alert(self):
        self.assertRegex(
            self.home_js,
            r"\.alert\(\s*'Coming soon'\s*\)",
            "home.js must alert the exact English message Coming soon",
        )
        self.assertIn("COMING_SOON_SELECTOR = '[data-coming-soon]'", self.home_js)
        self.assertIn("handleComingSoon(event, view)", self.home_js)
        self.assertIn("COMING_SOON_SELECTOR: COMING_SOON_SELECTOR", self.home_js)
        self.assertNotIn("<dialog", self.index)
        self.assertNotIn("showModal", self.home_js)
        self.assertNotIn("data-i18n", self.home_js)
        self.assertNotIn(
            "Coming soon", self.actions_block(), "the action row must not gain visible copy"
        )

    def test_available_soon_alerts_are_unchanged(self):
        block = self.actions_block()
        self.assertEqual(block.count('data-available-soon=""'), 0)
        self.assertEqual(self.index.count('data-available-soon'), 5)
        self.assertRegex(self.home_js, r"\.alert\(\s*'Available soon'\s*\)")


class RandomizedSectionBackgroundTests(HomeFixtures):
    def test_loader_uses_only_folder_svg_engines(self):
        for source in SVG_SOURCES:
            self.assertIn(source, self.home_js, f"missing background engine: {source}")
        self.assertNotIn(GRID_SOURCE, self.home_js, "business-grid is not an assets/backgrounds option")
        self.assertIn("[data-section-background]", self.home_js)

    def test_no_second_animation_framework_is_added(self):
        self.assertNotIn("getContext", self.home_js)
        self.assertNotIn("drawField", self.home_js)
        self.assertNotIn("createElement('canvas')", self.home_js)
        self.assertNotIn("createElement(\"canvas\")", self.home_js)
        self.assertLessEqual(
            self.home_js.count("requestAnimationFrame"),
            2,
            "section backgrounds must not add their own RAF loops",
        )
        self.assertEqual(
            re.findall(r"requestAnimationFrame\s*\(", self.home_js),
            [],
            "the only animation clock must stay the motion engine",
        )

    def test_svg_sources_use_the_existing_loader(self):
        self.assertIn("DOMParser", self.home_js)
        self.assertIn("view.fetch", self.home_js)
        self.assertNotRegex(self.home_js, r"dataset\.motionField\s*=\s*'grid'")
        self.assertNotRegex(self.home_js, r"<img\b", "backgrounds must not be static images")

    def test_motion_engine_still_creates_canvas_fields(self):
        self.assertIn("[data-motion-field]", self.motion_js)
        self.assertIn("createElement('canvas')", self.motion_js)
        self.assertIn("[data-motion-field]>.motion-field", read_text(
            REPO_ROOT / "assets" / "motion.css"
        ))
        home_tag = self.index.find('src="assets/home.js"')
        motion_tag = self.index.find('src="assets/motion.js"')
        self.assertGreater(home_tag, -1)
        self.assertGreater(motion_tag, home_tag, "motion.js must load after home.js")

    def test_svg_engines_carry_animation_and_reduced_motion_markup(self):
        for name in SVG_BACKGROUNDS:
            path = BACKGROUND_DIR / f"{name}.svg"
            self.assertTrue(path.is_file(), f"missing engine file: {path.name}")
            markup = read_text(path)
            self.assertIn("@keyframes", markup, f"{name}.svg has no animation keyframes")
            self.assertIn("animation:", markup, f"{name}.svg has no animation rules")
            self.assertIn(
                "prefers-reduced-motion",
                markup,
                f"{name}.svg must disable its own animation for reduced motion",
            )

    def test_navigation_and_reduced_motion_behaviour_are_kept(self):
        for marker in (
            "HERO_SOURCES",
            "clampIndex",
            "selectBackgroundSource",
            "planSectionBackgrounds",
            "sectionIndexFor",
            "shouldIgnoreWheel",
            "initUnifiedBackgrounds",
            "data-background-section",
            "is-active",
            "prefers-reduced-motion: reduce",
        ):
            self.assertIn(marker, self.home_js, f"navigation contract lost: {marker}")
        self.assertNotIn("addEventListener('wheel'", self.home_js)
        self.assertIn("data-home-section", self.home_js)


class PureJsBehaviourTests(unittest.TestCase):
    """Executes the browser-free helpers of assets/home.js with Node."""

    NODE = find_node()

    def setUp(self):
        if not self.NODE:
            self.skipTest("Node executable not found")

    def _run_node(self, source: str, *arguments: str) -> subprocess.CompletedProcess:
        with tempfile.TemporaryDirectory(prefix="home-js-") as temporary:
            script = Path(temporary) / "harness.mjs"
            script.write_text(source, encoding="utf-8")
            return subprocess.run(
                [self.NODE, str(script), *arguments],
                cwd=str(REPO_ROOT),
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=120,
            )

    def test_home_js_is_syntactically_valid(self):
        result = subprocess.run(
            [self.NODE, "--check", str(HOME_JS)],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=120,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_click_handler_alerts_once_and_never_translates(self):
        harness = """
import { pathToFileURL } from 'node:url';
const api = (await import(pathToFileURL(process.argv[2]).href)).default;
const messages = [];
const view = { alert: (message) => messages.push(message) };
const makeEvent = (target, extra) => {
  const event = { target, ...(extra || {}) };
  event.preventDefault = () => { event.prevented = true; };
  return event;
};
const button = { tagName: 'BUTTON', closest: () => button };
const link = { tagName: 'A', closest: () => link };
const plain = { tagName: 'SPAN', closest: () => null };

const buttonEvent = makeEvent(button);
const buttonHandled = api.handleAvailableSoon(buttonEvent, view);
const afterButton = messages.slice();

const plainEvent = makeEvent(plain);
const plainHandled = api.handleAvailableSoon(plainEvent, view);
const plainPrevented = plainEvent.prevented === true;

const modifiedEvent = makeEvent(link, { ctrlKey: true, button: 0 });
const modifiedHandled = api.handleAvailableSoon(modifiedEvent, view);
const modifiedPrevented = modifiedEvent.prevented === true;

const linkEvent = makeEvent(link);
const linkHandled = api.handleAvailableSoon(linkEvent, view);

const middleClickEvent = makeEvent(link, { button: 1 });
const middleClickHandled = api.handleAvailableSoon(middleClickEvent, view);

process.stdout.write(JSON.stringify({
  selector: api.AVAILABLE_SOON_SELECTOR,
  buttonHandled, buttonMessages: afterButton, buttonPrevented: buttonEvent.prevented === true,
  plainHandled, plainPrevented,
  modifiedHandled, modifiedPrevented,
  linkHandled, linkPrevented: linkEvent.prevented === true,
  middleClickHandled,
  allMessages: messages,
  nullEventHandled: api.handleAvailableSoon(null, view),
}));
"""
        result = self._run_node(harness, str(HOME_JS))
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)

        self.assertIn("[data-download]", data["selector"])
        self.assertIn("[data-available-soon]", data["selector"])

        self.assertTrue(data["buttonHandled"], "download triggers must be handled")
        self.assertTrue(data["buttonPrevented"], "the trigger must not navigate")
        self.assertEqual(data["buttonMessages"], [ALERT_MESSAGE])

        self.assertFalse(data["plainHandled"], "unrelated clicks must be ignored")
        self.assertFalse(data["plainPrevented"])

        self.assertFalse(data["modifiedHandled"], "ctrl/cmd/shift clicks stay native")
        self.assertFalse(data["modifiedPrevented"])
        self.assertFalse(data["middleClickHandled"])

        self.assertTrue(data["linkHandled"])
        self.assertTrue(data["linkPrevented"])
        self.assertFalse(data["nullEventHandled"])

        self.assertEqual(
            data["allMessages"],
            [ALERT_MESSAGE, ALERT_MESSAGE],
            "one native alert per handled click, always the exact English text",
        )

    def test_selection_helpers_cover_only_folder_sources(self):
        harness = """
import { pathToFileURL } from 'node:url';
const api = (await import(pathToFileURL(process.argv[2]).href)).default;
const plan = (random, allowGrid, count) => api.planSectionBackgrounds(random, allowGrid, count);
const messages = [];
const out = {
  svgSources: api.BACKGROUND_SOURCES ? [...api.BACKGROUND_SOURCES] : null,
  heroSources: api.HERO_SOURCES ? [...api.HERO_SOURCES] : null,
  grid: api.GRID_SOURCE === undefined ? null : api.GRID_SOURCE,
  firstSvg: api.selectBackgroundSource(0, false),
  lastSvg: api.selectBackgroundSource(0.999999, false),
  gridPick: api.selectBackgroundSource(0.999999, true),
  noGridPick: api.selectBackgroundSource(0.999999, false),
  fiveDistinct: plan(() => 0, true, 5),
  allSix: plan(() => 0, true, 6),
  sevenPicks: plan(() => 0, true, 7),
  svgOnlyPlan: plan(() => 0.5, false, 5),
  heroAlias: api.selectHeroSource(0, false),
  clamp: [api.clampIndex(-4, 5), api.clampIndex(9, 5), api.clampIndex(2, 5)],
  nearest: api.sectionIndexFor(140, [0, 100, 200, 300, 400]),
  alertReturned: api.showAvailableSoon({ alert: (message) => messages.push(message) }),
  alertMessages: messages,
  alertWithoutAlert: api.showAvailableSoon({}),
};
process.stdout.write(JSON.stringify(out));
"""
        result = self._run_node(harness, str(HOME_JS))
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)

        expected_svg = list(SVG_SOURCES)
        self.assertEqual(data["svgSources"], expected_svg)
        self.assertEqual(data["heroSources"], expected_svg)
        self.assertIsNone(data["grid"])

        self.assertEqual(data["firstSvg"], SVG_SOURCES[0])
        self.assertEqual(data["lastSvg"], SVG_SOURCES[-1])
        self.assertEqual(data["gridPick"], SVG_SOURCES[-1])
        self.assertEqual(data["noGridPick"], SVG_SOURCES[-1])

        pool = set(SVG_SOURCES)
        five = data["fiveDistinct"]
        self.assertEqual(len(five), 5)
        self.assertEqual(len(set(five)), 5, "sections must not repeat a background while unused ones remain")
        self.assertTrue(set(five) <= pool)

        six = data["allSix"]
        self.assertEqual(len(six), 6)
        self.assertEqual(set(six), pool, "all and only the six folder SVG engines must be reachable")

        seven = data["sevenPicks"]
        self.assertEqual(len(seven), 7)
        self.assertEqual(set(seven), pool)
        self.assertLess(len(set(seven)), len(seven), "exhausted SVG pools may repeat, never add another source")

        svg_only = data["svgOnlyPlan"]
        self.assertEqual(len(svg_only), 5)
        self.assertTrue(set(svg_only) <= pool)

        self.assertEqual(data["heroAlias"], SVG_SOURCES[0])
        self.assertEqual(data["clamp"], [0, 4, 2])
        self.assertEqual(data["nearest"], 1)

        self.assertTrue(data["alertReturned"])
        self.assertEqual(data["alertMessages"], [ALERT_MESSAGE])
        self.assertFalse(data["alertWithoutAlert"])


if __name__ == "__main__":
    unittest.main()
