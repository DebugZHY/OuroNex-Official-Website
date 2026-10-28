#!/usr/bin/env bash
# Data-sovereignty export: PayKit customers/products, Stack Auth users, PayKit
# subscriptions, payment/invoice rows and the app-owned user<->customer mapping to
# CSV plus a manifest.json, so an empty database can be restored from the export
# with every subscription still attributable to its user. Discovery is done at
# runtime from information_schema; tables are matched by known-name candidates
# (never a loose %user%).
#
# Usage: export.sh [--dry-run] [--help] [OUTPUT_DIR]
#   --dry-run   resolve configuration and print the exact plan, no database needed
#   --help      show this help
#   OUTPUT_DIR  target directory (default: server/exports/<timestamp>/)
#
# Connection comes from DATABASE_URL, loaded from server/.env when present.
# Backend: psql on PATH, else `docker exec -i ouronex-postgres psql`.
# Credentials are never printed; the database URL is redacted in all output.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SERVER_DIR"

CONTAINER_NAME="ouronex-postgres"
USER_TABLE_CANDIDATES=(projectuser project_user stack_users stack_auth_user stack_auth_users users user neon_auth_user)
SUBSCRIPTION_TABLE_CANDIDATES=(paykit_subscription paykit_subscriptions)
PAYMENT_TABLE_CANDIDATES=(paykit_invoice paykit_invoices paykit_payment paykit_payments)
OWNER_LINK_TABLE_CANDIDATES=(app_billing_owner billing_owner app_user_billing)
CUSTOMER_TABLE_CANDIDATES=(paykit_customer paykit_customers)
PRODUCT_TABLE_CANDIDATES=(paykit_product paykit_products)
CONTACT_TABLE_CANDIDATES=(contactchannel contact_channel)

usage() {
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

DRY_RUN=0
OUT_ARG=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "ERROR: unknown option '$arg'" >&2; usage >&2; exit 2 ;;
    *)
      if [ -n "$OUT_ARG" ]; then echo "ERROR: only one output directory is accepted" >&2; exit 2; fi
      OUT_ARG="$arg"
      ;;
  esac
done

# Load server/.env when present, without echoing it.
# A variable that is already in the environment always wins: otherwise a caller that points this
# script at one database (a scratch copy, a restored database) would silently export another.
if [ -f .env ]; then
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

redact() { printf '%s' "$1" | sed -E 's#(://)[^@/]*@#\1***@#'; }

OUT_DIR="${OUT_ARG:-exports/$(date +%Y%m%d-%H%M%S)}"

# ----------------------------------------------------------------- backends --
BACKEND=""
BACKEND_NOTE=""
if command -v psql >/dev/null 2>&1; then
  BACKEND="psql"
  BACKEND_NOTE="psql on PATH: $(command -v psql)"
elif command -v docker >/dev/null 2>&1; then
  if docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" >/dev/null 2>&1; then
    BACKEND="docker"
    BACKEND_NOTE="docker exec -i $CONTAINER_NAME psql (compose container is running)"
  else
    BACKEND_NOTE="docker is installed but container '$CONTAINER_NAME' is not running"
  fi
else
  BACKEND_NOTE="neither psql nor docker is available on PATH"
fi

BACKEND_HELP="Install a PostgreSQL client (psql), or start the compose database:
  cd \"$SERVER_DIR\" && docker compose up -d postgres
Then re-run: bash scripts/export.sh"

DISCOVER_SQL="SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name"

list_candidates() { local IFS=' '; printf '%s' "$*"; }

# ----------------------------------------------------------------- dry-run ---
if [ "$DRY_RUN" -eq 1 ]; then
  echo "== OuroNex data export plan (dry run) =="
  echo "server dir      : $SERVER_DIR"
  echo "output dir      : $OUT_DIR"
  if [ -n "$DATABASE_URL" ]; then
    echo "database (redacted): $(redact "$DATABASE_URL")"
  else
    echo "database        : DATABASE_URL is not set (server/.env missing or empty)"
  fi
  echo "table discovery : $DISCOVER_SQL"
  echo "backend         : ${BACKEND:-none} — $BACKEND_NOTE"
  echo
  echo "dataset: customers    -> customers.csv    (optional: PayKit customer rows; parent of subscriptions)"
  echo "  candidate tables: $(list_candidates "${CUSTOMER_TABLE_CANDIDATES[@]}")"
  echo "  SQL: COPY (SELECT * FROM \"<detected>\") TO STDOUT WITH CSV HEADER"
  echo "dataset: products     -> products.csv     (optional: PayKit product rows; parent of subscriptions)"
  echo "  candidate tables: $(list_candidates "${PRODUCT_TABLE_CANDIDATES[@]}")"
  echo "  SQL: COPY (SELECT * FROM \"<detected>\") TO STDOUT WITH CSV HEADER"
  echo "dataset: users         -> users.csv         (required: Stack Auth user table)"
  echo "  candidate tables: $(list_candidates "${USER_TABLE_CANDIDATES[@]}")"
  echo "  SQL: COPY (SELECT * FROM \"<detected>\" [WHERE \"tenancyId\" = ours]) TO STDOUT WITH CSV HEADER"
  echo "  scope: when the user table has a tenancyId column, only the tenancy of HEXCLAVE_PROJECT_ID is exported"
  echo "dataset: contact_channels -> contact_channels.csv (optional: emails/phones of those users)"
  echo "  candidate tables: $(list_candidates "${CONTACT_TABLE_CANDIDATES[@]}")"
  echo "  on the current Stack Auth schema the email is NOT in the user row, so skipping this loses user emails"
  echo "dataset: subscriptions -> subscriptions.csv (required: PayKit subscription table)"
  echo "  candidate tables: $(list_candidates "${SUBSCRIPTION_TABLE_CANDIDATES[@]}")"
  echo "  SQL: COPY (SELECT * FROM \"<detected>\") TO STDOUT WITH CSV HEADER"
  echo "dataset: payments      -> payments.csv      (optional: skipped loudly if absent)"
  echo "  candidate tables: $(list_candidates "${PAYMENT_TABLE_CANDIDATES[@]}")"
  echo "  SQL: COPY (SELECT * FROM \"<detected>\") TO STDOUT WITH CSV HEADER"
  echo "dataset: owner_links   -> owner_links.csv   (optional: user id <-> PayKit customer id mapping)"
  echo "  candidate tables: $(list_candidates "${OWNER_LINK_TABLE_CANDIDATES[@]}")"
  echo "  without it a restored subscriptions.csv cannot be attributed to a user"
  echo "  SQL: COPY (SELECT * FROM \"<detected>\") TO STDOUT WITH CSV HEADER"
  echo
  echo "manifest        : $OUT_DIR/manifest.json (source table, row count, sha256 per file)"
  echo "required tables missing -> exit 1 with the discovered table list"
  if [ -z "$BACKEND" ]; then
    echo
    echo "NOTE: ${BACKEND_NOTE}. A real export would exit 1 with:"
    echo "$BACKEND_HELP" | sed 's/^/  /'
  fi
  exit 0
fi

# ------------------------------------------------------------ real export ---
die() { echo "ERROR: $*" >&2; exit 1; }

[ -n "$DATABASE_URL" ] || die "DATABASE_URL is not set. Put it in $SERVER_DIR/.env (see .env.example) before exporting."
if [ -z "$BACKEND" ]; then
  die "$BACKEND_NOTE. $BACKEND_HELP"
fi

run_sql() { # -At: single column, no align; CR stripped (Windows psql emits CRLF)
  if [ "$BACKEND" = "psql" ]; then
    psql -X -q -v ON_ERROR_STOP=1 -At -c "$1" "$DATABASE_URL" | tr -d '\r'
  else
    docker exec -i "$CONTAINER_NAME" psql -X -q -v ON_ERROR_STOP=1 -At -c "$1" "$DATABASE_URL" | tr -d '\r'
  fi
}

copy_csv() { # streams CSV for $1 (table); $2 = optional WHERE expression
  local table="$1" where="${2:-}" select="SELECT * FROM \"$1\""
  [ -n "$where" ] && select="SELECT * FROM \"$1\" WHERE $where"
  if [ "$BACKEND" = "psql" ]; then
    psql -X -q -v ON_ERROR_STOP=1 -c "COPY ($select) TO STDOUT WITH CSV HEADER" "$DATABASE_URL"
  else
    docker exec -i "$CONTAINER_NAME" psql -X -q -v ON_ERROR_STOP=1 -c "COPY ($select) TO STDOUT WITH CSV HEADER" "$DATABASE_URL"
  fi
}

safe_identifier() { [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; }

mapfile -t TABLES < <(run_sql "$DISCOVER_SQL")
[ "${#TABLES[@]}" -gt 0 ] || die "no base tables found in schema 'public' — is the database initialised? (backend: $BACKEND)"

in_list() { local needle="$1"; shift; local t; for t in "$@"; do [ "$t" = "$needle" ] && return 0; done; return 1; }

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

pick_table() { # prints the first candidate present in TABLES (case-insensitive, original casing kept)
  local candidate t
  for candidate in "$@"; do
    for t in "${TABLES[@]}"; do
      if [ "$(lower "$t")" = "$(lower "$candidate")" ]; then printf '%s' "$t"; return 0; fi
    done
  done
  return 1
}

USER_TABLE="$(pick_table "${USER_TABLE_CANDIDATES[@]}")" || die "required Stack Auth user table not found. Candidates tried: $(list_candidates "${USER_TABLE_CANDIDATES[@]}"). Discovered tables: $(list_candidates "${TABLES[@]}")"
SUBSCRIPTION_TABLE="$(pick_table "${SUBSCRIPTION_TABLE_CANDIDATES[@]}")" || die "required PayKit subscription table not found. Candidates tried: $(list_candidates "${SUBSCRIPTION_TABLE_CANDIDATES[@]}"). Discovered tables: $(list_candidates "${TABLES[@]}")"
PAYMENT_TABLE="$(pick_table "${PAYMENT_TABLE_CANDIDATES[@]}")" || PAYMENT_TABLE=""
OWNER_LINK_TABLE="$(pick_table "${OWNER_LINK_TABLE_CANDIDATES[@]}")" || OWNER_LINK_TABLE=""
CUSTOMER_TABLE="$(pick_table "${CUSTOMER_TABLE_CANDIDATES[@]}")" || CUSTOMER_TABLE=""
PRODUCT_TABLE="$(pick_table "${PRODUCT_TABLE_CANDIDATES[@]}")" || PRODUCT_TABLE=""
CONTACT_TABLE="$(pick_table "${CONTACT_TABLE_CANDIDATES[@]}")" || CONTACT_TABLE=""

for t in "$USER_TABLE" "$SUBSCRIPTION_TABLE" ${PAYMENT_TABLE:+"$PAYMENT_TABLE"} ${OWNER_LINK_TABLE:+"$OWNER_LINK_TABLE"} ${CUSTOMER_TABLE:+"$CUSTOMER_TABLE"} ${PRODUCT_TABLE:+"$PRODUCT_TABLE"} ${CONTACT_TABLE:+"$CONTACT_TABLE"}; do
  safe_identifier "$t" || die "refusing to export suspicious table name: '$t'"
done

# A Stack Auth database can hold several projects ("tenancies"), each with its own users. Our
# export must contain ours only: dumping the whole user table would copy another project's accounts
# into our backup. The rule matches the server read model — scope to HEXCLAVE_PROJECT_ID when more
# than one tenancy exists, and refuse to guess when the mapping is missing.
USER_WHERE=""
CONTACT_WHERE=""
USER_COLUMNS="$(run_sql "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='$USER_TABLE'")"
if printf '%s\n' "$USER_COLUMNS" | grep -qx 'tenancyId'; then
  MULTI_TENANCY="$(run_sql "SELECT count(DISTINCT \"tenancyId\") FROM \"$USER_TABLE\"")"
  TENANCY_ID=""
  if [ -n "${HEXCLAVE_PROJECT_ID:-}" ]; then
    case "$HEXCLAVE_PROJECT_ID" in
      *[!A-Za-z0-9_-]*) die "HEXCLAVE_PROJECT_ID is not a plain identifier: '$HEXCLAVE_PROJECT_ID'" ;;
    esac
    TENANCY_ID="$(run_sql "SELECT id FROM \"Tenancy\" WHERE \"projectId\" = '$HEXCLAVE_PROJECT_ID' LIMIT 1" 2>/dev/null || true)"
    [ -n "$TENANCY_ID" ] || echo "WARNING: HEXCLAVE_PROJECT_ID=$HEXCLAVE_PROJECT_ID matches no \"Tenancy\" row" >&2
  fi
  if [ -n "$TENANCY_ID" ]; then
    USER_WHERE="\"tenancyId\"::text = '$TENANCY_ID'"
    CONTACT_WHERE="\"tenancyId\"::text = '$TENANCY_ID'"
    echo "scope: users limited to project $HEXCLAVE_PROJECT_ID (tenancy $TENANCY_ID)"
  elif [ "${MULTI_TENANCY:-0}" -gt 1 ]; then
    die "the user table holds $MULTI_TENANCY tenancies and HEXCLAVE_PROJECT_ID does not resolve to one of them; refusing to export every project's users"
  fi
fi

mkdir -p "$OUT_DIR"
MANIFEST="$OUT_DIR/manifest.json"
{
  printf '{\n'
  printf '  "generated_at": "%s",\n' "$(date -Iseconds)"
  printf '  "backend": "%s",\n' "$BACKEND"
  printf '  "database": "%s",\n' "$(redact "$DATABASE_URL")"
  printf '  "discovered_tables": ['
  sep=""
  for t in "${TABLES[@]}"; do printf '%s"%s"' "$sep" "$t"; sep=", "; done
  printf '],\n  "files": [\n'
} > "$MANIFEST"

emit_entry() { # dataset table file [where]
  local dataset="$1" table="$2" file="$3" where="${4:-}" rows sha bytes count_sql
  copy_csv "$table" "$where" > "$OUT_DIR/$file"
  [ -s "$OUT_DIR/$file" ] || die "export of '$table' produced an empty file ($file)"
  count_sql="SELECT count(*) FROM \"$table\""
  [ -n "$where" ] && count_sql="$count_sql WHERE $where"
  rows="$(run_sql "$count_sql")"
  sha="$(sha256sum "$OUT_DIR/$file" | awk '{print $1}')"
  bytes="$(wc -c < "$OUT_DIR/$file" | tr -d ' ')"
  printf '    {"dataset": "%s", "source_table": "%s", "file": "%s", "rows": %s, "bytes": %s, "sha256": "%s"},\n' \
    "$dataset" "$table" "$file" "$rows" "$bytes" "$sha" >> "$MANIFEST"
  echo "exported $dataset: $table -> $OUT_DIR/$file ($rows rows, sha256 $sha)"
}

EXPORTED_DATASETS=()

# emitted in dependency order so the same order works for a restore into an empty database
if [ -n "$CUSTOMER_TABLE" ]; then emit_entry "customers" "$CUSTOMER_TABLE" "customers.csv"; EXPORTED_DATASETS+=("customers"); else
  printf '    {"dataset": "customers", "status": "skipped", "reason": "no PayKit customer table present", "candidates_tried": "%s"}\n' \
    "$(list_candidates "${CUSTOMER_TABLE_CANDIDATES[@]}")" >> "$MANIFEST"
  echo "WARNING: customers dataset skipped — no PayKit customer table found (tried: $(list_candidates "${CUSTOMER_TABLE_CANDIDATES[@]}")). Subscription rows reference paykit_customer, so a restore will fail on the foreign key."
fi
if [ -n "$PRODUCT_TABLE" ]; then emit_entry "products" "$PRODUCT_TABLE" "products.csv"; EXPORTED_DATASETS+=("products"); else
  printf '    {"dataset": "products", "status": "skipped", "reason": "no PayKit product table present", "candidates_tried": "%s"}\n' \
    "$(list_candidates "${PRODUCT_TABLE_CANDIDATES[@]}")" >> "$MANIFEST"
  echo "WARNING: products dataset skipped — no PayKit product table found (tried: $(list_candidates "${PRODUCT_TABLE_CANDIDATES[@]}")). Subscriptions require product_internal_id, so a restore will fail on the foreign key."
fi
emit_entry "users" "$USER_TABLE" "users.csv" "$USER_WHERE"; EXPORTED_DATASETS+=("users")
# Emails live in the contact-channel table on the current Stack Auth schema, not in the user row:
# without this dataset a restored account has no address to sign in with.
if [ -n "$CONTACT_TABLE" ]; then
  CONTACT_COLUMNS="$(run_sql "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='$CONTACT_TABLE'")"
  if ! printf '%s\n' "$CONTACT_COLUMNS" | grep -qx 'tenancyId'; then CONTACT_WHERE=""; fi
  emit_entry "contact_channels" "$CONTACT_TABLE" "contact_channels.csv" "$CONTACT_WHERE"; EXPORTED_DATASETS+=("contact_channels")
else
  printf '    {"dataset": "contact_channels", "status": "skipped", "reason": "no contact-channel table present (emails may live in the user row instead)", "candidates_tried": "%s"}\n' \
    "$(list_candidates "${CONTACT_TABLE_CANDIDATES[@]}")" >> "$MANIFEST"
  echo "note: no contact-channel table found (tried: $(list_candidates "${CONTACT_TABLE_CANDIDATES[@]}")) — emails, if this schema has them, are expected in the user row"
fi
emit_entry "subscriptions" "$SUBSCRIPTION_TABLE" "subscriptions.csv"; EXPORTED_DATASETS+=("subscriptions")
if [ -n "$OWNER_LINK_TABLE" ]; then
  emit_entry "owner_links" "$OWNER_LINK_TABLE" "owner_links.csv"; EXPORTED_DATASETS+=("owner_links")
else
  printf '    {"dataset": "owner_links", "status": "skipped", "reason": "no user<->customer mapping table present", "candidates_tried": "%s"}\n' \
    "$(list_candidates "${OWNER_LINK_TABLE_CANDIDATES[@]}")" >> "$MANIFEST"
  echo "WARNING: owner_links dataset skipped — no user<->customer mapping table found (tried: $(list_candidates "${OWNER_LINK_TABLE_CANDIDATES[@]}")). A restored subscriptions.csv will not be attributable to a user until that table exists and is exported."
fi
if [ -n "$PAYMENT_TABLE" ]; then
  emit_entry "payments" "$PAYMENT_TABLE" "payments.csv"; EXPORTED_DATASETS+=("payments")
else
  printf '    {"dataset": "payments", "status": "skipped", "reason": "no invoice/payment table present", "candidates_tried": "%s"}\n' \
    "$(list_candidates "${PAYMENT_TABLE_CANDIDATES[@]}")" >> "$MANIFEST"
  echo "WARNING: payments dataset skipped — no invoice/payment table found (tried: $(list_candidates "${PAYMENT_TABLE_CANDIDATES[@]}"))"
fi

# close the files array: drop the trailing comma of the last entry, then close the JSON.
# Pure bash on purpose: a native python/node helper cannot read the MSYS-style path
# this script passes it, so the manifest would silently lose its fix-up step.
close_manifest() {
  local lines=() line i
  mapfile -t lines < "$MANIFEST"
  for (( i=${#lines[@]}-1; i>=0; i-- )); do
    line="${lines[$i]}"
    if [ -n "${line//[[:space:]]/}" ]; then
      lines[$i]="${line%,}"
      break
    fi
  done
  printf '%s\n' "${lines[@]}" > "$MANIFEST"
}
close_manifest
{
  printf '  ],\n'
  printf '  "restore_order": ['
  sep=""
  for d in "${EXPORTED_DATASETS[@]}"; do printf '%s"%s"' "$sep" "$d"; sep=", "; done
  printf ']\n}\n'
} >> "$MANIFEST"

# the manifest must parse; a corrupt manifest makes a restore unauditable
if command -v node >/dev/null 2>&1; then
  if ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$(cygpath -w "$MANIFEST" 2>/dev/null || printf '%s' "$MANIFEST")" 2>/dev/null; then
    echo "WARNING: manifest.json is not valid JSON — inspect $MANIFEST before relying on it" >&2
  fi
fi

echo "Export complete: $OUT_DIR"
echo "Manifest: $MANIFEST"