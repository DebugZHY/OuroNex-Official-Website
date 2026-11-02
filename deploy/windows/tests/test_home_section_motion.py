"""Static contract tests for the Home section scroll motion.

The manager verifies real computed styles, geometry and screenshots in Chrome
(``_scratch/verify-section-motion.cjs``).  This module pins the source-level
contract those browser checks depend on, so a later edit cannot silently drop
the motion behaviour.  Only ``assets/home.js``, ``assets/home.css`` and
``index.html`` are read: no browser, no server, no network.

Contract under test
-------------------
* ``assets/home.js`` defines one ``MOTION_ITEM_SELECTOR`` whose groups are the
  exact nineteen selectors below, in that order; it marks the matches with
  ``data-motion-item`` at runtime, drives them with an ``IntersectionObserver``
  rooted on ``main#main.home-scroll``, and sets
  ``data-motion-state="in" | "out"``.
* Stagger is real: every item gets an inline ``--motion-delay`` custom property.
* ``body[data-section-motion]`` is ``on`` normally and ``reduced`` when the user
  asks for reduced motion; the reduced path disconnects the observer.
* ``assets/home.css`` owns ``@keyframes onx-section-in`` (enter, ~0.72s,
  staggered) and ``@keyframes onx-section-out`` (exit, ~0.42s, no stagger),
  assigns them per state, and forces items fully visible under
  ``prefers-reduced-motion: reduce``.
* Progressive enhancement: no production markup has to carry motion attributes,
  and the stylesheet hides nothing unless the JS has switched
  ``data-section-motion`` on.
* Safeguards: the JS never writes inline ``opacity``/``transform`` (only custom
  properties), so a missing or interrupted animation cannot leave content
  permanently invisible.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
HOME_JS = REPO_ROOT / "assets" / "home.js"
HOME_CSS = REPO_ROOT / "assets" / "home.css"
INDEX_HTML = REPO_ROOT / "index.html"

SECTION_IDS = ("home", "sida", "price", "business", "about")

# The exact groups the motion layer must watch, in document order.
MOTION_ITEM_GROUPS = (
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
    ".about-intro > h2",
    ".home-footer > .footer-brand-block",
    ".home-footer > .footer-copyright",
    ".home-footer > .footer-content",
)

ENTER_ANIMATION = "onx-section-in"
EXIT_ANIMATION = "onx-section-out"
ENTER_DURATION_RANGE = (0.5, 1.0)  # contract: roughly 0.7s
EXIT_DURATION_RANGE = (0.25, 0.65)  # contract: roughly 0.45s
MOTION_ATTRIBUTES = ("data-motion-item", "data-motion-state", "data-section-motion", "--motion-delay")

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
LINE_COMMENT_RE = re.compile(r"(?<![\\:'\"])//[^\n]*")
DURATION_RE = re.compile(r"(\d*\.?\d+)(ms|s)\b")


# ---------------------------------------------------------------------------
# Source helpers
# ---------------------------------------------------------------------------


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _strip_css_comments(css: str) -> str:
    return COMMENT_RE.sub("", css)


def _strip_js_comments(js: str) -> str:
    return LINE_COMMENT_RE.sub("", COMMENT_RE.sub("", js))


def _squash(text: str) -> str:
    """Drop every whitespace run so selectors compare across formatting."""
    return re.sub(r"\s+", "", text or "")


def _collapse(text: str) -> str:
    """Collapse whitespace runs to one space, keeping statements separable."""
    return re.sub(r"\s+", " ", text or "").strip()


def _brace_body(text: str, open_index: int) -> str:
    """Return the body of the block whose ``{`` sits at ``open_index``."""
    depth = 0
    for index in range(open_index, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[open_index + 1:index]
    return text[open_index + 1:]


def js_text() -> str:
    return _strip_js_comments(_read(HOME_JS))


def css_text() -> str:
    return _strip_css_comments(_read(HOME_CSS))


def html_text() -> str:
    return _read(INDEX_HTML)


def enclosing_function_body(js: str, index: int) -> str:
    """Body of the function declaration that encloses ``index``."""
    start = js.rfind("function ", 0, index)
    if start < 0:
        return ""
    brace = js.find("{", start)
    if brace < 0 or brace > index:
        return ""
    return _brace_body(js, brace)


def function_named(js: str, name: str) -> str:
    if not name:
        return ""
    match = re.search(r"function\s+" + re.escape(name) + r"\s*\(", js)
    if not match:
        return ""
    brace = js.find("{", match.end() - 1)
    if brace < 0:
        return ""
    return _brace_body(js, brace)


def motion_region() -> str:
    """The function that wires the section motion, whatever it is called.

    The nearest ``function`` keyword to a motion marker is usually a small
    helper or a ``forEach`` callback, so the region is chosen by name first and
    then by picking the largest candidate body that still contains both the
    item marker and the observer (while excluding the module factory).
    """
    js = js_text()
    for match in re.finditer(r"function\s+(\w*[Mm]otion\w*)\s*\(", js):
        brace = js.find("{", match.end() - 1)
        if brace < 0:
            continue
        body = _brace_body(js, brace)
        if "data-motion-item" in body and "IntersectionObserver" in body:
            return body
    candidates: list[str] = []
    for needle in (
        "data-motion-item",
        "IntersectionObserver",
        "data-motion-state",
        "--motion-delay",
        "data-section-motion",
    ):
        start = 0
        while True:
            index = js.find(needle, start)
            if index < 0:
                break
            body = enclosing_function_body(js, index)
            if "data-motion-item" in body and "IntersectionObserver" in body:
                candidates.append(body)
            start = index + 1
    limit = int(len(js) * 0.6)
    candidates = [body for body in candidates if len(body) < limit]
    return max(candidates, key=len) if candidates else js


# ---------------------------------------------------------------------------
# CSS helpers
# ---------------------------------------------------------------------------


def split_blocks(text: str) -> list[tuple[str, str]]:
    """Return ``(prelude, body)`` for every brace block, nested bodies intact."""
    blocks: list[tuple[str, str]] = []
    depth = 0
    prelude_start = 0
    body_start = -1
    prelude = ""
    for index, char in enumerate(text):
        if char == "{":
            if depth == 0:
                prelude = text[prelude_start:index].strip()
                body_start = index + 1
            depth += 1
        elif char == "}":
            depth -= 1
            if depth <= 0:
                if body_start >= 0:
                    blocks.append((prelude, text[body_start:index]))
                depth = 0
                body_start = -1
                prelude_start = index + 1
    return blocks


def split_declarations(body: str) -> dict[str, str]:
    """Parse a declaration body into ``{property: value}`` (``!important`` kept)."""
    declarations: dict[str, str] = {}
    depth = 0
    current: list[str] = []
    for char in body:
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        if char == ";" and depth == 0:
            entries = "".join(current)
            current = []
            if ":" in entries:
                prop, _, value = entries.partition(":")
                declarations[prop.strip().lower()] = re.sub(r"\s+", " ", value.strip().lower())
            continue
        current.append(char)
    entries = "".join(current)
    if ":" in entries:
        prop, _, value = entries.partition(":")
        declarations[prop.strip().lower()] = re.sub(r"\s+", " ", value.strip().lower())
    return declarations


def normalise_selector(selector: str) -> str:
    """Lower-case, unquoted, whitespace-free selector text for substring checks."""
    text = selector.lower().replace('"', "").replace("'", "")
    return re.sub(r"\s+", "", text)


class CssRule:
    def __init__(self, kind: str, prelude: str, body: str, media: str) -> None:
        self.kind = kind
        self.prelude = prelude
        self.body = body
        self.media = media
        self.selectors = (
            [normalise_selector(part) for part in prelude.split(",") if part.strip()]
            if kind == "rule"
            else []
        )
        self.declarations = split_declarations(body) if kind == "rule" else {}
        self.frames = (
            {frame.strip(): split_declarations(frame_body) for frame, frame_body in split_blocks(body)}
            if kind == "keyframes"
            else {}
        )
        self.name = prelude.strip()

    def value(self, prop: str) -> str:
        """Declaration value without ``!important``."""
        return self.declarations.get(prop, "").replace("!important", "").strip()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"CssRule({self.kind}, {self.prelude!r}, media={self.media!r})"


def css_rules() -> list[CssRule]:
    def collect(text: str, media: str) -> list[CssRule]:
        found: list[CssRule] = []
        for prelude, body in split_blocks(text):
            lowered = prelude.strip().lower()
            if lowered.startswith("@media"):
                found.extend(collect(body, prelude.strip()))
            elif lowered.startswith("@keyframes") or lowered.startswith("@-webkit-keyframes"):
                found.append(CssRule("keyframes", prelude.strip(), body, media))
            elif lowered.startswith("@"):
                continue
            else:
                found.append(CssRule("rule", prelude.strip(), body, media))
        return found

    return collect(css_text(), "")


def style_rules() -> list[CssRule]:
    return [rule for rule in css_rules() if rule.kind == "rule"]


def keyframes(name: str) -> CssRule | None:
    for rule in css_rules():
        if rule.kind != "keyframes":
            continue
        if rule.name.lower().split()[-1].strip() == name:
            return rule
    return None


def rules_for(predicate) -> list[CssRule]:
    return [rule for rule in style_rules() if predicate(rule)]


def selector_has(rule: CssRule, fragment: str) -> bool:
    target = normalise_selector(fragment)
    return any(target in selector for selector in rule.selectors)


def duration_seconds(value: str) -> float | None:
    match = DURATION_RE.search(value or "")
    if not match:
        return None
    amount = float(match.group(1))
    return amount / 1000.0 if match.group(2) == "ms" else amount


def animation_value(rule: CssRule) -> str:
    """The ``animation`` shorthand or ``animation-name`` of a rule."""
    shorthand = rule.value("animation")
    if shorthand and shorthand != "none":
        return shorthand
    return rule.value("animation-name")


# ---------------------------------------------------------------------------
# 1. The item selector contract
# ---------------------------------------------------------------------------


class MotionItemSelectorTest(unittest.TestCase):
    """The JS must watch exactly the agreed selector groups, in order."""

    def setUp(self) -> None:
        self.js = js_text()
        self.squashed = _squash(self.js)

    def test_motion_item_selector_constant_exists(self) -> None:
        self.assertRegex(
            self.js,
            r"MOTION_ITEM_SELECTOR\s*=",
            "assets/home.js must define a MOTION_ITEM_SELECTOR constant",
        )

    def test_every_contract_group_is_present_in_order(self) -> None:
        positions = []
        for group in MOTION_ITEM_GROUPS:
            needle = _squash(group)
            position = self.squashed.find(needle)
            self.assertNotEqual(
                position,
                -1,
                f"assets/home.js is missing the motion group {group!r}",
            )
            positions.append(position)
        self.assertEqual(
            positions,
            sorted(positions),
            "the motion groups must stay in the documented reading order",
        )

    def test_groups_are_joined_into_one_selector(self) -> None:
        index = self.js.find("MOTION_ITEM_SELECTOR")
        self.assertGreater(index, -1)
        window = _collapse(self.js[index:index + 1600])
        self.assertIn(
            ".join(",
            window,
            "MOTION_ITEM_SELECTOR must join every group into one selector list",
        )

    def test_groups_are_all_matched_against_the_document(self) -> None:
        region = motion_region()
        self.assertTrue(region, "the motion wiring function must exist")
        self.assertRegex(
            region,
            r"querySelectorAll\(\s*MOTION_ITEM_SELECTOR\s*\)",
            "the motion layer must resolve MOTION_ITEM_SELECTOR against the document",
        )


# ---------------------------------------------------------------------------
# 2. The JS state machine
# ---------------------------------------------------------------------------


class MotionJsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.js = js_text()
        self.region = motion_region()

    def test_items_are_marked_at_runtime(self) -> None:
        self.assertTrue(self.region, "the motion wiring function must exist")
        self.assertRegex(
            self.region,
            r"setAttribute\(\s*['\"]data-motion-item['\"]",
            "items must be marked with data-motion-item by the JS, not by the markup",
        )

    def test_uses_intersection_observer(self) -> None:
        self.assertRegex(
            self.region,
            r"new\s+[\w.$]*IntersectionObserver\s*\(",
            "the motion layer must use an IntersectionObserver",
        )

    def test_observer_is_rooted_on_the_home_scroll_container(self) -> None:
        roots = re.findall(r"root\s*:\s*([\w.$]+)", self.region)
        scroll_bindings = set(
            re.findall(
                r"([\w$]+)\s*=\s*[\w.$]*querySelector\(\s*['\"]main#main\.home-scroll['\"]",
                self.region,
            )
        )
        inline_root = re.search(
            r"root\s*:\s*[\w.$]*querySelector\(\s*['\"]main#main\.home-scroll['\"]",
            self.region,
        )
        rooted = bool(roots) and bool(scroll_bindings) and bool(set(roots) & scroll_bindings)
        self.assertTrue(
            rooted or bool(inline_root),
            "root must be the home scroll container, found root(s) "
            f"{roots} and binding(s) {sorted(scroll_bindings)}",
        )

    def test_sets_in_and_out_states(self) -> None:
        self.assertRegex(
            self.region,
            r"setAttribute\(\s*['\"]data-motion-state['\"]",
            "the motion layer must publish data-motion-state",
        )
        for value in ("in", "out"):
            self.assertIn(
                f"setMotionState(target, '{value}')",
                self.region,
                f"the state machine must publish data-motion-state='{value}'",
            )

    def test_writes_the_stagger_as_a_custom_property(self) -> None:
        self.assertIn(
            "--motion-delay",
            self.region,
            "the per-item stagger must be published as --motion-delay",
        )
        self.assertRegex(
            self.region,
            r"setProperty\(\s*['\"]--motion-delay['\"]",
            "the stagger must be written inline with setProperty('--motion-delay', ...)",
        )

    def test_publishes_on_and_reduced_modes(self) -> None:
        self.assertRegex(
            self.region,
            r"setAttribute\(\s*['\"]data-section-motion['\"]\s*,\s*['\"]on['\"]",
            "the normal path must set data-section-motion='on'",
        )
        self.assertRegex(
            self.region,
            r"setAttribute\(\s*['\"]data-section-motion['\"]\s*,\s*['\"]reduced['\"]",
            "the reduced path must set data-section-motion='reduced'",
        )

    def test_reduced_motion_is_driven_by_match_media(self) -> None:
        self.assertRegex(
            self.region,
            r"matchMedia\(\s*['\"]\(prefers-reduced-motion:\s*reduce\)['\"]\s*\)",
            "the reduced path must come from matchMedia('(prefers-reduced-motion: reduce)')",
        )


# ---------------------------------------------------------------------------
# 3. Safeguards
# ---------------------------------------------------------------------------


class MotionSafeguardTest(unittest.TestCase):
    def setUp(self) -> None:
        self.js = js_text()
        self.region = motion_region()

    def test_no_inline_opacity_or_transform_is_written(self) -> None:
        self.assertIsNone(
            re.search(r"style\.cssText\s*=", self.js),
            "assets/home.js must not assign style.cssText",
        )
        for prop in ("opacity", "transform", "translate", "scale"):
            self.assertIsNone(
                re.search(r"\.style\.\s*" + prop + r"\s*=", self.js),
                f"assets/home.js must not write .style.{prop}; that could stick permanently",
            )
            self.assertIsNone(
                re.search(r"setProperty\(\s*['\"]" + prop + r"['\"]", self.js),
                f"assets/home.js must not set {prop} inline; that could stick permanently",
            )
        for match in re.finditer(r"setProperty\(\s*(['\"])(.+?)\1", self.js):
            self.assertTrue(
                match.group(2).startswith("--"),
                f"only custom properties may be set inline, found {match.group(2)!r}",
            )

    def test_reduced_motion_path_disconnects_the_observer(self) -> None:
        collapsed = _collapse(self.region)
        branch = re.search(
            r"if\s*\(\s*[\w.$]+\.matches\s*\)\s*\{?\s*(\w+)\(\s*\)\s*;",
            collapsed,
        )
        self.assertIsNotNone(
            branch,
            "the motion layer must branch on the reduced-motion media query",
        )
        disable_name = branch.group(1)
        disable_body = function_named(self.js, disable_name) or self.region
        self.assertRegex(
            disable_body,
            r"disconnect\w*\(",
            f"the reduced path ({disable_name}) must disconnect the observer",
        )
        self.assertNotRegex(
            disable_body,
            r"new\s+[\w.$]*IntersectionObserver\s*\(",
            f"the reduced path ({disable_name}) must not create an observer",
        )
        self.assertIn(
            "reduced",
            disable_body,
            f"the reduced path ({disable_name}) must publish data-section-motion='reduced'",
        )

    def test_normal_path_observes_after_the_decision(self) -> None:
        collapsed = _collapse(self.region)
        self.assertRegex(
            collapsed,
            r"else\s*\{?\s*\w+\(\s*\)\s*;",
            "the non-reduced path must be the only place that starts observing",
        )


# ---------------------------------------------------------------------------
# 4. The CSS animation contract
# ---------------------------------------------------------------------------


class MotionKeyframeTest(unittest.TestCase):
    def test_enter_keyframes_exist(self) -> None:
        rule = keyframes(ENTER_ANIMATION)
        self.assertIsNotNone(rule, f"assets/home.css must define @keyframes {ENTER_ANIMATION}")
        frames = rule.frames
        self.assertTrue(frames, f"@keyframes {ENTER_ANIMATION} must have frames")
        opacities = [frame.get("opacity", "") for frame in frames.values()]
        self.assertIn("0", opacities, f"@keyframes {ENTER_ANIMATION} must start from opacity 0")
        self.assertIn("1", opacities, f"@keyframes {ENTER_ANIMATION} must end at opacity 1")
        first = frames[sorted(frames, key=lambda key: float(key.strip('%')))[0]]
        last = frames[sorted(frames, key=lambda key: float(key.strip('%')))[-1]]
        self.assertEqual(first.get("opacity"), "0", f"@keyframes {ENTER_ANIMATION} must begin invisible")
        self.assertEqual(last.get("opacity"), "1", f"@keyframes {ENTER_ANIMATION} must end visible")
        self.assertEqual(last.get("transform"), "none", f"@keyframes {ENTER_ANIMATION} must settle with no transform")
        self.assertTrue(
            any("transform" in frame for frame in frames.values()),
            f"@keyframes {ENTER_ANIMATION} must move the item into place",
        )

    def test_exit_keyframes_exist(self) -> None:
        rule = keyframes(EXIT_ANIMATION)
        self.assertIsNotNone(rule, f"assets/home.css must define @keyframes {EXIT_ANIMATION}")
        frames = rule.frames
        self.assertTrue(frames, f"@keyframes {EXIT_ANIMATION} must have frames")
        ordered = [frames[key] for key in sorted(frames, key=lambda key: float(key.strip('%')))]
        self.assertEqual(ordered[0].get("opacity"), "1", f"@keyframes {EXIT_ANIMATION} must start visible")
        self.assertEqual(ordered[-1].get("opacity"), "0", f"@keyframes {EXIT_ANIMATION} must end invisible")


class MotionRuleTest(unittest.TestCase):
    def enter_rules(self) -> list[CssRule]:
        return rules_for(
            lambda rule: selector_has(rule, "[data-motion-item]")
            and selector_has(rule, '[data-motion-state="in"]')
        )

    def exit_rules(self) -> list[CssRule]:
        return rules_for(
            lambda rule: selector_has(rule, "[data-motion-item]")
            and selector_has(rule, '[data-motion-state="out"]')
        )

    def test_enter_rule_assigns_the_enter_animation(self) -> None:
        rules = self.enter_rules()
        self.assertTrue(rules, "assets/home.css must style [data-motion-item][data-motion-state=in]")
        matches = [rule for rule in rules if ENTER_ANIMATION in animation_value(rule)]
        self.assertTrue(matches, f"the enter state must assign the {ENTER_ANIMATION} animation")
        for rule in matches:
            fill = rule.value("animation-fill-mode") or rule.value("animation")
            self.assertIn(
                "both",
                fill,
                f"the enter animation needs fill-mode 'both' so the item cannot flash back ({rule.prelude!r})",
            )
            duration = duration_seconds(rule.value("animation") or rule.value("animation-duration"))
            self.assertIsNotNone(duration, "the enter animation must declare a duration")
            self.assertGreaterEqual(duration, ENTER_DURATION_RANGE[0], "enter duration is shorter than ~0.7s")
            self.assertLessEqual(duration, ENTER_DURATION_RANGE[1], "enter duration is longer than ~0.7s")

    def test_enter_rule_is_staggered_by_motion_delay(self) -> None:
        rules = [
            rule
            for rule in self.enter_rules()
            if ENTER_ANIMATION in animation_value(rule)
        ]
        self.assertTrue(rules, "the enter state must assign the enter animation")
        self.assertTrue(
            any("var(--motion-delay" in rule.value("animation-delay") for rule in rules),
            "the enter animation must be delayed by var(--motion-delay)",
        )

    def test_exit_rule_assigns_the_exit_animation_without_stagger(self) -> None:
        rules = self.exit_rules()
        self.assertTrue(rules, "assets/home.css must style [data-motion-item][data-motion-state=out]")
        matches = [rule for rule in rules if EXIT_ANIMATION in animation_value(rule)]
        self.assertTrue(matches, f"the exit state must assign the {EXIT_ANIMATION} animation")
        for rule in matches:
            self.assertNotIn(
                "var(--motion-delay",
                rule.value("animation-delay") + rule.value("animation"),
                "the exit must not be staggered",
            )
            duration = duration_seconds(rule.value("animation") or rule.value("animation-duration"))
            self.assertIsNotNone(duration, "the exit animation must declare a duration")
            self.assertGreaterEqual(duration, EXIT_DURATION_RANGE[0], "exit duration is shorter than ~0.45s")
            self.assertLessEqual(duration, EXIT_DURATION_RANGE[1], "exit duration is longer than ~0.45s")

    def test_animations_only_apply_after_the_js_switches_motion_on(self) -> None:
        for rule in self.enter_rules() + self.exit_rules():
            self.assertTrue(
                selector_has(rule, "data-section-motion"),
                f"motion rules must be scoped to body[data-section-motion], found {rule.prelude!r}",
            )

    def test_plan_strip_does_not_show_a_vertical_scrollbar_during_entry(self) -> None:
        rules = [
            rule
            for rule in rules_for(lambda rule: selector_has(rule, ".plan-strip"))
            if rule.value("overflow-x") == "auto"
        ]
        self.assertTrue(rules, "the horizontally scrolling plan strip must be styled")
        for rule in rules:
            self.assertEqual(
                rule.value("overflow-y"),
                "hidden",
                "the plan strip must clip the cards' vertical entrance movement instead of "
                "turning the visible overflow into a vertical scrollbar",
            )


class ReducedMotionCssTest(unittest.TestCase):
    def reduced_attribute_rules(self) -> list[CssRule]:
        return rules_for(
            lambda rule: selector_has(rule, "[data-motion-item]")
            and "data-section-motion=reduced" in "".join(rule.selectors)
        )

    def reduced_media_rules(self) -> list[CssRule]:
        return [
            rule
            for rule in style_rules()
            if "prefers-reduced-motion" in rule.media.lower()
            and "reduce" in rule.media.lower()
            and selector_has(rule, "[data-motion-item]")
        ]

    def test_reduced_attribute_rule_keeps_items_visible(self) -> None:
        rules = self.reduced_attribute_rules()
        self.assertTrue(
            rules,
            "assets/home.css must style body[data-section-motion=reduced] [data-motion-item]",
        )
        for rule in rules:
            self.assertEqual(rule.value("opacity"), "1", f"reduced motion must force opacity 1 ({rule.prelude!r})")
            self.assertEqual(rule.value("transform"), "none", f"reduced motion must force transform none ({rule.prelude!r})")
            self.assertIn(
                rule.value("animation"),
                {"", "none"},
                f"reduced motion must disable the animation ({rule.prelude!r})",
            )

    def test_prefers_reduced_motion_block_keeps_items_visible(self) -> None:
        rules = self.reduced_media_rules()
        self.assertTrue(
            rules,
            "assets/home.css needs an @media (prefers-reduced-motion: reduce) rule for [data-motion-item]",
        )
        for rule in rules:
            self.assertEqual(rule.value("opacity"), "1", f"the media block must force opacity 1 ({rule.prelude!r})")
            self.assertEqual(rule.value("transform"), "none", f"the media block must force transform none ({rule.prelude!r})")
            self.assertIn(
                rule.value("animation"),
                {"", "none"},
                f"the media block must disable the animation ({rule.prelude!r})",
            )

    def test_reduced_media_block_is_not_restricted_to_the_on_state(self) -> None:
        for rule in self.reduced_media_rules():
            self.assertNotIn(
                "data-section-motion=on",
                "".join(rule.selectors),
                "the reduced media block must apply regardless of the JS attribute value",
            )


# ---------------------------------------------------------------------------
# 5. Progressive enhancement
# ---------------------------------------------------------------------------


class ProgressiveEnhancementTest(unittest.TestCase):
    def setUp(self) -> None:
        self.html = html_text()

    def test_markup_does_not_carry_motion_attributes(self) -> None:
        for attribute in MOTION_ATTRIBUTES:
            self.assertNotIn(
                attribute,
                self.html,
                f"index.html must not hard-code {attribute}; the motion layer marks items at runtime",
            )

    def test_js_marks_items_instead_of_the_markup(self) -> None:
        self.assertIn("data-motion-item", js_text(), "assets/home.js must own the data-motion-item marking")
        self.assertNotIn("data-motion-item", self.html)

    def test_section_structure_the_contract_depends_on(self) -> None:
        self.assertRegex(
            self.html,
            r"<main[^>]*class=\"home-scroll\"[^>]*id=\"main\"",
            "index.html must keep main.home-scroll#main as the scroll container",
        )
        for section_id in SECTION_IDS:
            self.assertRegex(
                self.html,
                r"data-home-section[^>]*id=\"" + section_id + r"\"",
                f"section #{section_id} must keep data-home-section",
            )
        about_index = self.html.find('id="about"')
        footer_index = self.html.find('<footer class="site-footer"')
        self.assertGreater(about_index, -1, "the About section must exist")
        self.assertGreater(
            footer_index,
            about_index,
            "the footer must live inside the About section (after #about opens)",
        )


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
