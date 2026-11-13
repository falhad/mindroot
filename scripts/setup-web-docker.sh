#!/usr/bin/env bash
# One-time server setup for the web app on a server where a Caddy container owns ports 80 and 443
# and reads one file per site from a "sites" folder. It adds a small container that serves the
# static files, and one site file for the edge Caddy. Nothing that exists is restarted.
# After this, scripts/deploy-web.sh copies each new build.
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: scripts/setup-web-docker.sh --host <user@server> [options]

Options:
  --host <user@server>   SSH target. Also read from MINDROOT_WEB_HOST.
  --port <number>        SSH port. Default: 22
  --domain <name>        Public name of the site. Default: mindroot.app
  --path <folder>        Folder for the static files. Default: /var/www/<domain>
  --stack <folder>       Folder for the compose file. Default: /opt/infra/mindroot
  --sites <folder>       "sites" folder of the edge Caddy. Default: /opt/infra/caddy/sites
  --edge <container>     Name of the edge Caddy container. Default: caddy
  --network <name>       Docker network shared with the edge. Default: edge
  --script-src <origin>  Allow scripts from one more origin in the security policy,
                         for example https://example.com. Default: none.
  --cloudflare-analytics Same as --script-src https://static.cloudflareinsights.com
                         (Cloudflare Web Analytics, when the site is behind the Cloudflare proxy).
                         Give the option on each run: a run without it removes the origin.
  --remove               Undo: remove the site file, the container and the stack folder.
                         The static files stay.
  --dry-run              Show the steps; change nothing.
  -h, --help             Show this text.

It is safe to run again. A bad edge configuration is rolled back before the reload.
HELP
}

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then B=$'\033[1m'; R=$'\033[31m'; Z=$'\033[0m'; else B=''; R=''; Z=''; fi
say() { printf '%s==>%s %s\n' "$B" "$Z" "$*"; }
die() { printf '%serror:%s %s\n' "$R" "$Z" "$*" >&2; exit 1; }

HOST="${MINDROOT_WEB_HOST:-}"; PORT=22; DOMAIN="mindroot.app"; DEST=""
STACK="/opt/infra/mindroot"; SITES="/opt/infra/caddy/sites"; EDGE="caddy"; NET="edge"; SCRIPT_SRC=""; DRY=0; REMOVE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="${2:?--host needs a value}"; shift 2 ;;
    --port) PORT="${2:?--port needs a value}"; shift 2 ;;
    --domain) DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --path) DEST="${2:?--path needs a value}"; shift 2 ;;
    --stack) STACK="${2:?--stack needs a value}"; shift 2 ;;
    --sites) SITES="${2:?--sites needs a value}"; shift 2 ;;
    --edge) EDGE="${2:?--edge needs a value}"; shift 2 ;;
    --network) NET="${2:?--network needs a value}"; shift 2 ;;
    --script-src) SCRIPT_SRC="${2:?--script-src needs a value}"; shift 2 ;;
    --cloudflare-analytics) SCRIPT_SRC="https://static.cloudflareinsights.com"; shift ;;
    --remove) REMOVE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

[[ -n "$HOST" ]] || { usage >&2; die "give the server with --host <user@server>"; }
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "--domain is not a host name"
DEST="${DEST:-/var/www/$DOMAIN}"
for p in "$DEST" "$STACK" "$SITES"; do [[ "$p" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "not a plain absolute folder: $p"; done
[[ -z "$SCRIPT_SRC" || "$SCRIPT_SRC" =~ ^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "--script-src must be an origin like https://example.com"
[[ "$EDGE" =~ ^[A-Za-z0-9_.-]+$ && "$NET" =~ ^[A-Za-z0-9_.-]+$ ]] || die "bad container or network name"

cd "$(dirname "$0")/.."
SITE_FILE="$SITES/mindroot.caddy"
SSH=(ssh -p "$PORT" -o BatchMode=yes "$HOST")
RELOAD="docker exec $EDGE caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 && docker exec $EDGE caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile"

if [[ $DRY -eq 1 ]]; then
  say "Dry run for $HOST. Nothing changes."
  if [[ $REMOVE -eq 1 ]]; then
    echo "  remove $SITE_FILE and reload the container '$EDGE'"
    echo "  docker compose down in $STACK, then remove $STACK"
  else
    echo "  create $DEST and $STACK"
    echo "  copy deploy/web/docker/{compose.yml,Caddyfile} to $STACK, write $STACK/.env"
    echo "  extra script source in the security policy: ${SCRIPT_SRC:-none}"
    echo "  docker compose up -d   (container mindroot-web, network '$NET', no public port)"
    echo "  write $SITE_FILE for $DOMAIN, validate, reload the container '$EDGE'"
  fi
  exit 0
fi

if [[ $REMOVE -eq 1 ]]; then
  say "Removing the site from $HOST"
  "${SSH[@]}" "set -eu; rm -f '$SITE_FILE'; $RELOAD; [ -f '$STACK/compose.yml' ] && (cd '$STACK' && docker compose down); rm -rf '$STACK'"
  say "Done. The static files stay in $DEST"
  exit 0
fi

say "Checking the server"
"${SSH[@]}" "set -eu; docker inspect '$EDGE' >/dev/null; docker network inspect '$NET' >/dev/null; [ -d '$SITES' ]" \
  || die "the edge container '$EDGE', the network '$NET' or the folder $SITES is missing on $HOST"

say "Copying the stack to $HOST:$STACK"
"${SSH[@]}" "set -eu; mkdir -p '$DEST' '$STACK'; printf 'MINDROOT_WEB_ROOT=%s\nMINDROOT_EDGE_NETWORK=%s\nMINDROOT_SCRIPT_SRC=%s\n' '$DEST' '$NET' '$SCRIPT_SRC' > '$STACK/.env'"
scp -q -P "$PORT" -o BatchMode=yes deploy/web/docker/compose.yml deploy/web/docker/Caddyfile "$HOST:$STACK/"

say "Starting the container mindroot-web"
"${SSH[@]}" "set -eu; cd '$STACK'; docker compose up -d --force-recreate"

say "Adding $DOMAIN to the edge Caddy"
"${SSH[@]}" "set -eu
old=''; [ -f '$SITE_FILE' ] && old=\$(cat '$SITE_FILE')
umask 077
printf '%s {\n\treverse_proxy mindroot-web:80\n}\n' '$DOMAIN' > '$SITE_FILE'
if ! ($RELOAD); then
  if [ -n \"\$old\" ]; then printf '%s\n' \"\$old\" > '$SITE_FILE'; else rm -f '$SITE_FILE'; fi
  echo 'the edge refused the new configuration; it is rolled back' >&2; exit 1
fi"

say "Done. Now copy a build: scripts/deploy-web.sh --host $HOST --path $DEST --url https://$DOMAIN"
