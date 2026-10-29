"""Audit HTML translation references against the canonical JSON dictionaries."""

from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
I18N = ROOT / 'assets' / 'i18n'
FILES = sorted(ROOT.glob('*.html')) + sorted((ROOT / 'news').glob('*.html')) + sorted((ROOT / 'backend' / 'templates').glob('**/*.html'))
KEY_REFERENCE = re.compile(r'\bdata-i18n(?:-(?:content|alt|aria-label|placeholder|title|value))?="([^"]+)"')
PAGE = re.compile(r'\bdata-i18n-page="([^"]+)"')
SCRIPT = re.compile(r'<script[^>]+src="([^"]+)"')
USER_VALUE = re.compile(r'<(?:input|textarea)\b[^>]*\bdata-i18n(?:-value|-dynamic)?\s*=', re.I)
EDITABLE_VALUE = re.compile(r'<[^>]+contenteditable[^>]+data-i18n\s*=', re.I)

errors = []
referenced = set()
entry_count = 0

for path in FILES:
    rel = path.relative_to(ROOT)
    text = path.read_text(encoding='utf-8')
    page_match = PAGE.search(text)
    if not page_match:
        errors.append(f'{rel}: missing data-i18n-page')
        continue
    page = page_match.group(1)
    shared_path = I18N / 'shared.json'
    page_path = I18N / f'{page}.json'
    dynamic_path = I18N / 'dynamic.json'
    for required in (shared_path, page_path):
        if not required.exists():
            errors.append(f'{rel}: missing {required.relative_to(ROOT)}')
    if 'data-i18n-dynamic' in text and not dynamic_path.exists():
        errors.append(f'{rel}: missing dynamic.json')
    dictionaries = {}
    for dictionary_path in (shared_path, page_path, dynamic_path):
        if dictionary_path.exists():
            data = json.loads(dictionary_path.read_text(encoding='utf-8'))
            dictionaries.update(data)
    keys = set(KEY_REFERENCE.findall(text))
    referenced.update(keys)
    for key in sorted(keys):
        if key not in dictionaries:
            errors.append(f'{rel}: unresolved key {key}')
    if USER_VALUE.search(text) or EDITABLE_VALUE.search(text):
        errors.append(f'{rel}: user-editable value has a translation annotation')
    scripts = SCRIPT.findall(text)
    expected = ['/assets/i18n/shared.js']
    if 'data-i18n-dynamic' in text:
        expected.append('/assets/i18n/dynamic.js')
    expected.extend([f'/assets/i18n/{page}.js', '/assets/i18n.js'])
    positions = []
    for resource in expected:
        try:
            positions.append(scripts.index(resource))
        except ValueError:
            errors.append(f'{rel}: missing script {resource}')
    if len(positions) == len(expected) and positions != sorted(positions):
        errors.append(f'{rel}: translation scripts are out of order')
    for earlier in ('assets/site.js', '../assets/site.js', '/assets/site.js'):
        if earlier in scripts and scripts.index(earlier) < scripts.index('/assets/i18n.js'):
            errors.append(f'{rel}: site.js runs before i18n.js')

for dictionary_path in sorted(I18N.glob('*.json')):
    data = json.loads(dictionary_path.read_text(encoding='utf-8'))
    entry_count += len(data)
    for key, entry in data.items():
        if set(entry) != {'en', 'zh-CN', 'zh-TW'} or any(not isinstance(value, str) or not value for value in entry.values()):
            errors.append(f'{dictionary_path.relative_to(ROOT)}:{key}: invalid language fields')

if errors:
    print('\n'.join(errors), file=sys.stderr)
    raise SystemExit(1)
print(f'OK: {len(FILES)} pages, {len(referenced)} referenced keys, {entry_count} dictionary entries.')
