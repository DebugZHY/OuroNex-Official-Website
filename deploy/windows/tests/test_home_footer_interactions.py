"""Home footer social alert and navigation interaction tests."""

from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def run_node(source: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", "-e", source],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


class HomeFooterInteractionTests(unittest.TestCase):
    def test_social_controls_show_native_coming_soon_alert(self) -> None:
        result = run_node(
            r"""
const assert = require('node:assert/strict');
const api = require('./assets/home.js');
assert.equal(typeof api.showComingSoon, 'function');
assert.equal(typeof api.handleComingSoon, 'function');
assert.equal(api.COMING_SOON_SELECTOR, '[data-coming-soon]');
const alerts = [];
const view = { alert(message) { alerts.push(message); } };
assert.equal(api.showComingSoon(view), true);
assert.deepEqual(alerts, ['Coming soon']);
const trigger = { tagName: 'BUTTON' };
let prevented = 0;
const event = {
  button: 0,
  target: { closest(selector) { return selector === api.COMING_SOON_SELECTOR ? trigger : null; } },
  preventDefault() { prevented += 1; }
};
assert.equal(api.handleComingSoon(event, view), true);
assert.equal(prevented, 1);
assert.deepEqual(alerts, ['Coming soon', 'Coming soon']);
"""
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_footer_navigation_uses_the_home_section_scroller(self) -> None:
        result = run_node(
            r"""
const assert = require('node:assert/strict');
const api = require('./assets/home.js');
assert.equal(api.NAV_LINK_SELECTOR, '.nav-primary a[href], .footer-nav a[href]');
"""
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)


if __name__ == "__main__":
    unittest.main()
