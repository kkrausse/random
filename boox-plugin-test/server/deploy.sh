#!/bin/sh
# Deploys the Pi's tailnet OpenCode v2 server, which also serves the Palma reading app.
#
#   PALMA_SERVER_HOST=lrpi PALMA_SERVER_ADDRESS=<tailscale ipv4> ./server/deploy.sh
#
# - Runs the server as the unprivileged system user `opencode` (home /var/lib/opencode), sandboxed
#   by systemd and limited by an nftables egress filter to loopback, DNS and the public internet.
# - Installs the pinned @opencode/cli into /opt/opencode (the only OpenCode on the Pi;
#   /usr/local/bin/opencode links to it). Re-running with another OPENCODE_VERSION upgrades it.
# - Pins the server (`opencode serve --service`) to the Tailscale address, port 41137 and the
#   password in state/server.env, so the Palma app and the Chrome extension keep their settings.
# - Copies server/runtime/ (opencode.json, AGENTS.md) to the reading folder's parent, where v2 applies
#   it to reading chats only: deny by default, read/glob/grep/webfetch/websearch allowed.
set -eu

HOST="${PALMA_SERVER_HOST:-your-pi}"
VERSION="${OPENCODE_VERSION:-2.0.27}"
# The checked-in address is a placeholder; pass the Pi's real Tailscale IPv4.
ADDRESS="${PALMA_SERVER_ADDRESS:-100.64.0.10}"
PORT="41137"
STAGE="/tmp/opencode-deploy"

ssh "$HOST" "rm -rf '$STAGE' && mkdir -p '$STAGE/runtime'"
rsync -a server/runtime/ "$HOST:$STAGE/runtime/"
scp -q server/opencode.service server/opencode-egress.service server/opencode-egress.nft \
  server/opencode-global.jsonc "$HOST:$STAGE/"

ssh "$HOST" "sudo sh -s -- '$VERSION' '$ADDRESS' '$PORT' '$STAGE'" <<'REMOTE'
set -eu
VERSION="$1" ADDRESS="$2" PORT="$3" STAGE="$4"
OC_HOME=/var/lib/opencode
# Real location of the reading deploy. The unit bind-mounts it at CLIENT_ROOT, the path the
# Palma app, the Chrome extension and the stored sessions use.
ROOT="$OC_HOME/deploys/palma2-opencode"
PREFIX=/opt/opencode
BUN=/home/pi/.bun/bin/bun
as_oc() { sudo -u opencode -H "$@"; }

if ! id opencode >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$OC_HOME" --shell /usr/sbin/nologin --user-group opencode
fi
chmod 700 "$OC_HOME"
install -d -o opencode -g opencode -m 0700 "$OC_HOME/deploys" "$ROOT" "$ROOT/workdir" "$ROOT/state" \
  "$OC_HOME/.config" "$OC_HOME/.config/opencode"
rsync -a --chown=opencode:opencode --exclude workdir --exclude state --exclude .git "$STAGE/runtime/" "$ROOT/"
install -o opencode -g opencode -m 0600 "$STAGE/opencode-global.jsonc" "$OC_HOME/.config/opencode/opencode.jsonc"

if [ ! -f "$ROOT/state/server.env" ]; then
  (umask 077; printf 'OPENCODE_SERVER_PASSWORD=%s\n' "$(openssl rand -hex 24)" > "$ROOT/state/server.env")
fi
chown opencode:opencode "$ROOT/state/server.env"
chmod 600 "$ROOT/state/server.env"
. "$ROOT/state/server.env"

# Root-owned install, world-executable. The postinstall needs `node`, which the Pi lacks, so run it
# with bun. The opencode user cannot write here, so `opencode upgrade` cannot replace it.
case "$("$PREFIX/bin/opencode" --version 2>/dev/null || true)" in
  *"v$VERSION") ;;
  *)
    BUN_INSTALL="$PREFIX" "$BUN" add -g --exact --ignore-scripts "@opencode/cli@$VERSION"
    (cd "$PREFIX/install/global/node_modules/@opencode/cli" && "$BUN" ./postinstall.mjs)
    rm -rf "$PREFIX/install/cache"
    ;;
esac
ln -sfn "$PREFIX/bin/opencode" /usr/local/bin/opencode
ln -sfn "$PREFIX/bin/opencode2" /usr/local/bin/opencode2
case "$(/usr/local/bin/opencode --version)" in
  *"v$VERSION") ;;
  *) echo "Installed OpenCode is not $VERSION" >&2; exit 1 ;;
esac

as_oc git -C "$ROOT" init -q
as_oc git -C "$ROOT" add .gitignore opencode.json AGENTS.md
as_oc git -C "$ROOT" -c user.name='Palma Deploy' -c user.email='palma@localhost' \
  commit -q -m 'Deploy Palma OpenCode config' --allow-empty

as_oc /usr/local/bin/opencode service set hostname "$ADDRESS"
as_oc /usr/local/bin/opencode service set port "$PORT"
as_oc /usr/local/bin/opencode service set password "$OPENCODE_SERVER_PASSWORD"

install -d -m 0755 /etc/nftables.d
install -m 0644 "$STAGE/opencode-egress.nft" /etc/nftables.d/opencode-egress.nft
install -m 0644 "$STAGE/opencode-egress.service" /etc/systemd/system/opencode-egress.service
install -m 0644 "$STAGE/opencode.service" /etc/systemd/system/opencode.service
rm -rf "$STAGE"
systemctl daemon-reload
systemctl enable opencode-egress.service opencode.service
systemctl restart opencode-egress.service
systemctl restart opencode.service

i=0
until curl --fail --silent --user "opencode:$OPENCODE_SERVER_PASSWORD" "http://$ADDRESS:$PORT/api/info"; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then journalctl -u opencode.service -n 50 --no-pager; exit 1; fi
  sleep 1
done
printf '\n'
REMOTE
printf 'OpenCode %s deployed as opencode.service (user opencode) on port %s.\n' "$VERSION" "$PORT"
