"""Static regression tests for the Account Details card fields on Profile.

Scope (details card only):

* the heading keeps the translated Account Details label and appends the
  untranslated username after a literal spaced hyphen;
* exactly six account fields in order: Username, Email, Phone, UID,
  Member Since, Last Login, reusing the existing profile translation keys;
* every value falls back to the ASCII ``-`` and the user data stays
  untranslated while the two dates keep ``data-i18n-date``;
* the avatar column, Edit Avatar control and the rest of the page are untouched.

Everything here is source inspection: no browser, no server, no database.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PROFILE_HTML = REPO_ROOT / "backend" / "templates" / "accounts" / "profile.html"
PROFILE_I18N = REPO_ROOT / "assets" / "i18n" / "account-profile.json"

DETAILS_SECTION = re.compile(r'<section class="card profile-details".*?</section>', re.S)

HEADING_KEY = "account-profile.account-details.a951f4"

FIELD_KEYS = (
    "account-profile.username.84c290",
    "account-profile.email.84add5",
    "account-profile.phone.77064d",
    "account-profile.uid.d946ad",
    "account-profile.member-since.c6647c",
    "account-profile.last-login.2df48a",
)

FIELD_LABELS = {
    "account-profile.username.84c290": "Username",
    "account-profile.email.84add5": "Email",
    "account-profile.phone.77064d": "Phone",
    "account-profile.uid.d946ad": "UID",
    "account-profile.member-since.c6647c": "Member Since",
    "account-profile.last-login.2df48a": "Last Login",
}

USER_INPUT_VALUES = {
    "account-profile.username.84c290": '<p data-user-input>{{ user.username|default:"-" }}</p>',
    "account-profile.email.84add5": '<p data-user-input>{{ user.email|default:"-" }}</p>',
    "account-profile.phone.77064d": '<p data-user-input>{{ profile.phone|default:"-" }}</p>',
}

UID_VALUE = '<p>{{ profile.uid|default:"-" }}</p>'
MEMBER_SINCE_TIME = (
    '<time data-i18n-date="date" datetime="{{ user.date_joined|date:\'c\' }}">'
    '{{ user.date_joined|date:"M d, Y"|default:"-" }}</time>'
)
LAST_LOGIN_TIME = (
    '<time data-i18n-date="datetime" datetime="{{ user.last_login|date:\'c\' }}">'
    '{{ user.last_login|date:"M d, Y H:i"|default:"-" }}</time>'
)


class ProfileDetailsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = PROFILE_HTML.read_text(encoding="utf-8")
        cls.dictionary = json.loads(PROFILE_I18N.read_text(encoding="utf-8"))
        match = DETAILS_SECTION.search(cls.html)
        assert match is not None, "the profile-details section is required"
        cls.details = match.group(0)

    def info_items(self) -> list[str]:
        return re.findall(r'<div class="info-item">.*?</div>', self.details, re.S)

    def info_grid(self) -> str:
        match = re.search(r'<div class="info-grid">.*?</time></p>\s*</div>\s*</div>', self.details, re.S)
        assert match is not None, "the info-grid is required"
        return match.group(0)

    # -- heading -----------------------------------------------------------

    def test_heading_appends_the_username_after_a_literal_hyphen(self) -> None:
        heading = re.search(r"<h2[^>]*id=\"account-details-heading\"[^>]*>.*?</h2>", self.details, re.S)
        self.assertIsNotNone(heading, "the Account Details heading is required")
        markup = heading.group(0)
        self.assertIn(f'<span data-i18n="{HEADING_KEY}">Account Details</span>', markup)
        self.assertIn(
            '</span> - <span data-user-input>{{ user.username|default:"-" }}</span>',
            markup,
            "the heading must show 'Account Details - <username>'",
        )
        self.assertNotIn("data-i18n=\"account-profile.username", markup)

    # -- fields ------------------------------------------------------------

    def test_six_fields_render_in_the_required_order(self) -> None:
        keys = re.findall(r'data-i18n="(account-profile\.[a-z-]+\.[0-9a-f]+)"', self.details)
        label_keys = [key for key in keys if key in FIELD_KEYS]
        self.assertEqual(label_keys, list(FIELD_KEYS), "field order must be Username..Last Login")
        items = self.info_items()
        self.assertEqual(len(items), 6, f"expected six account fields, found {len(items)}")

    def test_each_field_uses_its_existing_label(self) -> None:
        for key, label in FIELD_LABELS.items():
            with self.subTest(key=key):
                self.assertIn(f'data-i18n="{key}">{label}</span>', self.details)
                self.assertIn(key, self.dictionary)
                self.assertEqual(self.dictionary[key]["en"], label)

    def test_values_and_ascii_dash_fallbacks(self) -> None:
        grid = self.info_grid()
        for key, markup in USER_INPUT_VALUES.items():
            with self.subTest(key=key):
                self.assertIn(markup, grid)
        self.assertIn(UID_VALUE, grid)
        self.assertIn(MEMBER_SINCE_TIME, grid)
        self.assertIn(LAST_LOGIN_TIME, grid)
        self.assertEqual(
            grid.count('|default:"-"'),
            6,
            "every field value needs the ASCII '-' fallback",
        )
        self.assertNotIn("\u2014", self.details, "the em dash fallback must be gone")
        self.assertNotIn("default:''", self.details, "blank values must fall back to '-'")

    def test_user_data_is_marked_and_dates_keep_i18n_date(self) -> None:
        for key in USER_INPUT_VALUES:
            with self.subTest(key=key):
                item = next(
                    (entry for entry in self.info_items() if key in entry), None
                )
                self.assertIsNotNone(item, key)
                self.assertIn("data-user-input", item)
                self.assertNotIn(f'data-i18n="{key}"', item[item.index("<p") :])
        uid_item = next(entry for entry in self.info_items() if "account-profile.uid.d946ad" in entry)
        self.assertNotIn("data-user-input", uid_item, "UID is not an editable user field")
        self.assertEqual(self.details.count('data-i18n-date="date"'), 1)
        self.assertEqual(self.details.count('data-i18n-date="datetime"'), 1)
        self.assertIn("datetime=\"{{ user.date_joined|date:'c' }}\"", self.details)
        self.assertIn("datetime=\"{{ user.last_login|date:'c' }}\"", self.details)

    # -- preserved surroundings -------------------------------------------

    def test_avatar_column_and_edit_control_are_preserved(self) -> None:
        for marker in (
            "{% if profile.avatar_url %}",
            'src="{{ profile.avatar_url }}"',
            "avatar-initials",
            'class="avatar-form"',
            'enctype="multipart/form-data"',
            'name="avatar"',
            "account-profile.edit-avatar.55e04a",
            'for="avatar-file"',
            'id="avatar-file"',
        ):
            self.assertIn(marker, self.details)

    def test_no_extra_profile_fields_are_added(self) -> None:
        for forbidden in ("first_name", "last_name", "date_of_birth", "company", "job_title"):
            self.assertNotIn(forbidden, self.details)
        self.assertNotIn("account-profile.basic-information.b0d5be", self.details)

    def test_every_translation_key_is_already_in_the_dictionary(self) -> None:
        keys = set(re.findall(r'data-i18n="(account-profile\.[^"]+)"', self.details))
        self.assertIn(HEADING_KEY, keys)
        for key in keys:
            with self.subTest(key=key):
                self.assertIn(key, self.dictionary, f"{key} needs no new dictionary entry")
        self.assertLessEqual(set(FIELD_KEYS), keys)


if __name__ == "__main__":
    unittest.main(verbosity=2)
