#!/usr/bin/env python3
"""Check that a migration's up and down files create and drop the same objects.

Usage:
    python server/db/migrations/check_parity.py [basename]

Default basename is 0001_app_profile. Standard library only; needs no database.
Exits 0 when the created and dropped object sets match, 1 otherwise.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

CREATE_TABLE = re.compile(
    r'\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w$]*|"[^"]+")', re.I)
CREATE_INDEX = re.compile(
    r'\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w$]*|"[^"]+")', re.I)
DROP_TABLE = re.compile(
    r'\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][\w$]*|"[^"]+")', re.I)
DROP_INDEX = re.compile(
    r'\bDROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?([A-Za-z_][\w$]*|"[^"]+")', re.I)


def strip_sql_noise(sql: str) -> str:
    """Remove block and line comments so prose can never be parsed as DDL."""
    sql = re.sub(r'/\*.*?\*/', ' ', sql, flags=re.S)
    return re.sub(r'--[^\n]*', ' ', sql)


def unquote(name: str) -> str:
    return name[1:-1] if name.startswith('"') and name.endswith('"') else name


def collect(sql: str):
    tables = {unquote(m.group(1)) for m in CREATE_TABLE.finditer(sql)}
    indexes = {unquote(m.group(1)) for m in CREATE_INDEX.finditer(sql)}
    drop_tables = {unquote(m.group(1)) for m in DROP_TABLE.finditer(sql)}
    drop_indexes = {unquote(m.group(1)) for m in DROP_INDEX.finditer(sql)}
    return tables, indexes, drop_tables, drop_indexes


def main(argv) -> int:
    basename = argv[1] if len(argv) > 1 else '0001_app_profile'
    up_path = HERE / f'{basename}.sql'
    down_path = HERE / f'{basename}.down.sql'

    missing = [str(p) for p in (up_path, down_path) if not p.is_file()]
    if missing:
        print('MISSING: ' + ', '.join(missing))
        print('PARITY FAIL - missing file(s)')
        return 1

    up_tables, up_indexes, _, _ = collect(strip_sql_noise(up_path.read_text(encoding='utf-8')))
    _, _, down_tables, down_indexes = collect(strip_sql_noise(down_path.read_text(encoding='utf-8')))

    print(f'up:   {up_path.name}')
    print(f'down: {down_path.name}')

    problems = []
    for label, created, dropped in (('tables', up_tables, down_tables),
                                    ('indexes', up_indexes, down_indexes)):
        print(f'  {label}: created={sorted(created) or "[]"} dropped={sorted(dropped) or "[]"}')
        if created != dropped:
            problems.append(f'{label}: created {sorted(created)} != dropped {sorted(dropped)}')
    if not up_tables and not up_indexes:
        problems.append('up file creates no tables or indexes')

    if problems:
        print('PARITY FAIL - ' + '; '.join(problems))
        return 1

    total = len(up_tables) + len(up_indexes)
    print(f'PARITY OK - {total} created object(s) match {total} dropped object(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))