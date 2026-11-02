"""Signed-in username in the authenticated topbar (left of Sign out).

Pins the follow-up: a non-translated ``{{ user.username|default:"-" }}`` span with
``class="account-username" data-user-input`` sits between the language switcher
and the logout form, styled as plain muted text with ellipsis truncation, and
ordered 3 on mobile between language (2) and logout (4).

Only the real template and stylesheet are read: no browser, no server.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
TOPBAR = REPO_ROOT / "backend" / "templates" / "accounts" / "_topbar.html"
ACCOUNT_CSS = REPO_ROOT / "assets" / "account.css"
TEMPLATES = REPO_ROOT / "backend" / "templates" / "accounts"

USERNAME_EXPRESSION = '{{ user.username|default:"-" }}'
SWITCHER = 'class="language-switcher"'
LOGOUT_FORM = "data-logout-form"
COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def normalise(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").lower())


def rules(css: str) -> list:
    found = []
    for match in RULE_RE.finditer(css):
        selectors = [normalise(part) for part in match.group(1).split(",") if part.strip()]
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


def base(css: str, selector: str) -> dict:
    target = normalise(selector)
    for selectors, declarations in rules(css):
        if target in selectors:
            return declarations
    raise AssertionError(f"{selector}: no such rule in account.css")


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


class TopbarMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.topbar = read(TOPBAR)

    def test_username_span_is_exact_and_untranslated(self):
        match = re.search(r"<span\b[^>]*class=\"account-username\"[^>]*>.*?</span>", self.topbar, re.S)
        self.assertIsNotNone(match, "missing the account-username span")
        span = match.group(0)
        self.assertIn(USERNAME_EXPRESSION, span)
        self.assertIn("data-user-input", span, "i18n must skip the username")
        self.assertNotIn("data-i18n", span, "the username must never be translated")

    def test_username_sits_between_language_switcher_and_logout(self):
        username = self.topbar.find("account-username")
        self.assertGreaterEqual(username, 0, "missing the account-username span")
        self.assertLess(
            self.topbar.find(SWITCHER), username, "username must follow the language switcher"
        )
        self.assertLess(
            username, self.topbar.find(LOGOUT_FORM), "username must precede Sign out"
        )
        self.assertEqual(
            self.topbar.count("account-username"), 1, "exactly one username label"
        )

    def test_avatar_circle_precedes_username_with_uploaded_or_initial_state(self):
        self.assertIn('class="account-avatar"', self.topbar)
        self.assertLess(
            self.topbar.find('class="account-avatar"'),
            self.topbar.find('class="account-username"'),
            "the avatar must sit immediately left of the username",
        )
        self.assertIn("{% if profile.avatar_url %}", self.topbar)
        self.assertIn('src="{{ profile.avatar_url }}"', self.topbar)
        self.assertIn('slice:":2"', self.topbar)
        self.assertIn("|upper", self.topbar)

    def test_sign_out_stays_rightmost_and_confirm_script_is_unchanged(self):
        self.assertRegex(self.topbar, r"</form>\s*</header>")
        self.assertIn('method="post"', self.topbar)
        self.assertIn('action="/logout/"', self.topbar)
        self.assertIn("{% csrf_token %}", self.topbar)
        self.assertIn("window.confirm", self.topbar)
        self.assertIn("event.preventDefault()", self.topbar)
        for language in ("en", "zh-cn", "zh-tw"):
            self.assertIn(f'data-confirm-{language}="', self.topbar)
        self.assertEqual(self.topbar.count("<script>"), 1)

    def test_mobile_order_and_source_order_match_the_contract(self):
        order = [
            self.topbar.find('class="account-brand"'),
            self.topbar.find(SWITCHER),
            self.topbar.find("account-username"),
            self.topbar.find(LOGOUT_FORM),
        ]
        self.assertNotIn(-1, order, f"a topbar control is missing: {order}")
        self.assertEqual(order, sorted(order), "desktop order: brand, language, username, logout")


class TopbarStyleTests(unittest.TestCase):
    SELECTOR = "body.account-page .account-username"
    MOBILE = "@media (max-width: 760px)"

    @classmethod
    def setUpClass(cls) -> None:
        cls.css = COMMENT_RE.sub("", read(ACCOUNT_CSS))
        cls.mobile = media_block(cls.css, cls.MOBILE)

    def test_username_is_plain_white_text_without_a_pill(self):
        username = base(self.css, self.SELECTOR)
        self.assertIn(username.get("display"), {"block", "inline-block", "flex", "inline-flex"})
        self.assertEqual(username.get("color"), "#fff")
        self.assertIn("var(--account-font)", username.get("font-family", ""))
        self.assertIn(username.get("background", "transparent"), {"transparent", "none"})
        self.assertIn(username.get("border", "0"), {"0", "none"})
        self.assertIn(username.get("border-radius", "0"), {"0"})

    def test_avatar_is_a_fixed_circle_with_cropped_image_support(self):
        identity = base(self.css, "body.account-page .account-identity")
        self.assertEqual(identity.get("display"), "flex")
        self.assertEqual(identity.get("gap"), "9px")
        self.assertEqual(identity.get("min-width"), "0")
        avatar = base(self.css, "body.account-page .account-avatar")
        self.assertEqual(avatar.get("width"), "32px")
        self.assertEqual(avatar.get("height"), "32px")
        self.assertEqual(avatar.get("flex"), "0 0 32px")
        self.assertEqual(avatar.get("border-radius"), "50%")
        self.assertEqual(avatar.get("overflow"), "hidden")
        self.assertEqual(avatar.get("display"), "grid")
        image = base(self.css, "body.account-page .account-avatar img")
        self.assertEqual(image.get("width"), "100%")
        self.assertEqual(image.get("height"), "100%")
        self.assertEqual(image.get("object-fit"), "cover")

    def test_long_usernames_truncate_instead_of_breaking_the_topbar(self):
        username = base(self.css, self.SELECTOR)
        self.assertEqual(username.get("white-space"), "nowrap")
        self.assertEqual(username.get("overflow"), "hidden")
        self.assertEqual(username.get("text-overflow"), "ellipsis")
        self.assertEqual(username.get("min-width"), "0")
        maximum = username.get("max-width", "")
        self.assertTrue(maximum, "a max-width is required so long names cannot stretch the bar")
        self.assertRegex(maximum, r"(\d+ch|\d+px|vw)")

    def test_topbar_keeps_centring_and_never_hides_the_username(self):
        self.assertEqual(base(self.css, "body.account-page .account-topbar").get("align-items"), "center")
        for selectors, declarations in rules(self.css):
            if normalise(self.SELECTOR) not in selectors:
                continue
            self.assertNotIn(declarations.get("display"), {"none"}, "the username must not be hidden")

    def test_mobile_orders_username_between_language_and_logout(self):
        language = base(self.mobile, "body.account-page .account-topbar .language-switcher")
        username = base(self.mobile, self.SELECTOR)
        logout = base(self.mobile, "body.account-page .account-logout")
        self.assertEqual(language.get("order"), "2")
        self.assertEqual(base(self.mobile, "body.account-page .account-identity").get("order"), "3")
        self.assertEqual(logout.get("order"), "4")
        self.assertRegex(username.get("max-width", ""), r"(\d+ch|\d+px|vw)")

    def test_language_and_logout_sizing_is_preserved(self):
        language = base(self.css, "body.account-page .language-switcher button")
        for prop in ("width", "height", "min-width", "min-height"):
            self.assertEqual(language.get(prop), "34px", f"language {prop} must stay 34px")
        logout = base(self.css, "body.account-page .account-logout button")
        self.assertEqual(logout.get("border-radius"), "999px")
        self.assertEqual(
            base(self.mobile, "body.account-page .account-logout button").get("min-height"), "44px"
        )


class PreviousWorkStillHoldsTests(unittest.TestCase):
    def test_font_preloads_and_logout_form_are_untouched(self):
        for page in ("profile.html", "security.html", "token_usage.html"):
            markup = read(TEMPLATES / page)
            with self.subTest(template=page):
                self.assertEqual(markup.count('as="font"'), 6)
                self.assertLess(markup.index('as="font"'), markup.index("/assets/account.css"))
                self.assertIn("{% include 'accounts/_topbar.html' %}", markup)
        sidebar = read(TEMPLATES / "_sidebar.html")
        self.assertNotIn("logout", sidebar.lower())
        self.assertIn('href="/index.html#price"', sidebar)


if __name__ == "__main__":
    unittest.main(verbosity=2)
