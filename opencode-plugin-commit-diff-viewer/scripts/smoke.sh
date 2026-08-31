#!/usr/bin/env bash

set -euo pipefail

session="opencode-plugin-smoke-$$"

cleanup() {
  tmux kill-session -t "$session" 2>/dev/null || true
}
trap cleanup EXIT

tmux new-session -d -x 160 -y 50 -s "$session" "opencode2"
sleep 3

tmux has-session -t "$session"
printf 'OpenCode started with the configured POC plugin; verify the startup toast manually\n'
