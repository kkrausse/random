# Retained server-process stall: capture/readiness deadlock

September 11, 2026. **Confirmed harness configuration defect by source tracing;
actual candidate startup remains unqualified.** Stopped at the first concrete
diagnosed cause, as requested. No application rebuild, native application launch,
additional Vivari execution, browser operation, or owned background worker.

The [prior probe receipt](SERVER-PROCESS-CANDIDATE.md) remains historical evidence:
one build passed; one headless execution listened on 4096 and timed out with host
exit 124. This diagnosis does not upgrade that run to a readiness or shutdown pass.

## Deterministic circular wait

The retained `probe.mjs` combines two incompatible modes:

1. Lines 89-92 start health checks only when the **live stdout callback** sees
   `OPENCODE_SERVER_PROCESS_READY`.
2. Line 131 starts the process with **`capture: true`**.
3. On clean fork `80d5cdd`, `packages/kernel-host/kernel.js:399-418` routes captured
   stdout/stderr into `proc.outBuf` / `proc.errBuf` and returns at line 404,
   **before either live host callback**.
4. Those buffers reach the `Kernel.start()` result only through process
   finalization (`kernel.js:491-504,529-542`).
5. The launcher waits for its upstream shutdown latch. The harness sends stdin
   EOF only after the live readiness callback and health checks (probe lines
   58-71). Thus even a successfully booted server cannot complete this harness.

This is **exit-only capture versus live readiness**, not evidence that stdin
backpressure blocked the upstream `start()` call. The launcher's `onListen`
callback attaches an EOF listener, calls `stdin.resume()` and returns a cleanup
Effect immediately; it does not await EOF before returning. Its later
`server.shutdown` wait is deliberate. Native lifecycle correctness and actual
guest EOF handling have not been dynamically established.

Importantly, this defect also hides a possible upstream boot error. The prior
log's absent ready marker cannot establish that `start()` failed to return.
Nor can it establish that the server became ready: no original captured buffer
was saved. The earlier description of a post-listen/pre-ready application stall
must therefore be read as **an observation gap**, not a proven application stall.

## Actual output path and P2 relevance

This probe bypasses `workspace-api/src/execution.ts` and its `ByteQueue`:

```text
guest stdout/stderr
  -> runtime/boot.js output()
  -> scripts/process-worker.mjs parentPort.postMessage
  -> probe worker.on('message') -> info.on[type]
  -> Kernel.onOutput
  -> capture buffers (no live host callback)
  -> final process result, if the process exits
```

`Kernel.start()` constructs its worker spec at lines 537-539 without
`stdioCredits`. `runtime/boot.js:44-47` consequently takes its direct-send branch,
not the SDK credit/1 MiB overflow branch. Neither SDK queue overflow nor producer
backpressure is an evidenced cause here. HTTP traffic follows the separate HTTP
bridge. The old run made no health request, because it never passed the stdout
gate.

EOF would use `Kernel.sendStdin` -> `postToProc` -> worker `stdin` message ->
`control.dispatchStdin` (`kernel.js:384-396,970-977`,
`scripts/process-worker.mjs:98-99`). The probe ignores the send return value;
there is no application receipt of EOF in its evidence. This is a diagnostic gap,
not an observed lost stdin message: the old run did not send EOF at all.

## Output loss and completion evidence

**Confirmed:** live stdout/stderr observation is disabled by the selected capture
mode. The timeout handler logs one marker then calls `process.exit(124)` (probe
lines 44-47), bypassing its final receipt and normal `finally` cleanup path.
Any output retained only in the kernel buffers becomes unrecoverable at host
termination.

**Not observed:** a specific missing ready/error byte sequence, transport drop,
overflow, dropped worker message, or premature stream EOF. The prior run has no
worker-boundary byte counts, kernel-buffer snapshot, or completed capture result
from which to reconstruct what was emitted. Absence of an error is not evidence
of lossless delivery.

Further concrete harness gaps:

- Both output callbacks are registered, but neither drains captured output live.
- No per-channel received/persisted byte counts, stream completion or sink-error
  receipt; writes to host streams ignore backpressure and lack error observation.
- Process worker `error` is handled, but not `messageerror` or unexpected worker
  exit. Worker messages without `info.on[m.type]` are silently ignored.
- No durable final failure receipt with last stage and output hashes on timeout.
- No joined forced-cleanup/worker termination evidence when the deadline calls
  `process.exit`; ordinary cleanup only runs if control reaches `finally`.

## Native comparison boundary and commands

The exact artifact hardcodes `/runtime-probe/opencode.sqlite` and port 4096.
`/runtime-probe` does not exist on this host. HOME/XDG isolation alone cannot
redirect that absolute database path. The available Docker CLI has no running
daemon, so a container filesystem/port namespace was not available through it.
No alternative isolation mechanism was exhaustively investigated after finding
the concrete harness defect.

Read-only environment checks:

```sh
ls -ld /runtime-probe
command -v sandbox-exec
command -v docker
docker info --format '{{.OSType}} {{.Architecture}}'
docker image ls --format '{{.Repository}}:{{.Tag}}'
```

Both Docker queries failed to connect to the local daemon. No daemon was started.
Native application execution is **BLOCKED/not attempted** under the inspected
setup. No candidate process touched host OpenCode, auth, state or listening ports.
No targeted headless rerun was made after the diagnosed stop condition.

## Smallest sustainable next fix

**Owner: integration diagnostic harness**, not application source or P2 runtime
implementation. Use the kernel's live-output mode for a readiness-driven server
probe, and collect both channels into host-owned diagnostic sinks from launch.
Keep readiness, health, EOF request, natural exit and forced cleanup as separate
stages. A narrow shared harness helper should:

1. Record launch/listen/output/exit and worker error/messageerror/exit boundaries,
   with received and persisted byte totals per channel.
2. On success, error or deadline, save a final receipt with last completed stage,
   output hashes, explicit missing/unknown completion fields and cleanup outcome.
3. On deadline, stop the owned process, obtain available output, join worker
   termination and finish the sinks before setting the host exit code.
4. Fail visibly on a diagnostic sink error or unsupported observation mode; never
   silently discard output or call exit-only capture a live drain.

The focused verification should use a real tiny long-lived process that emits
distinct stdout/stderr sentinels before waiting for EOF: verify both are observed
while it is alive, EOF causes clean exit, and a separate forced-timeout case saves
both channels and worker-cleanup evidence. This is reusable process diagnostics,
not an OpenCode-specific logging patch or a P2 backpressure implementation.

Only after that fix should one fresh run of the retained artifact establish
whether upstream boot itself fails. A future launcher should also accept ordinary
database/host/port configuration to make isolated native comparison practical;
the current artifact must remain unchanged for comparison.

## Preserved identities

Inspected integration commit: `ee810e412596cd4fa865f39fc56a5eaac187ff8d`.
Runtime resolved through `scripts/runtime-source.mjs` to the clean sibling fork
`/Users/kkrausse/Documents/repos/kkrausse/vivari`, revision
`80d5cdd599fce4fa4817128461c865e009109d34`.

Retained root:

```text
/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/server-process-candidate.0co24kti
```

Hashes rechecked at 22:37:20 UTC; all match the previous report:

| Retained file | SHA-256 |
| --- | --- |
| `.runtime/opencode-bun-server/server.js` | `55be88221d3d21dc373fb7ad7f80fdda3974a4a0be6453001e8e3df0957fc4fb` |
| `probe.mjs` | `c7f66f5a7881fa76c4e3db13c4267e3b0cac89be73994a6a04f8b0dd704b2977` |
| `probe.log` | `23087edb9a7ae835db8cc987c1f3a7db3e01e24c2efd7c8f87aac0d7d9fe7b8b` |
| `build-receipt.json` | `d6dcd8f0458d7bb3238229eebb0d01766eb4bd8861abc8e74646fe65fe8d7949` |

Source remains the recorded candidate
`20aff6d9f643afe9abf8a048e68f019d049f5329`; no source, dependency, artifact, launcher,
harness or runtime changes were made. Only this new report is committed.
