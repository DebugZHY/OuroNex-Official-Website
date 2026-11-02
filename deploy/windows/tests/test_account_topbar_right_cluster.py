"""Dashboard topbar: the signed-in cluster sits on the right edge.

Scope:

* ``body.account-page .account-brand`` is the only element in the topbar with an
  ``auto`` margin, and it is a right margin: the brand keeps the left edge while
  avatar + username + Sign out are pushed to the right;
* the language switcher keeps no auto margin, so when it is re-enabled it joins
  that right-hand cluster instead of splitting the free space in two;
* the logout form keeps its 10px gap and stays the last control;
* the topbar keeps centring its items vertically.

Source inspection of ``assets/account.css`` only: no browser, no server.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
ACCOUNT_CSS = REPO_ROOT / "assets" / "account.css"
TOPBAR_HTML = REPO_ROOT / "backend" / "templates" / "accounts" / "_topbar.html"

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")

BRAND = "body.account-page .account-brand"
TOPBAR = "body.account-page .account-topbar"
SWITCHER = "body.account-page .account-topbar .language-switcher"
IDENTITY = "body.account-page .account-identity"
LOGOUT = "body.account-page .account-logout"

RIGHT_CLUSTER = (IDENTITY, LOGOUT)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def sheet() -> str:
    return COMMENT_RE.sub("", read(ACCOUNT_CSS))


def normalise(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").lower())


def rules(css: str) -> list[tuple[list[str], dict[str, str]]]:
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


def base(css: str, selector: str) -> dict[str, str]:
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
                return css[start + 1 : position]
    return ""


class TopbarRightClusterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.css = sheet()
        cls.mobile = media_block(cls.css, "@media (max-width: 760px)")

    def test_brand_pushes_the_rest_of_the_bar_right(self) -> None:
        brand = base(self.css, BRAND)
        self.assertEqual(
            brand.get("margin-right"),
            "auto",
            "the brand must absorb the free space so the signed-in cluster reaches the right edge",
        )
        self.assertNotIn(
            "margin-left",
            brand,
            "auto margins on both sides would centre the brand instead of pinning it left",
        )

    def test_the_right_cluster_carries_no_competing_auto_margin(self) -> None:
        self.assertEqual(
            base(self.css, SWITCHER).get("margin-left"),
            "0",
            "a second auto margin would split the free space and leave the cluster mid-bar",
        )
        for selector in RIGHT_CLUSTER:
            declarations = base(self.css, selector)
            for prop in ("margin-left", "margin-right"):
                self.assertNotEqual(
                    declarations.get(prop),
                    "auto",
                    f"{selector}: the cluster is pushed by the brand, not by itself",
                )

    def test_mobile_switcher_does_not_reintroduce_an_auto_margin(self) -> None:
        self.assertTrue(self.mobile, "the 760px block must exist")
        switcher = base(self.mobile, SWITCHER)
        self.assertEqual(switcher.get("order"), "2")
        self.assertEqual(
            switcher.get("margin-left"),
            "0",
            "the mobile block must not restore margin-left:auto on the switcher",
        )

    def test_narrow_bar_keeps_the_cluster_right_aligned(self) -> None:
        narrow = media_block(self.css, "@media (max-width: 351px)")
        self.assertTrue(narrow, "the ≤351px block must exist")
        brand = base(narrow, BRAND)
        self.assertEqual(
            brand.get("flex-basis"),
            "100%",
            "under 352px the brand takes its own line instead of stranding Sign out",
        )
        self.assertEqual(brand.get("margin-right"), "0")
        self.assertEqual(
            base(narrow, IDENTITY).get("margin-left"),
            "auto",
            "the second line still pushes avatar, username and Sign out to the right edge",
        )

    def test_cluster_order_and_gap_are_unchanged(self) -> None:
        self.assertEqual(base(self.css, TOPBAR).get("align-items"), "center")
        self.assertEqual(
            base(self.css, LOGOUT).get("margin-left"),
            "10px",
            "Sign out keeps its 10px separation from the username",
        )
        self.assertEqual(base(self.mobile, LOGOUT).get("order"), "4")
        self.assertEqual(base(self.mobile, IDENTITY).get("order"), "3")

    def test_source_order_still_ends_with_the_logout_form(self) -> None:
        topbar = read(TOPBAR_HTML)
        positions = [
            topbar.find('class="account-brand"'),
            topbar.find('class="account-identity"'),
            topbar.find('class="account-logout"'),
            topbar.find("data-logout-form"),
        ]
        self.assertNotIn(-1, positions, "a topbar control is missing")
        self.assertEqual(positions, sorted(positions), "brand, identity, Sign out in source order")
        self.assertRegex(topbar, r"</form>\s*</header>")


if __name__ == "__main__":
    unittest.main()
