#!/bin/sh
set -eu

HOST="${PALMA_SERVER_HOST:-your-pi}"
ROOT="/home/pi/deploys/palma2-opencode"

ssh "$HOST" "mkdir -p '$ROOT'"
rsync -a --delete --exclude workdir --exclude state --exclude .git server/runtime/ "$HOST:$ROOT/"
scp server/palma2-opencode-v2.service "$HOST:/tmp/palma2-opencode-v2.service"
ssh "$HOST" "mkdir -p '$ROOT/workdir' '$ROOT/state/share/opencode'; if [ ! -f '$ROOT/state/server.env' ]; then umask 077; printf 'OPENCODE_PASSWORD=%s\n' \"\$(openssl rand -hex 24)\" > '$ROOT/state/server.env'; fi; if [ ! -f '$ROOT/state/share/opencode/auth.json' ] && [ -f /home/pi/.local/share/opencode/auth.json ]; then cp /home/pi/.local/share/opencode/auth.json '$ROOT/state/share/opencode/auth.json'; fi; git -C '$ROOT' init -q; git -C '$ROOT' add .gitignore opencode.json AGENTS.md; git -C '$ROOT' -c user.name='Palma Deploy' -c user.email='palma@localhost' commit -q -m 'Deploy Palma OpenCode config' --allow-empty; sudo install -m 0644 /tmp/palma2-opencode-v2.service /etc/systemd/system/palma2-opencode-v2.service; sudo systemctl daemon-reload; sudo systemctl enable palma2-opencode-v2.service; sudo systemctl restart palma2-opencode-v2.service"

ssh "$HOST" "i=0; while [ \"\$i\" -lt 10 ]; do . '$ROOT/state/server.env'; if curl --fail --silent --user \"opencode:\$OPENCODE_PASSWORD\" http://100.64.0.10:41137/api/health; then exit 0; fi; i=\$((i + 1)); sleep 1; done; exit 1"
printf '\nPalma OpenCode V2 deployed on port 41137.\n'
