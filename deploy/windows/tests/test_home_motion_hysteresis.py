"""Behavioural regressions for observer hysteresis and transition dwell."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


@unittest.skipUnless(shutil.which('node'), 'Node.js is required')
class HomeMotionHysteresisTests(unittest.TestCase):
    maxDiff = None

    def test_edge_hysteresis_and_transition_dwell(self):
        source = ROOT / 'assets' / 'home.js'
        harness = r'''
import { pathToFileURL } from 'node:url';
const api = (await import(pathToFileURL(process.argv[2]).href)).default;
  const item = {
    attrs: {}, parentElement: {}, style: {setProperty() {}},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; },
    closest() { return null; }, toggleAttribute() {},
    removeAttribute(name) { delete this.attrs[name]; },
  };
  const body = {attrs: {}, style: {setProperty() {}}, querySelectorAll() { return []; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] ?? null; }};
  let callback, options;
  class Observer {
    constructor(cb, opts) { callback = cb; options = opts; }
    observe() {} disconnect() {}
  }
  let now = 0, nextTimer = 0;
  const timers = new Map();
  const view = {
    innerWidth: 1440, innerHeight: 900, IntersectionObserver: Observer,
    matchMedia() { return {matches: false, addEventListener() {}}; },
    addEventListener() {}, scrollTo() {},
    performance: {now() { return now; }},
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, {at: now + delay, fn}); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  function advance(ms) {
    now += ms;
    for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at <= now && timers.has(id)) { timers.delete(id); timer.fn(); }
    }
  }
  const doc = {
    body,
    querySelector(selector) { return selector === 'main#main.home-scroll' ? {clientHeight: 900} : null; },
    querySelectorAll() { return [item]; },
  };
  api.initSectionMotion(doc, view);
  item.attrs['data-motion-variant'] = 'flip';
  function entry(ratio, intersecting = true) {
    callback([{target: item, isIntersecting: intersecting, intersectionRatio: ratio}]);
  }
  entry(.2);
  const states = [item.attrs['data-motion-state']];
  for (const [ratio, intersecting] of [[.08, true], [.01, true], [.03, true], [.03, true], [.08, true], [0, false], [.03, true], [.08, true]]) {
    advance(1200); entry(ratio, intersecting); states.push(item.attrs['data-motion-state']);
  }
  item.attrs = {};
  now = 0; timers.clear();
  entry(.2);
  const dwellStates = [item.attrs['data-motion-state']];
  advance(10); entry(0, false); dwellStates.push(item.attrs['data-motion-state']);
  advance(10); entry(.2); dwellStates.push(item.attrs['data-motion-state']);
  advance(1000); dwellStates.push(item.attrs['data-motion-state']);
  advance(200); entry(0, false); dwellStates.push(item.attrs['data-motion-state']);
  advance(10); entry(.2); dwellStates.push(item.attrs['data-motion-state']);
  advance(600); dwellStates.push(item.attrs['data-motion-state']);
  console.log(JSON.stringify({thresholds: options.threshold, states, dwellStates}));
'''
        with tempfile.TemporaryDirectory(prefix='ouronex-motion-dwell-', dir=r'D:\tmp') as temp:
            script = Path(temp) / 'harness.mjs'
            script.write_text(harness, encoding='utf-8')
            result = subprocess.run(
                ['node', str(script), str(source)], capture_output=True,
                text=True, encoding='utf-8', check=False, timeout=30,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        observed = json.loads(result.stdout)
        self.assertEqual(observed['thresholds'][:3], [0, .02, .08])
        self.assertEqual(observed['states'], ['in', 'in', 'out', 'out', 'out', 'in', 'out', 'out', 'in'])
        self.assertEqual(
            observed['dwellStates'],
            ['in', 'in', 'in', 'in', 'out', 'out', 'in'],
            'Animation callbacks must coalesce during enter/exit dwell, then allow a genuine later transition.',
        )


if __name__ == '__main__':
    unittest.main()
