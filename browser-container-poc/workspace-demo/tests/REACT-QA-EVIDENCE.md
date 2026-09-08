# Independent React QA + local diagnostics — 2026-09-07 (local date)

## Acceptance boundary

**React browser acceptance remains blocked, not passed.** The fresh QA session
read TESTING-HANDOFF first and used only the Bun-backed Browser Control CLI.
Both initial and follow-up explicit executions of
`--session brisk-wombat-706 --target-url 127.0.0.1:4311` failed before page access:

> Browser Control extension is not connected. Load extension/dist in Chromium;
> it reconnects automatically after relay or browser startup.

Doctor: reachable relay at 127.0.0.1:19989; CLI/relay 0.7.0, matching build
2026-09-05T19:03:42.828Z; extension disconnected; zero active/child/relay-owned/
unhealthy targets; zero connected sessions; no competing connection observed.
No browser page, workspace file, session, storage, source, or runtime was altered.
No screenshots could be captured. Existing screenshots remain prior evidence.

Reconnect the unpacked extension and attach the normal 4311 tab. Then inspect
and safely close the old shell before reloading the React host. Retained user
state and exact session ownership are still as listed in TESTING-HANDOFF.

## Implemented diagnostics and genuine recovery fix

- Gitignored `.diagnostics/events.jsonl` + one rotated generation; early browser
  bootstrap, bounded nonblocking browser upload, UI run ID/download link, server
  command/startup/proxy/request logs. Redacted structured error/cause/stack,
  timings, versions, lifecycle and client/service events.
- Workspace public API optional `onDiagnostic` observer: manifest fetch, worker
  creation/init, classified boot-log hints, ready, persistence query/result,
  directory creation and open completion/failure. Observer exceptions are isolated.
- UI timeout includes last observed open stage and elapsed milliseconds;
  ten-second open wait events persist if the browser can run/upload them.
- Found a distinct cancellation gap by code review and transport reproduction:
  after worker `ready`, `Workspace.open` no longer honored its signal while
  querying persistence/creating the workspace directory. Cancellation now destroys
  that still-opening host, rejects pending requests and releases the opening lock.
  A retry succeeds. **This does not prove the original 4311 timeout's cause.**
- Cleanup errors during service startup are recorded without replacing the
  initiating failure. Persistence UI now consumes the actual opening callback.
- Raw guest output is omitted by default; first-output/total-byte summaries are
  retained. Health failure diagnostics omit response bodies.

## Passed independent checks

These are host/transport tests, not evidence of real browser OPFS or guest apps.

1. `bun install --ignore-scripts`: 57 installs / 97 packages, no changes.
2. `bun run demo`: verified assets and reused the existing 4311 server/proxy.
3. Missing OpenCode receipt in a **test-owned temporary path**: command exited 1,
   gave the preparation instructions and diagnostic path/run ID. Persisted run:
   `55a47dab-2575-4fb4-b7c2-a7b961c57d31`.
4. Test-owned occupied port 65268: command exited 1, actionable port conflict,
   owner still served its original response; QA owner then stopped.
5. Missing prepared directory in a **test-owned temporary path**: the actual
   `demo.ts` entry prepared all 2,291 assets, started a server on 65403, and
   `/setup-check` returned 200. Runtime version
   `5b9e2d83dddb85eb5e09c482418a19779c7235ce5b42ff0376e52872f9d4ba50`.
   QA process stopped and its temporary prepared artifacts were removed.
6. Actual 4311 diagnostic POST → on-disk JSONL → download round trip: 204,
   preserved stage/elapsed/version/error/stack/cause/run, redacted explicit
   test-only credential and prompt markers. Receipt run
   `qa-http-12a640bb-1e97-48e2-ade4-99863870b26a`, page marker
   `qa-http-no-browser`; **injected evidence, not a browser timeout reproduction**.
7. Diagnostic oversized batch 413; foreign Origin 403; malformed JSON 400.
   `/`, `/app.js`, `/app.css`, `/diagnostics.js`, `/setup-check`: 200 and expected
   COOP same-origin / COEP require-corp headers.
8. Test-owned unknown proxy route returned its original 404/body and persisted
   correlated `proxy.response` / `proxy.complete` with byte count. Missing
   test-owned asset URL persisted `http.missing`. No real model request was made.
9. Demo typecheck, 7 tests / 34 assertions, build passed. Tests cover structured
   failure persistence, redaction, bounded rotation/valid JSONL, unwritable logger,
   observer isolation, plus existing controller/fixture/seed cases.
10. API typecheck, 4 tests / 17 assertions passed. New transport-only test stalls
    persistence after worker readiness, aborts, checks last milestone and worker
    termination, then reopens/closes successfully without resetting storage.

## Remaining real-browser gates / ownership

All requested React gates remain pending: first start/reopen, progress/disabled
controls/double clicks, counter interaction, editor same-Document HMR, retained
chat/model/history/streaming/tool edit, active cancellation, stop/start, acknowledged
flush/close/reload/dependency restore, partial-startup error/retry, effect cleanup.
Browser diagnostic bootstrap/upload and the UI download link also require visible
browser verification. HTTP responses and unit tests do not prove these gates.

`brisk-wombat-706` (user-owned 127 origin) and `tidy-badger-184` (localhost origin)
are retained untouched for follow-up. Existing 4311 watch server/proxy remains
owned by its original terminal; QA did not replace it. It picked up source edits
and served the new diagnostics route. No QA-owned server remains running.
Latest listener observation: PID 17262, `bun --watch serve.ts`; the earlier
handoff PID is historical after watch restarts.
