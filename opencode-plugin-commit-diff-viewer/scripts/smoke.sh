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
tmux send-keys -t "$session" '/commit-diff'
sleep 1

output="$(tmux capture-pane -p -J -t "$session" -S -50)"
grep -Fq "/commit-diff   Compare HEAD with a commit" <<<"$output"
printf 'OpenCode exposed the /commit-diff command\n'
