#!/usr/bin/env bash
# One command that runs every acceptance gate this build has, in order, and prints one verdict.
# Nothing here is a reimplementation: each step calls the gate that already exists
# (verify-export.sh, check_parity.py, preflight.mjs, the probe-*.mjs probes).
#
# Usage: verify-all.sh [--offline] [--no-preflight] [--clean-outbox]
#   --offline        run only the gates that need no database and no fixture
#   --no-preflight   skip server/scripts/preflight.mjs even when it is present
#   --clean-outbox   delete the dry-run mail files this run itself produced
#
# Exit: 0 every gate passed
#       1 at least one gate failed
#       3 the gates that need a database could not run (no reachable fixture database)
#
# The database steps need the development PostgreSQL instance (127.0.0.1:55432) or whatever
# DATABASE_URL/PG* points at; the offline steps never do.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.." || exit 1
SERVER_DIR="$(pwd)"

OFFLINE=0
RUN_PREFLIGHT=1
CLEAN_OUTBOX=0
for arg in "$@"; do
  case "$arg" in
    --offline) OFFLINE=1 ;;
    --no-preflight) RUN_PREFLIGHT=0 ;;
    --clean-outbox) CLEAN_OUTBOX=1 ;;
    -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "ERROR: unknown option '$arg'" >&2; exit 2 ;;
  esac
done

NAMES=() STATES=() NOTES=()
BLOCKED=0

record() { # name state note
  NAMES+=("$1"); STATES+=("$2"); NOTES+=("${3:-}")
  printf '%-6s %s%s\n' "$2" "$1" "${3:+  — $3}"
}

# run_gate <name> <command...>
# Streams the gate's own output; the gate keeps its own exit code semantics.
run_gate() {
  local name="$1"; shift
  echo
  echo "--- $name ---"
  if "$@"; then
    record "$name" PASS ""
  else
    record "$name" FAIL "exit $?"
  fi
}

echo "server dir : $SERVER_DIR"
echo "command    : ${0##*/} $*"
echo "node       : $(node --version 2>/dev/null || echo MISSING)"
echo "db target  : $(node --input-type=module -e 'import {describeDatabaseConfig} from "./src/lib/subscriptions.mjs"; try { const d = describeDatabaseConfig(); console.log(d.source + " " + d.host + ":" + d.port + "/" + d.database); } catch (e) { console.log("unresolved: " + e.message); }' 2>&1 | tail -1)"

# ---------------------------------------------------------------- 1. syntax
echo
echo "--- syntax ---"
syntax_failures=0
syntax_checked=0
while IFS= read -r f; do
  syntax_checked=$((syntax_checked + 1))
  if ! out="$(node --check "$f" 2>&1)"; then
    printf '  FAIL node --check %s\n%s\n' "$f" "$out" >&2
    syntax_failures=$((syntax_failures + 1))
  fi
done < <(find src scripts -type f \( -name '*.mjs' -o -name '*.js' \) | sort)
while IFS= read -r f; do
  syntax_checked=$((syntax_checked + 1))
  bash -n "$f" || { echo "  FAIL bash -n $f" >&2; syntax_failures=$((syntax_failures + 1)); }
done < <(find scripts db -type f -name '*.sh' | sort)
if [ "$syntax_failures" -eq 0 ]; then
  record "syntax ($syntax_checked files)" PASS
else
  record "syntax ($syntax_checked files)" FAIL "$syntax_failures file(s)"
fi

# ------------------------------------------------------- 2. migration parity
echo
echo "--- migration parity ---"
parity_failures=0
parity_checked=0
for up in db/migrations/*.sql; do
  case "$up" in *.down.sql) continue ;; esac
  base="${up%.sql}"
  [ -f "$base.down.sql" ] || { echo "  WARN no down file for $(basename "$base")" >&2; continue; }
  parity_checked=$((parity_checked + 1))
  echo "  $(basename "$base")"
  python db/migrations/check_parity.py "$(basename "$base")" 2>&1 | sed 's/^/    /' || parity_failures=$((parity_failures + 1))
done
if [ "$parity_checked" -eq 0 ]; then
  record "migration parity" FAIL "no up/down pairs found"
elif [ "$parity_failures" -eq 0 ]; then
  record "migration parity ($parity_checked pairs)" PASS
else
  record "migration parity ($parity_checked pairs)" FAIL "$parity_failures pair(s)"
fi

# --------------------------------------------------- 3. offline export gate
run_gate "export gate (offline)" bash scripts/verify-export.sh

# ------------------------------------------------------------- 4. preflight
if [ "$RUN_PREFLIGHT" -eq 1 ] && [ -f scripts/preflight.mjs ]; then
  run_gate "preflight" node scripts/preflight.mjs
elif [ "$RUN_PREFLIGHT" -eq 1 ]; then
  record "preflight" SKIP "scripts/preflight.mjs not present"
else
  record "preflight" SKIP "disabled with --no-preflight"
fi

# ------------------------------------------------- 4b. billing API (no network)
# Input-validation and configuration branches only: no database, no Stripe call.
run_gate "billing API" node scripts/probe-billing.mjs

# ----------------------------------------------------- 5. database-backed probes
if [ "$OFFLINE" -eq 1 ]; then
  record "probes (subscription/account/webhook)" SKIP "disabled with --offline"
else
  OUTBOX="outbox"
  before_outbox=""
  [ -d "$OUTBOX" ] && before_outbox="$(find "$OUTBOX" -maxdepth 1 -type f -printf '%f\n' 2>/dev/null | sort)"

  probe_names=("probe-db-config.mjs" "probe-subscription-status.mjs" "probe-account-api.mjs" "probe-webhook.mjs" "probe-mailer-smtp.mjs" "probe-welcome-once.mjs" "probe-identity-scope.mjs" "probe-auth-token.mjs")
  probe_failures=0
  probe_ran=0
  for p in "${probe_names[@]}"; do
    echo
    echo "--- $p ---"
    log="$(mktemp)"
    env -u DATABASE_URL -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE \
      node "scripts/$p" >"$log" 2>&1
    rc=$?
    sed 's/^/  /' "$log"
    if [ "$rc" -eq 0 ]; then
      record "$p" PASS "$(grep -Eo '[0-9]+/[0-9]+ (checks )?passed|[0-9]+ checks, [0-9]+ passed' "$log" | tail -1)"
      probe_ran=$((probe_ran + 1))
    elif grep -qE 'ECONNREFUSED|ENOTFOUND|does not exist|could not connect' "$log"; then
      record "$p" SKIP "no reachable database ($(grep -Eo 'ECONNREFUSED|ENOTFOUND' "$log" | head -1))"
      BLOCKED=1
    else
      record "$p" FAIL "exit $rc"
      probe_failures=$((probe_failures + 1))
    fi
    rm -f "$log"
  done

  # dry-run mail files are a side effect of the webhook probe; report them, and only
  # delete the ones this run created when asked to
  after_outbox=""
  [ -d "$OUTBOX" ] && after_outbox="$(find "$OUTBOX" -maxdepth 1 -type f -printf '%f\n' 2>/dev/null | sort)"
  new_outbox="$(comm -13 <(printf '%s\n' "$before_outbox") <(printf '%s\n' "$after_outbox") 2>/dev/null | sed '/^$/d')"
  if [ -n "$new_outbox" ]; then
    count="$(printf '%s\n' "$new_outbox" | wc -l | tr -d ' ')"
    if [ "$CLEAN_OUTBOX" -eq 1 ]; then
      printf '%s\n' "$new_outbox" | while IFS= read -r f; do rm -f "$OUTBOX/$f"; done
      record "dry-run mail files" PASS "$count created in $OUTBOX/, removed (--clean-outbox)"
    else
      record "dry-run mail files" PASS "$count left in $OUTBOX/ (rerun with --clean-outbox)"
    fi
  fi
fi

# ------------------------------------------------------------------ verdict
echo
echo "=========================== acceptance gate ==========================="
i=0
failures=0
while [ "$i" -lt "${#NAMES[@]}" ]; do
  printf '%-4s %-42s %s\n' "${STATES[$i]}" "${NAMES[$i]}" "${NOTES[$i]}"
  [ "${STATES[$i]}" = FAIL ] && failures=$((failures + 1))
  i=$((i + 1))
done
echo "======================================================================"
if [ "$failures" -gt 0 ]; then
  echo "GATE FAIL: $failures gate(s) failed"
  exit 1
fi
if [ "${BLOCKED:-0}" -eq 1 ]; then
  echo "GATE INCOMPLETE: offline gates passed, but the integration probes could not reach a database."
  echo "hint: the development fixture PostgreSQL listens on 127.0.0.1:55432 (D:\\agent-scratch\\pgprobe\\pgsql\\bin);"
  echo "      or point DATABASE_URL/PG* at another instance. Re-run without --offline once it is up."
  exit 3
fi
echo "GATE PASS"
exit 0
