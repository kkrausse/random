#!/bin/sh
# Deploys the Reading Context OpenCode v2 server to the Pi.
#
#   ./server/deploy.sh             live service: palma2-opencode.service on port 41137
#   STAGING=1 ./server/deploy.sh   staging copy: palma2-opencode-staging.service on port 41138
#
# Staging copies the live state/ into a sibling deployment root and runs v2 from that copy. It
# never stops, restarts, or reconfigures the live service, and it installs its own copy of the CLI,
# so it can be used to try a version or the v1 history migration before the live deploy.
# STAGING_REFRESH=1 throws the staging state away and copies the live state again.
set -eu

HOST="${PALMA_SERVER_HOST:-your-pi}"
VERSION="${OPENCODE_VERSION:-2.0.27}"
# The checked-in address is a placeholder; pass the Pi's real Tailscale IPv4.
UNIT_ADDRESS="100.64.0.10"
ADDRESS="${PALMA_SERVER_ADDRESS:-$UNIT_ADDRESS}"
LIVE_ROOT="/home/pi/deploys/palma2-opencode"
LIVE_UNIT="palma2-opencode"
LIVE_PORT="41137"
BUN="/home/pi/.bun/bin/bun"

if [ "${STAGING:-0}" = 1 ]; then
  ROOT="$LIVE_ROOT-staging"
  UNIT="$LIVE_UNIT-staging"
  PORT="41138"
else
  ROOT="$LIVE_ROOT"
  UNIT="$LIVE_UNIT"
  PORT="$LIVE_PORT"
fi
BIN="$ROOT/cli/node_modules/.bin/opencode"

ssh "$HOST" "mkdir -p '$ROOT'"
rsync -a --delete --exclude workdir --exclude state --exclude cli --exclude .git server/runtime/ "$HOST:$ROOT/"
# The checked-in unit describes the live service; staging is the same unit with its own root, port, and name.
sed -e "s#$LIVE_ROOT/#$ROOT/#g" \
  -e "s#--hostname $UNIT_ADDRESS#--hostname $ADDRESS#" \
  -e "s#--port $LIVE_PORT#--port $PORT#" \
  -e "s#^SyslogIdentifier=.*#SyslogIdentifier=$UNIT#" \
  -e "s#^Description=.*#Description=Palma 2 OpenCode reading server ($UNIT)#" \
  server/palma2-opencode.service | ssh "$HOST" "cat > '/tmp/$UNIT.service'"

ssh "$HOST" "set -eu
mkdir -p '$ROOT/workdir'

if [ '$ROOT' != '$LIVE_ROOT' ]; then
  if [ ! -d '$ROOT/state' ] || [ '${STAGING_REFRESH:-0}' = 1 ]; then
    test -d '$LIVE_ROOT/state'
    sudo systemctl stop '$UNIT.service' 2>/dev/null || true
    rm -rf '$ROOT/state'
    cp -a '$LIVE_ROOT/state' '$ROOT/state'
    # The live server may be writing its SQLite databases. Replace each copied database with a
    # consistent snapshot taken through SQLite instead of trusting a file copy of a live WAL.
    for source in '$LIVE_ROOT'/state/share/opencode/*.db; do
      [ -f \"\$source\" ] || continue
      copy='$ROOT'/state/share/opencode/\$(basename \"\$source\")
      rm -f \"\$copy\" \"\$copy-wal\" \"\$copy-shm\"
      SOURCE_DB=\"\$source\" COPY_DB=\"\$copy\" '$BUN' -e 'const { Database } = require(\"bun:sqlite\"); const db = new Database(process.env.SOURCE_DB, { readonly: true }); db.query(\"VACUUM INTO ?\").run(process.env.COPY_DB); db.close();'
    done
  fi
fi

mkdir -p '$ROOT/state/share/opencode' '$ROOT/state/state' '$ROOT/state/cache'
if [ ! -f '$ROOT/state/server.env' ]; then
  umask 077
  printf 'OPENCODE_SERVER_PASSWORD=%s\n' \"\$(openssl rand -hex 24)\" > '$ROOT/state/server.env'
elif grep -q '^OPENCODE_PASSWORD=' '$ROOT/state/server.env' && ! grep -q '^OPENCODE_SERVER_PASSWORD=' '$ROOT/state/server.env'; then
  sed 's/^OPENCODE_PASSWORD=/OPENCODE_SERVER_PASSWORD=/' '$ROOT/state/server.env' > '$ROOT/state/server.env.new'
  chmod 0600 '$ROOT/state/server.env.new'
  mv '$ROOT/state/server.env.new' '$ROOT/state/server.env'
fi
if [ ! -f '$ROOT/state/share/opencode/auth.json' ] && [ -f /home/pi/.local/share/opencode/auth.json ]; then
  cp /home/pi/.local/share/opencode/auth.json '$ROOT/state/share/opencode/auth.json'
fi

# The CLI is installed inside the deployment root, pinned, so this server's version does not depend
# on (or change) any other OpenCode install on the Pi.
mkdir -p '$ROOT/cli'
[ -f '$ROOT/cli/package.json' ] || printf '{\"private\":true}\n' > '$ROOT/cli/package.json'
(cd '$ROOT/cli' && '$BUN' add --exact --trust '@opencode/cli@$VERSION')
test -x '$BIN'
case \"\$('$BIN' --version)\" in
  *'$VERSION') ;;
  *) echo 'Installed OpenCode is not $VERSION' >&2; exit 1 ;;
esac

git -C '$ROOT' init -q
git -C '$ROOT' add .gitignore opencode.json AGENTS.md
git -C '$ROOT' -c user.name='Palma Deploy' -c user.email='palma@localhost' commit -q -m 'Deploy Palma OpenCode config' --allow-empty

sudo systemctl stop '$UNIT.service' 2>/dev/null || true
if [ '$ROOT' = '$LIVE_ROOT' ]; then
  # v2 migrates the v1 history in place on first start. Keep the state exactly as it was before.
  stamp=\$(date +%Y%m%d-%H%M%S)
  tar -C '$ROOT' -czf \"/home/pi/palma2-opencode-before-v2-\$stamp.tgz\" state
fi

sudo install -m 0644 '/tmp/$UNIT.service' '/etc/systemd/system/$UNIT.service'
sudo systemctl daemon-reload
if [ '$ROOT' = '$LIVE_ROOT' ]; then
  sudo systemctl enable '$UNIT.service'
fi
sudo systemctl restart '$UNIT.service'"

ssh "$HOST" "set -eu
. '$ROOT/state/server.env'
base='http://$ADDRESS:$PORT'
i=0
until curl --fail --silent --user \"opencode:\$OPENCODE_SERVER_PASSWORD\" \"\$base/api/info\"; do
  i=\$((i + 1))
  if [ \"\$i\" -ge 30 ]; then
    sudo journalctl -u '$UNIT.service' -n 50 --no-pager
    exit 1
  fi
  sleep 1
done
printf '\n'
curl --fail --silent --get --user \"opencode:\$OPENCODE_SERVER_PASSWORD\" --data-urlencode 'directory=$ROOT/workdir' \"\$base/api/session\" >/dev/null
# Report the v1 history migration, waiting a while if it is still running.
i=0
while :; do
  status=\$(curl --fail --silent --user \"opencode:\$OPENCODE_SERVER_PASSWORD\" \"\$base/api/experimental/migration/v1\" || echo unavailable)
  case \"\$status\" in *'\"running\"'*) ;; *) break ;; esac
  i=\$((i + 1))
  [ \"\$i\" -lt 120 ] || break
  sleep 2
done
printf 'V1 history migration: %s\n' \"\$status\"
# Migrated chats keep the directory they were created in, which is always the live workdir.
count=\$(curl --fail --silent --get --user \"opencode:\$OPENCODE_SERVER_PASSWORD\" --data-urlencode 'directory=$LIVE_ROOT/workdir' --data-urlencode 'limit=200' \"\$base/api/session\" | grep -o '\"id\":\"ses_' | wc -l)
printf 'Chats listed for $LIVE_ROOT/workdir: %s\n' \"\$count\""
printf '\nPalma OpenCode %s deployed as %s.service on port %s.\n' "$VERSION" "$UNIT" "$PORT"
