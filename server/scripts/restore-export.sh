#!/usr/bin/env bash
# Restore a directory produced by export.sh into a database, using the dataset
# order recorded in that export's manifest.json (parents before children).
#
# Usage: restore-export.sh <EXPORT_DIR> [--dry-run]
#   EXPORT_DIR  directory containing manifest.json and the .csv files
#   --dry-run   print the restore plan without touching the database
#
# The target database must already have the schema (migrations + vendor schema
# applied); this script only loads rows, so it never changes structure.
# Connection comes from DATABASE_URL, loaded from server/.env when present.
# Backend: psql on PATH, else `docker exec -i ouronex-postgres psql`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SERVER_DIR"

CONTAINER_NAME="ouronex-postgres"

usage() { sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

DRY_RUN=0
EXPORT_DIR=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "ERROR: unknown option '$arg'" >&2; exit 2 ;;
    *) [ -z "$EXPORT_DIR" ] || { echo "ERROR: only one export directory is accepted" >&2; exit 2; }; EXPORT_DIR="$arg" ;;
  esac
done
[ -n "$EXPORT_DIR" ] || { usage >&2; exit 2; }

MANIFEST="$EXPORT_DIR/manifest.json"
[ -f "$MANIFEST" ] || { echo "ERROR: no manifest.json in $EXPORT_DIR" >&2; exit 1; }

# a native psql cannot open an MSYS-style path (/d/...), so hand it a mixed path
native_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

if [ -f .env ]; then
  # A variable that is already in the environment always wins (see export.sh): the restore target
  # is chosen by the caller, never by whatever server/.env happens to point at.
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|\#*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    key="${line%%=*}"
    key="${key#export }"
    key="${key//[[:space:]]/}"
    case "$key" in ''|*[!A-Za-z0-9_]*) continue ;; esac
    [ -n "${!key+x}" ] && continue
    export "$key=${line#*=}"
  done < .env
fi
DATABASE_URL="${DATABASE_URL:-}"

run_psql() { # psql options first: the connection target must be the LAST argument,
             # otherwise -c is parsed as an extra command and silently ignored
  if command -v psql >/dev/null 2>&1; then
    psql -X -q -v ON_ERROR_STOP=1 "$@" "$DATABASE_URL"
  else
    docker exec -i "$CONTAINER_NAME" psql -X -q -v ON_ERROR_STOP=1 "$@" "$DATABASE_URL"
  fi
}

# manifest.json is written one dataset per line, so plain line parsing is enough
# and needs no python/node (which cannot read this script's MSYS-style paths).
DATASETS=() TABLES=() FILES=()
while IFS= read -r line; do
  case "$line" in
    *'"dataset"'*'"source_table"'*'"file"'*)
      parsed="$(printf '%s' "$line" | sed -E 's/.*"dataset": "([^"]+)".*"source_table": "([^"]+)".*"file": "([^"]+)".*/\1|\2|\3/')"
      DATASETS+=("${parsed%%|*}")
      rest="${parsed#*|}"
      TABLES+=("${rest%%|*}")
      FILES+=("${rest#*|}")
      ;;
  esac
done < "$MANIFEST"

[ "${#DATASETS[@]}" -gt 0 ] || { echo "ERROR: manifest lists no datasets with a file" >&2; exit 1; }

# honour the recorded order, then anything the manifest listed but did not order
ORDER=()
if grep -q '"restore_order"' "$MANIFEST"; then
  order_line="$(grep '"restore_order"' "$MANIFEST")"
  order_list="$(printf '%s' "$order_line" | sed -E 's/.*\[(.*)\].*/\1/' | tr -d '"' | tr ',' ' ')"
  for name in $order_list; do ORDER+=("$name"); done
fi
for d in "${DATASETS[@]}"; do
  found=0
  for o in ${ORDER[@]+"${ORDER[@]}"}; do [ "$o" = "$d" ] && found=1 && break; done
  [ "$found" -eq 0 ] && ORDER+=("$d")
done

index_of() { local i=0; for d in "${DATASETS[@]}"; do [ "$d" = "$1" ] && { printf '%s' "$i"; return 0; }; i=$((i+1)); done; return 1; }

echo "export dir : $EXPORT_DIR"
echo "backend    : $(command -v psql >/dev/null 2>&1 && echo "psql" || echo "docker exec $CONTAINER_NAME psql")"
echo "restore order: $(printf '%s ' ${ORDER[@]+"${ORDER[@]}"})"

LOADED=0
for dataset in ${ORDER[@]+"${ORDER[@]}"}; do
  idx="$(index_of "$dataset")" || continue
  table="${TABLES[$idx]}"
  data_file="$(native_path "$EXPORT_DIR/${FILES[$idx]}")"
  [ -f "$EXPORT_DIR/${FILES[$idx]}" ] || { echo "ERROR: manifest names ${FILES[$idx]} but it is missing from $EXPORT_DIR" >&2; exit 1; }
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "would load $dataset: ${FILES[$idx]} -> \"$table\""
    continue
  fi
  # the target table must be empty: a restore is into a fresh database, and a
  # half-loaded export would otherwise fail on a duplicate key mid-way
  before="$(run_psql -At -c "SELECT count(*) FROM \"$table\"" | tr -d '\r')"
  case "$before" in
    ''|*[!0-9]*) echo "ERROR: could not read the row count of \"$table\" before loading ${FILES[$idx]} (got '$before')" >&2; exit 1 ;;
  esac
  [ "$before" -eq 0 ] || { echo "ERROR: \"$table\" already holds $before row(s) — restore into an empty database" >&2; exit 1; }
  run_psql -c "\\copy \"$table\" FROM '$data_file' WITH (FORMAT csv, HEADER true)"
  rows="$(run_psql -At -c "SELECT count(*) FROM \"$table\"" | tr -d '\r')"
  case "$rows" in
    ''|*[!0-9]*) echo "ERROR: could not read the row count of \"$table\" after loading ${FILES[$idx]} (got '$rows')" >&2; exit 1 ;;
  esac
  [ "$rows" -gt 0 ] || echo "WARNING: \"$table\" is empty after loading ${FILES[$idx]}"
  echo "loaded $dataset: ${FILES[$idx]} -> \"$table\" ($rows rows now in table)"
  LOADED=$((LOADED + 1))
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo "dry run: nothing was written"
  exit 0
fi
echo "Restore complete: $LOADED dataset(s) loaded into $(printf '%s' "$DATABASE_URL" | sed -E 's#(://)[^@/]*@#\1***@#')"
