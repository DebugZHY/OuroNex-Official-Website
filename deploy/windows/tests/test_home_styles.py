"""Static CSS regression tests for the Home / navigation revisions.

The manager verifies real computed styles, geometry and screenshots in Chrome;
this module pins the exact declarations those checks depend on so a later edit
cannot silently drop them. Only the four stylesheets owned by this change are
read: assets/home.css, assets/site.css, assets/i18n.css and assets/account.css.

Contract under test (shared markup supplied elsewhere):

* `.language-switcher` holds three text-only buttons (public and account).
* The public `[data-signin]` link is a light-blue (#b7ceff) pill with dark text.
* The four primary nav links render at 20px.
* The hero slogan is `SIDA, AI Agent for Engineering.` and the subtitle is two
  block lines at 24px on desktop.
* Hero and download CTAs intentionally use linear gradients, slow breathing
  animations and a pointer-tracked `::before` glow; Customized Service and
  Request early access carry 3px borders; reduced motion disables all of it.
* SIDA renders two equal columns and three detail cards per feature, with no
  central logo or photo.
* Price cards use layered gradients, hairline borders and hover lift; `HK$` and
  `/ month` stay 14px at every breakpoint.
* About renders three equal columns of 4:5 portraits with one concise bio each
  (22px base, 20px on short desktops, 18px on mobile) inside a 1080px layout.
* Every `.home-section` background host lives in the shared `.home-backgrounds`
  stack, which crossfades one active layer at a time.
* The obsolete `.download-dialog` styles are gone.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
ASSETS = REPO_ROOT / "assets"
INDEX_HTML = REPO_ROOT / "index.html"

HOME_CSS = "home.css"
SITE_CSS = "site.css"
I18N_CSS = "i18n.css"
ACCOUNT_CSS = "account.css"
OWNED_SHEETS = (HOME_CSS, SITE_CSS, I18N_CSS, ACCOUNT_CSS)

RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")
COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
LIGHT_BLUE = "#b7ceff"
DARK_TEXT = {"#0b1626", "#080e17", "#0d1623", "#142033"}
LANGUAGE_FONT_STACK = (
    "microsoftyahei,pingfangsc,pingfangtc,hiraginosansgb,"
    "notosanscjksc,notosanssc,sans-serif"
)


def normalized_font_stack(value: str) -> str:
    return re.sub(r"[\s'\"]+", "", value).lower()


# ---------------------------------------------------------------------------
# Minimal, deterministic CSS reader
# ---------------------------------------------------------------------------


def _sheet(name: str) -> str:
    return (ASSETS / name).read_text(encoding="utf-8")


def _normalise_selector(text: str) -> str:
    return re.sub(r"\s+", "", text).lower()


def _split_declarations(body: str) -> list[tuple[str, str]]:
    declarations: list[tuple[str, str]] = []
    depth = 0
    current: list[str] = []
    for char in body:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if char == ";" and depth == 0:
            declarations.append("".join(current))
            current = []
        else:
            current.append(char)
    declarations.append("".join(current))

    parsed: list[tuple[str, str]] = []
    for declaration in declarations:
        declaration = declaration.strip()
        if not declaration or ":" not in declaration:
            continue
        prop, _, value = declaration.partition(":")
        parsed.append(
            (prop.strip().lower(), re.sub(r"\s+", " ", value.strip()).lower())
        )
    return parsed


def rules(name: str) -> list[tuple[list[str], list[tuple[str, str]]]]:
    """Return every style rule as (normalised selectors, ordered declarations).

    Rules nested inside @media are returned too; the media prelude is never
    merged into the selector because selectors cannot contain braces.
    """
    css = COMMENT_RE.sub("", _sheet(name))
    found: list[tuple[list[str], list[tuple[str, str]]]] = []
    for match in RULE_RE.finditer(css):
        selectors = [
            _normalise_selector(part)
            for part in match.group(1).split(",")
            if part.strip()
        ]
        if not selectors or any(part.startswith("@") for part in selectors):
            continue
        declarations = _split_declarations(match.group(2))
        if declarations:
            found.append((selectors, declarations))
    return found


def find_rules(name: str, selector: str) -> list[dict[str, str]]:
    target = _normalise_selector(selector)
    return [
        dict(declarations)
        for selectors, declarations in rules(name)
        if target in selectors
    ]


def find_rule(name: str, selector: str) -> dict[str, str]:
    """Return the merged declarations that apply for a selector.

    Later rules win per property, mirroring the cascade for rules that share
    the selector inside and outside media queries.
    """
    matches = find_rules(name, selector)
    if not matches:
        raise AssertionError(f"{name}: no rule for selector {selector!r}")
    merged: dict[str, str] = {}
    for declarations in matches:
        merged.update(declarations)
    return merged


def rule_with(name: str, selector: str, prop: str) -> dict[str, str]:
    """Return the first rule for ``selector`` that declares ``prop``."""
    for rule in find_rules(name, selector):
        if prop in rule:
            return rule
    raise AssertionError(f"{name}: no {selector!r} rule declares {prop!r}")


def declarations_for(name: str, selector: str, prop: str) -> list[str]:
    """Return every declared value of ``prop`` across the rules of ``selector``."""
    return [
        squash(rule[prop])
        for rule in find_rules(name, selector)
        if prop in rule
    ]


def media_block(name: str, prelude: str) -> str:
    """Return the full ``@media`` block whose prelude starts with ``prelude``."""
    text = _sheet(name)
    start = text.index(prelude)
    depth = 0
    index = text.index("{", start)
    while index < len(text):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
        index += 1
    raise AssertionError(f"{name}: unterminated block {prelude!r}")


def rule_index(name: str, selector: str) -> list[int]:
    """Return the document order of every rule that matches ``selector``."""
    target = _normalise_selector(selector)
    return [
        index
        for index, (selectors, _declarations) in enumerate(rules(name))
        if target in selectors
    ]


def alpha_values(value: str) -> list[float]:
    """Return every rgba() alpha in ``value`` as a float in 0..1."""
    found: list[float] = []
    for digits in re.findall(r"rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(\.\d+|\d+(?:\.\d+)?)\s*\)", value):
        found.append(float(digits))
    return found


def background(declarations: dict[str, str]) -> str:
    return declarations.get("background", declarations.get("background-color", ""))


def squash(value: str) -> str:
    """Drop whitespace so minified values compare predictably."""
    return re.sub(r"\s+", "", value or "")


class CssAssertions(unittest.TestCase):
    def assert_decl(
        self, declarations: dict[str, str], prop: str, expected: str, *, where: str
    ) -> None:
        actual = declarations.get(prop)
        self.assertEqual(
            actual,
            expected,
            f"{where}: expected {prop}: {expected}, found {actual!r}",
        )

    def assert_in(
        self, value: str, allowed: set[str], *, what: str
    ) -> None:
        self.assertIn(
            value, allowed, f"{what}: found {value!r}, expected one of {sorted(allowed)}"
        )

    def assert_transparent(self, declarations: dict[str, str], *, where: str) -> None:
        value = background(declarations)
        self.assertIn(
            value,
            {"transparent", "none", "rgba(0, 0, 0, 0)", "initial"},
            f"{where}: background must not paint a fill, found {value!r}",
        )

    def assert_no_border(self, declarations: dict[str, str], *, where: str) -> None:
        for prop in ("border", "border-color"):
            if prop in declarations:
                self.assertIn(
                    declarations[prop],
                    {"0", "none", "transparent"},
                    f"{where}: {prop} must not draw a border, found {declarations[prop]!r}",
                )


# ---------------------------------------------------------------------------
# 1. Language switchers: three text-only buttons, public and account
# ---------------------------------------------------------------------------


class PublicLanguageSwitcherTest(CssAssertions):
    CONTAINER = ".language-switcher"
    BUTTON = ".language-switcher button"
    HOVER = ".language-switcher button:hover"
    SELECTED = ".language-switcher button[aria-pressed='true']"
    FOCUS = ".language-switcher button:focus-visible"
    STANDALONE = ".language-switcher--standalone"

    def test_container_has_no_pill_border_or_fill(self) -> None:
        container = find_rule(I18N_CSS, self.CONTAINER)
        self.assert_no_border(container, where=self.CONTAINER)
        self.assert_transparent(container, where=self.CONTAINER)
        self.assert_decl(container, "border-radius", "0", where=self.CONTAINER)
        self.assert_decl(container, "box-shadow", "none", where=self.CONTAINER)
        self.assert_decl(container, "padding", "0", where=self.CONTAINER)

    def test_buttons_are_text_only_with_usable_hit_area(self) -> None:
        button = find_rule(I18N_CSS, self.BUTTON)
        self.assert_no_border(button, where=self.BUTTON)
        self.assert_transparent(button, where=self.BUTTON)
        self.assert_decl(button, "border-radius", "0", where=self.BUTTON)
        self.assertIn(
            "var(--muted",
            button.get("color", ""),
            "unselected language buttons must stay muted/readable",
        )
        for prop in ("width", "height"):
            hits = button.get(prop, "")
            px = re.fullmatch(r"(\d+(?:\.\d+)?)px", hits)
            self.assertIsNotNone(px, f"{self.BUTTON}: {prop} must be an explicit px value")
            self.assertGreaterEqual(float(px.group(1)), 30.0, f"{self.BUTTON}: hit area too small")
        self.assert_decl(button, "padding", "0", where=self.BUTTON)

    def test_hover_adds_no_filled_background(self) -> None:
        hover = find_rule(I18N_CSS, self.HOVER)
        self.assert_transparent(hover, where=self.HOVER)
        self.assertIn(
            "var(--ink",
            hover.get("color", ""),
            "hover should brighten the text only",
        )

    def test_selected_state_uses_text_colour_and_weight_only(self) -> None:
        selected = find_rule(I18N_CSS, self.SELECTED)
        self.assert_transparent(selected, where=self.SELECTED)
        self.assert_decl(selected, "box-shadow", "none", where=self.SELECTED)
        colour = selected.get("color", "")
        self.assertTrue(
            "var(--ink" in colour or colour in {"#edf2f8", "#f7faff", "#ffffff"},
            f"{self.SELECTED}: selected state must use a brighter text colour, found {colour!r}",
        )
        weight = selected.get("font-weight", "")
        self.assertTrue(
            weight in {"600", "700", "800", "bold"},
            f"{self.SELECTED}: selected state must be highlighted by weight, found {weight!r}",
        )

    def test_three_language_buttons_share_one_typography_and_one_slot(self) -> None:
        button = find_rule(I18N_CSS, self.BUTTON)
        family = button.get("font-family", "")
        self.assertEqual(
            normalized_font_stack(family),
            LANGUAGE_FONT_STACK,
            f"{self.BUTTON}: keep a fixed CJK-capable sans stack so 繁/简 never "
            f"fall back to a serif face, found {family!r}",
        )
        self.assertNotIn("var(--mono", family, f"{self.BUTTON}: the mono stack has no CJK glyphs")
        self.assertNotIn("monospace", family.lower())
        self.assert_decl(button, "font-size", "12px", where=self.BUTTON)
        self.assert_decl(button, "line-height", "1", where=self.BUTTON)
        self.assert_decl(button, "white-space", "nowrap", where=self.BUTTON)
        self.assertEqual(
            button.get("flex"),
            "0 0 34px",
            f"{self.BUTTON}: the three slots must be fixed and equal, found {button.get('flex')!r}",
        )
        self.assertEqual(
            button.get("width"),
            button.get("height"),
            f"{self.BUTTON}: slots must stay square, found {button.get('width')!r}/{button.get('height')!r}",
        )
        self.assertEqual(
            button.get("min-width"),
            button.get("width"),
            f"{self.BUTTON}: the slot must not shrink for a longer label",
        )

    def test_selected_state_changes_only_colour_and_weight(self) -> None:
        selected = find_rule(I18N_CSS, self.SELECTED)
        for prop in (
            "font",
            "font-family",
            "font-size",
            "line-height",
            "letter-spacing",
            "flex",
            "width",
            "height",
            "min-width",
            "min-height",
            "padding",
        ):
            self.assertNotIn(
                prop,
                selected,
                f"{self.SELECTED}: selection must not move the shared slot ({prop})",
            )

    def test_chinese_locales_do_not_restyle_the_language_slots(self) -> None:
        forbidden = {
            "font",
            "font-family",
            "font-size",
            "line-height",
            "letter-spacing",
            "width",
            "height",
            "flex",
            "padding",
        }
        for selectors, declarations in rules(I18N_CSS):
            if not any("language-switcher" in selector for selector in selectors):
                continue
            if not any(selector.startswith("html[lang") for selector in selectors):
                continue
            for prop, _value in declarations:
                self.assertNotIn(
                    prop,
                    forbidden,
                    f"locale rule must keep the shared slot metrics: {selectors} {prop}",
                )

    def test_focus_visible_remains(self) -> None:
        focus = find_rule(I18N_CSS, self.FOCUS)
        self.assertTrue(
            focus.get("outline", "").startswith("2px solid"),
            f"{self.FOCUS}: focus-visible outline must be preserved",
        )
        self.assert_decl(focus, "outline-offset", "2px", where=self.FOCUS)

    def test_standalone_variant_is_still_fixed_and_unfilled(self) -> None:
        standalone = find_rule(I18N_CSS, self.STANDALONE)
        self.assert_decl(standalone, "position", "fixed", where=self.STANDALONE)
        self.assert_transparent(standalone, where=self.STANDALONE)
        self.assert_decl(standalone, "box-shadow", "none", where=self.STANDALONE)
        self.assert_decl(standalone, "backdrop-filter", "none", where=self.STANDALONE)
        self.assert_no_border(standalone, where=self.STANDALONE)


class AccountLanguageSwitcherTest(CssAssertions):
    CONTAINER = "body.account-page .account-topbar .language-switcher"
    BUTTON = "body.account-page .language-switcher button"
    HOVER = "body.account-page .language-switcher button:hover"
    SELECTED = "body.account-page .language-switcher button[aria-pressed='true']"

    def test_account_overrides_do_not_restore_a_pill(self) -> None:
        container = find_rule(ACCOUNT_CSS, self.CONTAINER)
        self.assert_no_border(container, where=self.CONTAINER)
        self.assert_transparent(container, where=self.CONTAINER)
        self.assert_decl(container, "padding", "0", where=self.CONTAINER)
        self.assert_decl(container, "box-shadow", "none", where=self.CONTAINER)

        button = find_rule(ACCOUNT_CSS, self.BUTTON)
        self.assert_no_border(button, where=self.BUTTON)
        self.assert_transparent(button, where=self.BUTTON)
        self.assert_decl(button, "border-radius", "0", where=self.BUTTON)

    def test_account_hover_and_selected_states_are_text_only(self) -> None:
        hover = find_rule(ACCOUNT_CSS, self.HOVER)
        self.assert_transparent(hover, where=self.HOVER)

        selected = find_rule(ACCOUNT_CSS, self.SELECTED)
        self.assert_transparent(selected, where=self.SELECTED)
        self.assert_decl(selected, "box-shadow", "none", where=self.SELECTED)
        self.assertEqual(
            selected.get("color"),
            "#f7faff",
            f"{self.SELECTED}: selected state must use brighter text",
        )
        self.assertIn(
            selected.get("font-weight", ""),
            {"600", "700", "800"},
            f"{self.SELECTED}: selected state must be highlighted by weight",
        )

    def test_account_language_buttons_use_the_cjk_sans_stack(self) -> None:
        button = find_rule(ACCOUNT_CSS, self.BUTTON)
        family = button.get("font-family", "")
        self.assertEqual(
            normalized_font_stack(family),
            LANGUAGE_FONT_STACK,
            f"{self.BUTTON}: the account switcher must use the same CJK-capable "
            f"sans stack as the public one, found {family!r}",
        )
        self.assertNotIn("var(--account-mono", family)
        self.assertNotIn("monospace", family.lower())

    def test_account_keeps_44px_touch_target_rule(self) -> None:
        widths = {rule.get("width") for rule in find_rules(ACCOUNT_CSS, self.BUTTON)}
        self.assertIn("44px", widths, f"{self.BUTTON}: mobile 44px target must survive")
        heights = {rule.get("height") for rule in find_rules(ACCOUNT_CSS, self.BUTTON)}
        self.assertIn("44px", heights, f"{self.BUTTON}: mobile 44px target must survive")

    def test_account_buttons_share_typography_and_fixed_slots(self) -> None:
        families = {
            rule.get("font-family")
            for rule in find_rules(ACCOUNT_CSS, self.BUTTON)
            if rule.get("font-family")
        }
        self.assertEqual(
            len(families), 1, f"{self.BUTTON}: one font family across locales, found {families}"
        )
        lines = {
            rule.get("line-height")
            for rule in find_rules(ACCOUNT_CSS, self.BUTTON)
            if rule.get("line-height")
        }
        self.assertEqual(
            lines, {"1"}, f"{self.BUTTON}: line-height must stay identical across locales, found {lines}"
        )
        sizes = {
            rule.get("font-size")
            for rule in find_rules(ACCOUNT_CSS, self.BUTTON)
            if rule.get("font-size")
        }
        self.assertTrue(
            sizes <= {"11px", "12px"},
            f"{self.BUTTON}: only the responsive size may differ, found {sizes}",
        )
        for rule in find_rules(ACCOUNT_CSS, self.BUTTON):
            if "width" in rule:
                self.assertRegex(
                    rule["width"],
                    r"^\d+px$",
                    f"{self.BUTTON}: slots must be fixed px, found {rule['width']!r}",
                )
                self.assertEqual(
                    rule.get("height"),
                    rule["width"],
                    f"{self.BUTTON}: slots must stay square within each breakpoint",
                )

    def test_account_selected_state_does_not_move_the_slot(self) -> None:
        selected = find_rule(ACCOUNT_CSS, self.SELECTED)
        for prop in (
            "font",
            "font-family",
            "font-size",
            "line-height",
            "width",
            "height",
            "padding",
        ):
            self.assertNotIn(prop, selected, f"{self.SELECTED}: {prop} must not change on selection")

    def test_no_gradients_introduced_on_account_components(self) -> None:
        css = COMMENT_RE.sub("", _sheet(ACCOUNT_CSS)).lower()
        self.assertNotIn(
            "gradient(",
            css,
            "account components must stay gradient-free",
        )


# ---------------------------------------------------------------------------
# 2. Public "Log in" pill: light blue with dark readable text
# ---------------------------------------------------------------------------


class SignInPillTest(CssAssertions):
    SIGNIN = ".desktop-nav .nav-secondary [data-signin]:not(.is-authenticated)"
    SIGNIN_HOVER = ".desktop-nav .nav-secondary [data-signin]:not(.is-authenticated):hover"
    AVATAR = ".home-page .desktop-nav .nav-secondary [data-signin].is-authenticated"
    TOKEN = "var(--nav-pill-height)"

    def test_signin_wears_the_outline_cta_pill(self) -> None:
        variants = find_rules(SITE_CSS, self.SIGNIN)
        self.assertTrue(variants, f"{SITE_CSS}: no rule for {self.SIGNIN!r}")
        self.assertTrue(
            any(rule.get("border-radius") == "999px" for rule in variants),
            f"{self.SIGNIN}: existing pill shape (border-radius: 999px) must be preserved",
        )
        outlined = [rule for rule in variants if rule.get("border") == "1px solid #7894c9"]
        self.assertTrue(
            outlined, f"{self.SIGNIN}: rest border must stay the 1px #7894c9 outline, found "
            f"{[rule.get('border') for rule in variants]}",
        )
        for rule in outlined:
            self.assert_in(
                rule.get("color", ""),
                DARK_TEXT | {"var(--ink)"},
                what=f"{self.SIGNIN} text colour",
            )
            self.assertNotEqual(
                background(rule),
                LIGHT_BLUE,
                f"{self.SIGNIN}: Log in is the quiet outline pill, not the filled one",
            )
            self.assertIn(
                "linear-gradient(115deg",
                background(rule),
                f"{self.SIGNIN}: the pill shares the hero CTA gradient, found "
                f"{background(rule)!r}",
            )

    def test_signin_hover_uses_the_shared_cta_ring(self) -> None:
        hover = find_rule(SITE_CSS, self.SIGNIN_HOVER)
        self.assertEqual(
            hover.get("border-color"),
            "var(--cta-ring,#c2d7ff)",
            f"{self.SIGNIN_HOVER}: hover must take the shared CTA ring colour",
        )
        self.assertIn(
            "box-shadow",
            hover,
            f"{self.SIGNIN_HOVER}: hover keeps the shared lifted shadow",
        )
        self.assertNotEqual(
            background(hover),
            LIGHT_BLUE,
            f"{self.SIGNIN_HOVER}: hover must not repaint the pill light blue",
        )

    def test_signin_pill_keeps_its_height_and_label_metrics(self) -> None:
        variants = find_rules(SITE_CSS, self.SIGNIN)
        heights = {rule.get("height") for rule in variants if rule.get("height")}
        self.assertEqual(
            heights,
            {"52px", "50px"},
            f"{self.SIGNIN}: the pill is 52px tall and only the mobile block trims it to 50px, "
            f"found {sorted(h for h in heights if h)}",
        )
        base = next(rule for rule in variants if rule.get("height") == "52px")
        self.assertEqual(
            base.get("min-height"), "52px", f"{self.SIGNIN}: the height must not collapse"
        )
        self.assert_decl(base, "white-space", "nowrap", where=self.SIGNIN)
        self.assert_decl(base, "justify-content", "center", where=self.SIGNIN)
        self.assertRegex(
            base.get("padding", ""),
            r"^\d+px \d+px$",
            f"{self.SIGNIN}: the pill is content-sized with a horizontal padding, found "
            f"{base.get('padding')!r}",
        )

    def test_login_keeps_its_token_while_the_avatar_is_enlarged(self) -> None:
        token = find_rule(SITE_CSS, ":root").get("--nav-pill-height")
        self.assertIsNotNone(
            token, f"{SITE_CSS}: --nav-pill-height must be declared once for the Log in pill"
        )
        self.assertRegex(
            token, r"^\d+px$", f"{SITE_CSS}: token must be a px height, found {token!r}"
        )

        signin = next(
            rule
            for rule in find_rules(SITE_CSS, self.SIGNIN)
            if rule.get("height") == "52px"
        )
        for prop in ("height", "min-height"):
            self.assertEqual(
                signin.get(prop),
                "52px",
                f"{self.SIGNIN}: {prop} follows the trimmed 52px pill",
            )

        avatar = find_rule(HOME_CSS, self.AVATAR)
        for prop in ("width", "height", "min-width", "min-height"):
            self.assertEqual(
                avatar.get(prop),
                "48px",
                f"{self.AVATAR}: {prop} must be the enlarged 48px circle",
            )
        self.assert_decl(avatar, "border-radius", "50%", where=self.AVATAR)
        self.assertEqual(
            avatar.get("aspect-ratio"),
            "1",
            f"{self.AVATAR}: the avatar must stay a true circle",
        )
        self.assert_decl(avatar, "padding", "0", where=self.AVATAR)
        self.assert_decl(avatar, "overflow", "hidden", where=self.AVATAR)
        self.assertIn(
            "var(--accent-strong)",
            background(avatar),
            f"{self.AVATAR}: avatar fill must stay accent, found {background(avatar)!r}",
        )
        for rule in find_rules(HOME_CSS, self.AVATAR):
            self.assertNotEqual(
                background(rule),
                LIGHT_BLUE,
                f"{self.AVATAR}: avatar must not inherit the light-blue pill fill",
            )

    def test_avatar_is_48px_at_every_breakpoint(self) -> None:
        for rule in find_rules(HOME_CSS, self.AVATAR):
            for prop in ("width", "height", "min-width"):
                if prop not in rule:
                    continue
                self.assertEqual(
                    rule[prop], "48px",
                    f"{self.AVATAR}: {prop} must stay 48px, found {rule[prop]!r}",
                )
        sizes = set()
        for selectors, declarations in rules(HOME_CSS):
            if selectors != [_normalise_selector(self.AVATAR)]:
                continue
            for prop, value in declarations:
                if prop in {"width", "height", "min-width"}:
                    sizes.add(value)
        self.assertTrue(
            sizes <= {"48px"},
            f"{self.AVATAR}: the avatar must stay at the enlarged 48px size, found {sorted(sizes)}",
        )

    def test_avatar_image_and_initials_still_fill_the_circle(self) -> None:
        image = find_rule(HOME_CSS, self.AVATAR + " img")
        self.assert_decl(image, "object-fit", "cover", where=self.AVATAR + " img")
        self.assert_decl(image, "width", "100%!important", where=self.AVATAR + " img")
        self.assert_decl(image, "height", "100%!important", where=self.AVATAR + " img")
        initials = find_rule(HOME_CSS, self.AVATAR + " .nav-initials")
        self.assert_decl(initials, "width", "100%!important", where=self.AVATAR + " .nav-initials")
        self.assert_decl(initials, "height", "100%!important", where=self.AVATAR + " .nav-initials")
        self.assert_decl(initials, "font-size", "20px!important", where=self.AVATAR + " .nav-initials")

    def test_authenticated_avatar_rules_survive_light_blue_pill(self) -> None:
        avatar = find_rule(HOME_CSS, self.AVATAR)
        self.assert_decl(avatar, "border-radius", "50%", where=self.AVATAR)
        self.assertIn(
            "var(--accent-strong)",
            background(avatar),
            f"{self.AVATAR}: avatar fill must stay accent, found {background(avatar)!r}",
        )
        for rule in find_rules(HOME_CSS, self.AVATAR):
            self.assertNotEqual(
                background(rule),
                LIGHT_BLUE,
                f"{self.AVATAR}: avatar must not inherit the light-blue pill fill",
            )
        self.assert_decl(
            find_rule(HOME_CSS, self.AVATAR + " img"),
            "object-fit",
            "cover",
            where=self.AVATAR + " img",
        )


class HomeLanguageSwitcherScaleTest(CssAssertions):
    LANG = ".home-page .desktop-nav .nav-secondary .language-switcher"
    BUTTON = LANG + " button"

    def test_home_language_labels_are_20px(self) -> None:
        button = find_rule(HOME_CSS, self.BUTTON)
        self.assert_decl(button, "font-size", "20px", where=self.BUTTON)

    def test_home_language_slots_grow_with_the_20px_labels(self) -> None:
        button = find_rule(HOME_CSS, self.BUTTON)
        for prop in ("width", "height"):
            self.assert_decl(button, prop, "40px", where=self.BUTTON)
        self.assertEqual(
            button.get("min-width"), button.get("width"),
            f"{self.BUTTON}: language slots must stay equal",
        )
        self.assertEqual(
            button.get("flex"), "0 0 40px",
            f"{self.BUTTON}: fixed equal slots keep the three labels aligned",
        )
        self.assert_decl(find_rule(HOME_CSS, self.LANG), "gap", "6px", where=self.LANG)


# ---------------------------------------------------------------------------
# 3. Section 2 download rows
# ---------------------------------------------------------------------------


class PriceTypographyTest(CssAssertions):
    def test_plan_titles_and_prices_use_the_sans_display_font(self) -> None:
        for selector in (".plan-mini h2", ".plan-price"):
            rule = find_rule(HOME_CSS, selector)
            self.assert_decl(rule, "font-family", "var(--display)", where=selector)
            self.assertNotIn("serif", rule.get("font-family", "").lower())


class HeroActionsTest(CssAssertions):
    SHARED = ".hero-actions .button,.hero-actions .button-outline"
    PRIMARY = ".hero-actions .button"
    OUTLINE = ".hero-actions .button-outline"
    GLOW = ".hero-actions .button::before"
    GLOW_HOVER = ".hero-actions .button:hover::before"

    def test_both_actions_use_the_download_pill_shape(self) -> None:
        for selector in (self.PRIMARY, self.OUTLINE):
            shared = find_rule(HOME_CSS, selector)
            self.assert_decl(shared, "border-radius", "999px", where=selector)

    def test_explore_uses_a_gradient_cta_with_20px_text_at_every_width(self) -> None:
        primary = rule_with(HOME_CSS, self.PRIMARY, "background")
        fill = squash(background(primary))
        self.assertTrue(
            fill.startswith("linear-gradient("),
            f"{self.PRIMARY}: expected the intentional linear-gradient fill, found {fill!r}",
        )
        self.assert_decl(primary, "background-size", "190% 190%", where=self.PRIMARY)
        self.assertIn(
            "onx-cta-primary-breathe",
            primary.get("animation", ""),
            f"{self.PRIMARY}: the slow breathing animation is part of the design",
        )
        self.assert_in(primary.get("color", ""), DARK_TEXT, what=f"{self.PRIMARY} text colour")
        self.assertIn(
            "20px",
            declarations_for(HOME_CSS, self.PRIMARY, "font-size"),
            f"{self.PRIMARY}: explore keeps 20px text",
        )

    def test_actions_use_fixed_download_heights(self) -> None:
        rules = find_rules(HOME_CSS, self.PRIMARY)
        heights = [rule["height"] for rule in rules if "height" in rule]
        self.assertEqual(heights, ["60px", "56px"], heights)
        for rule in rules:
            if "height" in rule:
                self.assertEqual(rule.get("min-height"), "0", rule)

    def test_explore_arrow_keeps_a_tight_gap_and_does_not_slide_on_hover(self) -> None:
        rules = find_rules(HOME_CSS, self.PRIMARY)
        self.assertTrue(
            any(rule.get("gap") == "10px" and rule.get("padding-inline") == "24px" for rule in rules),
            f"{self.PRIMARY}: missing compact 10px gap and 24px inline padding",
        )
        arrow = find_rule(HOME_CSS, f"{self.PRIMARY} span[aria-hidden]")
        self.assert_decl(arrow, "transition", "none", where="hero CTA arrow")
        hover = find_rule(HOME_CSS, f"{self.PRIMARY}:hover span[aria-hidden]")
        self.assert_decl(hover, "transform", "none", where="hero CTA arrow (hover)")

    def test_customized_service_keeps_its_dark_gradient_and_thin_outline(self) -> None:
        outline = rule_with(HOME_CSS, self.OUTLINE, "border")
        self.assert_decl(outline, "border", "1px solid #7894c9", where=self.OUTLINE)
        fill = squash(background(outline))
        self.assertTrue(
            fill.startswith("linear-gradient("),
            f"{self.OUTLINE}: expected the dark linear-gradient fill, found {fill!r}",
        )
        self.assertIn(
            "onx-cta-outline-breathe",
            outline.get("animation", ""),
            f"{self.OUTLINE}: the slow breathing animation is part of the design",
        )

    def test_ctas_share_the_pointer_tracked_glow(self) -> None:
        shared = rule_with(HOME_CSS, self.PRIMARY, "--mx")
        self.assert_decl(shared, "--mx", "50%", where="shared CTA glow origin")
        self.assert_decl(shared, "--my", "50%", where="shared CTA glow origin")
        glow = find_rule(HOME_CSS, self.GLOW)
        self.assert_decl(glow, "opacity", "0", where="CTA glow")
        self.assertIn(
            "radial-gradient(",
            squash(background(glow)),
            "the CTA glow is a radial gradient",
        )
        self.assertIn("var(--mx) var(--my)", background(glow), "glow follows the pointer")
        hover_glow = find_rule(HOME_CSS, self.GLOW_HOVER)
        self.assert_decl(hover_glow, "opacity", "1", where="CTA glow on hover")
        hover = rule_with(HOME_CSS, f"{self.PRIMARY}:hover", "transform")
        self.assert_decl(hover, "transform", "none", where=f"{self.PRIMARY}:hover")
        self.assertIn("box-shadow", hover, f"{self.PRIMARY}:hover: expected the lift shadow")
        self.assert_decl(hover, "border-color", "var(--cta-ring,#c2d7ff)", where=f"{self.PRIMARY}:hover")

    def test_hover_ring_adds_two_visual_pixels_without_box_metrics(self) -> None:
        pairs = (
            (self.PRIMARY, "0 solid var(--cta-ring,#c2d7ff)"),
            (self.OUTLINE, "0 solid var(--cta-ring,#c2d7ff)"),
            (".sida-section .download-actions .button", "0 solid var(--cta-ring,#c2d7ff)"),
            (".sida-section .download-actions .early-access", "0 solid var(--cta-ring,#c2d7ff)"),
        )
        for base, border in pairs:
            with self.subTest(selector=base):
                for rule in find_rules(HOME_CSS, f"{base}:hover"):
                    self.assertNotIn("border-width", rule, f"{base}: hover must not change border-width")
                    self.assertNotIn("padding", rule, f"{base}: hover must not change padding")
                ring = rule_with(HOME_CSS, f"{base}::after", "border")
                self.assert_decl(ring, "border", border, where=f"{base}::after")
                self.assert_decl(ring, "position", "absolute", where=f"{base}::after")
                hover_ring = rule_with(HOME_CSS, f"{base}:hover::after", "border-width")
                self.assert_decl(hover_ring, "border-width", "2px", where=f"{base}:hover::after")
                self.assert_decl(hover_ring, "opacity", "1", where=f"{base}:hover::after")
        light = find_rule(HOME_CSS, self.PRIMARY)
        dark = find_rule(HOME_CSS, self.OUTLINE)
        self.assert_decl(light, "--cta-ring", "#ffffff", where=self.PRIMARY)
        self.assert_decl(dark, "--cta-ring", "#c2d7ff", where=self.OUTLINE)

    def test_ctas_use_translucent_fills_and_a_downward_shadow(self) -> None:
        for selector in (self.PRIMARY, self.OUTLINE):
            with self.subTest(selector=selector):
                fill = squash(background(rule_with(HOME_CSS, selector, "background")))
                self.assertIn("rgba(", fill, f"{selector}: fills must keep 25% transparency")
                self.assertIn(".75", fill, f"{selector}: fills must sit at 75% opacity")
        shared = rule_with(HOME_CSS, self.PRIMARY, "--mx")
        self.assertTrue(
            shared.get("box-shadow", "").startswith("0 12px 26px"),
            f"CTA rest state needs a downward shadow, found {shared.get('box-shadow')!r}",
        )

    def test_both_breathing_keyframes_exist(self) -> None:
        # Shared with the header pills, so the keyframes now live in site.css.
        shared = _sheet(HOME_CSS) + _sheet(SITE_CSS)
        for name in ("onx-cta-primary-breathe", "onx-cta-outline-breathe"):
            with self.subTest(keyframes=name):
                self.assertIn(f"@keyframes {name}", shared)

    def test_reduced_motion_disables_cta_animation_glow_and_transform(self) -> None:
        block = media_block(HOME_CSS, "@media(prefers-reduced-motion:reduce)")
        self.assertIn("animation:none!important", block)
        self.assertIn("::before{display:none}", block)
        self.assertIn("transform:none!important", block)
        for selector in (self.PRIMARY, self.OUTLINE):
            with self.subTest(selector=selector):
                self.assertIn(selector, block, "the reduced-motion block must cover the CTA")


class DownloadRowsTest(CssAssertions):
    ACTIONS = ".sida-section .download-actions"
    BUTTON = ".sida-section .download-actions .button"
    BUTTON_HOVER = ".sida-section .download-actions .button:hover"
    EARLY = ".sida-section .download-actions .early-access"
    EARLY_HOVER = ".sida-section .download-actions .early-access:hover"
    NOTE = ".sida-section .download-actions .release-note"

    def test_windows_mac_and_early_access_share_one_centred_row(self) -> None:
        variants = find_rules(HOME_CSS, self.ACTIONS)
        self.assertTrue(variants, f"{HOME_CSS}: no rule for {self.ACTIONS!r}")
        layout_rules = [rule for rule in variants if "display" in rule]
        self.assertTrue(layout_rules, f"{self.ACTIONS}: missing display declaration")
        desktop = layout_rules[0]
        self.assert_decl(desktop, "display", "grid", where=self.ACTIONS)
        self.assert_decl(
            desktop,
            "grid-template-columns",
            "repeat(3,auto)",
            where=f"{self.ACTIONS} must size each pill to its icon and label",
        )
        self.assert_decl(desktop, "align-items", "center", where=self.ACTIONS)
        self.assert_decl(desktop, "justify-content", "center", where=self.ACTIONS)
        self.assertIn(
            squash(desktop.get("gap", "")),
            {"20px", "12px20px", "24px20px"},
            f"{self.ACTIONS}: expected the widened 20px column gap",
        )
        width = squash(desktop.get("width", ""))
        self.assertIn(
            width,
            {"min(100%,900px)", "900px"},
            f"{self.ACTIONS}: the row must stay compact for three pills, found {width!r}",
        )
        for selector in (self.BUTTON, self.EARLY):
            for rule in find_rules(HOME_CSS, selector):
                self.assertNotIn(
                    "grid-column",
                    rule,
                    f"{selector}: the action must not be forced onto its own row",
                )
                self.assertNotIn(
                    "flex-direction",
                    rule,
                    f"{selector}: the actions must not stack vertically on desktop",
                )

    def test_narrow_layout_is_one_column_without_horizontal_overflow(self) -> None:
        variants = find_rules(HOME_CSS, self.ACTIONS)
        self.assertGreaterEqual(
            len(variants), 2, f"{self.ACTIONS}: the narrow layout must be declared explicitly"
        )
        narrow = variants[-1]
        self.assert_decl(narrow, "display", "grid", where=f"{self.ACTIONS} (narrow)")
        self.assert_decl(
            narrow,
            "grid-template-columns",
            "minmax(0,1fr)",
            where=f"{self.ACTIONS} (narrow)",
        )
        self.assertNotIn(
            "flex-direction", narrow, f"{self.ACTIONS}: narrow layout must stay a grid"
        )
        narrow_width = squash(narrow.get("width", ""))
        self.assertIn(
            narrow_width,
            {"min(100%,320px)", "320px", "100%"},
            f"{self.ACTIONS} (narrow): the row must stay inside the viewport, found {narrow_width!r}",
        )
        for selector in (self.BUTTON, self.EARLY):
            narrow_action = [
                rule for rule in find_rules(HOME_CSS, selector) if "white-space" in rule
            ][-1]
            self.assert_decl(
                narrow_action,
                "white-space",
                "normal",
                where=f"{selector} (narrow): long labels must wrap instead of overflowing",
            )

    def test_each_action_sizes_itself_to_its_content(self) -> None:
        rules = find_rules(HOME_CSS, self.BUTTON)
        self.assertTrue(
            any(
                rule.get("width") == "auto"
                and rule.get("justify-content") == "flex-start"
                and rule.get("white-space") == "nowrap"
                for rule in rules
            ),
            f"{self.BUTTON}: each pill must size to its icon and label",
        )

    def test_platform_icons_keep_a_fixed_aligned_size(self) -> None:
        selector = ".sida-section .download-actions .download-icon"
        icon = find_rule(HOME_CSS, selector)
        self.assert_decl(icon, "display", "block", where=selector)
        self.assert_decl(icon, "width", "20px", where=selector)
        self.assert_decl(icon, "height", "20px", where=selector)
        self.assert_decl(icon, "flex", "0 0 20px", where=selector)

    def test_windows_and_mac_use_the_primary_gradient_cta(self) -> None:
        button = rule_with(HOME_CSS, self.BUTTON, "background")
        fill = squash(background(button))
        self.assertTrue(
            fill.startswith("linear-gradient("),
            f"{self.BUTTON}: expected the intentional linear-gradient fill, found {fill!r}",
        )
        self.assert_decl(button, "border", f"1px solid {LIGHT_BLUE}", where=self.BUTTON)
        self.assert_decl(button, "background-size", "190% 190%", where=self.BUTTON)
        self.assertIn(
            "onx-cta-primary-breathe",
            button.get("animation", ""),
            f"{self.BUTTON}: the slow breathing animation is part of the design",
        )
        self.assert_in(button.get("color", ""), DARK_TEXT, what=f"{self.BUTTON} text colour")
        metrics = rule_with(HOME_CSS, self.BUTTON, "min-height")
        self.assert_decl(metrics, "min-height", "64px", where=self.BUTTON)
        self.assert_decl(metrics, "border-radius", "999px", where=self.BUTTON)
        self.assert_decl(metrics, "font-size", "20px", where=self.BUTTON)

    def test_early_access_shares_the_pill_family_with_a_thin_border(self) -> None:
        primary = rule_with(HOME_CSS, self.BUTTON, "min-height")
        early = rule_with(HOME_CSS, self.EARLY, "min-height")
        for prop in ("min-height", "padding", "border-radius", "font-size", "width"):
            self.assertEqual(
                early.get(prop),
                primary.get(prop),
                f"{self.EARLY}: {prop} must match the download pills, found {early.get(prop)!r}",
            )
        outline = rule_with(HOME_CSS, self.EARLY, "border")
        self.assert_decl(outline, "border", "1px solid #7894c9", where=self.EARLY)
        fill = squash(background(outline))
        self.assertTrue(
            fill.startswith("linear-gradient("),
            f"{self.EARLY}: expected the dark linear-gradient fill, found {fill!r}",
        )
        self.assertNotIn(LIGHT_BLUE, fill, f"{self.EARLY}: must not be a filled accent pill")
        self.assertIn(
            "onx-cta-outline-breathe",
            outline.get("animation", ""),
            f"{self.EARLY}: the slow breathing animation is part of the design",
        )
        self.assert_decl(early, "justify-content", "center", where=self.EARLY)
        self.assert_decl(early, "opacity", "1", where=f"{self.EARLY} must stay enabled-looking")
        self.assert_decl(early, "white-space", "nowrap", where=self.EARLY)

    def test_early_access_hover_keeps_its_geometry_with_the_shared_glow(self) -> None:
        hover = rule_with(HOME_CSS, self.EARLY_HOVER, "transform")
        self.assert_decl(hover, "transform", "none", where=self.EARLY_HOVER)
        self.assertIn("box-shadow", hover, f"{self.EARLY_HOVER}: expected the shared lift shadow")
        self.assertNotIn(
            LIGHT_BLUE,
            squash(background(hover)),
            f"{self.EARLY_HOVER}: the outline pill must not become a filled accent pill",
        )
        glow = find_rule(
            HOME_CSS,
            ".sida-section .download-actions .early-access:hover::before",
        )
        self.assert_decl(glow, "opacity", ".45", where="early access glow on hover")

    def test_download_hover_keeps_its_geometry_without_recolouring_the_pill(self) -> None:
        hover = rule_with(HOME_CSS, self.BUTTON_HOVER, "transform")
        self.assert_decl(hover, "transform", "none", where=self.BUTTON_HOVER)
        self.assertIn("box-shadow", hover, f"{self.BUTTON_HOVER}: expected the lift shadow")
        for rule in find_rules(HOME_CSS, self.BUTTON_HOVER):
            fill = squash(background(rule))
            self.assertNotIn(
                fill,
                {"#fff", "#ffffff", "var(--ink)", "var(--bg)"},
                f"{self.BUTTON_HOVER}: hover must not flip the pill to a flat colour",
            )

    def test_release_note_is_a_centred_uppercase_slogan(self) -> None:
        note = find_rule(HOME_CSS, self.NOTE)
        self.assert_decl(note, "font-size", "clamp(18px,1.25vw,24px)", where=self.NOTE)
        self.assert_decl(note, "font-weight", "500", where=self.NOTE)
        self.assert_decl(note, "letter-spacing", ".14em", where=self.NOTE)
        self.assert_decl(note, "text-transform", "uppercase", where=self.NOTE)
        self.assert_decl(note, "text-wrap", "balance", where=self.NOTE)
        self.assert_decl(note, "text-align", "center", where=self.NOTE)
        self.assert_decl(note, "margin", "0", where=self.NOTE)
        self.assert_decl(
            note,
            "grid-column",
            "1/-1",
            where=f"{self.NOTE} must own the row below the two buttons",
        )

    def test_plan_buttons_are_not_restyled(self) -> None:
        for selectors, declarations in rules(HOME_CSS):
            if not any(".plan" in selector for selector in selectors):
                continue
            values = " ".join(dict(declarations).values())
            self.assertNotIn(
                LIGHT_BLUE,
                values,
                f"plan controls must not pick up the download colour: {selectors}",
            )


# ---------------------------------------------------------------------------
# 4. About member photos
# ---------------------------------------------------------------------------


class TeamPhotoTest(CssAssertions):
    PHOTO = ".team-photo"
    IMAGE = ".team-photo img"

    def test_photo_is_a_4x5_clipping_portrait_card(self) -> None:
        photo = find_rules(HOME_CSS, self.PHOTO)[0]
        self.assert_decl(photo, "overflow", "hidden", where=self.PHOTO)
        self.assert_decl(photo, "width", "100%", where=self.PHOTO)
        self.assert_decl(photo, "aspect-ratio", "4/5", where=self.PHOTO)
        self.assert_decl(photo, "border-radius", "20px", where=self.PHOTO)
        self.assertIn("border", photo, f"{self.PHOTO}: expected the hairline frame")
        self.assertIn("box-shadow", photo, f"{self.PHOTO}: expected the portrait shadow")
        self.assertNotEqual(photo.get("height"), "92px", "the fixed circle frame is gone")

    def test_image_fills_and_crops_without_stretching(self) -> None:
        image = find_rules(HOME_CSS, self.IMAGE)[0]
        self.assert_decl(image, "display", "block", where=self.IMAGE)
        self.assert_decl(image, "width", "100%", where=self.IMAGE)
        self.assert_decl(image, "height", "100%", where=self.IMAGE)
        self.assert_decl(image, "object-fit", "cover", where=self.IMAGE)
        self.assertIn("object-position", image, f"{self.IMAGE}: portraits need an anchor")
        self.assertNotIn("transform", image, f"{self.IMAGE}: no stretching allowed")
        self.assertNotIn("filter", image, f"{self.IMAGE}: no filters allowed")
        self.assertIn(
            "transform",
            image.get("transition", ""),
            f"{self.IMAGE}: hover growth is animated through transition",
        )

    def test_photo_frame_scales_with_the_member_layout(self) -> None:
        widths = declarations_for(HOME_CSS, self.PHOTO, "width")
        self.assertEqual(
            set(widths),
            {"100%"},
            f"{self.PHOTO}: the portrait must always fill its column, found {sorted(set(widths))}",
        )
        aspects = declarations_for(HOME_CSS, self.PHOTO, "aspect-ratio")
        self.assertEqual(
            set(aspects), {"4/5"}, f"{self.PHOTO}: keep the 4:5 portrait ratio, found {aspects}"
        )
        grid = find_rules(HOME_CSS, ".team-grid")[0]
        self.assertEqual(
            squash(grid.get("grid-template-columns", "")), "repeat(3,minmax(0,1fr))"
        )
        narrow = find_rules(HOME_CSS, ".team-grid")[-1]
        self.assertEqual(squash(narrow.get("grid-template-columns", "")), "minmax(0,1fr)")


class AboutCopyTest(CssAssertions):
    """About renders three horizontal portrait cards with one concise bio each."""

    SECTION = ".about-section"
    LAYOUT = ".team-layout"
    GRID = ".team-grid"
    MEMBER = ".team-member"
    LAST = ".team-member:last-child"
    PHOTO = ".team-photo"
    COPY = ".team-copy"
    NAME = ".team-member h2"
    ROLE = ".team-role"
    BIO = ".team-bio"
    FOOTER = ".home-footer"

    def test_member_stacks_the_portrait_above_the_copy(self) -> None:
        member = find_rules(HOME_CSS, self.MEMBER)[0]
        self.assert_decl(member, "display", "flex", where=self.MEMBER)
        self.assert_decl(member, "flex-direction", "column", where=self.MEMBER)
        self.assert_decl(member, "background", "transparent", where=self.MEMBER)
        photo = find_rules(HOME_CSS, self.PHOTO)[0]
        self.assert_decl(photo, "overflow", "hidden", where=self.PHOTO)
        self.assert_decl(photo, "border-radius", "20px", where=self.PHOTO)
        copy = find_rules(HOME_CSS, self.COPY)[0]
        self.assert_decl(copy, "min-width", "0", where=f"{self.COPY} must not overflow")
        self.assertIn(
            copy.get("display"),
            {"flex", "grid", "block"},
            f"{self.COPY}: copy column needs an explicit layout, found {copy.get('display')!r}",
        )
        self.assertIn("padding", copy, f"{self.COPY}: expected the portrait spacing")
        self.assertIn(
            "auto",
            copy.get("flex", ""),
            f"{self.COPY}: the copy column must take the leftover space, found {copy.get('flex')!r}",
        )

    def test_roles_are_visually_subordinate_to_names(self) -> None:
        name_rule = find_rules(HOME_CSS, self.NAME)[0]
        clamp = re.search(r"clamp\((\d+(?:\.\d+)?)px", name_rule["font-size"])
        self.assertIsNotNone(clamp, f"{self.NAME}: expected the responsive name size")
        smallest_name = float(clamp.group(1))
        role = find_rules(HOME_CSS, self.ROLE)[0]
        role_size = float(re.match(r"(\d+(?:\.\d+)?)px", role["font-size"]).group(1))
        self.assertEqual(role_size, 20.0, f"{self.ROLE}: the owner asked for 20px role labels")
        self.assertLess(
            role_size,
            smallest_name,
            f"{self.ROLE}: role {role_size}px must stay below the smallest name {smallest_name}px",
        )
        for rule in find_rules(HOME_CSS, self.ROLE):
            size = rule.get("font-size")
            if size:
                self.assertEqual(
                    size, "20px", f"{self.ROLE}: every rule, including media blocks, must stay 20px"
                )
        self.assertIn(
            role.get("color"),
            {"#8faccd", "#8fb7ff", "#9aabc0", "var(--muted)", "var(--accent)", "#b9c8dc"},
            f"{self.ROLE}: role must use a subordinate colour, found {role.get('color')!r}",
        )
        self.assert_decl(role, "text-transform", "uppercase", where=self.ROLE)

    def test_bio_is_22px_on_desktop_20px_when_short_and_18px_on_mobile(self) -> None:
        bio = find_rules(HOME_CSS, self.BIO)[0]
        self.assert_decl(bio, "font-size", "22px", where=self.BIO)
        self.assert_decl(bio, "line-height", "1.55", where=self.BIO)
        self.assertGreaterEqual(float(bio["line-height"]), 1.5, f"{self.BIO}: line-height too tight")
        self.assertIn(
            "break",
            squash(bio.get("overflow-wrap", "") + bio.get("word-break", "")),
            f"{self.BIO}: long words must wrap instead of overflowing",
        )
        sizes = declarations_for(HOME_CSS, self.BIO, "font-size")
        self.assertEqual(
            sizes,
            ["22px", "18px", "20px"],
            f"{self.BIO}: expected 22px base, 18px mobile and 20px short desktop, found {sizes}",
        )
        for rule in find_rules(HOME_CSS, self.BIO):
            for prop in ("max-height", "overflow", "text-overflow", "-webkit-line-clamp", "height"):
                self.assertNotIn(
                    prop, rule, f"{self.BIO}: biographies must never be clipped ({prop})"
                )
            if "display" in rule:
                self.assertNotEqual(rule["display"], "-webkit-box", f"{self.BIO}: no line clamp")
        paragraphs = find_rule(HOME_CSS, self.BIO + " p")
        self.assertEqual(
            squash(paragraphs.get("margin", "")), "0", f"{self.BIO} p: paragraph flow must stay flat"
        )
        self.assertNotIn(
            self.BIO + " p+p",
            _sheet(HOME_CSS),
            "the long multi-paragraph biography rhythm is intentionally gone",
        )

    def test_about_may_grow_past_one_viewport(self) -> None:
        section = find_rule(HOME_CSS, self.SECTION)
        self.assert_decl(section, "height", "auto", where=f"{self.SECTION} must not clip bios")
        self.assert_decl(section, "min-height", "100svh", where=self.SECTION)

    def test_desktop_uses_three_equal_columns(self) -> None:
        layout = find_rules(HOME_CSS, self.LAYOUT)[0]
        self.assertIn("1080px", layout.get("width", ""))
        self.assertEqual(squash(layout.get("width", "")), "min(1080px,calc(100%-64px))!important")
        grid = find_rules(HOME_CSS, self.GRID)[0]
        self.assertEqual(squash(grid.get("gap", "")), "28px")
        self.assertEqual(
            squash(grid.get("grid-template-columns", "")),
            "repeat(3,minmax(0,1fr))",
            "the three people sit in one horizontal row",
        )
        desktop = find_rules(HOME_CSS, self.LAST)[0]
        self.assertEqual(desktop.get("grid-column"), "auto")
        self.assertEqual(desktop.get("justify-self"), "stretch")
        self.assertEqual(desktop.get("width"), "100%")
        member = find_rules(HOME_CSS, self.MEMBER)[0]
        self.assertEqual(member.get("min-height"), "0")

    def test_narrow_layout_is_single_column_and_caps_the_member_width(self) -> None:
        grid_rules = find_rules(HOME_CSS, self.GRID)
        self.assertGreaterEqual(len(grid_rules), 2, "a narrow single-column override is required")
        narrow = grid_rules[-1]
        self.assertEqual(
            squash(narrow.get("grid-template-columns", "")),
            "minmax(0,1fr)",
            f"{self.GRID}: narrow viewports must use one column, found {narrow.get('grid-template-columns')!r}",
        )
        widths = declarations_for(HOME_CSS, self.MEMBER, "width")
        self.assertIn(
            "min(100%,340px)",
            widths,
            f"{self.MEMBER}: narrow members must be capped at 340px so photo and copy align",
        )
        centring = declarations_for(HOME_CSS, self.MEMBER, "margin-inline")
        if "auto" not in centring:
            shorthands = declarations_for(HOME_CSS, self.MEMBER, "margin")
            self.assertTrue(
                any("auto" in value for value in shorthands),
                f"{self.MEMBER}: narrow members must be centred horizontally",
            )
        last_rules = find_rules(HOME_CSS, self.LAST)
        self.assertGreaterEqual(len(last_rules), 2, "the third member needs a narrow reset")
        narrow_last = last_rules[-1]
        self.assertEqual(
            narrow_last.get("grid-column"),
            "auto",
            f"{self.LAST}: the narrow flow must not keep the desktop span",
        )

    def test_footer_stays_readable(self) -> None:
        footer = find_rule(HOME_CSS, self.FOOTER)
        self.assert_decl(footer, "background", "#0b1220", where=self.FOOTER)
        self.assertIn("grid-template-columns", footer, f"{self.FOOTER}: columns must stay defined")
        text = find_rule(HOME_CSS, self.FOOTER + " p")
        size = float(re.match(r"(\d+(?:\.\d+)?)px", text["font-size"]).group(1))
        self.assertGreaterEqual(size, 12.0, f"{self.FOOTER} p: footer copy must stay legible")

    def test_five_sections_use_native_free_scroll(self) -> None:
        scroller = find_rule(HOME_CSS, ".home-scroll")
        self.assert_decl(scroller, "scroll-snap-type", "none", where=".home-scroll")
        self.assert_decl(scroller, "height", "100svh", where=".home-scroll")
        section = find_rule(HOME_CSS, ".home-section")
        self.assertNotIn("scroll-snap-align", section)
        self.assert_decl(section, "height", "auto", where=".home-section")

class ExpandedSectionsTest(CssAssertions):
    def base(self, selector: str) -> dict[str, str]:
        matches = find_rules(HOME_CSS, selector)
        self.assertTrue(matches, f"missing base rule: {selector}")
        return matches[0]

    def test_wide_desktop_containers_use_the_available_page(self) -> None:
        for selector in (".hero-inner", ".price-layout"):
            width = squash(self.base(selector).get("width", ""))
            self.assertIn("1920px", width, f"{selector}: expected the expanded wide container")
        feature = squash(self.base(".feature-layout").get("width", ""))
        self.assertIn("1180px", feature, "the SIDA block keeps a narrower column than the hero")
        self.assertEqual(squash(self.base(".feature-layout").get("margin-inline", "")), "auto",
                         "the narrower SIDA block stays centred")

    def test_hero_type_and_demo_are_larger(self) -> None:
        self.assert_decl(self.base(".hero-copy h1"), "font-size", "clamp(52px,4.8vw,88px)", where=".hero-copy h1")
        self.assert_decl(self.base(".hero-description"), "font-size", "24px", where=".hero-description")
        self.assert_decl(
            self.base(".hero-description-line"),
            "display",
            "block",
            where=".hero-description-line keeps the two subtitle lines stacked",
        )
        self.assert_decl(self.base(".hero-demo"), "height", "min(74vh,760px)", where=".hero-demo")

    def test_sida_tabs_panel_and_downloads_are_larger(self) -> None:
        self.assert_decl(self.base(".feature-tabs"), "grid-template-columns", "480px minmax(0,1fr)", where=".feature-tabs")
        self.assert_decl(self.base(".feature-tab-list button"), "font", "500 20.5px/1.3 var(--display)", where=".feature-tab-list button")
        self.assert_decl(self.base(".feature-detail-card p"), "font-size", "20px", where=".feature-detail-card p")
        self.assert_decl(self.base(".feature-detail-card h3"), "font", "500 41px/1.16 var(--display)", where=".feature-detail-card h3")
        self.assertIn("900px", squash(self.base(".sida-section .download-actions").get("width", "")))

    def test_price_cards_and_table_use_more_space(self) -> None:
        self.assert_decl(self.base(".plan-mini"), "min-height", "320px", where=".plan-mini")
        self.assert_decl(self.base(".plan-mini h2"), "font-size", "34px", where=".plan-mini h2")
        self.assert_decl(self.base(".plan-table"), "font-size", "20px", where=".plan-table")
        self.assert_decl(self.base(".plan-table"), "min-width", "1150px", where=".plan-table")
        self.assert_decl(self.base(".plan-table th"), "height", "60px", where=".plan-table th")
        self.assert_decl(self.base(".plan-table th"), "font-size", "20px", where=".plan-table th")


class HomepageRedesignTest(CssAssertions):
    """The current homepage composition: nav type scale, hero copy, the two SIDA
    columns, the layered price cards and the uppercase comparison table."""

    def html(self) -> str:
        return INDEX_HTML.read_text(encoding="utf-8")

    def test_primary_nav_links_render_at_20px(self) -> None:
        nav = find_rule(HOME_CSS, ".home-page .nav-primary a")
        self.assert_decl(nav, "font-size", "20px", where="primary nav links")

    def test_hero_slogan_and_two_block_subtitle_lines(self) -> None:
        html = self.html()
        self.assertIn("SIDA, AI Agent for Engineering.", html)
        description = re.search(r'<p class="hero-description">(.*?)</p>', html, re.S)
        self.assertIsNotNone(description, "the hero subtitle is required")
        lines = re.findall(r'<span class="hero-description-line"[^>]*>', description.group(1))
        self.assertEqual(len(lines), 2, "the subtitle is two block lines")
        self.assert_decl(
            find_rules(HOME_CSS, ".hero-description-line")[0],
            "display",
            "block",
            where=".hero-description-line",
        )
        self.assert_decl(
            find_rules(HOME_CSS, ".hero-description")[0],
            "font-size",
            "24px",
            where=".hero-description on desktop",
        )

    def test_sida_uses_a_quarter_column_and_one_stacked_text_column(self) -> None:
        tabs = find_rules(HOME_CSS, ".feature-tabs")[0]
        self.assertEqual(
            squash(tabs.get("grid-template-columns", "")),
            "480pxminmax(0,1fr)",
            "the tab list is a fixed rail and the copy takes the rest",
        )
        stack = find_rules(HOME_CSS, ".feature-card-stack")[0]
        self.assertEqual(
            squash(stack.get("grid-template-columns", "")),
            "minmax(0,1fr)",
            "the three detail rows share one column",
        )
        self.assertEqual(
            squash(stack.get("grid-auto-rows", "")),
            "auto",
            "the three blocks stack as content-sized rows",
        )
        html = self.html()
        stacks = re.findall(
            r'<div class="feature-card-stack">(.*?)</div>\s*</article>', html, re.S
        )
        self.assertEqual(len(stacks), 4, "all four features own a card stack")
        for stack_html in stacks:
            with self.subTest():
                self.assertEqual(stack_html.count('class="feature-detail-card"'), 3)
        panels = re.findall(
            r'<article[^>]*class="feature-panel"[^>]*>(.*?)</article>', html, re.S
        )
        self.assertTrue(panels, "the SIDA panels are required")
        for panel in panels:
            self.assertNotIn("<img", panel, "no central logo or photo in the SIDA panels")
        self.assertNotIn(
            ".feature-panel img",
            _sheet(HOME_CSS),
            "the retired panel image rule must stay gone",
        )

    def test_price_cards_use_layered_gradients_borders_and_hover(self) -> None:
        card = find_rules(HOME_CSS, ".plan-mini")[0]
        fill = squash(background(card))
        self.assertTrue(
            fill.startswith("linear-gradient("),
            f".plan-mini: expected the layered surface gradient, found {fill!r}",
        )
        self.assertIn("rgba(155,181,210,.2)", squash(card.get("border", "")), card.get("border"))
        self.assertIn("inset", card.get("box-shadow", ""), ".plan-mini: expected the inner highlight")
        self.assert_decl(card, "border-radius", "18px", where=".plan-mini")
        featured = find_rules(HOME_CSS, ".plan-mini:nth-child(2)")[0]
        self.assertIn("padding-box", featured.get("background", ""), "featured card gradient frame")
        self.assertIn("border-box", featured.get("background", ""), "featured card gradient frame")
        hairline = find_rule(HOME_CSS, ".plan-mini::before")
        self.assertIn("linear-gradient(", hairline.get("background", ""), "top hairline highlight")
        glow = find_rule(HOME_CSS, ".plan-mini::after")
        self.assertIn("radial-gradient(", glow.get("background", ""), "corner glow wash")
        hover = rule_with(HOME_CSS, ".plan-mini:hover", "transform")
        self.assert_decl(hover, "transform", "translatey(-4px)", where=".plan-mini:hover lift")
        self.assertIn("box-shadow", hover, ".plan-mini:hover: expected the deeper shadow")

    def test_currency_and_interval_stay_20px_at_every_breakpoint(self) -> None:
        for selector in (".plan-currency", ".plan-interval"):
            with self.subTest(selector=selector):
                sizes = declarations_for(HOME_CSS, selector, "font-size")
                self.assertIn("20px", sizes, f"{selector}: expected the 20px base size")
                self.assertEqual(
                    set(sizes),
                    {"20px"},
                    f"{selector}: HK$ and / month stay 20px everywhere, found {sizes}",
                )

    def test_table_row_labels_use_the_uppercase_treatment(self) -> None:
        label = find_rules(HOME_CSS, ".plan-table tbody th")[0]
        self.assert_decl(label, "font-size", "20px", where=".plan-table tbody th")
        self.assert_decl(label, "font-weight", "600", where=".plan-table tbody th")
        self.assertIn("letter-spacing", label, ".plan-table tbody th: expect the tracked label")
        self.assertNotIn(
            "text-transform",
            label,
            "uppercase labels come from the copy, not from a forced transform",
        )
        head = find_rules(HOME_CSS, ".plan-table thead th")[0]
        self.assert_decl(head, "position", "sticky", where=".plan-table thead th")
        self.assert_decl(head, "top", "0", where=".plan-table thead th")
        yes = find_rule(HOME_CSS, ".plan-table .yes")
        self.assertIn("color", yes, ".plan-table .yes: checks keep their accent colour")

    def test_reduced_motion_disables_card_and_portrait_motion(self) -> None:
        block = media_block(HOME_CSS, "@media(prefers-reduced-motion:reduce)")
        for selector in (".plan-mini", ".team-member", ".team-photo"):
            with self.subTest(selector=selector):
                self.assertIn(selector, block, f"reduced motion must cover {selector}")
        self.assertIn("transform:none!important", block)
        self.assertIn("animation:none!important", block)


# ---------------------------------------------------------------------------
# 5. Section backgrounds
# ---------------------------------------------------------------------------


class SectionBackgroundTest(CssAssertions):
    MEDIA = ".home-backgrounds>.hero-media"
    SUBTLE = '.home-backgrounds>.hero-media:not([data-background-section="home"]).is-active'
    SCRIM = '.home-backgrounds>.hero-media:not([data-background-section="home"])::after'
    WRAP = ".home-section>.wrap"
    FOOTER = ".home-section>.home-footer"
    PERSPECTIVE = (
        '.home-page .hero-media[data-background="assets/backgrounds/perspective-grid.svg"]>svg'
    )
    PERSPECTIVE_SCRIM = (
        '.home-page .home-backgrounds>.hero-media'
        '[data-background="assets/backgrounds/perspective-grid.svg"]::after'
    )

    def test_every_section_media_sits_behind_content(self) -> None:
        media = find_rule(HOME_CSS, self.MEDIA)
        self.assert_decl(media, "position", "absolute", where=self.MEDIA)
        self.assert_decl(media, "inset", "0", where=self.MEDIA)
        self.assert_decl(media, "z-index", "0", where=self.MEDIA)
        self.assert_decl(media, "pointer-events", "none", where=self.MEDIA)

    def test_shared_background_stack_crossfades_one_active_layer(self) -> None:
        stack = find_rule(HOME_CSS, ".home-backgrounds")
        self.assert_decl(stack, "position", "absolute", where=".home-backgrounds")
        self.assert_decl(stack, "inset", "0", where=".home-backgrounds")
        self.assert_decl(stack, "z-index", "0", where=".home-backgrounds")
        layer = find_rules(HOME_CSS, self.MEDIA)[0]
        self.assert_decl(layer, "opacity", "0", where=self.MEDIA)
        self.assertIn("opacity", layer.get("transition", ""))
        active = find_rule(HOME_CSS, ".home-backgrounds>.hero-media.is-active")
        self.assert_decl(active, "opacity", "1", where=".home-backgrounds>.hero-media.is-active")

    def test_section_media_is_visible_but_subtle(self) -> None:
        subtle = find_rule(HOME_CSS, self.SUBTLE)
        self.assert_decl(subtle, "overflow", "hidden", where=self.SUBTLE)
        opacity = subtle.get("opacity", "")
        matched = re.fullmatch(r"0?\.\d+|\.\d+", opacity)
        self.assertIsNotNone(
            opacity and matched,
            f"{self.SUBTLE}: opacity must be a decimal below 1, found {opacity!r}",
        )
        self.assertGreater(float(opacity), 0.0)
        self.assertLess(float(opacity), 1.0)

        scrim = find_rule(HOME_CSS, self.SCRIM)
        self.assert_decl(scrim, "content", "\"\"", where=self.SCRIM)
        self.assert_decl(scrim, "position", "absolute", where=self.SCRIM)
        self.assert_decl(scrim, "inset", "0", where=self.SCRIM)
        self.assertIn(
            "rgba(8,14,23",
            squash(background(scrim)),
            f"{self.SCRIM}: a readable flat scrim is expected",
        )
        self.assertNotIn(
            "gradient",
            background(scrim),
            f"{self.SCRIM}: keep the scrim flat, not a gradient",
        )

    def test_content_and_footer_paint_above_backgrounds(self) -> None:
        for selector in (self.WRAP, self.FOOTER):
            rule = find_rule(HOME_CSS, selector)
            self.assert_decl(rule, "position", "relative", where=selector)
            z_index = rule.get("z-index", "")
            self.assertTrue(
                re.fullmatch(r"\d+", z_index) and int(z_index) > 0,
                f"{selector}: content must be lifted above the media, found z-index {z_index!r}",
            )

    def test_randomized_media_keeps_the_prominent_generic_treatment(self) -> None:
        base_rules = find_rules(HOME_CSS, ".hero-media>svg")
        self.assertTrue(base_rules, f"{HOME_CSS}: no generic svg rule")
        generic = base_rules[0]
        self.assert_decl(generic, "width", "100%", where=".hero-media>svg")
        self.assert_decl(generic, "height", "100%", where=".hero-media>svg")
        self.assert_decl(generic, "object-fit", "cover", where=".hero-media>svg")
        self.assert_decl(generic, "object-position", "left center", where=".hero-media>svg")
        self.assertEqual(
            squash(generic.get("transform", "")).lower(),
            "translatex(5%)scalex(-1)",
            ".hero-media>svg: the mirrored, translated overscan must be restored",
        )
        self.assertEqual(
            squash(generic.get("filter", "")).lower(),
            "brightness(1.75)saturate(1.25)",
            ".hero-media>svg: the original brightness/saturation must be restored",
        )

        homepage = find_rule(HOME_CSS, ".home-page .hero-media>svg")
        self.assert_decl(homepage, "left", "-5%", where=".home-page .hero-media>svg")
        self.assert_decl(homepage, "width", "105%", where=".home-page .hero-media>svg")
        self.assertEqual(
            squash(homepage.get("transform", "")).lower(),
            "translatex(5%)scalex(-1)",
            ".home-page .hero-media>svg: the 105% translate/mirror treatment must be restored",
        )

    def test_motion_field_keeps_its_prominent_generic_treatment(self) -> None:
        field = find_rule(HOME_CSS, ".home-page .hero-media>.motion-field")
        self.assert_decl(field, "left", "-5%", where=".home-page .hero-media>.motion-field")
        self.assert_decl(field, "width", "105%", where=".home-page .hero-media>.motion-field")
        self.assert_decl(field, "mask-image", "none", where=".home-page .hero-media>.motion-field")
        self.assertEqual(
            squash(field.get("transform", "")).lower(),
            "translatex(5%)",
            ".home-page .hero-media>.motion-field: the overscan translate must be restored",
        )
        self.assertEqual(
            squash(field.get("filter", "")).lower(),
            "brightness(1.6)saturate(1.3)",
            ".home-page .hero-media>.motion-field: the original brightness/saturation must be restored",
        )

    def test_generic_scrim_stays_light(self) -> None:
        scrim = find_rule(HOME_CSS, ".hero-media::after")
        value = squash(background(scrim))
        self.assertEqual(
            value,
            "linear-gradient(90deg,rgba(8,14,23,.72)0%,rgba(8,14,23,.24)45%,rgba(8,14,23,.08)100%)",
            f".hero-media::after: the original lighter scrim must be restored, found {value!r}",
        )
        field_scrim = find_rule(HOME_CSS, ".home-page .hero-media:has(>.motion-field)::after")
        self.assertEqual(
            squash(background(field_scrim)),
            "rgba(8,14,23,.28)",
            ".home-page .hero-media:has(>.motion-field)::after: motion fields keep the light scrim",
        )

    def test_original_mobile_mirror_is_restored(self) -> None:
        mirrored = [
            rule
            for rule in find_rules(HOME_CSS, ".hero-media>svg")
            if squash(rule.get("transform", "")).lower() == "scalex(-1)"
        ]
        self.assertTrue(
            mirrored,
            ".hero-media>svg: the mobile mirror (transform: scaleX(-1)) must be restored",
        )
        self.assertEqual(mirrored[-1].get("object-position"), "center")

    def test_other_six_backgrounds_are_not_neutralised(self) -> None:
        for selectors, declarations in rules(HOME_CSS):
            if not any("hero-media>svg" in selector for selector in selectors):
                continue
            if any("data-background" in selector for selector in selectors):
                continue
            style = dict(declarations)
            if "transform" in style and "scalex(-1)" not in squash(style["transform"]).lower():
                self.fail(
                    f"generic background rule must stay mirrored/prominent: {selectors} {style['transform']!r}"
                )
            if "filter" in style:
                self.assertIn(
                    "brightness(",
                    squash(style["filter"]).lower(),
                    f"generic background rule must keep its brightness boost: {selectors}",
                )
            if "object-position" in style and "data-background" not in " ".join(selectors):
                self.assertIn(
                    style["object-position"],
                    {"left center", "center"},
                    f"generic background rule must stay left aligned: {selectors}",
                )

    def test_first_section_stays_left_aligned(self) -> None:
        selector = '.home-backgrounds>.hero-media[data-background-section="home"]>svg'
        first = find_rule(HOME_CSS, selector)
        self.assert_decl(
            first,
            "object-position",
            "left center",
            where=".home-backgrounds home layer must stay left aligned at every width",
        )

    def test_hero_perspective_grid_keeps_its_left_facing_mirror(self) -> None:
        selector = (
            '.home-page .home-backgrounds>.hero-media[data-background-section="home"]'
            '[data-background="assets/backgrounds/perspective-grid.svg"]>svg'
        )
        hero = find_rule(HOME_CSS, selector)
        self.assert_decl(hero, "transform", "scalex(-1)", where=selector)

    def test_perspective_grid_matches_generic_brightness(self) -> None:
        neutral = find_rule(HOME_CSS, self.PERSPECTIVE)
        self.assert_decl(neutral, "left", "0", where=self.PERSPECTIVE)
        self.assert_decl(neutral, "width", "100%", where=self.PERSPECTIVE)
        self.assert_decl(neutral, "height", "100%", where=self.PERSPECTIVE)
        self.assert_decl(neutral, "object-fit", "cover", where=self.PERSPECTIVE)
        self.assert_decl(neutral, "object-position", "left center", where=self.PERSPECTIVE)
        self.assert_decl(neutral, "transform", "none", where=self.PERSPECTIVE)
        self.assert_decl(
            neutral,
            "filter",
            "brightness(1.75) saturate(1.25)",
            where=self.PERSPECTIVE,
        )
        self.assertNotIn("105%", squash(neutral.get("width", "")) + squash(neutral.get("left", "")))

        mentioned = set()
        for selectors, _declarations in rules(HOME_CSS):
            for selector in selectors:
                mentioned.update(re.findall(r'data-background="([^"]+)"', selector))
        self.assertEqual(
            mentioned,
            {"assets/backgrounds/perspective-grid.svg"},
            f"only the perspective-grid host may receive overrides, found {sorted(mentioned)}",
        )

    def test_perspective_grid_uses_the_generic_scrim(self) -> None:
        self.assertEqual(
            rule_index(HOME_CSS, self.PERSPECTIVE_SCRIM),
            [],
            "perspective-grid must not keep a dedicated darker scrim",
        )
        generic = find_rule(HOME_CSS, ".hero-media::after")
        self.assertIn("gradient", background(generic))
        self.assertIn("rgba(8,14,23,.72)", squash(background(generic)))

    def test_no_visible_labels_are_added(self) -> None:
        for selectors, declarations in rules(HOME_CSS):
            if not any("hero-media" in selector for selector in selectors):
                continue
            for prop, value in declarations:
                if prop != "content":
                    continue
                self.assertIn(
                    value,
                    {'""', "none", "normal"},
                    f"hero-media must not inject a visible label: {selectors} {prop}: {value}",
                )


# ---------------------------------------------------------------------------
# 6. Obsolete dialog styles
# ---------------------------------------------------------------------------


class RemovedDialogTest(unittest.TestCase):
    def test_no_download_dialog_css_remains(self) -> None:
        for name in OWNED_SHEETS:
            css = COMMENT_RE.sub("", _sheet(name)).lower()
            self.assertNotIn(
                "download-dialog",
                css,
                f"{name}: obsolete .download-dialog styles must be removed",
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
