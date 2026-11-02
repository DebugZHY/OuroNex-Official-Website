"""Hero headline typography and the retired Geist face.

Frozen contract pinned here:

1. ``.hero-copy h1`` — the ``SIDA - Superintelligent Design Agent`` headline — carries no
   family override (it inherits Manrope from the body) and keeps weight 500, the base
   ``clamp(52px,5vw,72px)`` size and the mobile step;
2. no Geist Sans face, font file or manifest entry lingers in the tree (both Geist passes
   were rejected by the owner);
3. the stylesheet's manifest digest matches the bytes on disk.

The SIDA directory rail is deliberately NOT pinned here: it was rebuilt as a quiet ruled
rail after this module was written, so its geometry and type belong to that section's own
tests.
"""

from __future__ import annotations

import hashlib
import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
HOME_CSS = REPO_ROOT / "assets" / "home.css"
MANIFEST = REPO_ROOT / "package-manifest.json"
FONT_DIR = REPO_ROOT / "assets" / "fonts"

HERO_SIZE = "clamp(52px,5vw,72px)"


def css_text() -> str:
    return HOME_CSS.read_text(encoding="utf-8", errors="replace")


def strip_media(body: str) -> str:
    """Drop every ``@media`` block so only base rules remain."""
    out, i = [], 0
    while True:
        start = body.find("@media", i)
        if start < 0:
            out.append(body[i:])
            return "".join(out)
        out.append(body[i:start])
        brace = body.find("{", start)
        depth, j = 0, brace
        while j < len(body):
            if body[j] == "{":
                depth += 1
            elif body[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        i = j + 1


def base_css() -> str:
    return strip_media(css_text())


def rule(selector: str, css: str | None = None) -> str | None:
    body = css if css is not None else css_text()
    found = None
    for match in re.finditer(r"([^{}]+)\{([^{}]*)\}", body):
        if selector in [part.strip() for part in match.group(1).split(",")]:
            found = match.group(2)
    return found


def media_block(query: str, css: str | None = None) -> str:
    body = css if css is not None else css_text()
    start = body.find(query)
    if start < 0:
        return ""
    depth, i = 0, body.find("{", start)
    origin = i
    while i < len(body):
        if body[i] == "{":
            depth += 1
        elif body[i] == "}":
            depth -= 1
            if depth == 0:
                return body[origin + 1:i]
        i += 1
    return ""


def declarations(block: str | None) -> dict[str, str]:
    out: dict[str, str] = {}
    if not block:
        return out
    for part in block.split(";"):
        if ":" not in part:
            continue
        name, value = part.split(":", 1)
        out[name.strip()] = value.strip()
    return out


class HeroHeadlineTest(unittest.TestCase):
    def test_headline_inherits_manrope_at_medium(self):
        decls = declarations(rule(".hero-copy h1", base_css()))
        self.assertTrue(decls, ".hero-copy h1 must keep a base rule")
        self.assertNotIn("font-family", decls, "the headline must inherit the body face")
        self.assertEqual(decls.get("font-weight"), "500")

    def test_headline_size_ladder_is_untouched(self):
        self.assertEqual(declarations(rule(".hero-copy h1", base_css())).get("font-size"), HERO_SIZE)
        self.assertEqual(declarations(rule(".hero-copy h1", media_block("@media(max-width:760px)")))
                         .get("font-size"), "clamp(34px,8vw,46px)")
        for query in ("@media(max-width:1200px)", "@media(max-width:1000px) and (min-width:761px)",
                      "@media(max-width:760px)"):
            inner = declarations(rule(".hero-copy h1", media_block(query)))
            self.assertNotIn("font-family", inner, query)
            self.assertNotIn("font-weight", inner, query)


class RetiredGeistTest(unittest.TestCase):
    def test_no_geist_face_or_asset_remains(self):
        self.assertNotIn("Geist", css_text())
        self.assertEqual([p.name for p in FONT_DIR.glob("geist*")], [])
        entries = {e["path"]: e for e in json.loads(MANIFEST.read_text(encoding="utf-8"))["files"]}
        self.assertEqual([p for p in entries if "geist" in p.lower()], [])


class ManifestTest(unittest.TestCase):
    def test_manifest_pins_the_current_stylesheet(self):
        entries = {e["path"]: e for e in json.loads(MANIFEST.read_text(encoding="utf-8"))["files"]}
        entry = entries["assets/home.css"]
        self.assertEqual(entry["sha256"], hashlib.sha256(HOME_CSS.read_bytes()).hexdigest())


if __name__ == "__main__":
    unittest.main()
