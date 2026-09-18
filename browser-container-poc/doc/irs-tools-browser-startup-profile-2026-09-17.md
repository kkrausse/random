# irs-tools browser startup: first detailed timing profile

Date: 2026-09-17 local / 2026-09-18 UTC.

## Scope and method

Prioritize browser startup; defer dependency/source preparation-cache redesign.
Rebuilt and reinstalled the workspace/chat libraries, restarted the app server,
and ran `bun run prepare:editor` before opening the editor (cache hit).
Opened the existing browser-local workspace without clearing storage or changing
source. Browser Control session `tidy-walrus-087`, localhost:5173/dashboard.

Completed startup run: `fbac9774-f969-462a-9add-b1990ffe5663`.
This is one warm-storage run, not a fresh-workspace benchmark or a controlled
comparison with TODO. Chromium tracing was requested during the run, so overhead
may affect these timings. No CPU trace was successfully retrieved.

## Results

| Stage | Duration |
| --- | ---: |
| Entire recorded startup operation | 29,468ms |
| Load preparation | 470ms |
| Open workspace | 6,533ms |
| Seed missing source/config | 141ms |
| Runtime and verified application delivery | 12,685ms |
| Preview/OpenCode services and clients | 9,629ms |

Workspace opening spent 6,523ms reaching worker readiness; the persistence query
and remaining open work were only a few milliseconds. That worker-init interval
still needs internal profiling to distinguish loading, initialization and restore.

Delivery hit the compressed bundle cache (180ms), decompressed in 647ms, and still
installed all 26,088 files. The install-tree call took 11,500ms: verification
1,656ms, filesystem install 9,145ms, readback 114ms, with additional boundary work
outside those internal timers. Bundle: 77,372,634 compressed / 340,182,561 expanded
bytes. Runtime.start itself took 11ms; application delivery took 12,674ms.

### Service branch breakdown (branches overlap)

| Wait | Vite/preview | OpenCode/chat |
| --- | ---: | ---: |
| Spawn API resolves | 12ms | 106ms |
| Expose/listener wait | 2,703ms | 2,227ms |
| HTTP/application readiness | 6,169ms | 679ms |
| Client readiness | 733ms | 308ms |
| Branch readiness from service-stage start | 9,624ms | 3,338ms |

OpenCode readiness requests: health 362ms, activation 301ms, configuration 3ms,
model catalog 12ms. Vite reported ready in 2,343ms, but the subsequent first `/`
response required another 6,169ms. Iframe attach-to-load was about 731ms.
Preview's final flush took **2ms**.

The app's preview-ready predicate is presence of an `h1` in the iframe, combined
with its load event. It is not a measured first paint or exhaustive interaction
test. Chat readiness is the existing controller's completed initialization, not
a compositor paint measurement. Approximate time from operation start: chat
23.2s; preview 29.5s. No tool/model edit was performed during profiling.

## What this establishes

- The large service bucket can now be separated: preview is its critical branch
  in this run; chat initialization and the final flush are not the long pole.
- A cached bundle does not imply reuse of an installed tree. Substantial repeated
  filesystem work remains on a warm reopen.
- The Vite cache marker reported reuse. This does not prove Vite reused every
  transformed module or optimizer output; request-level/worker CPU evidence is
  needed to explain the 6.2s first response.
- The older 18.7s service-stage observation did not repeat (9.6s here). Do not
  attribute that difference to this instrumentation or claim a speedup.
- TODO's remembered four-second startup has not been remeasured under equivalent
  conditions, so the difference is not yet explained by a controlled comparison.

## Added library instrumentation

- Workspace service spawn, listener/expose, and connection/readiness spans, with
  service identity, elapsed time, failure and waiting events.
- Recipe preview-cache check, source scan, seed flush, runtime application delivery,
  first preview HTTP response, client waits, branch-ready markers, final flush.
- OpenCode readiness HTTP requests include only fixed request path/method/timing.
- Preview iframe attachment and load milestones.

Events use the existing library diagnostics switch, transport and run correlation.
No source, credentials, request bodies or new app-specific instrumentation added.

## Artifacts and reproduction

Local timing-event export:
`/Users/kkrausse/Documents/repos/kkrausse/irs-tools/tmp/editor/profiles/startup-fbac9774.events.json`

Derived Chrome/Perfetto-compatible duration timeline (34 spans, **not CPU samples**):
`/Users/kkrausse/Documents/repos/kkrausse/irs-tools/tmp/editor/profiles/startup-fbac9774.timeline.json`

The generated artifacts are ignored local output. The event export omits actor and
client metadata. Full retained host events remain accessible with:

```sh
bun editor:logs --json --run fbac9774
```

Browser Control tracing completion hung, blocking subsequent commands in that
session even after CLI timeout and user reattachment. A fresh session worked,
but `Profiler.enable` returned method-not-found. Details and recovery attempts:
`/Users/kkrausse/Documents/repos/kkrausse/random/browser-control/todo.md`.
No retrieved CPU sample evidence, no browser cache reset, and no forced relay stop.
Cleanup check from the fresh session returned `Tracing is not started` to
`Tracing.end`, confirming Chromium is no longer recording; the old automation
execute is waiting on a completion event rather than an active capture.

## Next experiments

1. Profile worker initialization and tree installation internally; investigate
   verified installed-tree reuse rather than skipping integrity checks blindly.
2. Instrument Vite's first-request plugin/module work to attribute the 6.2s to
   React Router startup, transforms, filesystem access, or another specific cause.
3. Repeat untraced warm and fresh-workspace runs plus TODO on identical versions.
4. Once custom CDP routing is working, collect a bounded worker-inclusive CPU
   profile. Main-page sampling alone does not cover guest Vite/filesystem workers.

## Checks

- Workspace build and all 16 tests pass.
- Chat build/typecheck and 18 focused editor/markup/launch/diagnostics tests pass.
- irs-tools typecheck passes. Preparation was a cache hit.
- Real correlated startup completed with `failed: false`; the added service and
  readiness spans reached the authenticated host log.
