#!/bin/sh
# Deploys the Pi's one OpenCode v2 server, which also serves the Palma reading app.
#
#   PALMA_SERVER_HOST=lrpi PALMA_SERVER_ADDRESS=<tailscale ipv4> ./server/deploy.sh
#
# - Installs the pinned @opencode/cli globally with bun (the only OpenCode on the Pi).
# - Pins the background server (`opencode serve --service`) to the Tailscale address, port 41137 and
#   the password in state/server.env, so the CLI on the Pi, the Palma app and the Chrome extension
#   all use the same server, database and logins.
# - Copies server/runtime/ (opencode.json, AGENTS.md) to the reading folder's parent, where v2 applies
#   it to reading chats only: deny by default, read/glob/grep/webfetch/websearch allowed.
set -eu

HOST="${PALMA_SERVER_HOST:-your-pi}"
VERSION="${OPENCODE_VERSION:-2.0.27}"
# The checked-in address is a placeholder; pass the Pi's real Tailscale IPv4.
ADDRESS="${PALMA_SERVER_ADDRESS:-100.64.0.10}"
PORT="41137"
ROOT="/home/pi/deploys/palma2-opencode"
BIN="/home/pi/.bun/bin/opencode"
BUN="/home/pi/.bun/bin/bun"

ssh "$HOST" "mkdir -p '$ROOT/workdir' '$ROOT/state'"
rsync -a --exclude workdir --exclude state --exclude .git server/runtime/ "$HOST:$ROOT/"
scp -q server/opencode.service "$HOST:/tmp/opencode.service"

ssh "$HOST" "set -eu
if [ ! -f '$ROOT/state/server.env' ]; then
  umask 077
  printf 'OPENCODE_SERVER_PASSWORD=%s\n' \"\$(openssl rand -hex 24)\" > '$ROOT/state/server.env'
fi
. '$ROOT/state/server.env'

'$BUN' add -g --exact --trust '@opencode/cli@$VERSION'
case \"\$('$BIN' --version)\" in
  *'$VERSION') ;;
  *) echo 'Installed OpenCode is not $VERSION' >&2; exit 1 ;;
esac

git -C '$ROOT' init -q
git -C '$ROOT' add .gitignore opencode.json AGENTS.md
git -C '$ROOT' -c user.name='Palma Deploy' -c user.email='palma@localhost' commit -q -m 'Deploy Palma OpenCode config' --allow-empty

'$BIN' service set hostname '$ADDRESS'
'$BIN' service set port '$PORT'
'$BIN' service set password \"\$OPENCODE_SERVER_PASSWORD\"
sudo install -m 0644 /tmp/opencode.service /etc/systemd/system/opencode.service
sudo systemctl daemon-reload
sudo systemctl enable opencode.service
sudo systemctl restart opencode.service

i=0
until curl --fail --silent --user \"opencode:\$OPENCODE_SERVER_PASSWORD\" 'http://$ADDRESS:$PORT/api/info'; do
  i=\$((i + 1))
  if [ \"\$i\" -ge 30 ]; then sudo journalctl -u opencode.service -n 50 --no-pager; exit 1; fi
  sleep 1
done
printf '\n'"
printf 'OpenCode %s deployed as opencode.service on port %s.\n' "$VERSION" "$PORT"
