#!/usr/bin/env bash
# Build the web app and copy it to a server with rsync over SSH.
# The server only needs to serve static files: see deploy/web/ and docs/web.md.
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: scripts/deploy-web.sh --host <user@server> [options]

Builds the website (pnpm build:web: the landing page at / and the app at /app/) and copies dist/ to the server.

Options:
  --host <user@server>   SSH target. Also read from MINDROOT_WEB_HOST.
  --path <folder>        Folder on the server. Default: /var/www/mindroot.app
                         Also read from MINDROOT_WEB_PATH.
  --port <number>        SSH port. Default: 22
  --url <url>            Address to check after the copy. Default: https://mindroot.app
  --skip-build           Copy the dist/ folder that exists; do not build.
  --dry-run              Show what would change on the server; change nothing.
  --no-check             Do not check the address after the copy.
  -h, --help             Show this text.

Files that are no longer in the build are deleted on the server (old hashed assets).
HELP
}

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then B=$'\033[1m'; G=$'\033[32m'; R=$'\033[31m'; Z=$'\033[0m'; else B=''; G=''; R=''; Z=''; fi
say() { printf '%s==>%s %s\n' "$B" "$Z" "$*"; }
die() { printf '%serror:%s %s\n' "$R" "$Z" "$*" >&2; exit 1; }

HOST="${MINDROOT_WEB_HOST:-}"
DEST="${MINDROOT_WEB_PATH:-/var/www/mindroot.app}"
PORT=22
URL="https://mindroot.app"
BUILD=1; DRY=0; CHECK=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="${2:?--host needs a value}"; shift 2 ;;
    --path) DEST="${2:?--path needs a value}"; shift 2 ;;
    --port) PORT="${2:?--port needs a value}"; shift 2 ;;
    --url) URL="${2:?--url needs a value}"; shift 2 ;;
    --skip-build) BUILD=0; shift ;;
    --dry-run) DRY=1; shift ;;
    --no-check) CHECK=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

[[ -n "$HOST" ]] || { usage >&2; die "give the server with --host <user@server>"; }
[[ "$DEST" == /* && "$DEST" != "/" ]] || die "--path must be an absolute folder and not /"
command -v rsync >/dev/null || die "rsync is not installed"

cd "$(dirname "$0")/.."

if [[ $BUILD -eq 1 ]]; then
  say "Building the website"
  pnpm build:web
fi
[[ -f dist/index.html && -f dist/app/index.html ]] || die "dist/ is not a website build: run without --skip-build"

FLAGS=(-az --delete --delay-updates --human-readable --itemize-changes -e "ssh -p $PORT")
[[ $DRY -eq 1 ]] && FLAGS+=(--dry-run)

say "Copying dist/ to $HOST:$DEST$([[ $DRY -eq 1 ]] && echo ' (dry run)')"
rsync "${FLAGS[@]}" dist/ "$HOST:$DEST/"

if [[ $DRY -eq 1 ]]; then
  say "Dry run: nothing changed on the server"
  exit 0
fi

if [[ $CHECK -eq 1 ]]; then
  say "Checking $URL"
  # A new site needs some seconds for its first certificate, so try for up to one minute.
  code=000
  for _ in 1 2 3 4 5 6; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL/" || true)
    [[ "$code" == "200" ]] && break
    sleep 10
  done
  [[ "$code" == "200" ]] || die "$URL answered with HTTP $code"
  # Both pages must be this build: compare the name of the main script of each.
  for page in "" "app/"; do
    want=$(grep -o 'assets/[A-Za-z0-9_-]*\.js' "dist/${page}index.html" | head -1)
    [[ -n "$want" ]] || die "dist/${page}index.html names no script"
    # A proxy in front of the server can answer with the old page for a few seconds, so try for up to 30 seconds.
    seen=0
    for _ in 1 2 3 4 5 6; do
      if curl -s --max-time 20 "$URL/$page" | grep -q "$want"; then seen=1; break; fi
      sleep 5
    done
    [[ $seen -eq 1 ]] || die "$URL/$page does not serve this build ($want). Is a cache or another folder in the way?"
    printf '%sok%s %s/%s serves this build\n' "$G" "$Z" "$URL" "$page"
  done
fi
