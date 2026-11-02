"""Static regression tests for the merged Profile page (Dashboard absorbed)."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PROFILE_HTML = REPO_ROOT / "backend" / "templates" / "accounts" / "profile.html"
SIDEBAR_HTML = REPO_ROOT / "backend" / "templates" / "accounts" / "_sidebar.html"
ACCOUNT_CSS = REPO_ROOT / "assets" / "account.css"
PROFILE_I18N = REPO_ROOT / "assets" / "i18n" / "account-profile.json"


class ProfilePageLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = PROFILE_HTML.read_text(encoding="utf-8")
        cls.sidebar = SIDEBAR_HTML.read_text(encoding="utf-8")
        cls.css = ACCOUNT_CSS.read_text(encoding="utf-8")
        cls.i18n = json.loads(PROFILE_I18N.read_text(encoding="utf-8"))

    def block(self, pattern: str) -> str:
        match = re.search(pattern, self.html, re.S)
        self.assertIsNotNone(match, f"markup not found: {pattern}")
        return match.group(0)

    def profile_details(self) -> str:
        return self.block(r'<section class="card profile-details".*?</section>')

    def plan_card(self) -> str:
        return self.block(
            r'<section class="card subscription-card profile-plan-card".*?</section>'
        )

    def editor(self) -> str:
        return self.block(r'<section class="card profile-editor".*?</section>')

    # -- structure ---------------------------------------------------------

    def test_account_details_is_first_main_content(self) -> None:
        main_at = self.html.index('<main class="main">')
        details_at = self.html.index('<section class="card profile-details"')
        self.assertLess(main_at, details_at)
        before_details = self.html[main_at:details_at]
        self.assertNotIn("<h1", before_details)
        self.assertNotIn('class="sub"', before_details)
        self.assertNotIn("account-profile.profile.ff4fc0", before_details)
        self.assertNotIn("manage-your-account-information", before_details)
        self.assertNotIn("<h1", self.html)

    def test_section_order_matches_requirements(self) -> None:
        order = [
            self.html.index('<section class="card profile-details"'),
            self.html.index('<section class="card subscription-card profile-plan-card"'),
            self.html.index('<div class="profile-actions">'),
            self.html.index('<section class="card profile-editor"'),
        ]
        self.assertEqual(order, sorted(order), "Account Details -> plan -> actions -> editor")

    def test_actions_are_edit_profile_and_security_only(self) -> None:
        actions = self.block(r'<div class="profile-actions">.*?</div>')
        self.assertEqual(actions.count("<button "), 1, actions)
        self.assertEqual(actions.count("<a "), 1, actions)
        self.assertIn("account-dashboard.edit-profile.cd280a", actions)
        self.assertIn("account-dashboard.security-settings.dbe3f2", actions)
        self.assertIn('href="/profile/security/"', actions)
        for legacy in ("view-plans", "quick-actions"):
            self.assertNotIn(legacy, self.html)

    # -- avatar ------------------------------------------------------------

    def test_avatar_shows_upload_or_initials_and_uploads_multipart(self) -> None:
        details = self.profile_details()
        self.assertIn("{% if profile.avatar_url %}", details)
        self.assertIn('src="{{ profile.avatar_url }}"', details)
        self.assertRegex(details, r"<img[^>]+profile\.avatar_url")
        self.assertIn("avatar-initials", details)
        self.assertRegex(details, r"avatar-initials[^>]*data-user-input")
        self.assertIn('|slice:":2"|upper', details)

        form = re.search(r'<form class="avatar-form"[^>]*>.*?</form>', details, re.S)
        self.assertIsNotNone(form)
        form_html = form.group(0)
        self.assertIn('enctype="multipart/form-data"', form_html)
        self.assertIn('method="post"', form_html)
        self.assertIn("{% csrf_token %}", form_html)
        self.assertRegex(
            form_html, r'<input name="action"[^>]*type="hidden"[^>]*value="avatar"'
        )
        self.assertRegex(
            form_html,
            r'<input accept="\.png,\.jpg,\.jpeg,\.webp"[^>]*name="avatar"[^>]*type="file"',
        )
        self.assertRegex(form_html, r'for="avatar-file"')
        self.assertRegex(form_html, r'id="avatar-file"')
        self.assertIn("account-profile.edit-avatar.55e04a", form_html)

    def test_avatar_edit_label_opens_native_file_picker_and_submits(self) -> None:
        details = self.profile_details()
        # The label is the visible Edit Avatar control for the native file input.
        label = re.search(r'<label class="btn[^"]*"[^>]*for="avatar-file"', details)
        self.assertIsNotNone(label)
        self.assertIn('id="avatar-file"', details)
        # Choosing a file submits the multipart form without a custom modal.
        self.assertIn("avatarFile.form.submit()", self.html)
        self.assertNotIn("role=\"dialog\"", self.html)
        self.assertNotIn("<dialog", self.html)

    # -- plan card ---------------------------------------------------------

    def test_plan_card_keeps_dashboard_values_with_usage_inside(self) -> None:
        plan = self.plan_card()
        self.assertRegex(plan, r"data-user-input[^>]*>\{\{ subscription\.plan\.display_name \}\}")
        self.assertIn("account-dashboard.plan.ae2f98", plan)
        self.assertIn("account-dashboard.free-forever.8f31b8", plan)
        self.assertIn("{{ subscription.plan.price_monthly }}", plan)
        self.assertIn("account-dashboard.upgrade.a6f47e", plan)
        self.assertIn("account-dashboard.manage.bf58d1", plan)
        self.assertIn('href="/index.html#price"', plan)

        usage = re.search(r'<div class="profile-plan-usage">.*?</div>\s*</section>', plan, re.S)
        self.assertIsNotNone(usage)
        usage_html = usage.group(0)
        self.assertIn("account-dashboard.tokens-remaining.c00593", usage_html)
        self.assertIn("account-dashboard.tokens-used.238462", usage_html)
        self.assertIn("account-dashboard.tokens.339143", usage_html)
        self.assertIn("{{ subscription.tokens_remaining|default:0 }}", usage_html)
        self.assertIn("{{ token_usage }}", usage_html)
        self.assertEqual(usage_html.count('class="plan-metric"'), 2)

    def test_no_legacy_kpi_grid_or_cards(self) -> None:
        for legacy in (
            "kpi-grid",
            'class="kpi"',
            "account-dashboard.quick-actions.c40810",
            "account-dashboard.view-plans.c79fd4",
            "account-dashboard.member-since.c6647c",
        ):
            self.assertNotIn(legacy, self.html)

    # -- inline editor -----------------------------------------------------

    def test_editor_is_hidden_by_default_and_toggled_with_aria(self) -> None:
        toggle = re.search(r'<button[^>]*id="edit-profile-toggle"[^>]*>', self.html)
        self.assertIsNotNone(toggle)
        toggle_html = toggle.group(0)
        self.assertIn('aria-controls="profile-editor"', toggle_html)
        self.assertIn('aria-expanded="false"', toggle_html)
        self.assertIn('type="button"', toggle_html)

        editor_open = re.search(r'<section class="card profile-editor"[^>]*>', self.html)
        self.assertIsNotNone(editor_open)
        self.assertIn('id="profile-editor"', editor_open.group(0))
        self.assertRegex(editor_open.group(0), r"\shidden(\s|>)")

        self.assertIn("editor.removeAttribute('hidden')", self.html)
        self.assertIn("editor.setAttribute('hidden', '')", self.html)
        self.assertIn("setAttribute('aria-expanded'", self.html)

    def test_editor_matches_reference_two(self) -> None:
        editor = self.editor()
        self.assertIn("account-profile.basic-information.b0d5be", editor)
        for field in ("username", "email", "phone"):
            self.assertRegex(editor, rf'<input[^>]*name="{field}"')
            self.assertRegex(editor, rf'<label for="{field}">')
        self.assertIn("account-profile.save-changes.fa2984", editor)
        self.assertIn("{% csrf_token %}", editor)
        self.assertRegex(editor, r'<form method="post">')
        self.assertNotIn("cancel", editor.lower())
        self.assertNotIn("close", editor.lower())
        self.assertNotIn("placeholder", editor)
        self.assertNotRegex(editor, r'aria-hidden|role="dialog"')

    # -- navigation and i18n ----------------------------------------------

    def test_dashboard_navigation_is_gone(self) -> None:
        self.assertNotRegex(self.sidebar, r'<a[^>]*href="/dashboard/"')
        self.assertNotIn(">Dashboard<", self.sidebar)
        for target in ("/profile/", "/profile/security/", "/index.html#price", "/dashboard/usage/"):
            self.assertIn(f'href="{target}"', self.sidebar)
        self.assertIn('target="_blank"', self.sidebar)
        self.assertIn('rel="noopener"', self.sidebar)
        self.assertIn("accounts/_sidebar.html", self.html)

    def test_sidebar_has_no_subscription_heading(self) -> None:
        self.assertNotIn("account-dashboard.subscription.8fde48", self.sidebar)
        self.assertNotIn(">Subscription</span></h3>", self.sidebar)

    def test_sidebar_usage_precedes_plans(self) -> None:
        usage = self.sidebar.index("account-dashboard.usage.0bb186")
        plans = self.sidebar.index("account-dashboard.plans.cf2e5f")
        self.assertLess(usage, plans)

    def test_sidebar_sections_do_not_add_extra_vertical_gap(self) -> None:
        match = re.search(r"body\.account-page \.sidebar \.section\s*\{([^}]+)\}", self.css)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertIn("margin-bottom: 0;", match.group(1))

    def test_edit_avatar_translations_in_source(self) -> None:
        entry = self.i18n.get("account-profile.edit-avatar.55e04a")
        self.assertIsNotNone(entry)
        self.assertEqual(entry.get("en"), "Edit Avatar")
        self.assertEqual(entry.get("zh-CN"), "编辑头像")
        self.assertEqual(entry.get("zh-TW"), "編輯頭像")

    # -- styles ------------------------------------------------------------

    def test_profile_styles_are_scoped_flat_and_responsive(self) -> None:
        css = self.css
        base_start = css.index("Profile page (merged dashboard)")
        base_end = css.index("Responsive layout", base_start)
        base = css[base_start:base_end]
        self.assertNotIn("gradient(", base)
        for selector_line in base.splitlines():
            stripped = selector_line.strip()
            if stripped.endswith("{") and not stripped.startswith("@"):
                self.assertTrue(
                    stripped.startswith("body.account-page"),
                    f"unscoped selector: {stripped}",
                )

        narrow_start = css.index("Profile page (merged dashboard) — narrow viewports")
        narrow = css[narrow_start:]
        self.assertIn("@media (max-width: 760px)", narrow)
        self.assertIn("@media (max-width: 420px)", narrow)
        self.assertIn("flex-direction: column", narrow)
        self.assertIn(".profile-details .info-grid", narrow)

        usage_rule = re.search(r"\.profile-plan-usage\s*\{([^}]*)\}", css, re.S)
        self.assertIsNotNone(usage_rule)
        self.assertIn("grid-template-columns: repeat(2, minmax(0, 1fr))", usage_rule.group(1))

        plan_rule = re.search(r"\.profile-plan-head\s*\{([^}]*)\}", css, re.S)
        self.assertIsNotNone(plan_rule)
        self.assertIn("justify-content: space-between", plan_rule.group(1))

        avatar_rule = re.search(r"\.profile-avatar \.avatar\s*\{([^}]*)\}", css, re.S)
        self.assertIsNotNone(avatar_rule)
        self.assertIn("border-radius: 50%", avatar_rule.group(1))
        self.assertIn("width: 88px", avatar_rule.group(1))


if __name__ == "__main__":
    unittest.main()
