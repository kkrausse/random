# agent-dash design

Layers, bottom up:

```
machine helpers (machines.ts)    on() · forward() · exec/sh/lines · shared ssh connection
harness streams                  claude.ts (host loop) · opencode.ts · codex.ts
sources / store (store.ts)       one supervised fiber per machine × harness → Solid store
UI (list.tsx, new-session.tsx,   Solid + OpenTUI; panes run the harness CLI in a PTY
    main.tsx)
```

Effect is used for the source side only (streams, scoped resources, retry
schedules, Schema decoding). The store is the bridge: each stream item replaces
that source's rows in a Solid store; the UI never sees Effect.

## Machines

A machine is `{ id, ssh?, dir?, path? }` from `~/.config/agent-dash/machines.json`.
There is no machine service, just two helpers:

- `on(machine, cmd, { cwd?, tty? })`: `cmd` unchanged locally; remotely an
  `ssh` argv running `PATH=<path entries>:~/.local/bin:~/.bun/bin:~/.opencode/bin:$PATH;
  cd <cwd> && exec <cmd>` (shell-quoted, `~` expanded on the host; `-t` for
  panes, `-T -o BatchMode=yes` otherwise).
- `forward(machine, target)`: local address unchanged; remotely `ssh -O forward
  -L` on the shared connection (a free local TCP port, or a local Unix socket
  for Codex pointing at the remote absolute path, resolved from the remote
  `$HOME`), with `ssh -O cancel` when the Effect scope closes.

### SSH channel model

Every ssh uses `ControlMaster=auto`, `ControlPath=~/.local/state/agent-dash/ssh/%C`
(mode 700; falls back to `/tmp/agent-dash-<uid>` if that path would exceed the
~104 byte Unix socket limit) and `ControlPersist=10m`. The master is opened once
per host under a semaphore, so one TCP connection per host carries:

- the host loop (one long-lived session),
- short commands (`cat service.json`, socket checks, archive writes, `claude --bg`),
- port/socket forwards (OpenCode SSE + requests, Codex RPC; these are channels,
  not sessions),
- each open pane (one session each).

sshd's `MaxSessions` (default 10) caps sessions per connection. A pane refused for
that reason prints a message saying so. Quitting interrupts every source (which
cancels forwards) and runs `ssh -O exit` for each host.

## Harness streams

Each source emits the complete current list on every item.

| Harness | Mechanism | Why |
|---|---|---|
| Claude | one POSIX `sh` loop per host printing a framed record every 2 s | no subscribe API; remotes may have only `sh` (no jq/python/bun) |
| OpenCode 2.x | `/api/event` SSE; relevant events (session.*, permission.*, form.*) trigger a re-list; 60 s resync | the server has an event stream |
| Codex | app-server notifications (`thread/started`, `thread/status/changed`, `thread/archived`, ...) trigger a re-list; 60 s resync | the daemon broadcasts thread notifications to every client |

Triggers arriving while a list is in flight collapse into one more list
(`Stream.buffer` sliding, capacity 1).

### Claude host loop

Frames, one record per tick:

```
@@archive
<~/.config/agent-dash/archive.json>
@@claude <exit code> | @@claude missing
<claude agents --json --all>
@@job <id> <mtime>          followed by state.json, or
@@job <id> <mtime> same     when unchanged since the last tick
@@end
```

The loop emits every tick even when nothing changed; no record for ~3 ticks fails
the stream and the supervisor restarts the command. Local uses the same loop. A
host without `claude` still runs it for its archive marks. The Paseo check (local
`ps`) only runs for the local machine.

### OpenCode

`cat` of `service.json` via `on`, plus `opencode --version` and a `kill -0` of its
pid on that host. CLI missing → not installed; CLI 1.x → unsupported (different
API); no file or dead pid → not running (stale). Then `forward` to the host:port
the url names (the Mac's service binds its Tailscale address, not loopback).

### Codex

`[ -S ~/.codex/app-server-control/app-server-control.sock ]` on the host, forward
the socket, keep the existing hand-framed WebSocket JSON-RPC (`CodexRpc`).

## Sources and store

A source is machine × harness, keyed `machine/harness`. Its state is rows plus an
optional problem. Each source runs under `supervise`: a stream that ends or fails
records the problem and is retried, every 60 s for quiet problems (missing,
unsupported, stopped) and with exponential backoff capped at 30 s for real ones
(unreachable, decode, failed). Real failures keep the last rows on screen.
All external JSON (claude agents output, state.json, archive.json, OpenCode and
Codex responses) is decoded with `Schema`, so format drift is a per-source error.

## Session model

`{ machine, harness, key = machine/harness:id, id, title, cwd, open?: {cmd, cwd},
closedReason?, status, detail, updatedAt, model, archived }`. `open.cmd` is
machine-agnostic; the pane wraps it with `on(machine, cmd, { cwd, tty: true })`.
Status: `needs | working | done | failed | interrupted | idle` (idle = never
prompted, e.g. a fresh `claude --bg`). A new session's claim is data:
`{ id }` (Claude) or `{ firstNewIn: dir }` (OpenCode/Codex).

## Archive

Archived = harness archive, OR a dashboard mark, OR (not needs/working and
`updatedAt` older than 7 days) unless explicitly restored. Marks live on each host in
`~/.config/agent-dash/archive.json` as `{ "harness:id": true | false }` (false =
explicit restore). `x`/`r` read, modify and replace the file on that host with a
POSIX `sh` write (temp file + `mv`); last writer wins between two dashboards
archiving at the same moment. Every dashboard reads the file through that host's
loop record.

## UI

Sections Working → Needs input → Finished → Archived (collapsed). Order within a
section is frozen once every source answered (or after 5 s); live updates move
badges and sections, never positions within a section. Working is the exception:
it is ordered by when each session was first seen working, so a newly working
session joins its bottom.

Inside a pane, mouse drags always go to the harness. The dashboard watches the
harness output for mouse reporting (DECSET 1000/1002/1003): while it is on, the
harness draws and copies its own selection and the dashboard's selection is off;
while it is off, the dashboard selects and copies on release. OSC 52 clipboard
writes from the harness are re-sent to the real terminal, since the embedded
terminal doesn't pass them on. Panes not shown for 15
minutes are closed (agents keep running in their daemons).
