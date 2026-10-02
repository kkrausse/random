# Multi-host agent sessions: proposed design vs. Paseo vs. T3 Code

2026-10-02. Goal: one simple terminal UI that shows every Claude Code and
OpenCode session across my Tailscale machines, shows which are waiting on me,
and lets me start, message and approve them, choosing host, harness and model.

Companion to [design.md](design.md), which specifies the own-daemon option.

Sources: Paseo at `ac83aa0` (v0.11.0-beta.3) and T3 Code at `6c8fed3`
(v0.0.44), both read from source on this date, plus the Claude Code and
OpenCode docs. Nothing here was run; see [Unverified](#unverified).

## Conclusion

All three designs are the same architecture. Paseo and T3 Code each
independently arrived at what I sketched: a per-machine daemon, one generic
adapter interface per harness, one WebSocket protocol with permissions as
first-class messages, and multi-host aggregation in the client.

So the choice is not about design, it is about how much to own:

1. **Recommended first step: write only the TUI, on `@getpaseo/client`, with
   the stock Paseo daemon on each host.** Paseo is the only one with a
   published, documented client library, and it has no TUI, so the TUI is the
   one piece that does not exist yet. The daemon's weight is invisible once
   installed.
2. **Fallback: build the small daemon myself** (Bun, two adapters), copying
   the patterns listed under [What to copy](#what-to-copy). Do this if the
   Paseo daemon or its pre-1.0 client turns out to be annoying.
3. **Do not fork either.** Both servers are roughly 185-190k lines and move
   fast, and most of that is features I do not want (git/PR tooling,
   terminals, voice, relay, mobile).

To keep the fallback cheap, the TUI should talk to a small `HostClient`
interface of my own, with a Paseo-backed implementation first. Swapping in my
own daemon later then does not touch the UI.

## The proposed design

- **Host daemon** on every machine, bound to the Tailscale interface.
- **Adapter interface** implemented per harness: `info`, `list`, `read`,
  `create`, `send`, `reply`, `interrupt`, `stop`, plus one normalized event
  stream.
- **Claude adapter** uses the Claude Agent SDK. The SDK is a library that
  spawns one `claude` subprocess per session over stdio, so the daemon has to
  own liveness, pending requests and restart recovery.
- **OpenCode adapter** is passive: `opencode serve` already owns all of that,
  so the adapter only translates.
- **Wire protocol** is my own: requests plus sequence-numbered events with
  replay from `sinceSeq`, and "pending request" (`permission` or `question`)
  as a first-class message that drives the `waiting` state.
- **Client** is a thin TUI that holds a host list and merges session lists.

## How each one does it

| | Proposed | Paseo | T3 Code |
|---|---|---|---|
| Per-machine daemon | Bun, small | Node 22, `@getpaseo/server`, 184k lines | Node 24, npm `t3`, 188k lines |
| Adapter interface | `HarnessAdapter` | `AgentClient` + `AgentSession` | `ProviderAdapterShape` |
| Claude | Agent SDK `query()` | Agent SDK `query()`, streaming input | Agent SDK `query()`, one per thread |
| Claude approvals | park the permission callback | `canUseTool` parks a promise | `canUseTool` parks a `Deferred` |
| Claude questions | `request.open` kind `question` | same channel, kind `question` / `plan` | separate `user-input.requested` event |
| OpenCode | talk to `opencode serve` | spawns a shared `opencode serve`, OpenCode SDK v2 | spawns `opencode serve` per thread, OpenCode SDK v2 |
| Codex | later | `codex app-server` JSON-RPC over stdio | `codex app-server` JSON-RPC over stdio |
| Transport | WebSocket JSON | WebSocket JSON (+ binary for terminals) | Effect RPC over WebSocket |
| Schema | TS types | zod, one 7.5k-line file, ~435 messages | Effect Schema, ~170 RPC methods |
| Event ordering | per-session `seq` | per-agent `seq` + `epoch` | global `sequence`, event-sourced |
| Replay on reconnect | automatic from `sinceSeq` | client must fetch timeline after cursor | `afterSequence`, snapshot fallback |
| Durable event log | JSONL or SQLite | none; timeline in memory, rehydrated from provider transcript | SQLite event store + projections |
| "Waiting" state | derived from open request | derived (`needs_input` bucket) | derived from pending approvals |
| After daemon restart | sessions idle, resume lazily | agents `closed`, resume lazily | threads kept, sessions interrupted |
| Multi-host | client merges | app has host registry; CLI is one host per call | client-side registry, one connection per environment |
| Auth | Tailscale only | optional password, Host/Origin allowlist | pairing token, scoped sessions |
| Reusable client | n/a | `@getpaseo/client` on npm, documented | none; packages are private |
| TUI | to build | none | none |
| Extension point | adapters | plugin SDK (can add a provider) | none; static driver list |
| License | mine | Apache-2.0 | MIT |

### Paseo adapter interface (abbreviated)

`packages/server/src/server/agent/agent-sdk-types.ts`

```ts
interface AgentClient {
  createSession(config, launchContext?, opts?): Promise<AgentSession>
  resumeSession(handle: AgentPersistenceHandle, overrides?): Promise<AgentSession>
  fetchCatalog(opts): Promise<{ models, modes, defaultModeId }>
  isAvailable(): Promise<boolean>
}
interface AgentSession {
  startTurn(prompt, opts?): Promise<{ turnId }>
  subscribe(cb: (e: AgentStreamEvent) => void): () => void
  streamHistory(): AsyncGenerator<AgentStreamEvent>
  getPendingPermissions(): AgentPermissionRequest[]
  respondToPermission(requestId, response): Promise<...>
  setMode(id); setModel?(id); interrupt(); close()
  describePersistence(): AgentPersistenceHandle | null
}
```

### T3 Code adapter interface (abbreviated)

`apps/server/src/provider/Services/ProviderAdapter.ts`

```ts
interface ProviderAdapterShape<TError> {
  startSession(input): Effect<ProviderSession, TError>
  sendTurn(input): Effect<ProviderTurnStartResult, TError>
  interruptTurn(threadId, turnId?): Effect<void, TError>
  respondToRequest(threadId, requestId, decision): Effect<void, TError>
  respondToUserInput(threadId, requestId, answers): Effect<void, TError>
  stopSession(threadId); listSessions(); hasSession(threadId)
  readThread(threadId); rollbackThread(threadId, numTurns)
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>
}
```

## Where they differ from the proposal

- **Paseo has no durable event log.** Timelines live in memory and are
  rebuilt from the harness's own transcript. That is simpler than I proposed
  and probably enough: both Claude and OpenCode already persist transcripts.
- **Paseo's replay is pull, not push.** After reconnect the client fetches
  the timeline after its last `(epoch, seq)`. Fine for a TUI.
- **T3 Code is fully event-sourced.** Commands go through a decider into a
  SQLite event table with projections. Correct, but far more machinery than a
  personal tool needs.
- **Both layer extra concepts on sessions.** Paseo has workspaces and
  projects; T3 Code has projects, threads and environments. A TUI on Paseo
  has to live with its model.
- **Both spawn OpenCode themselves.** Neither attaches to an `opencode serve`
  I already run by default (T3 Code can optionally). Sessions I start in my
  own OpenCode TUI may not show up without extra work. This matters because
  `oc-plugin-session-manager` already gives me a good OpenCode view.

## Size and weight

| | Paseo | T3 Code |
|---|---|---|
| Server | 184k lines, 42 deps (node-pty, sherpa-onnx, express) | 188k lines, Effect 4.0.0-rc |
| UI | 281k (Expo) + 13k (Electron) | 223k web + 101k mobile + 40k desktop |
| Session-relevant core | ~78k `agent/` (55k providers) + ~15k ws/session | ~25-30k |
| Claude adapter alone | ~10.8k | ~5.7k |
| Client library | 11k, published | 31k, private |
| Release pace | 129 releases June-Oct 2026 | v0.0.44, 54 DB migrations |

The Claude adapter sizes are the useful warning: the happy path is a few
hundred lines, and the rest is edge cases (plan mode, questions, subagents,
resume cursors, aborts). A self-built adapter starts small and grows.

## API stability for a third-party UI

| | Paseo | T3 Code |
|---|---|---|
| Client package | `@getpaseo/client`, published on npm | `@t3tools/contracts`, `@t3tools/client-runtime`, both `private`, unpublished |
| Stated supported surface | Yes: the package root is "the supported SDK surface" | None |
| Compatibility policy | Written: wire schema changes are append-only, both directions, with capability flags | Capability flags exist; no promise to outside clients |
| Version | pre-1.0 (0.11 beta) | 0.0.44 |
| Docs for building on it | `public-docs/sdk/*` | Internal docs only |
| Known gap | Paseo's own CLI mostly uses the unsupported `internal/daemon-client` import, so the public surface may be incomplete | Must vendor from a git checkout and re-sync by hand |
| Replay for a UI | Client refetches after its last cursor | Server replays from `afterSequence` |

Paseo is the only one that treats outside clients as a supported use. T3 Code
is usable but means pinning a commit and owning the upgrade.

## Telemetry and outbound calls

Checked by grepping server, client, CLI and protocol packages; not a full
network audit.

**T3 Code** sends product analytics to PostHog, on by default.

- `apps/server/src/telemetry/AnalyticsService.ts` posts batches to
  `https://us.i.posthog.com` with a built-in project key.
- The identifier is a SHA-256 hash of, in order: the Codex account ID from
  `~/.codex/auth.json`, the Claude user ID from `~/.claude.json`, or a random
  installation ID.
- Events: server boot heartbeat, client connected, thread started, turn
  requested, session started/stopped, turn completed. Properties include
  provider, model, reasoning effort, permission mode, duration and token
  totals. Its docs state prompts, responses and file contents are not sent.
- **Off switch:** `T3CODE_TELEMETRY_ENABLED=false` in the server's
  environment. With it off, nothing is recorded or sent.
- Not audited: its OpenTelemetry observability layer, desktop update checks,
  and T3 Connect (Clerk sign-in plus relay), which is opt-in.

**Paseo** has no analytics in the daemon, client, CLI or protocol packages:
no PostHog, Sentry or similar dependency, and no telemetry code found.

- The one default outbound service is the relay (`relay.paseo.sh`), which is
  enabled unless configured off. Disable it and bind to the tailnet instead.
- `https://app.paseo.sh` is in the default allowed origins for the hosted web
  app; irrelevant with a custom client but worth removing.
- Not checked: the Expo app and bundled plugins, which a custom TUI would not
  run.

## Options

### A. TUI on `@getpaseo/client` (recommended first)

- Per host: `npm install -g @getpaseo/cli`, bind `daemon.listen` to the
  tailnet IP, set a password, decline the relay.
- TUI: one `createPaseoClient({ url, password })` per host; merge
  `client.agents.list()`; subscribe to timelines; answer with
  `agent.respondToPermission`.
- Gets Claude, OpenCode and Codex, model selection and subagent events
  without writing an adapter.
- Risks: client is pre-1.0 and the CLI itself leans on an unsupported
  `internal/daemon-client` import; `@getpaseo/protocol` is 15.9 MB unpacked;
  Paseo's workspace model; hand-started sessions may not appear.

### B. Own daemon, own protocol

- Bun daemon, Claude adapter on the Agent SDK, OpenCode adapter proxying a
  running `opencode serve`.
- Full control and a small surface, and it can attach to sessions I started
  elsewhere.
- Cost: I own the Claude adapter's edge cases and keep up with SDK changes.

### E. Fork T3 Code and add `apps/tui`

A variant of D that avoids speaking the wire protocol by hand.

- Fork the monorepo and add a new `apps/tui` that depends on the workspace
  packages `@t3tools/contracts` and `@t3tools/client-runtime`, the same way
  `apps/web`, `apps/desktop` and `apps/mobile` do.
- `client-runtime` already holds the headless client logic: connection
  registry and supervisor per environment, RPC, auth, thread state, and
  pending-request derivation. It has no React imports and exposes each area
  as a separate subpath export, so the `three`-based device viewers are
  simply not imported.
- The fork only adds a directory, so merging upstream rarely conflicts.
  Upstream contract changes show up as type errors in the TUI.
- T3 Code's `AGENTS.md` says many of its users run forks.
- To check: a few `state/` and `platform/` files reference browser globals,
  so some storage or platform layer may need a terminal implementation.

This is the best way to build on T3 Code, and it keeps the server, web and
mobile apps unmodified.

### Mobile alongside a custom TUI

Using their daemon means their mobile apps keep working next to my TUI: the
daemon is the source of truth, so a session started from either shows in
both. This is the main thing lost by building my own daemon (option B).

- **Paseo:** store apps for iOS and Android. Over Tailscale, set
  `daemon.listen` to the tailnet IP and add the host in the app as a direct
  connection. No relay needed.
- **T3 Code:** store apps for iOS and Android. Pair with
  `t3 pair --tailscale`.

### C. Fork Paseo or T3 Code

- Not worth it: too large, too fast-moving, and T3 Code states it is not
  accepting contributions and has no stable client contract.

### D. T3 Code server with a custom client

- Feasible: `t3 serve`, `t3 auth session issue`, connect to `/ws`, then
  `subscribeShell`, `subscribeThread { afterSequence }` and `dispatchCommand`.
- The client would vendor T3 Code's `contracts` and `client-runtime` from a
  git checkout and use Effect RPC. Effect 4 pre-release is not a concern in
  itself: OpenCode pins `effect` 4.0.0-beta.83 too.
- The real costs are that those packages are private and unpublished, there
  is no protocol stability promise, and `client-runtime` drags in unrelated
  code. Its upside over A is proper server-side replay from a durable event
  log.
- Second choice after A; worth a look if Paseo's client disappoints.

## What to copy

If building B, these are the patterns both projects converged on:

- **Park the permission callback.** In `canUseTool`, emit a request event,
  await a promise keyed by request ID, resolve it from the client's reply.
  Treat the abort signal as cancel.
- **Handle `AskUserQuestion` and `ExitPlanMode` inside that same callback.**
  Answers go back through `updatedInput`.
- **Opaque resume handle per session.** Store whatever the harness needs to
  resume (Claude session ID, optionally last assistant message ID) and treat
  it as opaque outside the adapter.
- **One long-lived `query()` per session** with streaming input,
  `includePartialMessages`, and `setModel` / `setPermissionMode` on the live
  query.
- **Subagents from `parent_tool_use_id`**, surfaced as child events of the
  parent session.
- **Lazy resume after restart.** Sessions come back idle; the next `send`
  resumes them. Pending approvals do not survive.
- **Aggregate hosts in the client only.** No daemon talks to another.
- **Skip the durable event log at first** (Paseo's choice); add it only if
  mid-turn reconnect turns out to matter.

## Claude: SDK vs. the built-in supervisor

Claude Code has its own per-machine daemon behind `claude agents`, but it is
only exposed through a TUI and a thin CLI:

| | Available non-interactively |
|---|---|
| Start a background session | yes: `claude --bg --model … "prompt"` |
| List with state and `waitingFor` | yes: `claude agents --json` |
| Stop / remove / respawn | yes |
| Send a follow-up message | no documented command |
| Answer a permission prompt | not directly |
| Structured event stream | no; `claude logs <id>` is plain text |

A `PermissionRequest` HTTP hook can return allow/deny, so the host daemon
could answer permissions for any Claude session on the machine through a
hook. Combined with `claude agents --json`, that would surface hand-started
terminal sessions as rows that can be approved but not chatted with.

Both Paseo and T3 Code chose the SDK, not the supervisor.

## Unverified

- Neither daemon was run; everything is from source and docs.
- Whether `@getpaseo/client`'s public surface is enough for a full TUI
  without the internal import.
- Whether Paseo lists Claude/OpenCode sessions it did not start
  (`listImportableSessions` exists on the adapter; behaviour not checked).
- Whether the `PermissionRequest` hook fires in Claude background sessions.
- Whether an Agent SDK subprocess picks up the machine's existing `claude`
  subscription login when no API key is set. Both projects point the SDK at
  the user's installed `claude`, which suggests yes.

## Suggested spike

1. Install the Paseo daemon on this Mac and the Linux box, tailnet-bound.
2. Write a ~200-line Bun script on `@getpaseo/client`: connect to both,
   print a merged session list with state, create one Claude and one
   OpenCode session, answer one permission.
3. If that works cleanly, build the TUI behind a `HostClient` interface.
   If it fights back, switch to option B with the patterns above.

## Sources

- https://github.com/getpaseo/paseo
- https://github.com/pingdotgg/t3code
- https://code.claude.com/docs/en/agent-sdk/hosting
- https://code.claude.com/docs/en/agent-sdk/sessions
- https://code.claude.com/docs/en/agent-view
- https://code.claude.com/docs/en/hooks
- https://opencode.ai/docs/server/
