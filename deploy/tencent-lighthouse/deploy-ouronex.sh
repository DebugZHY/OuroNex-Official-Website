#!/usr/bin/env bash
# Publish a verified static package to an existing Nginx document root.
# The script never edits Nginx configuration; it backs up and copies files only.
set -euo pipefail

PACKAGE_DIR="${1:-}"
WEB_ROOT="${2:-}"
CHECK_URL="${3:-http://127.0.0.1/}"

if [ -z "$PACKAGE_DIR" ] || [ -z "$WEB_ROOT" ]; then
  echo "usage: sudo bash deploy-ouronex.sh <package-dir> <web-root> [check-url]" >&2
  echo "example: sudo bash deploy-ouronex.sh ./public /www/wwwroot/ouronex http://150.109.55.6/" >&2
  exit 2
fi

PACKAGE_DIR="$(cd "$PACKAGE_DIR" && pwd)"
WEB_ROOT="${WEB_ROOT%/}"
if [ ! -f "$PACKAGE_DIR/index.html" ] || [ ! -f "$PACKAGE_DIR/assets/gate.js" ]; then
  echo "ERROR: package is incomplete (expected index.html and assets/gate.js): $PACKAGE_DIR" >&2
  exit 2
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run this script as root." >&2
  exit 2
fi

case "$WEB_ROOT" in
  ""|/|/www|/www/wwwroot)
    echo "ERROR: refusing unsafe web root: $WEB_ROOT" >&2
    exit 2
    ;;
esac
if [ -e "$WEB_ROOT" ] && [ ! -d "$WEB_ROOT" ]; then
  echo "ERROR: web root exists but is not a directory: $WEB_ROOT" >&2
  exit 2
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/root/ouronex-backups/$STAMP"
mkdir -p "$BACKUP_DIR"

if [ -d "$WEB_ROOT" ]; then
  tar -czf "$BACKUP_DIR/web-root.tar.gz" -C "$WEB_ROOT" .
  echo "backup: $BACKUP_DIR/web-root.tar.gz"
else
  echo "web root does not exist yet; it will be created"
fi

mkdir -p "$WEB_ROOT"
if command -v rsync >/dev/null 2>&1; then
  rsync -a "$PACKAGE_DIR"/ "$WEB_ROOT"/
else
  cp -a "$PACKAGE_DIR"/. "$WEB_ROOT"/
fi
echo "copied: $PACKAGE_DIR -> $WEB_ROOT"

NGINX_BIN="${NGINX_BIN:-}"
if [ -z "$NGINX_BIN" ]; then
  NGINX_BIN="$(command -v nginx 2>/dev/null || true)"
fi
if [ -z "$NGINX_BIN" ] && [ -x /www/server/nginx/sbin/nginx ]; then
  NGINX_BIN=/www/server/nginx/sbin/nginx
fi
if [ -z "$NGINX_BIN" ]; then
  echo "WARNING: nginx binary not found; copied files but did not reload Nginx." >&2
  exit 3
fi

"$NGINX_BIN" -t
"$NGINX_BIN" -s reload 2>/dev/null || systemctl reload nginx
echo "nginx reloaded"

sleep 1
# Check the gate from a file, not through a pipe: grep -q exits on the first
# match and closes the pipe, which kills curl with EPIPE (exit 23); with
# pipefail enabled that turns a successful check into a false failure.
CHECK_FILE="$(mktemp)"
trap 'rm -f "$CHECK_FILE"' EXIT
if curl -fsS -o "$CHECK_FILE" "$CHECK_URL" && grep -q 'id="site-gate"' "$CHECK_FILE"; then
  echo "PASS: $CHECK_URL serves the new passcode gate"
else
  echo "WARNING: new index.html was copied, but $CHECK_URL did not return the gate." >&2
  echo "Check the Nginx root and URL, then reload Nginx." >&2
  exit 4
fi
curl -fsS -o /dev/null -w 'gate.js HTTP %{http_code}\n' "${CHECK_URL%/}/assets/gate.js"
curl -fsS -o /dev/null -w 'tower model HTTP %{http_code}\n' "${CHECK_URL%/}/workflow-stages/models/transmission-tower.glb.gz"
echo "rollback: tar -xzf $BACKUP_DIR/web-root.tar.gz -C $WEB_ROOT && $NGINX_BIN -s reload"
