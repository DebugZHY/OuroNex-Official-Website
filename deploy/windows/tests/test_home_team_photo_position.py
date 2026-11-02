"""Team portrait crop regression tests."""

from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
HOME_CSS = REPO_ROOT / "assets" / "home.css"


class TeamPhotoPositionTests(unittest.TestCase):
    def test_jake_and_siwei_photos_use_their_requested_vertical_positions(self) -> None:
        css = HOME_CSS.read_text(encoding="utf-8")
        self.assertIn(".team-photo img[src$='jake-chan.jpeg']{object-position:center 10%}", css)
        self.assertIn(".team-photo img[src$='siwei-liu.jpeg']{object-position:center 50%}", css)
        self.assertIn(".team-photo img{display:block;width:100%;height:100%;object-fit:cover;object-position:center", css)
        self.assertIn("aspect-ratio:4/5", css)

    def test_photo_box_stays_full_width_height_auto_with_cropping(self) -> None:
        """The smaller desktop portrait comes from the 1080px container, not the photo box."""
        css = HOME_CSS.read_text(encoding="utf-8")
        self.assertRegex(css, r"\.team-photo\{[^}]*\bwidth:100%")
        self.assertRegex(css, r"\.team-photo\{[^}]*\bheight:auto")
        self.assertRegex(css, r"\.team-photo\{[^}]*\baspect-ratio:4/5")
        self.assertRegex(css, r"\.team-photo\{[^}]*\boverflow:hidden")
        self.assertRegex(
            css,
            r"\.team-photo img\{[^}]*\bobject-fit:cover[^}]*\bobject-position:center"
            r"|\\.team-photo img\\{[^}]*\\bobject-position:center[^}]*\\bobject-fit:cover",
        )


if __name__ == "__main__":
    unittest.main()
