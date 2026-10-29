"""Compile canonical JSON translation dictionaries into ordered, non-fetching JS files."""

from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets' / 'i18n'
LANGUAGES = {'en', 'zh-CN', 'zh-TW'}
compiled = 0

for path in sorted(SOURCE.glob('*.json')):
    entries = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(entries, dict):
        raise ValueError(f'{path.name}: root must be an object')
    for key, entry in entries.items():
        if not isinstance(entry, dict) or set(entry) != LANGUAGES:
            raise ValueError(f'{path.name}:{key}: expected exactly en, zh-CN and zh-TW')
        if any(not isinstance(entry[language], str) or not entry[language] for language in LANGUAGES):
            raise ValueError(f'{path.name}:{key}: translations must be non-empty strings')
    payload = json.dumps(entries, ensure_ascii=False, indent=2)
    output = SOURCE / f'{path.stem}.js'
    output.write_text(
        f'// Generated from assets/i18n/{path.name}. Edit the JSON, then run python scripts/i18n_compile.py.\n'
        'window.OuroNexI18n = Object.assign(window.OuroNexI18n || {}, ' + payload + ');\n',
        encoding='utf-8'
    )
    compiled += 1

print(f'Compiled {compiled} dictionaries.')
