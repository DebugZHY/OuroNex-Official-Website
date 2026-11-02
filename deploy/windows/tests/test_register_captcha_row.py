"""The register page's verification row lines up as one strip.

The arithmetic challenge and the Answer field are siblings in a flex row. Centring
them (`align-items:center`) with a stray `margin-bottom:16px` on the input left the
two controls at different heights with offset baselines, so the row must stretch
instead and the Answer field must drop the stacking margin it inherits from
`.card input`.

Source inspection of the register template only.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
REGISTER_HTML = REPO_ROOT / "backend" / "templates" / "accounts" / "register.html"


def style_block() -> str:
    html = REGISTER_HTML.read_text(encoding="utf-8")
    match = re.search(r"<style>(.*?)</style>", html, re.S)
    assert match, "register.html has no <style> block"
    return match.group(1)


def declarations(selector: str) -> dict[str, str]:
    css = style_block()
    match = re.search(re.escape(selector) + r"\s*\{([^{}]*)\}", css)
    if not match:
        raise AssertionError(f"{selector}: no such rule in register.html")
    found = {}
    for declaration in match.group(1).split(";"):
        if ":" not in declaration:
            continue
        prop, _, value = declaration.partition(":")
        found[prop.strip()] = value.strip()
    return found


class CaptchaRowAlignmentTest(unittest.TestCase):
    def test_row_stretches_its_two_controls(self) -> None:
        row = declarations(".card .captcha-row")
        self.assertEqual(
            row.get("align-items"),
            "stretch",
            "centring a shorter box against a taller input offsets both edges",
        )
        self.assertEqual(row.get("display"), "flex")

    def test_answer_field_drops_the_stacking_margin(self) -> None:
        answer = declarations(".card .captcha-row input")
        self.assertEqual(
            answer.get("margin-bottom"),
            "0",
            ".card input carries margin-bottom:16px, which skews the row's centre line",
        )
        self.assertEqual(answer.get("flex"), "1")

    def test_challenge_box_centres_its_own_text(self) -> None:
        box = declarations(".card .captcha-q")
        self.assertEqual(
            box.get("display"),
            "flex",
            "the challenge is a flex item now, so its text needs its own centring",
        )
        self.assertEqual(box.get("align-items"), "center")
        self.assertEqual(box.get("padding"), "10px 16px")
        self.assertEqual(box.get("white-space"), "nowrap")


if __name__ == "__main__":
    unittest.main()
