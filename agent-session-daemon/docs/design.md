# Agent session daemon: design

2026-10-02. Status: draft, nothing built.

One terminal UI for every coding-agent session on every machine I own. See
[comparison.md](comparison.md) for how Paseo and T3 Code solve the same
problem and whether to reuse them instead.

## Goals

- See all Claude Code and OpenCode sessions across my Tailscale machines in
  one list, with which are working and which are waiting on me.
- Start a session choosing host, harness, model and directory.
- Send messages, answer permission prompts and questions, interrupt, stop.
- Keep the UI small. The UI is the point; everything else is plumbing.

## Non-goals

- Mobile, web or desktop clients.
- A relay or any access from outside the tailnet.
- Git, PR, worktree or terminal management in the daemon.
- Multi-user, accounts, or auth beyond the tailnet.
- Replacing the harnesses' own TUIs for deep work in a single session.

## Shape

```
  TUI (any machine)
   │  one WebSocket per host, same protocol
   ├──────────────► host daemon (macbook)
   ├──────────────► host daemon (linux box)
   └──────────────► host daemon (...)

  host daemon
   ├─ claude adapter   ── Claude Agent SDK ── claude subprocess per session
   └─ opencode adapter ── HTTP + SSE ─────── opencode serve (already running)
```

- **Everything harness-specific lives on the host.** The client speaks one
  protocol and never imports a harness SDK.
- **Hosts never talk to each other.** The client merges.
- **The daemon is the source of truth for live state** on its machine.

## Adapter interface

Internal to the daemon. One implementation per harness.

```ts
interface HarnessAdapter {
  harness: HarnessId
  info(): Promise<HarnessInfo>
  list(opts?: { cwd?: string }): Promise<SessionSummary[]>
  read(sessionId: string): Promise<SessionEvent[]>
  create(opts: CreateOpts): Promise<SessionSummary>
  send(sessionId: string, text: string): Promise<void>
  reply(sessionId: string, requestId: string, answer: RequestAnswer): Promise<void>
  interrupt(sessionId: string): Promise<void>
  stop(sessionId: string): Promise<void>
  subscribe(listener: (e: SessionEvent) => void): () => void
}

type HarnessId = "claude" | "opencode"

interface HarnessInfo {
  harness: HarnessId
  available: boolean
  models: { id: string; label: string }[]
}

interface CreateOpts {
  cwd: string
  prompt: string
  model?: string
  permissionMode?: string
}

interface SessionSummary {
  id: string
  harness: HarnessId
  cwd: string
  title: string
  model?: string
  state: SessionState
  openRequest?: PendingRequest
  parentId?: string
  updatedAt: number
}

type SessionState = "working" | "waiting" | "idle" | "failed"
```

Rules for implementations:

- `send` works whether or not the session has a live process. Resuming is the
  adapter's business.
- `list` returns history merged with live state. A session with no live
  process is `idle`.
- `state` is `waiting` exactly when `openRequest` is set.

## Pending requests

Permissions and questions are one concept: something the session is blocked
on that only I can answer.

```ts
interface PendingRequest {
  id: string
  kind: "permission" | "question" | "plan"
  title: string
  detail?: string                 // command, diff, file path
  options?: { id: string; label: string }[]
  questions?: { id: string; prompt: string; choices?: string[] }[]
  raw?: unknown                   // harness payload, for display only
}

type RequestAnswer =
  | { kind: "allow"; scope?: "once" | "session" | "always" }
  | { kind: "deny"; message?: string }
  | { kind: "answers"; values: Record<string, string> }
```

A request is open from `request.open` until `request.resolved`. It is lost if
the daemon restarts; the session comes back `idle` and the turn is re-run on
the next message.

## Wire protocol

WebSocket, JSON, one connection per host. Requests carry an `id` and get one
response; events are pushed.

### Requests

| Method | Params | Result |
|---|---|---|
| `host.info` | | host name, harnesses with models, known directories |
| `session.list` | `{ cwd? }` | `SessionSummary[]` across all adapters |
| `session.create` | `{ harness } & CreateOpts` | `SessionSummary` |
| `session.read` | `{ sessionId }` | transcript as `SessionEvent[]` |
| `session.send` | `{ sessionId, text }` | |
| `session.reply` | `{ sessionId, requestId, answer }` | |
| `session.interrupt` | `{ sessionId }` | |
| `session.stop` | `{ sessionId }` | |
| `session.watch` | `{ sessionId, sinceSeq? }` | starts detail events for one session |
| `session.unwatch` | `{ sessionId }` | |

### Events

Two tiers, so an idle client is cheap:

- **Always sent:** `session.updated` with a full `SessionSummary` whenever
  state, title or open request changes. This alone drives the list, the
  status gutter and the inbox.
- **Sent only for watched sessions:** the detail stream.

```ts
type SessionEvent = { sessionId: string; seq: number; at: number } & (
  | { type: "message.delta"; role: "assistant"; text: string }
  | { type: "message"; role: "user" | "assistant"; text: string }
  | { type: "tool.start"; toolId: string; name: string; input: unknown }
  | { type: "tool.end"; toolId: string; ok: boolean; summary?: string }
  | { type: "request.open"; request: PendingRequest }
  | { type: "request.resolved"; requestId: string }
  | { type: "subagent.start"; subagentId: string; label: string }
  | { type: "subagent.end"; subagentId: string }
  | { type: "turn.end"; ok: boolean; error?: string }
) & { raw?: unknown }
```

### Reconnect

Start with the simple version, as Paseo does:

- On connect the client calls `session.list`; that fully restores the list
  and inbox.
- For an open session the client calls `session.read` and re-renders.
- `seq` is per session and only orders events within one daemon run.

Add a per-session ring buffer and `sinceSeq` replay only if losing mid-turn
deltas on reconnect turns out to matter. No durable event log: both
harnesses already persist transcripts.

## Claude adapter

The Claude Agent SDK is a library, not a client. `query()` spawns a `claude`
subprocess that the calling process owns. So this adapter is where the daemon
does real work.

- **Live map:** `sessionId → { query, inputQueue, pending requests }`.
- **Create:** one long-lived `query()` per session with a streaming input
  iterable, `includePartialMessages`, `cwd`, `model`, `permissionMode`, the
  `claude_code` system prompt preset, and normal `settingSources` so project
  config, skills and hooks load as they do in the CLI.
- **Session ID:** arrives on the init message. `create` awaits it before
  returning.
- **Send:** push onto the input iterable if live; otherwise start a new
  `query()` with `resume: sessionId`.
- **Permissions:** `canUseTool` emits `request.open`, awaits a promise keyed
  by request ID, and returns allow or deny from `reply`. Abort signal resolves
  it as cancelled.
- **Questions and plans:** `AskUserQuestion` and `ExitPlanMode` arrive
  through the same callback. Map them to kind `question` / `plan`; answers
  return through `updatedInput`.
- **List:** SDK `listSessions()` for history, overlaid with the live map.
- **Read:** SDK `getSessionMessages()`, mapped to `SessionEvent`.
- **Subagents:** messages with `parent_tool_use_id` become `subagent.*`
  events on the parent. No separate rows at first.
- **Model switch:** `setModel()` on the live query.
- **Idle reaping:** close the subprocess after a period idle; it resumes on
  the next `send`.

Optional, later: also surface rows from `claude agents --json` so sessions
started by hand in a terminal appear in the list, and register a
`PermissionRequest` HTTP hook pointing at the daemon so those can be approved
too. They cannot be chatted with.

## OpenCode adapter

Passive. `opencode serve` owns sessions, liveness, the event stream and
pending permissions, so this adapter holds no state of its own.

- Attach to the machine's existing `opencode serve` rather than spawning one,
  so sessions from my normal OpenCode TUI show up. Spawn only if none is
  running.
- `list`, `read`, `create`, `send`, `interrupt` map to the OpenCode SDK.
- Subscribe to the SSE event stream and translate to `SessionEvent`.
- Permission and question replies map to OpenCode's reply endpoints.
- Children map to `parentId`, which OpenCode already models.
- `oc-plugin-session-manager/src/attention-api.ts` and
  `session-controller.tsx` already contain the status and inbox logic against
  this API; lift from there.

## Daemon

- Bun, TypeScript, functions and interfaces.
- One process per machine, run as a user service (launchd on macOS, systemd
  user unit on Linux). It must be long-lived: Claude subprocesses die with it.
- Binds to the Tailscale interface only. No other auth at first; the daemon
  can run arbitrary agents, so it must never listen on a public interface.
- Local state is one small JSON or SQLite file: known directories, and for
  Claude the last known summary per session so the list is fast.
- After restart every Claude session is `idle`; nothing is auto-resumed.

## Client

- Config is a list of hosts (`name`, tailnet address).
- One connection per host, reconnecting independently. An unreachable host is
  shown as unavailable, never as an empty list.
- The client talks to a `HostClient` interface, so the backend can be this
  daemon or Paseo's (`@getpaseo/client`) without touching the UI.

```ts
interface HostClient {
  host: string
  status(): "connected" | "connecting" | "unavailable"
  info(): Promise<HostInfo>
  list(): Promise<SessionSummary[]>
  create(harness: HarnessId, opts: CreateOpts): Promise<SessionSummary>
  read(sessionId: string): Promise<SessionEvent[]>
  send(sessionId: string, text: string): Promise<void>
  reply(sessionId: string, requestId: string, answer: RequestAnswer): Promise<void>
  interrupt(sessionId: string): Promise<void>
  stop(sessionId: string): Promise<void>
  onSummary(listener: (s: SessionSummary) => void): () => void
  watch(sessionId: string, listener: (e: SessionEvent) => void): () => void
}
```

### TUI

OpenTUI + Solid, the same stack as `oc-plugin-session-manager`, reusing its
picker design:

- **List:** rows grouped by host, single-cell status gutter (`!` permission,
  `?` question, spinner for working), harness tag, title, model, age.
  Subagents collapsed under their parent.
- **Inbox:** the first open request across all hosts, with Allow / Deny /
  Always, one at a time.
- **Session view:** transcript, streaming output, composer, interrupt.
- **New session:** pick host, harness, model, directory, then type a prompt.

## Build order

1. Daemon skeleton with the OpenCode adapter: `host.info`, `session.list`,
   `session.updated`. A script that prints a merged list from two hosts.
2. Claude adapter: create, send, streaming, permission reply.
3. TUI list and inbox across hosts.
4. Session view and new-session flow.
5. Questions, plans, subagents, model switch.
6. Optional: `claude agents --json` rows and the permission hook.

## Open decisions

- **Reuse first?** [comparison.md](comparison.md) recommends a short spike of
  the TUI on Paseo's client before building the daemon. If that is good
  enough, steps 1, 2, 5 and 6 above disappear.
- **Transport framework.** Plain typed JSON over WebSocket is enough for
  about ten methods. Effect RPC over WebSocket (what T3 Code uses) would give
  a typed client and streaming for free, and OpenCode is on Effect 4 too.
  Lean: plain JSON until the protocol stops changing.
- **Claude subscription login.** Assumed that an SDK-spawned `claude` uses
  the machine's existing login when no API key is set. Verify before step 2.
- **Codex.** Would be a third adapter over `codex app-server` (JSON-RPC over
  stdio), which is what both Paseo and T3 Code do. Not planned.
- **Subagents as rows or nested events.** Nested first; revisit if I want to
  message a Claude subagent directly.
