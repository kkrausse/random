# agent-dash

One status list for Claude Code, OpenCode and Codex sessions, on this machine and
any others you can `ssh` to. Opening a session runs the harness's own CLI inside
the dashboard (a PTY drawn by OpenTUI's embedded terminal, over ssh for remote
machines), so agent-dash never reimplements a chat view. Each harness keeps its
sessions in a daemon, so leaving a pane never stops the agent.

```sh
bun install
ln -s "$PWD/bin/agentdash" ~/.local/bin/agentdash
agentdash   # new local sessions start in the directory you run it from
```

See [docs/design.md](docs/design.md) for how it works.

## Machines

`~/.config/agent-dash/machines.json` (created as `[{"id":"local"}]` if absent):

```json
[
  { "id": "local" },
  { "id": "diesel2", "ssh": "diesel2", "dir": "~/devfs/repos/kkrausse" },
  { "id": "lrpi", "ssh": "lrpi" }
]
```

- `ssh`: an alias/host from your ssh config (key auth; the dashboard never prompts).
- `dir`: default start directory for new sessions there (default `~`).
- `path`: extra PATH entries on the host. `~/.local/bin`, `~/.bun/bin` and
  `~/.opencode/bin` are always added, since non-interactive ssh skips `.bashrc`.

All ssh traffic to a host shares one connection (ControlMaster sockets in
`~/.local/state/agent-dash/ssh`). sshd allows 10 sessions per connection by default
(`MaxSessions`); each open remote pane and the host's status loop take one.

## List

Sections: **Needs input**, **Finished** (done, failed, interrupted, never prompted),
**Working**, **Archived** (collapsed; tab shows it). A session is archived when its
harness archived it, you archived it here, or it is finished and untouched for 7
days. Rows are labelled `machine·harness`; the footer lists sources with problems
(red) and harnesses that aren't there (dim: not installed, unsupported, not running).

Archive marks live on each session's own host in `~/.config/agent-dash/archive.json`,
so every dashboard sees the same marks. Restoring overrides the 7-day rule; it can't
undo an archive made in the harness itself.

## Keys

List: ↑↓/jk move · ⏎/→ open · n new · x archive · r restore · tab show archived ·
/ filter · q quit.

New session: ↑↓ machine · ←→ harness · tab edit start dir · ⏎ open · esc back.
Combinations whose harness is missing or unsupported are greyed out.

In a session pane, go back to the list with:

- ctrl+] anywhere
- ← or ctrl+c on an empty prompt (ctrl+c passes through while the agent works or
  text is typed, so it still clears and interrupts)

The client stays alive in the background (● open) and reopens instantly; panes not
shown for 15 minutes are closed. An unused new chat is cached for reuse ("·ready"),
and ← on its empty prompt returns to the picker.

## Providers

| Harness | Status | Open | New |
|---|---|---|---|
| Claude Code | per-host sh loop: `claude agents --json --all` + `~/.claude/jobs/<id>/state.json` every 2 s | `claude attach <id>` | `claude --bg`, then attach |
| OpenCode 2.x | background service HTTP API (`~/.local/state/opencode/service.json`, basic auth user `opencode`), re-read on `/api/event` events | `opencode -s <id>` | `opencode <dir>` |
| Codex | app-server daemon, WebSocket over `~/.codex/app-server-control/app-server-control.sock`, re-read on thread notifications | `codex resume <id>` | `codex -C <dir>` |

Remote OpenCode ports and Codex sockets are forwarded over the shared ssh connection.
OpenCode 1.x and Claude Code without `agents --json` show as unsupported.

Interactive Claude sessions (plain `claude` in another terminal) are listed but
marked view only: `claude attach` only accepts background jobs.
