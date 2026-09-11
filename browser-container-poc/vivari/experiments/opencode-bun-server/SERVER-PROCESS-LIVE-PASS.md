# September 11: direct server/process live-output headless PASS

**PASS: one unchanged artifact execution**, after reusable integration harness
verification. OpenCode became ready, rejected unauthenticated health, returned
authenticated health, consumed the embedding's EOF shutdown request, completed
its Effect scope and exited naturally. Both workers were terminated and joined.
No application rebuild, source/dependency patch, runtime edit or browser run.

This closes the [capture/readiness harness deadlock](SERVER-PROCESS-DIAGNOSIS.md)
for the retained artifact. It does not reconstruct output from the original
timed-out run or upgrade that historical receipt.

## Reusable diagnostic mechanism

`scripts/headless-process-probe.mjs` uses the supported `Kernel.launch()` live
mode with the existing SQLite snapshot FS worker. It rejects `capture: true`.
Each run gets a fresh UUID directory containing separate stdout/stderr byte logs,
fresh SQLite storage and a final receipt. Application-specific checks belong in
the caller's `exercise` callback.

- Both channels are collected from launch; regular-file writes handle partial
  writes, with separate received/persisted byte counts and SHA-256s. Logs are
  fsynced and closed, then read back for byte/hash comparison.
- Worker messages are counted before kernel dispatch. Worker `error`,
  `messageerror`, unexpected exit, unhandled messages and stdio overflow are
  explicit failures. Worker-message totals are reported separately from sink
  totals; nested captured children can differ, so a mismatch is not automatically
  called a transport drop.
- Stages distinguish launch/listen/readiness, EOF posting, application completion,
  guest exit and preservation. The primary failure retains its stage; cleanup and
  receipt errors are secondary instead of replacing it.
- A deadline aborts the exercise, stops a live guest and joins owned worker
  termination under a separate five-second bound. Incomplete cleanup is recorded
  as a failure; outstanding termination joins are unref'd. No unconditional
  `process.exit()` discards diagnostics before cleanup.
- The final receipt is written to a new file, fsynced and atomically renamed.
  Publication failure is returned explicitly with the primary failure intact;
  callers must surface it. A failed rename can leave the fsynced `.tmp` evidence.

These are bounded low-volume diagnostics, not P2 backpressure. Synchronous host
filesystem/kernel operations are not preempted by JavaScript timers; the cleanup
bound covers asynchronous worker joins. Kernel output messages have no per-stream
EOF acknowledgment: receipts say so explicitly. Worker termination closes the
observation window; byte equality is **not proof of end-to-end lossless output**.
The FS worker's native Node OPFS warning is host-side output, not guest stderr.

## Verification

From `browser-container-poc/vivari`:

```sh
/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node --test scripts/headless-process-probe.test.mjs
```

All **3 real-Vivari-kernel tests passed** in 2.36 seconds:

1. A real guest emits exact multi-chunk UTF-8 stdout/stderr markers before waiting
   for EOF. Both are observed while it is alive; EOF triggers a completion marker,
   natural exit 0, exact file bytes/hashes and joined cleanup.
2. The same guest intentionally waits indefinitely. A two-second deadline saves
   both logs and a TIMEOUT receipt, preserving the last marker stage, recording
   forced exit 143/SIGTERM and joined workers, with no EOF request.
3. A real filesystem publication error (receipt destination is a directory)
   preserves an intentional primary exercise failure, returns `EISDIR`, retains
   exact logs and a fsynced temporary receipt, and joins all workers.

The first suite run found a harness JSON round-trip mismatch: `code: undefined`
was omitted from disk. Changed it to explicit `null`; the complete rerun passed.
No runtime failure occurred. Original failed test evidence remains retained.

Successful-suite receipt roots under `.runtime/headless-diagnostics/`:

| Test | Directory | Receipt SHA-256 |
| --- | --- | --- |
| Live EOF | `live-eof-7e7b3fe2-eec0-4ced-b3b7-9eed32ed6003` | `fac3263cde3a2b6868b2068d88a4e79723d7596339946809e1564f649aabe981` |
| Timeout | `forced-timeout-606fa091-e384-4f79-b124-473cd485cb37` | `f778f47cfd1905b378c328d035dc26fab0cb1b23823e3281bfdd54861a6a4a43` |
| Expected publication failure | `receipt-error-9053b885-8055-48d8-8824-22deea80140d` | See `receipt.json.tmp`; published receipt intentionally unavailable |

## Single application execution

```sh
/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node scripts/opencode-server-process-headless.mjs \
  /private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/server-process-candidate.0co24kti
```

The caller validates the exact retained build receipt, clean source revision/tree
and lock, clean runtime pin, copied recipe hashes, and the complete emitted file
set with byte/hash checks. All five artifacts are mounted unchanged. Source and
runtime cleanliness and output hashes are rechecked after the guest exits.

| Checkpoint (UTC) | Observed result |
| --- | --- |
| Listener, 23:14:49.993 | port 4096, PID 1 |
| Real schema bootstrap | 46 migrations completed, 30 ms logged |
| Application ready, 23:14:50.060 | upstream `start()` returned; marker received |
| Unauthenticated health, 23:14:50.066 | 401 |
| Authenticated health, 23:14:50.073 | 200, `healthy:true`, version `0.0.0-beta-19425`, PID 1 |
| Stdin EOF posted, 23:14:50.074 | `sendStdin` returned true |
| Scope complete, 23:14:50.077 | `OPENCODE_SERVER_PROCESS_SHUTDOWN_COMPLETE` received |
| Guest exit, 23:14:50.077 | code 0, signal null, natural=true, forced=false |
| Worker cleanup, 23:14:50.149 | FS and process worker exits observed; both termination promises joined |
| Host result | exit 0, PASS; no primary/secondary failures |

EOF posting alone is not delivery proof, but the subsequent upstream scope-close
marker and natural exit establish the requested shutdown behavior in this run.
Node worker exit codes are 1 because their host shells are explicitly terminated
after guest exit; they are distinct from the recorded natural **guest exit 0**.

## Final evidence and identities

Run directory, relative to the integration root:

```text
.runtime/headless-diagnostics/opencode-server-process-0543d990-551d-4b8a-ae10-9f7f1c10423a/
```

| File | Bytes / scope | SHA-256 |
| --- | --- | --- |
| `receipt.json` | final PASS, stages, workers, cleanup, output and provenance | `ff5d8c93bd875ae63b151d0d8c2fc210d5d60aaebb339bbfc0ea7407accbdc0c` |
| `stdout.bin` | 381 received/persisted/worker-message bytes; 5 chunks | `4309c89091887921c84efb7d7a7540b04e8073b2f6fb8c962fc325872a93fd90` |
| `stderr.bin` | 0 received/persisted/worker-message bytes | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

Both channel logs were fsynced/closed; no worker or sink errors were recorded.
No received-byte loss was observed across the measured worker-message-to-file
boundary. Broader producer/transport loss is not established by these counts.

- OpenCode source: clean `20aff6d9f643afe9abf8a048e68f019d049f5329`.
- Vivari: clean `80d5cdd599fce4fa4817128461c865e009109d34`, sibling checkout
  resolved through `scripts/runtime-source.mjs`.
- Unchanged app JS: 28,419,496 bytes, SHA-256
  `55be88221d3d21dc373fb7ad7f80fdda3974a4a0be6453001e8e3df0957fc4fb`.
- The retained build used Bun 1.4.0 despite the candidate's 1.4.2 declaration;
  this slice performed no build. Host Node was 24.7.0.
- Tested helper SHA-256: `68e1052e17ebc5b2ba6b00871941293c3c5cf9381e2f4d3266a4ffafb8d05199`.
- Test SHA-256: `75c1dd24f79fba9441cf4ce5fb596d18b524ca8174f7ff4adeaa4f7c4cb6e98a`.
- Application caller SHA-256: `064ce5cbb00f6caab47fda4cf3fded0f4b1e37959b6d703cf6746f64835ad324`.

Original candidate probe/log/build-receipt hashes still match their prior report;
qualified old JS remains `765dd1b6…` and clean old JS remains `1281158d…`.
No owned workers remain. No model, tool, chat, restart-retention or browser check
was performed. **Next bounded task:** one browser OPFS startup/authentication/EOF
shutdown qualification of this exact artifact with equally explicit completion
evidence, without advancing the shared qualified pin first.
