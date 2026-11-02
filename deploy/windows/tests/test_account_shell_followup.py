"""Static regression tests for the shared authenticated account shell.

Scope (shared shell unit):

* the public SIDA/Price/Business/About nav is gone from every authenticated page
  (``accounts/_topbar.html``) while the brand link stays;
* Sign out moved out of the sidebar into the topbar as the rightmost control,
  still a POST form with a CSRF token, guarded by a native ``window.confirm``
  warning available in English, zh-CN and zh-TW from data attributes;
* the sidebar Plans link opens ``/index.html#price`` in a new browsing context
  with ``rel="noopener"`` while the Usage URL is unchanged;
* the authenticated language switcher keeps stable 34px desktop slots in the
  account mono at 12px with a fixed line height, unchanged by locale or the
  selected state, with 44px touch slots on mobile and no selected pill;
* the Security page's Danger Zone card follows the main page width exactly like
  the Change Password card.

Everything is source inspection of the real templates and stylesheet: no
browser, no server, no Django account needed.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
TEMPLATES = REPO_ROOT / "backend" / "templates" / "accounts"
TOPBAR_HTML = TEMPLATES / "_topbar.html"
SIDEBAR_HTML = TEMPLATES / "_sidebar.html"
SECURITY_HTML = TEMPLATES / "security.html"
ACCOUNT_CSS = REPO_ROOT / "assets" / "account.css"

CONFIRM_MESSAGES = {
    "en": "Sign out of your OuroNex account? You will need to sign in again.",
    "zh-cn": "确定要退出 OuroNex 账户吗？退出后需要重新登录。",
    "zh-tw": "確定要登出 OuroNex 帳戶嗎？登出後需要重新登入。",
}
CJK = re.compile(r"[\u4e00-\u9fff]")
COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")


# ---------------------------------------------------------------------------
# Minimal readers
# ---------------------------------------------------------------------------


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def sheet() -> str:
    return COMMENT_RE.sub("", read(ACCOUNT_CSS))


def normalise(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").lower())


def css_rules(css: str) -> list:
    found = []
    for match in RULE_RE.finditer(css):
        selectors = [
            normalise(part) for part in match.group(1).split(",") if part.strip()
        ]
        if not selectors or any(selector.startswith("@") for selector in selectors):
            continue
        declarations = {}
        for declaration in match.group(2).split(";"):
            if ":" not in declaration:
                continue
            prop, _, value = declaration.partition(":")
            declarations[prop.strip().lower()] = re.sub(r"\s+", " ", value.strip().lower())
        if declarations:
            found.append((selectors, declarations))
    return found


def base_declarations(css: str, selector: str) -> dict:
    target = normalise(selector)
    for selectors, declarations in css_rules(css):
        if target in selectors:
            return declarations
    raise AssertionError(f"{selector}: no such rule in account.css")


def merged_declarations(css: str, selector: str) -> dict:
    target = normalise(selector)
    merged: dict = {}
    for selectors, declarations in css_rules(css):
        if target in selectors:
            merged.update(declarations)
    return merged


def media_block(css: str, prelude: str) -> str:
    index = css.find(prelude)
    if index < 0:
        return ""
    start = css.index("{", index)
    depth = 0
    for position in range(start, len(css)):
        char = css[position]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return css[start + 1:position]
    return ""


def tag(html: str, pattern: str, *, what: str) -> str:
    match = re.search(pattern, html, re.S)
    if not match:
        raise AssertionError(f"missing {what}")
    return match.group(0)


# ---------------------------------------------------------------------------
# 1. Topbar: public nav removed, brand kept, sign out rightmost
# ---------------------------------------------------------------------------


class TopbarTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.topbar = read(TOPBAR_HTML)

    def test_public_nav_is_gone_from_the_shared_topbar(self):
        self.assertNotIn("account-site-nav", self.topbar)
        self.assertNotIn("Main navigation", self.topbar)
        for anchor in ("#sida", "#price", "#business", "#about"):
            self.assertNotIn(f'href="/index.html{anchor}"', self.topbar)
        self.assertNotIn("<nav", self.topbar, "the topbar no longer holds a nav")

    def test_no_authenticated_template_restores_the_public_nav(self):
        for page in TEMPLATES.glob("*.html"):
            self.assertNotIn(
                "account-site-nav", read(page), f"{page.name} restored the removed nav"
            )

    def test_brand_link_is_preserved(self):
        self.assertIn('class="account-brand"', self.topbar)
        self.assertIn('href="/index.html"', self.topbar)
        self.assertIn('src="/assets/ouronex-mark.svg"', self.topbar)
        self.assertIn("shared.ouronex.3343a9", self.topbar)

    def test_sign_out_is_a_post_form_with_csrf(self):
        form = tag(self.topbar, r'<form\b[^>]*data-logout-form[^>]*>.*?</form>', what="logout form")
        opening = form[: form.index(">") + 1]
        self.assertIn('method="post"', opening)
        self.assertIn('action="/logout/"', opening)
        self.assertIn("{% csrf_token %}", form)
        self.assertIn('type="submit"', form)
        self.assertIn("account-dashboard.sign-out.dc1649", form)

    def test_no_get_logout_link_exists_anywhere(self):
        for page in TEMPLATES.glob("*.html"):
            text = read(page)
            self.assertNotRegex(
                text,
                r'<a\b[^>]*href="/logout/?"',
                f"{page.name} still offers a GET logout link",
            )

    def test_sign_out_is_the_rightmost_topbar_control(self):
        self.assertRegex(
            self.topbar,
            r"</form>\s*</header>",
            "the logout form must be the last control in the topbar",
        )
        self.assertLess(
            self.topbar.index('class="language-switcher"'),
            self.topbar.index("data-logout-form"),
            "sign out must sit after the language switcher",
        )

    def test_native_confirm_warning_in_three_languages(self):
        self.assertIn("window.confirm", self.topbar)
        self.assertNotIn("<dialog", self.topbar)
        self.assertNotIn('role="dialog"', self.topbar)
        self.assertNotIn("modal", self.topbar.lower())
        for language, message in CONFIRM_MESSAGES.items():
            attribute = f'data-confirm-{language}="{message}"'
            self.assertIn(attribute, self.topbar, f"missing {language} warning")
        for language in ("zh-cn", "zh-tw"):
            self.assertRegex(CONFIRM_MESSAGES[language], CJK)

    def test_cancel_prevents_submission_and_accept_submits(self):
        script = tag(self.topbar, r"<script>.*?</script>", what="inline confirm script")
        self.assertIn("addEventListener('submit'", script)
        self.assertIn("event.preventDefault()", script)
        self.assertIn("window.confirm", script)
        self.assertNotIn("<script src=", self.topbar, "no new public JS file is allowed")
        self.assertIn("data-confirm-", script, "the message is read from data attributes")


# ---------------------------------------------------------------------------
# 2. Sidebar: logout removed, Plans opens a new browsing context
# ---------------------------------------------------------------------------


class SidebarTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sidebar = read(SIDEBAR_HTML)

    def test_logout_form_and_inline_style_are_gone(self):
        lowered = self.sidebar.lower()
        self.assertNotIn("logout", lowered)
        self.assertNotIn("<form", lowered)
        self.assertNotIn("<style", lowered)
        self.assertNotIn("sign out", lowered)
        self.assertNotIn("account-dashboard.sign-out.dc1649", self.sidebar)

    def test_plans_link_opens_the_home_price_section_in_a_new_tab(self):
        anchor = tag(
            self.sidebar,
            r'<a\b[^>]*href="/index\.html#price"[^>]*>',
            what="Plans link",
        )
        self.assertIn('target="_blank"', anchor)
        self.assertRegex(anchor, r'rel="[^"]*noopener')


    def test_usage_url_is_unchanged_and_plans_is_gone_from_pricing(self):
        self.assertIn('href="/dashboard/usage/"', self.sidebar)
        self.assertNotIn('href="/pricing/"', self.sidebar)

    def test_profile_entry_kept_and_dashboard_entry_absent(self):
        self.assertIn('href="/profile/"', self.sidebar)
        self.assertIn('href="/profile/security/"', self.sidebar)
        self.assertNotRegex(self.sidebar, r'<a\b[^>]*href="/dashboard/"')
        self.assertNotIn(">Dashboard<", self.sidebar)


# ---------------------------------------------------------------------------
# 3. Authenticated language switcher typography
# ---------------------------------------------------------------------------


class LanguageTypographyTests(unittest.TestCase):
    SELECTOR = "body.account-page .language-switcher button"
    PRESSED = "body.account-page .language-switcher button[aria-pressed='true']"

    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()

    def test_slots_are_fixed_34px_in_cjk_sans_at_12px(self):
        button = base_declarations(self.css, self.SELECTOR)
        for prop in ("width", "height", "min-width", "min-height"):
            self.assertEqual(button.get(prop), "34px", f"{prop} must be a fixed 34px slot")
        self.assertEqual(button.get("flex"), "0 0 34px")
        font = button.get("font-family", "").lower()
        self.assertIn("microsoft yahei", font)
        self.assertIn("sans-serif", font)
        self.assertNotIn("monospace", font)
        self.assertEqual(button.get("font-size"), "12px")
        self.assertEqual(button.get("line-height"), "1")

    def test_selected_state_changes_colour_and_weight_only(self):
        pressed = base_declarations(self.css, self.PRESSED)
        self.assertEqual(pressed.get("background"), "transparent")
        self.assertEqual(pressed.get("box-shadow"), "none")
        self.assertIn(pressed.get("font-weight"), {"600", "700", "800"})
        for prop in (
            "width",
            "height",
            "min-width",
            "min-height",
            "flex",
            "padding",
            "font-family",
            "font-size",
            "line-height",
        ):
            self.assertNotIn(
                prop,
                pressed,
                f"the selected state must not change {prop} between locales",
            )

    def test_no_locale_scoped_override_touches_the_switcher(self):
        for selectors, _declarations in css_rules(self.css):
            for selector in selectors:
                if "language-switcher" not in selector:
                    continue
                self.assertNotIn("html[lang", selector, f"locale override: {selector}")

    def test_container_stays_text_only(self):
        container = base_declarations(self.css, "body.account-page .account-topbar .language-switcher")
        self.assertEqual(container.get("padding"), "0")
        self.assertEqual(container.get("box-shadow"), "none")
        self.assertIn(container.get("background"), {"transparent", "none"})
        self.assertIn(container.get("border", "0"), {"0", "none"})

    def test_mobile_keeps_44px_touch_slots(self):
        mobile = media_block(self.css, "@media (max-width: 760px)")
        self.assertTrue(mobile, "the mobile block is required")
        button = base_declarations(mobile, self.SELECTOR)
        for prop in ("width", "height", "min-width", "min-height"):
            self.assertEqual(button.get(prop), "44px", f"mobile {prop} must stay 44px")
        self.assertEqual(button.get("font-size"), "12px")
        self.assertEqual(button.get("line-height"), "1")


# ---------------------------------------------------------------------------
# 4. Security page width parity for the two cards
# ---------------------------------------------------------------------------


class SecurityWidthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()
        cls.security = read(SECURITY_HTML)

    def test_no_rule_caps_the_danger_zone_separately(self):
        for selectors, declarations in css_rules(self.css):
            if not any("danger-zone" in selector for selector in selectors):
                continue
            self.assertNotIn(
                "max-width",
                declarations,
                f"the Danger Zone must not be constrained separately: {selectors}",
            )
            self.assertNotIn(
                "width",
                declarations,
                f"the Danger Zone must follow the main width: {selectors}",
            )

    def test_shared_card_cap_no_longer_targets_the_danger_zone(self):
        for selectors, declarations in css_rules(self.css):
            if declarations.get("max-width") != "960px":
                continue
            self.assertFalse(
                any("danger-zone" in selector for selector in selectors),
                f"the 960px cap still includes the Danger Zone: {selectors}",
            )

    def test_security_body_is_scoped_and_both_cards_use_the_card_class(self):
        self.assertIn('class="account-page account-security-page"', self.security)
        self.assertIn("body.account-security-page", self.css)
        main = tag(self.security, r'<main class="main">.*?</main>', what="main column")
        cards = re.findall(r'<div class="([^"]*card[^"]*)">', main)
        self.assertEqual(len(cards), 2, f"expected two cards, found {cards}")
        for classes in cards:
            self.assertEqual(
                classes.split()[0], "card", f"cards must share the .card width: {classes}"
            )
        self.assertNotRegex(main, r'class="[^"]*card[^"]*"[^>]*style="[^"]*(max-)?width')
        self.assertIn("Change Password", main)
        self.assertIn("Danger Zone", main)


# ---------------------------------------------------------------------------
# 5. Responsive / flat-colour guards
# ---------------------------------------------------------------------------


class ShellLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()

    def test_topbar_wraps_instead_of_overflowing(self):
        topbar = base_declarations(self.css, "body.account-page .account-topbar")
        self.assertEqual(topbar.get("flex-wrap"), "wrap")
        mobile = media_block(self.css, "@media (max-width: 760px)")
        self.assertTrue(base_declarations(mobile, "body.account-page .account-topbar").get("gap"))

    def test_sign_out_control_is_flat_and_touch_sized_on_mobile(self):
        button = base_declarations(self.css, "body.account-page .account-logout button")
        self.assertIn(button.get("border-radius"), {"999px"})
        self.assertIn(button.get("background"), {"transparent", "none"})
        self.assertEqual(button.get("white-space"), "nowrap")
        mobile = media_block(self.css, "@media (max-width: 760px)")
        self.assertEqual(
            base_declarations(mobile, "body.account-page .account-logout button").get("min-height"),
            "44px",
        )

    def test_no_gradients_viewport_widths_or_custom_modal_styles(self):
        css = self.css.lower()
        for forbidden in ("gradient(", "100vw", ".modal", "dialog"):
            self.assertNotIn(forbidden, css, f"account.css must stay flat: {forbidden}")

    def test_mobile_stack_has_no_dead_public_nav_rules(self):
        self.assertNotIn("account-site-nav", self.css, "dead topbar nav rules must be removed")


if __name__ == "__main__":
    unittest.main(verbosity=2)
