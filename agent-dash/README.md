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

`~/.config/agent-dash/machines.json` (created with just this machine if absent):

```json
[
  { "id": "mac" },
  { "id": "diesel2", "ssh": "diesel2", "dir": "~/devfs/repos/kkrausse" },
  { "id": "lrpi", "ssh": "lrpi" }
]
```

- `id`: the name shown in the list. The entry without `ssh` is this machine; `"local"` there is
  shown as its Tailscale name (else its hostname).
- `ssh`: an alias/host from your ssh config (key auth; the dashboard never prompts).
- `dir`: default start directory for new sessions there (default `~`).
- `color`: label color for the host (hex); defaults to a palette color by position in the file.
- `path`: extra PATH entries on the host. `~/.local/bin`, `~/.bun/bin` and
  `~/.opencode/bin` are always added, since non-interactive ssh skips `.bashrc`.

All ssh traffic to a host shares one connection (ControlMaster sockets in
`~/.local/state/agent-dash/ssh`). sshd allows 10 sessions per connection by default
(`MaxSessions`); each open remote pane and the host's status loop take one.

## List

Sections: **Working**, **Needs input**, **Finished** (done, failed, interrupted, idle),
**Archived** (collapsed; tab shows it). Known unprompted drafts are hidden, not archived or deleted.
Row labels are `machine·harness`, the machine in
its host color and the harness in its own. Working is ordered by when each session
started working, so one you just answered lands at its bottom, next to Needs input.
In a session pane, mouse drags go to the harness, which draws and copies its own selection;
for harnesses that don't take the mouse, the dashboard selects and copies on release. A session is archived when its
harness archived it, you archived it here, or it is finished and untouched for 7
days. Rows are labelled `machine·harness`; the footer lists sources with problems
(red) and harnesses that aren't there (dim: not installed, unsupported, not running).

Rows show **N subagents (M active)**, counting all descendants like the
session-manager plugin. Counts include finished descendants; `≥N` means the bounded
history scan was incomplete. Children are not separate top-level rows. For Claude the
total is the session's subagent transcripts; "active" is only known for background
sessions (their job state lists what the current turn has running).

Context badges show **N% ctx**, or a token count when the limit is unavailable:

- **OpenCode:** latest assistant-response usage and that model's location-specific
  context limit, fetched for active sessions. Completed sessions retain snapshots
  observed while they were active. Compaction/revert boundaries are respected.
- **Codex:** latest `thread/tokenUsage/updated` notification received on the live
  connection. No snapshot is available at initial connection until an event arrives;
  receiving events depends on the server's notification/subscription behavior.
  The dashboard does not resume threads to subscribe to usage.
- **Claude:** the last response's input tokens (fresh, cache-read and cache-write),
  read from the session transcript, which is how Claude's own status line counts it.
  The transcript doesn't record the window size, so the limit is assumed: 1M for
  Claude 5 models and `[1m]` ids (or once usage passes 200k), else 200k. Unavailable
  between a compaction and the next response.

These are latest-response snapshots, not continuously exact streaming usage or
lifetime billed tokens. The selected row's footer shows raw tokens and snapshot
age. Missing data is omitted, never displayed as 0%.

Archive marks live on each session's own host in `~/.config/agent-dash/archive.json`,
so every dashboard sees the same marks. Restoring overrides the 7-day rule; it can't
undo an archive made in the harness itself.

## Keys

List: ↑↓/jk move · ⏎/→ open · n new · x stop + archive · r restore · tab show archived ·
/ filter · q quit.

`x` first stops whatever is still running in the session, so an archived session can't wake
itself up later (a Claude `/loop` or scheduled wakeup), then archives it. If the stop fails the
session stays unarchived. `x` on an already archived but still running session just stops it.
The conversation is kept either way; opening the session resumes it.

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

What a harness needs to appear here, per machine:

- **A daemon that owns its sessions**, so they outlive any client, including the dashboard's pane.
- **Presence**: a cheap check that says installed / too old / daemon not running (shown dimly, not as errors).
- **List**: every session with id, title, cwd, last update, model, whether the harness archived it,
  and a status that maps onto `working | needs | done | failed | interrupted | idle`. Activity
  (working, needs input) must come from the live process, not from a self-reported note.
- **Change signal**: an event stream that triggers a re-list, or polling. Polling also re-lists on
  demand, which the dashboard asks for when you leave a pane.
- **Open**: a CLI that attaches to a session by id in a terminal (run over ssh for remote machines).
- **New**: a CLI that starts a session in a directory, plus a way to recognise it in the list (an
  id it prints, or the first new session in that directory).
- **Stop** (optional): end whatever is still running so nothing starts again unprompted. `x` runs it
  before archiving. A harness whose sessions can wake themselves (Claude's `/loop`, scheduled
  wakeups) must stop the process; one that only runs when prompted just interrupts the turn.

| Harness | Status | Open | New | Stop |
|---|---|---|---|---|
| Claude Code | per-host sh loop: `claude agents --json --all` + `~/.claude/jobs/<id>/state.json` every 2 s | `claude attach <id>` | `claude --bg`, then attach | `claude stop <id>` (ends the process and its wakeups; background sessions only) |
| OpenCode 2.x | background service HTTP API (`~/.local/state/opencode/service.json`, basic auth user `opencode`), re-read on `/api/event` events | `opencode -s <id>` | `opencode <dir>` | `POST /api/session/<id>/interrupt` |
| Codex | app-server daemon, WebSocket over `~/.codex/app-server-control/app-server-control.sock`, re-read on thread notifications | `codex resume <id>` | `codex -C <dir>` | `turn/interrupt` on the in-progress turn |

Remote OpenCode ports and Codex sockets are forwarded over the shared ssh connection.
OpenCode 1.x and Claude Code without `agents --json` show as unsupported.

Interactive Claude sessions (plain `claude` in another terminal) are listed but
marked view only: `claude attach` only accepts background jobs.
