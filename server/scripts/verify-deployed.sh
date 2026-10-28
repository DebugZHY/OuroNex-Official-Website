#!/usr/bin/env bash
# Deployed-stack acceptance: the probes that need the real database and the real Stack Auth.
#
# Loads server/.env first, but never overwrites a variable the caller already exported (same rule as
# export.sh/restore-export.sh), so `DATABASE_URL=... npm run verify:deployed` still points at the
# database the caller chose.
#
# Usage:  npm run verify:deployed
# Exit:   0 every probe passed / 1 at least one failed (the first failing probe's code)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.." || exit 1

if [ -f .env ]; then
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"
    case "$key" in *[!A-Za-z0-9_]*|'') continue ;; esac
    if [ -z "${!key:-}" ]; then
      value="${line#*=}"
      export "$key=$value"
    fi
  done < .env
fi

echo "database : $(node --input-type=module -e 'import {describeDatabaseConfig} from "./src/lib/subscriptions.mjs"; try { const d = describeDatabaseConfig(); console.log(d.source + " " + d.host + ":" + d.port + "/" + d.database); } catch (e) { console.log("unresolved: " + e.message); }' 2>&1 | tail -1)"
echo "stack api: ${NEXT_PUBLIC_STACK_API_URL:-<unset>}  project: ${HEXCLAVE_PROJECT_ID:-<unset>}"

failures=0
for probe in probe-deployed-identity.mjs probe-identity-scope.mjs probe-auth-token.mjs probe-billing-live.mjs; do
  echo
  echo "--- $probe ---"
  if node "scripts/$probe"; then
    echo "    ok"
  else
    echo "    FAILED (exit $?)"
    failures=$((failures + 1))
  fi
done

echo
if [ "$failures" -eq 0 ]; then
  echo "DEPLOYED GATE PASS"
  exit 0
fi
echo "DEPLOYED GATE FAIL: $failures probe(s)"
exit 1
