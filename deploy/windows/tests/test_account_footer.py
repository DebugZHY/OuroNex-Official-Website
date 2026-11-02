import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ACCOUNTS = ROOT / "backend" / "templates" / "accounts"
COPYRIGHT = "Copyright © 2026 OuroNex Technology Company Limited. All Rights Reserved."


class AccountFooterTests(unittest.TestCase):
    def test_footer_uses_the_exact_fixed_copyright_line(self) -> None:
        footer = (ACCOUNTS / "_footer.html").read_text(encoding="utf-8")
        self.assertEqual(footer.count(COPYRIGHT), 1)
        self.assertEqual(footer.count("<p>"), 1)
        self.assertNotIn("data-i18n", footer)

    def test_every_dashboard_tab_renders_the_shared_footer(self) -> None:
        for name in ("profile.html", "security.html", "token_usage.html"):
            template = (ACCOUNTS / name).read_text(encoding="utf-8")
            with self.subTest(template=name):
                self.assertEqual(
                    template.count("{% include 'accounts/_footer.html' %}"),
                    1,
                )
                self.assertLess(
                    template.index("{% include 'accounts/_footer.html' %}"),
                    template.index("</main>"),
                )

    def test_short_pages_keep_the_footer_at_the_content_bottom(self) -> None:
        css = (ROOT / "assets" / "account.css").read_text(encoding="utf-8")
        main = re.search(r"body\.account-page \.main \{(?P<body>[^}]*)\}", css)
        footer = re.search(r"body\.account-page \.account-footer \{(?P<body>[^}]*)\}", css)
        if main is None or footer is None:
            self.fail("main/footer layout rules are missing")
        main_body = main.group("body")
        footer_body = footer.group("body")
        self.assertIn("display: flex", main_body)
        self.assertIn("flex-direction: column", main_body)
        self.assertIn("margin-top: auto", footer_body)
        self.assertIn("font: 400 13px/1.6 var(--account-font)", footer_body)
        self.assertIn("text-align: center", footer_body)

    def test_usage_keeps_a_minimum_gap_above_the_footer_rule(self) -> None:
        css = (ROOT / "assets" / "account.css").read_text(encoding="utf-8")
        gap = re.search(
            r"body\.account-page \.main > \.token-usage-board \{(?P<body>[^}]*)\}",
            css,
        )
        if gap is None:
            self.fail("usage-to-footer minimum gap rule is missing")
        self.assertIn("margin-bottom: 32px", gap.group("body"))


if __name__ == "__main__":
    unittest.main()
