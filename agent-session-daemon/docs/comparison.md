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

### How real is Paseo's public client?

Checked in source. The public root of `@getpaseo/client` is a 1.1k-line
facade over a 6.9k-line internal `DaemonClient`.

- **Covered by the public facade:** list agents with live updates, create
  (provider/model, mode, cwd, prompt), send, pending permissions and
  `respondToPermission`, timeline subscribe and refetch, archive, provider
  and model catalog, usage.
- **Missing from the public facade:** interrupting a turn, and switching
  model or mode on a live agent. All three exist on the internal client
  (`cancelAgent`, `setAgentModel`, `setAgentMode`).
- **Not what Paseo itself builds on:** the app imports the internal client
  116 times and the public root 10 times; the CLI 9 to 2.

So the supported surface is real and documented but young (first published
May 2026) and thinner than what the first-party UI uses. A TUI would need the
internal import for interrupt, which is explicitly unsupported, though it is
the path their own apps exercise every day.

T3 Code is the opposite: no supported surface, but `client-runtime` is the
exact code its web, desktop and mobile apps run on.

### Is Paseo's API enough for the TUI?

`@getpaseo/client@0.11.0-beta.3` installs and imports under Bun (8 packages,
25 MB). Not exercised against a running daemon.

| Need | Paseo | Where |
|---|---|---|
| Several machines | one client instance per host; I merge | public |
| Live session list with state | `agents.list({ subscribe })`, snapshot then updates | public |
| Waiting on me | `pendingPermissions`, kinds tool / plan / question | public |
| Answer a request | `respondToPermission` | public |
| Start with harness + model + directory | `agents.create`, provider `claude/…`, `opencode/…` | public |
| Model catalog per host | `providers.listModels` | public |
| Streaming output | `timeline.subscribe`; assistant text arrives in pieces | public |
| History | `timeline.refetch`, paged by cursor | public |
| Reconnect | live-only; refetch after my last `(epoch, seq)` myself | public |
| Interrupt a turn | `cancelAgent` | internal only |
| Switch model / mode live | `setAgentModel`, `setAgentMode` | internal only |
| Nested subagent tree | `listProviderSubagents`, with `parentSubagentId` and status | internal only |
| Subagent transcript | `fetchProviderSubagentTimeline` | internal only |

Functionally it is enough, including both subagent views. In practice the
TUI would be written against the internal `DaemonClient`, as Paseo's own app
is. The wire protocol under it has the append-only compatibility policy, so
the risk is the client's method names changing between releases, not the
daemon breaking; pin the client version.

Still open, and only answerable by running it:

- Whether sessions started in my own OpenCode or Claude TUIs appear.
- Whether idle Claude processes are ever closed.
- How its workspace model feels when I only care about sessions.

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

### F. herdr: a different category

[herdr](https://github.com/ogulcancelik/herdr) is not a daemon-plus-protocol
design. It is a terminal multiplexer (think tmux) that knows about agents.
From its README and docs only; source not read.

- Runs the real `claude`, `codex`, `opencode` TUIs in PTY panes. Nothing is
  re-rendered, so every harness feature works as-is, including native
  subagent views and slash commands.
- A background server per machine keeps panes alive across detach.
- A sidebar marks each agent `working`, `blocked`, `done` or `idle`, from
  process names plus terminal-output heuristics, with deeper integrations
  for some agents.
- "Several machines, one window": the client connects over SSH to a herdr
  server on each saved machine and shows one combined agent list. SSH over
  the tailnet works with no extra setup.
- A documented socket API (newline-delimited JSON on a local Unix socket)
  and CLI wrappers: list agents, read pane output, send input, wait for a
  state, subscribe to events. Local socket only.
- Rust, single binary, Apache-2.0, about 42k stars.

Against the goals:

- It is already a terminal UI with cross-machine status, which is most of
  what I want, with zero adapter code.
- "Start a session choosing harness and model" is just running the CLI with
  flags in a new pane on the selected machine.
- No structured transcript, no unified permission inbox with Allow/Deny
  buttons: answering a prompt means focusing that pane and typing.
- State detection is partly heuristic, so it can be wrong.
- No mobile app.
- Not checked: telemetry.

**Rejected.** I tried this before: one full OpenCode or Claude Code TUI
client per pane costs too much, even when the OpenCode client attaches to a
shared server. See the next section.

#### Variant: one pane per harness per machine

Avoids the per-session cost: each pane runs that harness's own sessions
view rather than one session.

- Claude pane: `claude agents`, which lists every background session on
  that machine with Working / Needs input, and lets me peek, reply and
  dispatch. Sessions run under Claude Code's own supervisor.
- OpenCode pane: one `opencode` TUI with `oc-plugin-session-manager`, whose
  picker and inbox already cover that machine's sessions.
- herdr only federates the panes across machines over SSH.

Cost is two TUI clients per machine, fixed, regardless of session count.
For Claude this uses official surfaces only, so it is the lowest ToS tier.

Limits:

- herdr tracks state per pane and assumes one agent per pane, so its sidebar
  cannot show per-session status for a sessions-view pane. The status lives
  inside each pane. A custom integration could report a rolled-up state per
  pane (untested).
- No single list across machines and harnesses, and no cross-machine inbox;
  it is 2 x N panes to look at.
- Splitting sessions into their own panes brings back a full client each.
- Plain `tmux` over SSH gives nearly the same thing.

Useful as a zero-build baseline, and as the fallback if subscription rules
tighten again.

## Processes per session

The cost that ruled out herdr, applied to the others.

| | UI clients | Claude | OpenCode | Idle reaping |
|---|---|---|---|---|
| herdr | one full harness TUI per pane | one `claude` TUI per pane | one `opencode` TUI per pane | none; panes stay up |
| Paseo | one, shared | one headless `claude` per live agent | one shared `opencode serve` per machine | none found (grep only) |
| T3 Code | one, shared | one headless `claude` per live thread | one `opencode serve` **per thread** | stops sessions idle 30 min, sweeps every 5 |
| Own daemon | one, shared | one headless `claude` per live session | the one `opencode serve` already running | mine to set |

- Claude is the unavoidable cost. Every design built on the Agent SDK runs
  one `claude` subprocess per live session; there is no shared Claude server.
  It is headless, so cheaper than the TUI, but Anthropic's hosting guide
  still suggests sizing about 1 GiB RAM per agent as a starting point.
- So what matters is how fast idle Claude sessions are closed, and resumed
  lazily on the next message.
- T3 Code's per-thread `opencode serve` is deliberate and documented
  (`docs/internals/providers.md`): OpenCode's MCP registrations are
  directory-scoped, T3 Code injects a thread-scoped MCP connection, and two
  threads sharing a server in one directory would replace each other's.
- It is avoidable: with a `serverUrl` set in the OpenCode provider settings,
  T3 Code connects to that external server instead of spawning one
  (`Layers/OpenCodeAdapter.ts`, `connectToOpenCodeServer`). Threads then
  share it, at the cost of the MCP collision above. Not tested.
- The per-thread server is headless and is killed with its session, so the
  30-minute idle reaper bounds how many are alive.

### G. Claude inside OpenCode, via the Agent SDK

**Rejected.** Prompt caching does not work through `opencode-claude` in my
use, which makes every turn pay for the full context. Its README claims the
opposite, so this is from experience, not from the code. Kept for the record.

Instead of a new daemon, make Claude a model provider in OpenCode. OpenCode's
background service is then the only daemon, and its multi-server app,
`oc-plugin-session-manager`, the permission inbox and nested child sessions
all apply to Claude sessions unchanged.

Hard requirement: OpenCode talks to Claude only through the official
`@anthropic-ai/claude-agent-sdk`, which runs the unmodified `claude` binary
under my own `claude auth login`. No token handling of any kind.

This already exists. From READMEs only; none installed or run.

| Plugin | Talks to Claude via | OpenCode 2 | Tools run by | Notes |
|---|---|---|---|---|
| `openchamber/opencode-claude` | Agent SDK only | Yes (2.x required) | OpenCode, through a proxy | One Claude session per chat, resumed each message; subagents are OpenCode child sessions |
| `ai-sdk-provider-claude-code` | Agent SDK only | Library, not a plugin | Claude Code itself | AI SDK provider (368 stars, active); a plugin could load it through the `aisdk` hook |
| `akash-joshi/opencode-claude-code-plugin` | Spawns the CLI directly | Yes | OpenCode, through a proxy | Uses `--dangerously-skip-permissions` for unproxied tools and has multi-account failover. Fails the requirement |

How the first one works: Claude Code's built-in tools are switched off and
OpenCode's tools are handed to Claude instead, so every edit and shell
command goes through OpenCode's permission system.

Trade-offs:

- Best reuse of anything on this list: no new daemon, no new protocol, and
  the TUI I already have.
- It is Claude Code's loop and model with OpenCode's tools, not Claude Code
  as shipped. Claude-native subagent views, plan mode UI and tool behaviour
  are replaced by OpenCode's.
- Still one `claude` process per live session.
- Depends on two moving targets: OpenCode's plugin API and the Agent SDK.

### Terms of service

Not legal advice, and I could not retrieve Anthropic's Help Center article
itself; the June statement below is as quoted by Zed.

What Anthropic's published text says:

- Claude Code's legal page: subscription login is for "ordinary use of
  Claude Code and other native Anthropic applications", and plan limits
  "assume ordinary, individual usage of Claude Code and the Agent SDK".
- The same page: an end user may sign in to "the unmodified Claude Code
  binary with their own Claude subscription".
- June 2026, after pausing a planned billing change: "ACP usage, `claude -p`,
  the Claude Agent SDK, and third-party apps built on the Agent SDK continue
  to work with Claude subscriptions exactly as they did before."
- Prohibited: reusing subscription OAuth tokens in third-party tools, and
  developers offering Claude login in their products.

That is today's text. The 2026 history is less comfortable:

| When | What Anthropic did |
|---|---|
| Jan | Third-party tools reusing subscription logins start failing; accounts banned for "gaming" pricing |
| Feb | Legal page: subscription tokens "in any other product, tool, or service — including the Agent SDK — is not permitted" |
| Apr 4 | Subscriptions stop covering third-party tools, OpenCode named |
| May 13 | Reversed: third-party use allowed again through the Agent SDK, with a separate metered credit planned for June 15 |
| Jun 15 | Credit plan paused; Agent SDK use draws from plan limits as before |

So tier 2 below is permitted now, but the same category was prohibited for
about three months this year.

Risk ladder, lowest first:

1. Official surfaces only: `claude`, `claude agents`, Remote Control.
2. The Agent SDK driving the unmodified binary under my own login, for my
   own use. Paseo, T3 Code, my own daemon and SDK-only OpenCode plugins all
   sit here; routing through OpenCode is not a different tier.
3. Driving the CLI with permission checks bypassed, rotating accounts, or
   heavy unattended volume. Avoid.
4. Any plugin that reads or reuses the subscription token. Prohibited.

The live risk at tier 2 is a policy or billing reversal more than a ban:
Anthropic has said it is reworking how subscriptions cover Agent SDK use and
will give notice. Re-check before relying on it.

#### `opencode-claude` 1.3.4, read from the published package

- Only dependency besides `zod` is `@anthropic-ai/claude-agent-sdk`.
- No Anthropic API host anywhere; the only URLs are `127.0.0.1`, the
  official install script and `claude.com`.
- Never reads a token. It deletes `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` from the child
  environment so the CLI's own login is used, and stores only a placeholder
  in OpenCode. Sign-in relays `claude auth login`.
- No account rotation, no header or client spoofing.
- Chat turns keep the `claude_code` system prompt preset, with instructions
  appended.
- Every chat turn sets `tools: []`, `permissionMode: "bypassPermissions"`
  and `allowDangerouslySkipPermissions: true`. Claude Code's built-in tools
  and its permission layer are off; OpenCode's permission system is the only
  gate. These are SDK options, but the README does not mention them.
- Titles and compaction summaries run as separate one-shot turns on a small
  model with a custom system prompt.

Rating: tier 2, at its upper edge.

- Ban risk today: low. It follows today's published rules and handles no
  credentials.
- Risk of losing subscription coverage: moderate. It is exactly the pattern
  restricted from February to May, with OpenCode named.
- Slightly above Paseo or T3 Code, which run Claude Code with its own tools
  and permission layer intact.

### H. Session switcher over the official clients

A status TUI of my own, plus the harness's real client opened on demand for
the one session I pick. Each harness's own daemon keeps sessions running;
no daemon or protocol of mine, and no transcript renderer.

Each provider supplies three things:

1. **Status list:** id, title, directory, state (working / needs input /
   done), updated time.
2. **Open command:** the argv that opens that session in its official
   client.
3. **New command:** the argv that starts a session with a model and prompt.

| | Claude Code | OpenCode 2 |
|---|---|---|
| Keeps sessions alive | its supervisor (`claude daemon`) | its background service |
| Status list | `claude agents --json` | service API via `@opencode/client` |
| Summary line | `name` field | session title |
| Preview | `claude logs <id>` | messages via the API |
| Open | `claude attach <id>` | `opencode -s <id>` |
| New | `claude --bg --model … "prompt"` | `opencode --prompt …` or the API |
| Leave without stopping | `Ctrl+Z` or `←` | quit the client |
| Answer a request | in the attached client | from my TUI via the API, as the plugin does |

`claude agents --json` verified on this machine: returns `id`, `name`,
`cwd`, `kind`, `state`, `status`, `sessionId`, `startedAt`, `pid`.

Other machines: run the same commands through `ssh -t host …` on the
tailnet; OpenCode can instead be reached at each host's service URL.

Where the client appears, simplest first:

- **Hand off the terminal:** suspend my TUI, run the client full screen,
  return on exit.
- **tmux:** my TUI lives in one pane and opens clients in others, with a cap
  on how many stay open. This gives per-session splits.
- **Embedded terminal widget.** Most work, least needed.

Against the constraints:

- Resources: clients exist only while I am looking at them.
- ToS: official surfaces only for Claude, the lowest tier.
- Prompt caching, plan mode, skills: native, because it is the real client.
- Subagents: Claude's own in-session view when attached; OpenCode children
  nested in my list from the API. Exactly the two views I wanted.
- Effort: the smallest option that still gives one list across machines.

What it does not do:

- No approve/deny inbox for Claude; I attach and answer there. OpenCode
  requests can still be answered in place.
- Claude sessions must be background sessions. Interactive ones in other
  terminals are listed but cannot be attached.
- `waitingFor` says a session needs input, not what it is asking.
- Status is polled, per host.
- No mobile client. Claude's Remote Control app covers Claude separately.

Prior art: Claude Code's own agent view is this for one machine and one
harness. `ccmux` and `agent-deck` are cross-machine and multi-harness but
keep a live client per session in tmux and infer status from the screen or
hooks. I found nothing that uses the harnesses' own daemons as the source of
truth with on-demand clients; that is not proof none exists.

This is now the recommended first build. Paseo or an own daemon only become
necessary if I want Claude approvals in the list or a unified transcript.

### I. Claude Code behind OpenCode's server API

Idea: keep Claude Code running as itself through the Agent SDK, but expose
it through OpenCode's server API so OpenCode's clients and
`oc-plugin-session-manager` drive Claude sessions unchanged.

Two ways to get there:

**A standalone server that re-implements the API.** Not found anywhere.

- The OpenCode 2 client has about 134 methods and 256 KB of generated
  types. Its TUI calls many of them at startup (config, models, agents,
  locations, forms, shells), so a usable subset is still large.
- The API changes between patch releases; `oc-plugin-session-manager`'s
  own audit doc records breaking changes across 2.0.3, 2.0.6 and 2.0.7.
- This is the own-daemon work plus imitating OpenCode's data model.

**A plugin inside the real OpenCode server.** Exists:
`AeriumChris/opencode-claude-acp`. From its README only.

- OpenCode 2 plugin (tested on 2.0.15) that registers a provider backed by
  `@agentclientprotocol/claude-agent-acp`, the ACP adapter built on the
  official Agent SDK.
- One ACP connection and one native Claude session per OpenCode session.
- Claude Code runs its own built-in tools; OpenCode's tools are also offered
  through a session-scoped MCP server.
- Approvals appear as OpenCode question forms (title only) with Deny /
  Allow once / Allow always / Allow all.
- Uses the local `claude` sign-in; no token handling documented.
- Reports cache reads and writes through a `/claude-usage` command.
- Gaps: no plan mode mapping, nothing on subagents, native tools show as a
  generic `claude_code` activity, no edit-review UI.
- Maturity: 0 stars, 21 commits, no releases.

This differs from the rejected `opencode-claude` in the way that matters:
that one makes Claude a model that OpenCode re-drives each request; this one
holds a long-lived native Claude session. Caching should therefore behave
natively, but that is the first thing to verify.

ToS: tier 2. Anthropic's June statement names ACP usage explicitly, and
Claude's own tools and permission layer stay on.

If this direction is wanted, extend the plugin rather than re-implement the
server: OpenCode keeps implementing its own API and only the Claude bridge
is mine.

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

## OpenCode 2 changes the picture

I run OpenCode 2.x (`opencode v2.0.19`), which differs from the 1.x that
both projects were built around.

- **OpenCode 2 has its own shared daemon.** Per its CLI docs: "OpenCode
  discovers or starts one shared background server for your user account.
  Every local OpenCode client connects to that server." It runs as
  `opencode serve --service`; `opencode service status` prints its URL.
- **A plain `opencode serve --port N` does not join it.** Tested locally: it
  started a separate process with its own port and password (about 160 MB at
  startup) and left the background service untouched. So anything that
  spawns `opencode serve` gets a private server, with no consolidation.
- **The 2.x server API is a breaking change.** The migration guide says
  integrations on the V1 API "must migrate" and use `@opencode/client`.

| | OpenCode 2 support | How it gets a server |
|---|---|---|
| T3 Code | None found: depends on `@opencode-ai/sdk` ^1.3.15 only | spawns `opencode serve` per thread |
| Paseo | Yes, auto-selected from the installed version, via `@opencode/client` | spawns one private `opencode serve --port 0` |
| Own daemon | `@opencode/client`, as `oc-plugin-session-manager` already uses | attaches to the shared background service |

- T3 Code's OpenCode adapter most likely does not work with OpenCode 2 at
  all. Not run, but the source has no 2.x client and the API is breaking.
- Paseo works with 2.x but runs a second server beside the background
  service. Whether sessions from my own OpenCode TUI appear in it is
  unverified.
- Only the own-daemon design uses the server that is already running, which
  costs nothing extra and by construction shows my TUI's sessions.

## Effort: own daemon vs. Paseo

Rough sizing, not measurement. The TUI is the same work either way and is
the larger part; this compares only what sits behind `HostClient`.

**OpenCode needs no daemon in either case.** OpenCode 2's background service
already listens on the tailnet address (`opencode service status` here
prints a `100.x` URL), so the TUI can talk to each host's service directly
with `@opencode/client`. That is a `HostClient` of a few hundred lines,
mostly lifted from `oc-plugin-session-manager`. It also avoids Paseo's
second OpenCode server and shows sessions from my own OpenCode TUI.

So the real comparison is the Claude side only:

| | Paseo for Claude | Own Claude daemon |
|---|---|---|
| Code to write | `HostClient` over Paseo's internal client: ~300-600 lines | Server + protocol ~300-500, Claude adapter ~500-800 for the happy path, growing to ~2-3k with edge cases |
| Time to a working list + inbox | a day or two | one to two weeks |
| Long tail | their release notes | mine: questions, plan mode, subagent tracking, interrupts, resume, transcript mapping, SDK changes |
| Install per host | their daemon, relay off, tailnet bind | my daemon as a user service |
| Idle Claude processes | theirs; no reaper found | mine to set |
| Mobile | their app works | none |
| Codex later | already there | another adapter |

Reference points for the long tail: T3 Code's Claude adapter is 5.7k lines
and Paseo's is 10.8k. Both cover more than I need, but most of that is edge
cases found by real use, not features.

Recommended order:

1. `HostClient` for OpenCode, direct to each host's service. Needed either
   way, and cheap.
2. `HostClient` for Claude over Paseo. Gets the whole TUI working.
3. Replace 2 with my own Claude daemon only if Paseo's process handling,
   caching or workspace model turns out to be a problem.

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
