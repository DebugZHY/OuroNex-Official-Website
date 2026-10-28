#!/usr/bin/env bash
# Offline verification for export.sh: syntax, dry-run plan and coverage of the
# three required datasets. Requires no database, no psql and no docker.
#
# Usage: verify-export.sh
# Exit: 0 when every check passes, 1 with a VERIFY FAIL line otherwise.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPORT="$SCRIPT_DIR/export.sh"

fail() { echo "VERIFY FAIL: $*" >&2; exit 1; }

[ -f "$EXPORT" ] || fail "missing $EXPORT"

# 1. syntax
bash -n "$EXPORT" || fail "bash -n failed for export.sh"
echo "ok: bash -n export.sh"

# 2. dry-run resolves the plan without a database
DRY_OUT="$(bash "$EXPORT" --dry-run 2>&1)" || fail "export.sh --dry-run exited non-zero"
echo "ok: export.sh --dry-run exited 0"

# 3. every dataset (parents first) and the owner-link dataset are named in the plan
for dataset in customers products users contact_channels subscriptions payments owner_links; do
  printf '%s\n' "$DRY_OUT" | grep -q "dataset: $dataset" || fail "dry-run does not mention the '$dataset' dataset"
done
echo "ok: dry-run names datasets customers, products, users, contact_channels, subscriptions, payments, owner_links"

for file in customers.csv products.csv users.csv contact_channels.csv subscriptions.csv payments.csv owner_links.csv manifest.json; do
  printf '%s\n' "$DRY_OUT" | grep -q "$file" || fail "dry-run does not mention $file"
done
echo "ok: dry-run names every CSV plus manifest.json"

# 4. required-table detection must not be a loose %user% guess
printf '%s\n' "$DRY_OUT" | grep -q 'project_user' || fail "dry-run does not show the known-name user table candidates"
printf '%s\n' "$DRY_OUT" | grep -q 'paykit_subscription' || fail "dry-run does not show the paykit_subscription candidate"
printf '%s\n' "$DRY_OUT" | grep -q 'app_billing_owner' || fail "dry-run does not show the app_billing_owner candidate"
echo "ok: known-name candidates for the user, subscription and owner-link tables are shown"

# 5. discovery and failure behaviour are explicit
printf '%s\n' "$DRY_OUT" | grep -q 'information_schema' || fail "dry-run does not show the information_schema discovery query"
printf '%s\n' "$DRY_OUT" | grep -q 'exit 1' || fail "dry-run does not state the missing-required-table exit behaviour"
echo "ok: discovery query and hard-fail behaviour are stated"

# 6. no credential may leak into any output
if printf '%s\n' "$DRY_OUT" | grep -Eq '(postgres(ql)?)://[^@[:space:]*]+:[^@[:space:]*]+@'; then
  fail "dry-run output contains an unredacted credential"
fi
echo "ok: database URL is redacted (no user:password pattern in output)"

echo
echo "== dry-run plan =="
printf '%s\n' "$DRY_OUT"
echo
echo "VERIFY OK: export.sh is syntactically valid and its dry-run plan covers users, subscriptions and payments."