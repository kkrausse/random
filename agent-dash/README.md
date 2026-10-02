# agent-dash

One status list for Claude Code, OpenCode and Codex sessions. Opening a session
runs the harness's own CLI inside the dashboard (a PTY drawn by OpenTUI's
embedded terminal), so agent-dash never reimplements a chat view. Each harness
keeps its sessions in a daemon, so leaving a pane never stops the agent.

```sh
bun install
ln -s "$PWD/bin/agentdash" ~/.local/bin/agentdash
agentdash   # new sessions start in the directory you run it from
```

## Keys

List: ↑↓/jk move · ⏎/→ open · n new · / filter · tab show inactive · r refresh · q quit.

In a session pane, go back to the list with:

- ctrl+] anywhere
- ← or ctrl+c on an empty prompt (ctrl+c passes through while the agent works or
  text is typed, so it still clears and interrupts)

The client stays alive in the background (● open) and reopens instantly.

`n` picks a harness and opens its native new chat; model and mode are set in the
harness's own UI. An unused new chat is cached for reuse ("· ready"), and ← on its
empty prompt returns to the picker.

## Providers

| Harness | Status source | Open | New |
|---|---|---|---|
| Claude Code | `claude agents --json --all` + `~/.claude/jobs/<id>/state.json` | `claude attach <id>` | `claude --bg`, then attach |
| OpenCode | background service HTTP API (`~/.local/state/opencode/service.json`, basic auth user `opencode`) | `opencode -s <id>` | `opencode <dir>` |
| Codex | app-server daemon, WebSocket over `~/.codex/app-server-control/app-server-control.sock` | `codex resume <id>` | `codex -C <dir>` |

Interactive Claude sessions (plain `claude` in another terminal) are listed but
marked view only: `claude attach` only accepts background jobs.
