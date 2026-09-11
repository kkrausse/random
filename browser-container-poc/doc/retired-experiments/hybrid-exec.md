# Explicit Linux ↔ Vivari execution spike (retired)

Archived September 11, 2026. The untracked experiment implementation and generated
assets were removed from the working repository during cleanup. Paths and commands
below describe the historical spike, not a currently runnable project. Results are
the original recorded observations, not a new qualification.

Own origin **http://127.0.0.1:5221/**. Static Bun server; every tested native
command runs in the browser's QEMU Linux guest. Worker JavaScript runs in Vivari.
No host execution endpoint. Existing `:5213` and sibling experiments are untouched.

## Reproduce

Requires the existing generated QEMU assets, `hybrid/dist/runtime.{js,css}` and
`hybrid/.artifacts/fixed-runtime/` (see `../hybrid/README.md`). These are read-only
inputs. This harness builds only its own `.artifacts/main.js`.
`inputs.json` records the qualified manifests/helper hashes; startup verifies
those pins and all runtime-manifest file hashes. QEMU image hashes remain in the
referenced manifest; this server does not rehash the large image on each boot.

```sh
cd browser-container-poc/hybrid-exec
bun test
bun run dev
```

1. Open `:5221`, click **Start Linux** and **Boot worker**.
2. At `demo login:` enter `root`; wait for `demo:/workspace#` after version checks.
3. Click **Connect + install accel**; wait for the installed receipt.
4. In the real Linux PTY run:

   ```sh
   EXEC_MARK=forwarded accel run -- node /workspace/probe.cjs 'argument with spaces'
   echo "launcher-status=$?"
   ```

The command is a real guest executable shell wrapper in `/usr/local/bin/accel`
which execs guest Bun `/tmp/accel.ts`. Stock `node`/`bun` are not replaced.
The probe script and its standalone API are controlled **Vivari-only fixtures**.
Their paths do not imply a shared filesystem, nor are Linux source files copied
on each launch. A script must already exist in the worker VFS.

## Execution contract and topology

```
Linux foreground shell → accel → Linux Unix socket /tmp/hybrid-exec.sock
  → independent guest bridge → QEMU serial → browser relay → Vivari process worker
  ← stdout/stderr UTF-8 chunks and numeric exit ← proc-out / proc-exit

worker native.cjs → reserved RS stdout control record → browser relay
  → serial native-spawn → independent Linux Bun.spawn (not foreground shell)
  ← base64 stdout/stderr frames + exit/error ← serial
  → reserved worker stdin → native.cjs Promise result (Buffer)
```

The guest's top-level serial dispatch is concurrent (`void handle`), and the
socket server remains live while a foreground launcher waits. Native commands
therefore never queue behind the launcher on its PTY. Concurrent native calls
have launch-scoped IDs; stdout and stderr each have sequence numbers. Data frames
carry at most 4096 binary bytes, each independently base64-encoded. Exit is sent
only after both pipes drain. Native missing executables reject as errors; a real
nonzero child exit resolves with `{code,stdout,stderr}`. The standalone API buffers
the streamed response to return Buffers; it is **not `child_process.spawn`
integration**, and does not pretend to be a ChildProcess/EventEmitter.
Error payloads are diagnostic strings from guest Bun, not normalized Node errno
objects; callers must not assume every missing-executable message contains `ENOENT`.
On error/cancellation, late native frames may still be in flight and are ignored
after removal of the launch-scoped registration; there is no drain acknowledgement.

Forward launch preserves argv strings, absolute cwd, and string env through JSON.
Vivari merges env with its runtime defaults, so this is not POSIX `execve` env
replacement. cwd must independently exist in both environments. Worker platform,
PID, PATH semantics and Node compatibility remain Vivari's. Public SDK output
merges stderr, so this spike uses the pinned underlying `proc-out.stream` plus
the TypeScript-private (runtime-visible) `execId`. This is an internal API seam.
ASCII argv (including spaces) and env are qualified. The reused guest serial
reader decodes each chunk separately, so non-ASCII control fields spanning a
chunk boundary are not yet guaranteed; base64 binary payloads avoid that issue.

## Lifetime, bounds and exact gaps

- Guest launcher SIGINT sends cancellation; browser terminates the worker using
  SDK `kill()` (SIGTERM internally), returns shell status 130, and kills its
  tracked direct native children. This is termination, not delivery of a catchable
  worker SIGINT. Unix socket disconnect also requests cancellation.
- Launcher deadline 120s; browser worker deadline 110s (currently also status
  130); native child deadline 30 guest-clock seconds, standalone API deadline 40
  browser-wall seconds. Native deadline
  uses the guest's actual termination exit code rather than a typed timeout.
- Eight concurrent native children, maximum aggregate output 1 MiB per child;
  exceeding the limit rejects. Cancellation kills direct children only, not
  Linux process groups/grandchildren. No detached processes/job-control contract.
- Guest launcher request buffering is capped at 64 KiB; browser stdout line
  framing is capped at 64 KiB. Native input is a finite base64 field, not an
  interactive stream (standalone requests capped at 60000 JSON characters).
  No credit-based backpressure; large inputs and sustained
  output are not qualified. The guest protocol assumes cooperating local clients.
- **Worker stdin is reserved for native replies**, and RS-prefixed stdout lines
  are reserved control. Worker regular stdout is line-buffered (partial tail
  flushes at exit); stderr is forwarded immediately. UTF-8 text is supported for
  worker terminal output, not arbitrary binary stdout. Native output is binary.
- Native env uses caller values; no implicit shell unless argv explicitly asks
  for `/bin/sh -c`. No auto-selection of Linux versus worker binaries.
- Reload destroys the QEMU overlay and running processes. OPFS worker fixtures
  are refreshed on boot. Socket install is ephemeral. No reconnect/resume.
- Guest bridge and serial adapter are source overlays assembled in memory by
  `server.ts`; no sibling source edits, runtime rebuild or generated JS patches.

## Interface proposed to filesystem/native FFI tracks

Replace the fixture preloading with one agreed mount mapping, e.g.
`{mountId, linuxRoot:'/workspace', workerRoot:'/workspace', generation}`. Validate
cwd against it, and pass the mount identity on both execution directions. Require
the filesystem track to specify write visibility before spawn, rename/open-fd
semantics, and when native completion makes writes visible to worker reads.
This launcher does not establish any of those guarantees.

Extract `native-spawn {job,argv,cwd,env,stdin}` and `native-event
{job,event:{type:'data',stream,seq,data}|{type:'exit',code}|{type:'error',error}}`
into a dedicated MessagePort worker/kernel transport. Add stdin chunk/EOF,
credits, signal acknowledgement, per-launch capability and group termination.
Then wire actual `child_process` OP_SPAWN_ASYNC/child-stdout/child-stderr/child-exit
instead of reserving app stdio. Synchronous spawn needs a separate SAB response
slot serviced without blocking the kernel that routes native messages; do not
park that kernel waiting for a guest command which may itself invoke accel.
An FFI ABI should use its own IDs/lifetime and binary frames, not overload
terminal output or claim POSIX child-process semantics.

Specific upstream integration hazard: pinned `packages/runtime/builtins/
child_process.js` `_drain()` lines 307/309 does
`Buffer.from(String(m.chunk), 'utf8')` for child stdout/stderr. Sending raw typed
arrays through that existing path would stringify them and corrupt native binary
output. A real integration must preserve byte views there, add native PID routing
to stdin/kill, and maintain child liveness plus exit-before-close ordering. The
standalone path here explicitly decodes base64 into Buffers instead.

## Checks and evidence

`protocol.test.ts` tests every split boundary of two records containing all 256
byte values, plus oversized complete/incomplete frames. `native-api.test.ts`
checks concurrent request isolation, binary result bytes, nonzero exit, error
rejection, sequence rejection, and request limits with a mock transport (it does
not execute host processes). Browser qualification
and exact observed results are recorded in `results.json` when available.
The qualified run in session **`cosmic-wombat-621`** returned launcher status 23,
separate capture status 19, and Ctrl+C status 130. Native `sleep` returned 143 and
was absent from guest `ps`; both browser job registries were empty. Four native
requests ran concurrently, including exact six-byte and 9000-byte binary round
trips and a missing executable. The 9000-byte response had three ordered frames.

**Reliability finding:** an earlier four-command burst hit the 40-second native
deadline. Single-call diagnostics and the subsequent full acceptance passed with
the same deadline; the cause is not established. This is a working bounded spike,
not a throughput/reliability qualification. The first binary-input defect was
also caught live and fixed: guest Bun's stdin sink needs `write(bytes); end()`.
The live inspection API is `window.execSpike`: `logs`, `jobs`, `nativeJobs`,
`vm`, `bridge`. `bridge.request({type:'exec',command})` is **QEMU guest** execution;
`bridge.send({type:'terminal-input',data})` feeds the real guest PTY.

```sh
browser-control execute --session SESSION --file browser-container-poc/hybrid-exec/accept-browser.js
```

Acceptance runs the nested binary/error probe from the native PTY, separately
captures worker stdout/stderr through a guest `accel` subprocess in `/tmp`, then
checks real PTY Ctrl+C and empty browser job registries. It requires the connected
page from steps 1–3; it does not navigate or restart any other experiment.
