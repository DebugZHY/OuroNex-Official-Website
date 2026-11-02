"""Focused tests for removing the Token Usage Model filter.

The Model select and every result-filtering path keyed on model are gone, while
model report data, the By model aggregation/tab/table, the Session filter and
the time-range filters stay intact.  Pure helper behaviour is executed with
Node; the rest is source/static analysis.  No browser or server is started.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
TOKEN_JS = REPO_ROOT / "assets" / "token-usage.js"
TOKEN_CSS = REPO_ROOT / "assets" / "token-usage.css"
TOKEN_HTML = REPO_ROOT / "backend" / "templates" / "accounts" / "token_usage.html"

NODE_HARNESS = r"""
const api = require(process.argv[2]);

function record(day, model, sessionId, input) {
  return {
    day: day,
    model: model,
    sessionId: sessionId,
    title: sessionId,
    calls: 1,
    input: input,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
  };
}

const records = api.normalizeRecords([
  record('2026-10-30', 'alpha', 's1', 10),
  record('2026-10-30', 'beta', 's1', 20),
  record('2026-10-28', 'alpha', 's2', 30),
  record('2026-10-10', 'alpha', 's3', 40),
  record('2026-09-01', 'beta', 's4', 50),
]);

const now = new Date(2026, 9, 30, 12, 0, 0);
const ids = (list) => list.map((item) => item.model + ':' + item.sessionId).sort();
const run = (filters) => api.filterRecords(records, Object.assign({ now: now }, filters));

const modelsAll = api.aggregateByModel(records).map((group) => group.key);
const totalsAll = {};
api.aggregateByModel(records).forEach((group) => { totalsAll[group.key] = group.total; });

const modelsAfterLegacyFilter = api.aggregateByModel(
  run({ range: 'all', model: 'alpha' })
).map((group) => group.key);

const sanitized = api.sanitizeRecord({
  day: '2026-10-30', model: '  alpha  ', sessionId: 's1',
});

process.stdout.write(JSON.stringify({
  all: ids(run({ range: 'all' })),
  range7d: ids(run({ range: '7d' })),
  legacyAlpha7d: ids(run({ range: '7d', model: 'alpha' })),
  legacyBeta7d: ids(run({ range: '7d', model: 'beta' })),
  unknownModelAll: ids(run({ range: 'all', model: 'does-not-exist' })),
  today: ids(run({ range: 'today' })),
  last30d: ids(run({ range: '30d' })),
  sessionS1All: ids(run({ range: 'all', session: 's1' })),
  sessionS2WithLegacyModel: ids(run({ range: 'all', session: 's2', model: 'beta' })),
  sessionS1Today: ids(run({ range: 'today', session: 's1' })),
  modelsAll: modelsAll,
  modelsAfterLegacyFilter: modelsAfterLegacyFilter,
  totalsAll: totalsAll,
  sanitizedModel: sanitized ? sanitized.model : null,
  hasAggregateByModel: typeof api.aggregateByModel === 'function',
  hasByModelTab: api.TAB_KEYS.indexOf('model') !== -1,
}));
"""


def find_node() -> str | None:
    override = os.environ.get("NODE_EXE")
    candidates = [override, shutil.which("node"), shutil.which("node.exe")]
    candidates.extend(
        [
            r"D:\nodejs\node.exe",
            r"C:\Program Files\nodejs\node.exe",
            r"C:\Program Files (x86)\nodejs\node.exe",
        ]
    )
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def node_path(path: Path) -> str:
    """Translate WSL paths for a Windows Node binary; pass through elsewhere."""
    text = str(path)
    node = find_node()
    if os.name == "nt" or not text.startswith("/") or not node or not node.lower().endswith(".exe"):
        return text
    try:
        converted = subprocess.run(
            ["wslpath", "-w", text],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return text
    converted_path = converted.stdout.strip()
    return converted_path or text


def filter_records_source(source: str) -> str:
    match = re.search(r"function filterRecords\(records, filters\) \{.*?\n  \}", source, re.S)
    if match is None:
        raise AssertionError("filterRecords helper not found")
    return match.group(0)


class TokenUsageModelFilterStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.js = TOKEN_JS.read_text(encoding="utf-8")
        cls.css = TOKEN_CSS.read_text(encoding="utf-8")
        cls.html = TOKEN_HTML.read_text(encoding="utf-8")

    def test_template_has_no_model_filter_control(self) -> None:
        self.assertNotIn("tu-model", self.html)
        self.assertNotIn("All models", self.html)
        self.assertNotRegex(self.html, r">\s*Model\s*</label>")

    def test_template_keeps_range_and_session_controls(self) -> None:
        self.assertIn('id="tu-range"', self.html)
        for value in ("today", "7d", "30d", "all"):
            self.assertIn(f'data-range="{value}"', self.html)
        self.assertIn('id="tu-session"', self.html)
        self.assertIn("All sessions", self.html)
        self.assertRegex(self.html, r'for="tu-session"[^>]*>Session</label>')

    def test_javascript_has_no_model_filter_wiring(self) -> None:
        for removed in ("tu-model", "state.model", "options.model"):
            self.assertNotIn(removed, self.js)
        self.assertIsNone(re.search(r"\bels\.model\b", self.js))
        self.assertNotIn("'All models'", self.js)
        self.assertNotIn('"All models"', self.js)
        body = filter_records_source(self.js)
        self.assertNotIn(".model", body, "filterRecords must not narrow results by model")

    def test_model_data_and_reporting_are_preserved(self) -> None:
        for marker in (
            "aggregateByModel",
            "renderModelTable",
            "TAB_KEYS = ['day', 'model', 'session']",
            "aggregateByModel: aggregateByModel",
            "model: model",
            "tu-tab-model",
            "tu-panel-model",
        ):
            self.assertIn(marker, self.js)
        self.assertIn('id="tu-tab-model"', self.html)
        self.assertIn('id="tu-panel-model"', self.html)
        self.assertIn("By model", self.html)

    def test_session_and_time_range_wiring_remain(self) -> None:
        for marker in (
            "els.session.addEventListener('change'",
            "els.range.addEventListener('click'",
            "state.session = event.target.value",
            "state.range = button.dataset.range",
            "renderAll()",
        ):
            self.assertIn(marker, self.js)
        self.assertIn(".tu-field", self.css)
        self.assertIn(".tu-select", self.css)
        self.assertIn(".tu-segmented", self.css)
        self.assertIn(".tu-toolbar", self.css)

    def test_board_states_and_refresh_stay(self) -> None:
        for marker in (
            "setBoardState('ready')",
            "setBoardState('error')",
            "loadData(false)",
            "loadData(true)",
            "tu-refresh",
        ):
            self.assertIn(marker, self.js)
        self.assertIn('id="tu-refresh"', self.html)
        self.assertIn('id="tu-error"', self.html)
        self.assertIn('id="tu-kpis"', self.html)
        self.assertIn('id="tu-chart"', self.html)


class TokenUsageModelFilterNodeTests(unittest.TestCase):
    NODE = find_node()

    def setUp(self) -> None:
        if not self.NODE:
            self.skipTest("Node executable not found")

    def run_node(self, *arguments: str, source: str | None = None) -> subprocess.CompletedProcess:
        with tempfile.TemporaryDirectory(prefix="token-usage-") as temporary:
            script = Path(temporary) / "harness.cjs"
            script.write_text(source or NODE_HARNESS, encoding="utf-8")
            forwarded = [
                node_path(Path(argument)) if argument.startswith("/") else argument
                for argument in arguments
            ]
            return subprocess.run(
                [self.NODE, node_path(script), *forwarded],
                cwd=str(REPO_ROOT),
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=120,
            )

    def test_token_usage_js_is_syntactically_valid(self) -> None:
        result = subprocess.run(
            [self.NODE, "--check", node_path(TOKEN_JS)],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=120,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_legacy_model_option_never_narrows_results(self) -> None:
        result = self.run_node(str(TOKEN_JS))
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)

        self.assertEqual(len(data["range7d"]), 3, data["range7d"])
        self.assertEqual(data["legacyAlpha7d"], data["range7d"])
        self.assertEqual(data["legacyBeta7d"], data["range7d"])
        self.assertEqual(data["all"], data["unknownModelAll"])
        self.assertEqual(len(data["all"]), 5)
        self.assertTrue(any(item.startswith("beta:") for item in data["legacyAlpha7d"]))
        self.assertTrue(any(item.startswith("alpha:") for item in data["legacyBeta7d"]))

    def test_time_range_filtering_still_works(self) -> None:
        result = self.run_node(str(TOKEN_JS))
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)

        self.assertEqual(len(data["today"]), 2, data["today"])
        self.assertEqual(len(data["range7d"]), 3, data["range7d"])
        self.assertEqual(len(data["last30d"]), 4, data["last30d"])
        self.assertEqual(len(data["all"]), 5)

    def test_session_filter_stays_working_and_independent(self) -> None:
        result = self.run_node(str(TOKEN_JS))
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)

        self.assertEqual(data["sessionS1All"], ["alpha:s1", "beta:s1"])
        self.assertEqual(data["sessionS2WithLegacyModel"], ["alpha:s2"])
        self.assertEqual(data["sessionS1Today"], ["alpha:s1", "beta:s1"])

    def test_model_aggregation_and_data_survive(self) -> None:
        result = self.run_node(str(TOKEN_JS))
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)

        self.assertTrue(data["hasAggregateByModel"])
        self.assertTrue(data["hasByModelTab"])
        self.assertEqual(data["modelsAll"], ["alpha", "beta"])
        self.assertEqual(data["modelsAfterLegacyFilter"], ["alpha", "beta"])
        self.assertEqual(data["totalsAll"], {"alpha": 80, "beta": 70})
        self.assertEqual(data["sanitizedModel"], "alpha")


if __name__ == "__main__":
    unittest.main()
