# Fresh React demo QA handoff — implementation ownership released

## Public chat integration + independent QA (latest)

See [integration checkpoint](tests/integration-qa/README.md) and its bounded JSON
HTTP receipt. Public root/controller, React view and styles are integrated through
file dependencies; fresh workspaces require **New chat**. Query preservation and
duplicate React peer resolution defects were fixed. Recipe owns ready/dispose, not
the view or panel toggle. The generic workspace packages were not changed.

Browser check once: CLI/relay 0.7.0 match; extension disconnected, zero targets.
No page, storage, session or user edit touched. All new browser/guest acceptance is
still blocked. **Next exact case:** reconnect extension, inspect retained tabs with
their explicit sessions first; select a new QA-owned 4312 tab/session, verify normal
counter with zero editing workers, then Enable editing through actual guest boot.

**http://127.0.0.1:4312** is the deliberate admin QA server, PID 65716, shell
`sh_07f798c270011eR7rzjxsE7mqv` (ownership transferred to parent). Existing 4311 is
non-admin, latest observed PID 86252; its policy/process was not changed. Current
HTTP checks set only the QA server's in-memory counter to 23. Preserved 4311 origins,
headings and sessions in §Browser ownership below remain untouched.

## Current product-mode implementation (supersedes older UX notes below)

Owner `ses_f80adc345ffehktRIDsTSnqYzk` implemented controlled normal/editing mode,
source-only reset, server policy and native backend passthrough. See the concise
[IMPLEMENTATION-HANDOFF.md](./IMPLEMENTATION-HANDOFF.md) for exact features/run,
runtime patch version, evidence and fresh acceptance matrix. Default route now shows
the normal counter. Use `LOCAL_EDITOR_ADMIN=1 bun run demo` for the local admin
fixture's Enable editing toggle; direct editor/model routes deny without that flag.
The existing 4311 server owner/environment was not changed. A policy mismatch needs
parent/QA to restart that owning terminal deliberately; new ports are new stores.

Focused API checks 4 tests/17 assertions; demo suite 12 tests/84 assertions passed,
then final focused product checks passed 5 tests/55 assertions (combined coverage
12 tests/89 assertions). Demo browser/server typecheck and build passed. Runtime full build and
real-Node verification passed; consumer tarball check passed with new `/react` and
`/server` APIs and 36 hash-identical runtime files. Latest runtime version:
`fd0c1c8769ed2ab52fca10ccbdfdb9beebda5a31e1c1985d7a24f83ae6a39003`.

One observational Browser Control doctor remains disconnected (0.7.0 matching relay,
zero targets). No browser navigation or state mutation occurred. Retained origins,
tabs, original source headings and chat session IDs in §Browser ownership below
remain authoritative. Explicit Reset source must be tested on a QA-owned source
snapshot/origin, not silently over those retained headings. Source reset preserves
unknown files/chat/backend; ordinary entry always preserves edits.

The standalone optional chat package in `opencode-chat/` is now integrated;
the chat controller/view seam remains replaceable. Parent owns the remaining
fresh independent real-browser QA. Historical
Start workspace / Advanced UI descriptions below no longer describe the current shell.

## Local package checkpoint (2026-09-07)

See [IMPLEMENTATION-HANDOFF.md](./IMPLEMENTATION-HANDOFF.md) for the newer public
package layout, isolated consumer proof and exact remaining product-mode work.
The provider is now imported from `@kev-browser-agent-kit/workspace/react`; build that local
package before running the demo. The editable-app shell/backend passthrough are
now implemented; see the current checkpoint above. Existing browser acceptance gates below
remain pending; the CLI still reports the disconnected extension.

## Independent QA checkpoint + diagnostics (2026-09-07)

Fresh QA `ses_f80e84bf7ffe5wHuln4yAnScDi` could not acquire any browser page:
explicit retained-session execute failed twice; matching 0.7.0 relay remains
reachable, extension disconnected, zero targets. Browser acceptance and new
screenshots remain blocked. User was asked to reconnect/attach the 4311 tab.
All preserved state and browser sessions below remain untouched.

Implemented local bounded diagnostics at `.diagnostics/events.jsonl` (+ `.1`),
early browser handlers, run IDs/download UI, timed open/worker/persistence and
service/client milestones, server command/proxy failures, redacted errors/causes/
stacks. See README and `tests/REACT-QA-EVIDENCE.md` for limits and actual receipts.
Fixed a transport-reproduced post-worker-ready cancellation gap in Workspace.open;
this is **not an established cause** of the old 120-second timeout.

Actual one-command preparation into a temporary test-owned prepared directory,
missing prerequisite, occupied port preservation, existing server reuse, diagnostic
POST/disk/download/redaction/limits and targeted regression checks passed. Temporary
servers/artifacts were cleaned up. 4311 remains the original terminal's watch
server/proxy, now serving the updated host and diagnostic routes.
Latest listener observation: PID **17262**, command `bun --watch serve.ts`
(the historical PID 86252 below is stale after watch restarts).

**Next concrete action:** reconnect Browser Control, then inspect retained tabs
with explicit target selection before close/reload. Run QA cases 1–5 below and
verify new diagnostics in the browser. Do not treat the new host/transport tests
or injected `qa-http-no-browser` log record as React/runtime acceptance.

Owner handing off: `ses_f81074389ffe32i7lVNm6xCRKm`. No further agents spawned.
Please own the real-browser React acceptance pass and fix defects you find.

## What changed / where

- `src/workspace-provider.tsx`: React context/hook + public-API controller;
  serialized lifecycle, progress/errors, managed services, effect attachment
  cleanup, startup abort and unmount disposal. No sample ports/packages in it.
- `src/sample-recipe.ts`: app-specific 7-stage startup, seed only missing files,
  verified prepared delivery, guest Vite/OpenCode launch and auth Fetch adapter.
- `src/main.tsx`: host React editor/preview/status/chat; chat mounts existing
  `chat-client-demo/src/client.ts` in an effect. Client now exposes `ready`
  and opt-in empty-server session creation. Minimal Base UI/shadcn-style Button,
  Tailwind, Lucide. `src/sample.ts` is the separate guest React counter source.
- `demo.ts`, `setup.ts`, `serve.ts`: one entry prepares missing/stale apps, checks
  fingerprints/hashes, reuses compatible local server, reports port conflicts.
  Same Bun process serves host/runtime/prepared assets and local model proxy.

## Start / prerequisites

```sh
cd /Users/kkrausse/Documents/repos/kkrausse/random/browser-container-poc/editable-app-demo
bun install --ignore-scripts
bun run demo
```

URL: **http://127.0.0.1:4311** → **Start workspace**. Existing server/proxy on 4311
is the prior integration's watch server, observed PID 86252, shell handoff
`sh_07eab5654001FHnhlCDnOHqQaS`; this session did not replace it. `bun run demo`
currently verifies and reuses it. The old 4310 server is no longer listening.
Contract server 43917 was not touched or rechecked. Use a new port only deliberately
(different origin/persistent store). Ctrl-C stops only the terminal-owned server.

Ignored artifacts are current: `workspace-api/dist/runtime`, demo `dist/prepared`
(2,291 files / 98,019,988 bytes plus manifests/receipt), host `dist/app.{js,css}`.
Runtime version: `5b9e2d83dddb85eb5e09c482418a19779c7235ce5b42ff0376e52872f9d4ba50`.
Matched guest OpenCode revision: `d7a7256bb6b0952f486c95718cfbf460b1570a56`, schema/core
dev-19167. Missing prerequisites need the pinned compiled runtime/source/toolchain
and installed OpenCode source; see README. `demo` packages existing runtime output
and prepares missing/stale apps, not a full source checkout/toolchain bootstrap.

## Browser ownership and preserved state

Only Browser Control via its Bun-backed CLI. Skill was loaded. CLI/relay 0.7.0,
matching build 2026-09-05T19:03:42.828Z. Extension disconnected during React work;
doctor found no targets. User was asked to reconnect. Do not reset storage.

- `brisk-wombat-706`: inspected user tab **127.0.0.1:4311**. Always pass explicit
  `--target-url 127.0.0.1:4311` as well as session: adoption/default-page behavior
  was unstable (documented in BROWSER-CONTROL-TODO). User tab must remain open.
- `tidy-badger-184`: relay-created **localhost:4311** page, deliberately separate
  origin for a fresh sample without deleting user data. Ownership transfers to QA;
  do not delete the session until useful follow-up is done.
- Last successful pages still ran the earlier vanilla shell. Stop/close attempts
  failed before page access after disconnection. Inspect actual tabs first;
  acknowledge close via old UI if still available, then reload the React host.
- 127 origin retains `/src/App.tsx` heading **Browser Muse HMR verified**, original
  source restored/flushed after a temporary manual edit, and existing chat session
  `ses_f81172f68ffejN3an9WuDa9DW4` with prior real-model history.
- localhost origin retains interactive counter titled **My edited browser counter**
  and “Sample workspace” session `ses_f80ff3b6bffeWfgjD6TNLkJvHb`. Its title edit
  was saved/flushed. Count 1 was only runtime React state; restart should reset it.

## Prior findings and verification boundary

Original user failure was on **4311**, at workspace-open's 120-second deadline:
`8:01:19 PM Failed: signal timed out`, workspace closed/runtime stopped/downstream
buttons disabled. Retrying Open restored storage at 8:05:31 without any reset.
Underlying missed-deadline cause is not proven by retained logs. Do not claim an
identified kernel fix. New UX adds precise stages, preflight and safe retry.

Before React steering: both retained/fresh vanilla one-click flows passed real
Vite/chat; double click admitted one start; 31 models plus default; automatic empty
session; counter click; saved title HMR preserved exact iframe Document and count;
127 source restored. **These are not proof of the new React host.** No fresh
provider call needed; prior real model tool-edit was already accepted independently.

Final focused checks passed: demo browser+Bun typecheck; 5 tests / 21 assertions
(seed preservation/reopen, duplicate lock + failure/retry, abort/once-only disposal,
fixture tests); build; client tests 6 / 24 assertions; HTTP 200/isolation headers on
host JS/CSS/setup/runtime/prepared; setup stale preparation + reuse; isolated occupied
port rejection without stopping its owner. Details: `tests/TURNKEY-EVIDENCE.md`.

## QA cases (real browser, not host/mock substitutes)

1. Reload into **Editable app demo**. Start workspace once on retained origin:
   seven stages, no JSON/order required, editor defaults App.tsx, original source
   and existing session/history preserved, preview rendered, chat ready/Send enabled.
2. Fresh origin if needed (do not delete old stores): actual counter click; save
   a source edit → same iframe Document HMR; model call only as needed. Guest and
   host are separate React apps. Read file should pick up model edits.
3. Double-click/start/stop races; controls disabled while busy; unsaved editor
   protection. Inject a missing asset or service startup failure reversibly;
   progress/error actionable, retry resumes without replacing edited source or
   duplicating sessions/services. Dependency conflicts intentionally reject.
4. Advanced Stop runtime keeps files editable; Start workspace restores services;
   Close acknowledges flush and releases OPFS; reload + start preserves exact source
   and chat history while redelivering excluded dependencies.
5. Effect cleanup/unmount during startup and after readiness: no live iframe/chat
   connections outliving services, lease released after close; inspect console for
   React lifecycle issues. StrictMode cleanup defers actual disposal across effect
   replay, but this has only focused controller tests, not a DOM StrictMode test.

Known gaps: all new React E2E items above await you; unload flush is best-effort,
explicit Close required for acknowledged durability; only one OPFS workspace per
origin; provider/network availability remains external; no quota-failure test.
Unrelated hybrid-exec/hybrid-mount and .DS_Store paths remain untouched/untracked.
