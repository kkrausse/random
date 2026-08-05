#!/bin/sh
set -eu

HOST="${PALMA_SERVER_HOST:-your-pi}"
ROOT="/home/pi/deploys/palma2-opencode"
VERSION="${OPENCODE_VERSION:-1.18.13}"

ssh "$HOST" "mkdir -p '$ROOT'"
rsync -a --delete --exclude workdir --exclude state --exclude .git server/runtime/ "$HOST:$ROOT/"
scp server/palma2-opencode.service "$HOST:/tmp/palma2-opencode.service"
scp server/migrate-v2-history.sh "$HOST:/tmp/migrate-v2-history.sh"
ssh "$HOST" "set -eu
mkdir -p '$ROOT/workdir' '$ROOT/state/share/opencode'
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

/home/pi/.bun/bin/bun install -g --trust 'opencode-ai@$VERSION'
/home/pi/.bun/bin/bun remove -g @opencode-ai/cli 2>/dev/null || true
test -x /home/pi/.bun/bin/opencode
test \"\$(/home/pi/.bun/bin/opencode --version)\" = '$VERSION'

git -C '$ROOT' init -q
git -C '$ROOT' add .gitignore opencode.json AGENTS.md
git -C '$ROOT' -c user.name='Palma Deploy' -c user.email='palma@localhost' commit -q -m 'Deploy Palma OpenCode config' --allow-empty

sudo systemctl stop palma2-opencode-v2.service 2>/dev/null || true
sudo systemctl stop palma2-opencode.service 2>/dev/null || true
for proc in /proc/[0-9]*; do
  name=\$(cat \"\$proc/comm\" 2>/dev/null || true)
  exe=\$(readlink -f \"\$proc/exe\" 2>/dev/null || true)
  case \"\$name:\$exe\" in
    opencode:*|opencode2:*|opencode2.exe:*|lildax:*|*:*/opencode|*:*/opencode2|*:*/opencode2.exe|*:*/lildax) kill \"\${proc##*/}\" 2>/dev/null || true ;;
  esac
done
sleep 1
for proc in /proc/[0-9]*; do
  name=\$(cat \"\$proc/comm\" 2>/dev/null || true)
  exe=\$(readlink -f \"\$proc/exe\" 2>/dev/null || true)
  case \"\$name:\$exe\" in
    opencode:*|opencode2:*|opencode2.exe:*|lildax:*|*:*/opencode|*:*/opencode2|*:*/opencode2.exe|*:*/lildax) kill -KILL \"\${proc##*/}\" 2>/dev/null || true ;;
  esac
done

stamp=\$(date +%Y%m%d-%H%M%S)
tar -C '$ROOT' -czf \"/home/pi/palma2-opencode-before-stable-\$stamp.tgz\" state
db='$ROOT/state/share/opencode'
if [ ! -f \"\$db/opencode.db\" ] && [ -f \"\$db/opencode-next.db\" ]; then
  cp \"\$db/opencode-next.db\" \"\$db/opencode.db\"
  [ ! -f \"\$db/opencode-next.db-wal\" ] || cp \"\$db/opencode-next.db-wal\" \"\$db/opencode.db-wal\"
  [ ! -f \"\$db/opencode-next.db-shm\" ] || cp \"\$db/opencode-next.db-shm\" \"\$db/opencode.db-shm\"
fi
sh /tmp/migrate-v2-history.sh \"\$db/opencode.db\"

sudo install -m 0644 /tmp/palma2-opencode.service /etc/systemd/system/palma2-opencode.service
sudo systemctl disable palma2-opencode-v2.service 2>/dev/null || true
sudo rm -f /etc/systemd/system/palma2-opencode-v2.service
sudo systemctl daemon-reload
sudo systemctl enable palma2-opencode.service
sudo systemctl restart palma2-opencode.service"

ssh "$HOST" "i=0; while [ \"\$i\" -lt 30 ]; do . '$ROOT/state/server.env'; if curl --fail --silent --user \"opencode:\$OPENCODE_SERVER_PASSWORD\" http://100.64.0.10:41137/global/health; then curl --fail --silent --get --user \"opencode:\$OPENCODE_SERVER_PASSWORD\" --data-urlencode 'directory=$ROOT/workdir' http://100.64.0.10:41137/session >/dev/null; exit 0; fi; i=\$((i + 1)); sleep 1; done; sudo journalctl -u palma2-opencode.service -n 50 --no-pager; exit 1"
printf '\nPalma OpenCode %s deployed on port 41137.\n' "$VERSION"
