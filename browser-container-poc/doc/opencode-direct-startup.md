# Direct unbundled OpenCode startup — first executed milestone

September 11, 2026. **Built-path browser OPFS health, minimal model SSE, local read/edit/grep, and managed shutdown pass;
broader server acceptance remains ahead. Unbundled startup remains blocked.**

## September 11: bounded glob attempt — browser PASS recovered; host acceptance blocked

**Browser PASS recovered; no host receipt PASS.** Started
`bun scripts/serve-opencode-bun-server.ts --once --glob` exactly once from clean
harness `53d21b73d9755b3d1ac89bbc04faa8a6c7c36a4f`. Original background shell:
`sh_092090dbd001jaU4eDknX9KYPF`; original run ID:
`6180cad9-dcb9-4401-9524-e87f0580c6b1`.
Browser Control CLI session `brisk-walrus-245` navigated once to the exact
printed fresh URL, and returned that destination successfully:
`http://127.0.0.1:52426/?autorun=1&runID=6180cad9-dcb9-4401-9524-e87f0580c6b1&model=1&glob=1`.

On the first continuation, the single attempted receipt read returned **ENOENT** for
`vivari/.runtime/opencode-bun-6180cad9-dcb9-4401-9524-e87f0580c6b1.json`.
No automatic host-completion notification was available then. The original
unverified entry was committed as `8994075` at `2026-09-11T19:55:29Z`.

A bounded recovery inspection on the same run established this chronology:

- Host PID **83488** started at `2026-09-11T19:54:22Z`; at elapsed **2m08s**
  it was still listening on `127.0.0.1:52426`. The one recovery receipt read
  around `19:56:12Z` also returned ENOENT, **before** the host deadline.
- One read-only Browser Control CLI execute on the existing exact page at
  `2026-09-11T19:56:40.580Z` recovered `window.opencodeBunServerResult` with
  **PASS**, all nine checks, and completed cleanup. Navigation had started at
  `19:54:32.280Z`; no new navigation or model request was issued.
- Host timeout is **180 seconds**, armed after bundle preparation and server
  startup (`scripts/serve-opencode-bun-server.ts:203`), thus no earlier than
  approximately `19:57:22Z`. At the browser snapshot at least **41 seconds**
  remained. This slice leaves the original host alive and does not observe its
  later timeout/exit or perform another receipt check.

| Recovered browser evidence | Actual result |
| --- | --- |
| Provider/model | `opencode/muse-spark-1.3-contributor-free` |
| Prompt requests / tool events | **1 / 7**; host proxy POST count unavailable |
| Local glob calls / successes | **1 / 1**, provider-executed `false` |
| Input / path / correlation / exact content matched | all `true` |
| Content items / matched files / fixture files | **1 / 1 / 2** |
| Seed bytes / SHA-256 | **39** / `a9af5f95b94f0de12968fc7e513cf000f573b4e91f10bd9450f52de2ae1cbcdf` |
| Exact content SHA-256 | `6246d2c3789c8c4af609e062c529aa4326214c06192d0dbec1e560634628a717` |
| Unchanged package files / installer checkpoint / setup stderr bytes | **9 / true / 0** |
| Package manifest SHA-256 | `a81b84f137a13dd27977bb55578eb58c13e8d8a4da12612afd84808dad90256a` |
| Installer SHA-256 | `3314ddc36719cd3d4857b5b52398fefef445f2f6bde5f809aa53efee2c78708a` |
| Text deltas / blocks / aggregate UTF-16 length | **2 / 2 / 88** |
| Aggregate / trimmed / last-block marker matched | **false / false / true** |
| Terminal / SSE cleanup | `session.execution.succeeded` / aborted and joined |
| Managed stop / cleanup exit status | accepted / natural exit verified |
| Setup, glob, and top-level guest exits | `exitCode: 0, forced: false, signal: null` |
| Awaited lifecycle cleanup | `runtime.stop + workspace.flush + workspace.close completed` |
| Guest stdout / stderr bytes; mounted assets | **3262 / 0; 6** |

**Concrete reporting blocker:** the host PASS guard at
`scripts/serve-opencode-bun-server.ts:118` requires `globEvidence.seedBytes === 37`.
The actual fixture strings at `probes/opencode-bun-server.ts:90` total **39**
UTF-8 bytes, independently recomputed offline with the same SHA-256 as the
browser. Therefore this recovered PASS cannot satisfy the host guard. The
guard returns HTTP **400**, `Incomplete acceptance checkpoints`, before calling
`report()`; rejection does not clear the deadline or write a receipt. The
browser stores its sanitized result before POSTing (`:514–517`). The snapshot
contained no `/result` resource-timing entry, so the actual POST response was
**not directly observed**; HTTP 400 is the proven validator outcome for this
result, not a captured network response. This is a host acceptance/reporting
defect, not evidence of failed guest glob execution. A subsequent host timeout
receipt would describe the reporting timeout, not negate the recovered browser
checkpoints.

The requested gate was one prompt within 60 seconds, one local upstream `glob`
call with pattern `*.ts`, path `/workspace/glob-probe`, and limit 10, returning
exactly `/workspace/glob-probe/match.ts` without a newline. Acceptance also
requires seeded match/nonmatch fixtures, nine unchanged ripgrep package files,
clean installer exit, successful terminal execution, accepted managed stop,
natural guest exit `0/null/nonforced`, and completed OPFS cleanup. These are
requirements; the matching browser checkpoints above are now recovered.

The supplied pre-run provenance identified existing runtime distribution
`098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`
and clean fork `80d5cdd`. The recovered browser result corroborates the runtime
distribution hash; source provenance and host exit remain unverified without a
receipt. Recovery used one receipt check, one process/listener inspection, and
one targeted browser state snapshot. No rebuild, second host launch, additional
navigation, retry, fallback, completion polling, or sleep was performed. Only
this documentation was edited; no raw reasoning, authentication data, or guest
logs were captured here.

Smallest next action: preserve this run and consume its original host completion
notification/receipt when available. In a separate future code slice, correct
the proven seed-length guard (prefer deriving it from the fixture bytes) and
make rejected acceptance reporting explicit. Do not relabel this browser PASS
as a host receipt PASS. Combined read/edit/grep/glob and persisted edit/session
regression remain later milestones.

## September 11: bounded single-file grep attempt passes

**PASS**, all nine checkpoints. Ran
`bun scripts/serve-opencode-bun-server.ts --once --grep` exactly once from clean
harness `ef009f2`. Browser Control CLI session `brisk-walrus-245` navigated once
to the exact printed fresh URL:
`http://127.0.0.1:52216/?autorun=1&runID=c99c7946-952d-44d9-b35a-242fbc8b807b&model=1&grep=1`.
Original background shell `sh_09201d1ae001mW4Bq5YiFRaBPF` automatically
completed with host exit **0**. No polling, sleeps, execution retries, repairs,
fallbacks, or additional navigation occurred.

Saved sanitized receipt (local generated artifact):
`vivari/.runtime/opencode-bun-c99c7946-952d-44d9-b35a-242fbc8b807b.json`;
manifest observed `2026-09-11T19:46:28.005Z`, host Bun `1.4.0`.
The receipt was inspected through a targeted result/provenance extraction.

| Gate / observation | Actual result |
| --- | --- |
| Provider/model | `opencode/muse-spark-1.3-contributor-free` |
| Prompt requests / model-proxy POSTs | **1 / 2** |
| Prompt deadline / host bound | **60s / 180s**, completed within gate |
| Tool events / grep calls / correlated successes | **7 / 1 / 1**, no other tools |
| Exact input matched | `true`; pattern `VIVARI_GREP_NEEDLE`, path `/workspace/grep-probe.txt`, limit **10**, include omitted |
| Exact content matched / content items | `true / 1`, including trailing newline |
| Provider-executed tool | `false`; local execution |
| Unchanged ripgrep package files | **9**, `ripgrep@0.3.1`, all lengths/SHA-256 verified; transforms `[]` |
| Installer checkpoint / stderr bytes | `true / 0` |
| Installer exit | `exitCode: 0, forced: false, signal: null` |
| Text deltas / ended blocks / aggregate UTF-16 length | **2 / 2 / 58** |
| Aggregate / trim-only / last-block marker matched | `false / false / true` |
| Terminal event | `session.execution.succeeded` |
| SSE cleanup | aborted and joined |
| Managed stop / cleanup exit status | accepted / natural exit verified |
| Guest exit, top-level and phase and grep evidence | `exitCode: 0, forced: false, signal: null` |
| Awaited OPFS lifecycle cleanup | `runtime.stop + workspace.flush + workspace.close completed` |
| Guest stdout / stderr bytes | **3258 / 0** |
| Host exit | **0** |

The exact verified tool content is
`"Found 1 matches\n/workspace/grep-probe.txt:\n  Line 2: VIVARI_GREP_NEEDLE\n"`,
SHA-256 `d4e0ef49b1070a6413f8c35a873c8465c37a746803792140b66dc9a965bb9f9d`.
The **32-byte** seed is `"before\nVIVARI_GREP_NEEDLE\nafter\n"`, SHA-256
`eeb508a3252e85f21f9917342481048cd304b1708422cf748691f7564b61d123`.
The harness correlates session events and tool IDs with the same nonempty
assistantMessageID through call and success, requiring `executed: false` at both.
Nonempty streamed final text and successful terminal execution are acceptance
gates; aggregate marker equality is diagnostic, and the last block matched.

Provisioning used the ordinary `/direct/node_modules/.bin/rg` symlink to
`../ripgrep/lib/rg.mjs` and chmod **0755** on that entry. The installer emitted
exactly `OPENCODE_RIPGREP_INSTALL_PASS\n` and exited cleanly. The nine-file
manifest SHA-256 is
`a81b84f137a13dd27977bb55578eb58c13e8d8a4da12612afd84808dad90256a`;
the **279-byte** installer SHA-256 is
`3314ddc36719cd3d4857b5b52398fefef445f2f6bde5f809aa53efee2c78708a`.
Individual asset destinations, lengths, and hashes are retained in the receipt.

All six app/model assets passed length and hash verification. Existing app and
runtime artifacts were reused; only the browser harness was bundled. Runtime
distribution `098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`
carries clean fork `80d5cdd599fce4fa4817128461c865e009109d34`, built
`2026-09-11T18:36:31.189Z`. App `server.js` SHA-256 remains
`765dd1b67583b645a01e904cdc0de525487e1b5c15db2b281ecad83fa5a5f059`.
Observed upstream source is `d7a7256bb6b0952f486c95718cfbf460b1570a56`
with the preexisting `packages/tui/src/component/devtools-bar.tsx` edit;
app build-time attestation is absent. This is one fresh-origin lifecycle with
one initial phase, not reopen/persistence qualification. The host exited and
the browser session is retained. This documentation-only change records no raw
reasoning, authentication responses, credentials, or guest logs.

Next smallest task: specify an offline acceptance case combining an exact
single-file edit with grep verification after full workspace/runtime reopen,
including explicit terminal, natural-exit, and OPFS-cleanup checkpoints.

## September 11: bounded single-file edit attempt passes

**PASS**, all eight checkpoints; original background shell
`sh_091f5cf1c0013yshAbv0Q1B0Ca` completed with host exit **0**.
Executed `bun scripts/serve-opencode-bun-server.ts --once --edit` once from
clean harness `e6a6141881beaa1cbb0b33ddefd3fc182035b2b7`. Browser Control CLI
session `brisk-walrus-245` navigated once to the exact printed fresh URL:
`http://127.0.0.1:51882/?autorun=1&runID=6f0ce2c4-bd07-472c-8896-4ea6ec995d52&model=1&edit=1`.
Automatic host completion supplied the outcome, without polling, sleeps,
retries, or another navigation. The saved receipt inspection required a targeted
result extraction after the full-file read was truncated by its provenance list.

Receipt (local generated artifact):
`vivari/.runtime/opencode-bun-6f0ce2c4-bd07-472c-8896-4ea6ec995d52.json`;
manifest observed `2026-09-11T19:33:20.911Z`, host Bun `1.4.0`.

| Gate / observation | Actual result |
| --- | --- |
| Provider/model | `opencode/muse-spark-1.3-contributor-free` |
| Prompt requests / model-proxy POSTs | **1 / 2** |
| Prompt deadline / host bound | **60s / 180s**, completed within gate |
| Tool events / upstream edit calls / correlated successes | **7 / 1 / 1** |
| Same-file read calls / successes | **0 / 0**, permitted range 0–2; no other tools |
| Edit target / target matched | `/workspace/edit-probe.txt` / `true` |
| Exact old/new input matched | `true`; `VIVARI_EDIT_BEFORE` → `VIVARI_EDIT_AFTER`, replaceAll omitted or false |
| Provider-executed tool | `false` |
| Final bytes checked through `workspace.fs` | **18**, exact match including trailing newline |
| Text deltas / ended blocks / aggregate UTF-16 length | **2 / 2 / 51** |
| Aggregate / trim-only / last-block marker matched | `false / false / true` |
| Terminal event | `session.execution.succeeded` |
| SSE cleanup | aborted and joined |
| Managed stop / cleanup exit status | accepted / natural exit verified |
| Guest exit, top-level and phase and edit evidence | `exitCode: 0, forced: false, signal: null` |
| Awaited OPFS lifecycle cleanup | `runtime.stop + workspace.flush + workspace.close completed` |
| Output byte counts (stdout / stderr) | **3330 / 0** |
| Host exit | **0** |

Fixture hashes matched the gate's expected bytes:

- Before: **19 bytes**, SHA-256
  `86327673f81b55747abf3ae3212fbcef76cccb9ea10384e5a56f174378247d92`.
- After: **18 bytes**, SHA-256
  `4dc9aa238cd84bbb9e6d8ce654b1beacc276701922cb126e14b003d99c36eb37`.

The edit gate requires nonempty streamed final text and successful execution;
aggregate marker equality is diagnostic. Both ended blocks account for the
aggregate mismatch, while the last block matched. Exact file bytes are the
authoritative edit result. All six mounted assets passed length/SHA-256 checks.
One initial phase completed; this run has no reopen observations.

Existing app/runtime artifacts were reused; only the browser harness was bundled.
Runtime distribution
`098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`
was built `2026-09-11T18:36:31.189Z` from clean fork
`80d5cdd599fce4fa4817128461c865e009109d34`. App `server.js` SHA-256 is
`765dd1b67583b645a01e904cdc0de525487e1b5c15db2b281ecad83fa5a5f059`.
Observed upstream source is `d7a7256bb6b0952f486c95718cfbf460b1570a56`
with the preexisting TUI edit; app build-time attestation remains absent.
The host exited and browser session is retained. This handoff records sanitized
evidence only, omitting raw model text, reasoning, credentials, and guest logs.

Next smallest task, subject to sequential user approval: specify offline a
single-file edit-persistence acceptance case that verifies the exact edited
bytes after full workspace/runtime reopen, with explicit terminal and natural-exit
checkpoints. This result supplies the edit baseline; further execution requires
its own approval.

## September 11: corrected read-gate single attempt passes

**PASS**, all eight acceptance checkpoints; the original background completion
notification confirmed host exit **0**. Executed
`bun scripts/serve-opencode-bun-server.ts --once --read` once from clean harness
`d495d1d`, with the 180-second host bound. Browser Control CLI session
`brisk-walrus-245` navigated once to the exact printed fresh-origin URL:
`http://127.0.0.1:51701/?autorun=1&runID=95a71a0a-b780-4586-8e06-1a85711b94fa&model=1&read=1`.
Completion was collected from original background shell
`sh_091ef8f46001hN7eaOYXpQ74fv`, without polling, sleeps, retries, or another
navigation.

Receipt (local generated artifact):
`vivari/.runtime/opencode-bun-95a71a0a-b780-4586-8e06-1a85711b94fa.json`,
manifest observed `2026-09-11T19:26:31.348Z`, host Bun `1.4.0`.

| Gate / observation | Actual result |
| --- | --- |
| Provider/model | `opencode/muse-spark-1.3-contributor-free` |
| Prompt requests / model-proxy POSTs | **1 / 2** |
| Tool events / local read calls / correlated successes | **5 / 1 / 1**, no other tools |
| Read target / input path matched | `/workspace/read-probe.txt` / `true` |
| Canonical tool content matched authoritative fixture | `true` |
| Provider-executed tool | `false` |
| Text deltas / ended blocks / aggregate UTF-16 length | **2 / 1 / 34** |
| Exact aggregate / trim-only / last-block text matched | `true / true / true` |
| Terminal event | `session.execution.succeeded` |
| SSE cleanup | aborted and joined |
| Managed stop | accepted |
| Cleanup exit status | natural exit verified |
| Guest exit (top-level, initial phase, and read cleanup evidence) | `exitCode: 0, forced: false, signal: null` |
| Awaited cleanup | `runtime.stop + workspace.flush + workspace.close completed` |
| Output byte counts (stdout / stderr) | **3256 / 0** |
| Host exit | **0** |

The eight checkpoints cover fresh real OPFS workspace `default`, all six assets
mounted with length/SHA-256 verification, validated guest registration,
authenticated healthy service, minimal model session creation, one successful
local read with exact target/content and successful terminal SSE, accepted managed
stop, and natural guest exit before cleanup. The initial phase has seven checks;
the fresh-workspace check is top-level. The receipt records one completed phase
and no database-reopen observations.

Both the harness's strict content/text assertions and the observed runtime
lifecycle passed in this attempt. This does not retroactively resolve the earlier
attempt's text mismatch or qualify broader tools/restart behavior. No model text,
reasoning, credentials, or raw guest logs are retained in this handoff.

Existing app/runtime artifacts were reused; only the browser harness was bundled.
Runtime distribution is
`098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`,
from clean fork `80d5cdd599fce4fa4817128461c865e009109d34`, built
`2026-09-11T18:36:31.189Z`. Observed upstream source remains `d7a7256` with its
preexisting TUI edit, and the manifest still lacks app build-time attestation.
The qualification host exited and the browser session is retained. This outcome
changes only this handoff document; no runtime, pin, provider, or host live service
changes were made.

Next smallest task: offline, select and specify the next single-tool acceptance
case, including deterministic fixture, correlated tool-result checks, terminal
event, and natural-exit requirements. This pass supplies the read baseline; it
does not authorize another execution.

## September 11: offline read-gate diagnosis

Inspected the failed `6489fb85-b0f7-4be3-8488-a283f18718df` receipt and
the pinned `d7a7256` source without another execution. The accepted text-only
baseline used the same `session.text.ended` aggregation. In
`packages/schema/src/session-event.ts:344-365`, ended text is the replayable
full-value boundary; `packages/core/src/session/runner/publish-llm-event.ts:149-175`
publishes the accumulated fragments (or supplied full value). Counting deltas
without concatenating them again is correct. Multiple ended blocks are possible;
the old receipt records neither their count nor their text. The fixture is a
single 34-character ASCII line with no trailing newline. Whitespace, formatting,
extra blocks, and another text mismatch remain unproven explanations.

Focused harness corrections:

- Terminal validation and exact-text mismatch now have distinct failure
  checkpoints, rather than retaining the generic `60s deadline` checkpoint.
- Require the correlated local read success's canonical `content` to match the
  known one-line fixture representation, in addition to its input path and
  `executed: false`. Pinned `tool/plugin/read.ts:181-189` emits the header and
  numbered line; `tool/runtime.ts:189-192` normalizes that string into one text
  content item. Previously, any nonempty content array qualified this portion.
- Preserve ended-block count, aggregate UTF-16 length, trim-only comparison,
  and last-block exact comparison. These are diagnostics only; the exact-text
  gate remains required. No actual text, reasoning, auth, or raw logs are retained.
- Retain the managed-cleanup exit tuple and explicit natural/unexpected/unavailable
  exit status within the existing 20-second exit bound. Stop acceptance remains
  distinguishable from exit availability. The historical receipt cannot be filled
  in retroactively, and cleanup cannot turn a failed read gate into a pass.

Validation: targeted strict TypeScript check including the probe passed;
`git diff --check` passed. No browser/model requests, builds, runtime edits, pins,
or host OpenCode operations were performed. Next bounded test: one fresh-origin
`--once --read` attempt using the existing app/runtime artifacts, retaining the
new comparison/content/exit evidence and stopping after that single attempt.
Only that evidence can justify any subsequent change to the prose gate.

## September 11: bounded upstream read-tool attempt

**FAIL**: five of eight acceptance checkpoints completed; the original one-shot
host completion notification confirmed exit **1**. Executed
`bun scripts/serve-opencode-bun-server.ts --once --read` once from clean harness
commit `72b57a4`. Browser Control CLI session `brisk-walrus-245` navigated once to
the exact printed fresh-origin URL:
`http://127.0.0.1:51434/?autorun=1&runID=6489fb85-b0f7-4be3-8488-a283f18718df&model=1&read=1`.
The original background completion was awaited without polling or sleep. No
retry, repair, provider fallback, new credentials, or second navigation occurred.

Receipt (local generated artifact):
`vivari/.runtime/opencode-bun-6489fb85-b0f7-4be3-8488-a283f18718df.json`,
manifest observed `2026-09-11T19:20:54.141Z`, host Bun `1.4.0`.

Completed checkpoints: fresh real OPFS workspace `default`; all six app/catalog
assets mounted unchanged with length and SHA-256 verification; guest registration
validated; authenticated health `healthy: true`; minimal model session created.
The harness seeded the read target `/workspace/read-probe.txt` before the prompt.

Sanitized receipt evidence:

| Gate / observation | Actual result |
| --- | --- |
| Provider/model | `opencode/muse-spark-1.3-contributor-free` |
| Prompt requests / model-proxy POSTs | **1 / 2** (continuation POST observed) |
| Tool events / calls / correlated successes | **5 / 1 / 1** |
| Read target input path matched | `true`, `/workspace/read-probe.txt` |
| Provider-executed tool | `false` |
| Text deltas / exact file-content match | **3 / false** |
| Terminal event | `session.execution.succeeded` |
| SSE cleanup | aborted and joined |
| Managed stop | accepted |
| Awaited cleanup | `runtime.stop + workspace.flush + workspace.close completed` |
| Natural guest exit | absent from failure receipt; not qualified |
| Host exit | **1** |

The reported failure stage was `initial: one model prompt and terminal SSE (60s
deadline)`. This stage label does not establish a timeout: terminal success was
observed, but the exact returned-file-content gate failed. The receipt records no
completed phases or guest exit tuple. Read execution and cleanup evidence therefore
do not constitute a full eight-checkpoint pass. No raw model text, reasoning,
credentials, or response logs are included. Provider/authentication unavailability
is not established by this receipt; no credential decision is needed from this run.

Served runtime distribution remained
`098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`,
from clean fork `80d5cdd599fce4fa4817128461c865e009109d34`, built
`2026-09-11T18:36:31.189Z`. Existing app/runtime distributions were reused;
only the existing browser harness was bundled. No host OpenCode, runtime, pin,
or app changes were made. The qualification host exited; the browser session is
retained. Next smallest task: inspect the harness's text-delta aggregation and
exact-match acceptance logic offline to isolate the mismatch before authorizing
another bounded execution.

## September 11: single public-model prompt and terminal SSE

**PASS**, all eight acceptance checkpoints; the original one-shot host completion
notification confirmed exit **0**. One execution of
`bun scripts/serve-opencode-bun-server.ts --once --model` from `vivari`, at clean
harness commit `6ac6618708bb4c2322f9ebd4b17a5795e41dfb0e`, with a 180-second host
bound and 60-second model SSE deadline. Browser Control CLI session
`brisk-walrus-245` navigated once to the exact fresh URL:
`http://127.0.0.1:51245/?autorun=1&runID=6fb9c428-9476-4108-a7d7-02ca42a6ffb2&model=1`.
Completion was collected from that original background attempt without polling,
retries, fallback, or additional model calls.

Receipt (local generated artifact):
`vivari/.runtime/opencode-bun-6fb9c428-9476-4108-a7d7-02ca42a6ffb2.json`,
manifest observed `2026-09-11T19:15:01.019Z`, host Bun `1.4.0`.

The eight receipt checkpoints, in order, all passed:

1. Fresh real OPFS workspace `default`.
2. All six assets mounted unchanged, lengths and SHA-256 verified.
3. Guest-generated registration validated (credentials omitted).
4. Authenticated health `healthy: true`.
5. Minimal model session created.
6. One short prompt streamed the exact `MINIMAL_MODEL_OK` marker, with **one text
   delta**, **zero tool events**, and terminal `session.execution.succeeded`;
   SSE subscription aborted and joined.
7. Managed stop `accepted: true`.
8. Natural guest exit `exitCode: 0`, `forced: false`, `signal: null`, before cleanup.

Provider/model was exactly `opencode/muse-spark-1.3-contributor-free`.
The receipt records **one prompt request and one model-proxy POST**,
`textMatched: true`, and completed awaited `runtime.stop`, `workspace.flush`, and
`workspace.close`. Stdout/stderr drains counted 3,255/0 bytes; their contents
were not collected for this report. The run used the accepted public proxy and
catalog, with no private host credentials or new authentication. The catalog
SHA-256 was `93c9a67396a5a459c4cd6c4ea3514ef86652019ed2bc1a3589dbc624c4a42ea9`.

Actual served runtime distribution:
`098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`,
carrying clean fork `80d5cdd599fce4fa4817128461c865e009109d34`, built
`2026-09-11T18:36:31.189Z` (`release: false`). Observed app source was
`d7a7256bb6b0952f486c95718cfbf460b1570a56`, retaining the preexisting
`packages/tui/src/component/devtools-bar.tsx` modification. App build-time
attestation remains absent (`buildReceipt: null`). Served `server.js` was
28,339,357 bytes, SHA-256
`765dd1b67583b645a01e904cdc0de525487e1b5c15db2b281ecad83fa5a5f059`.
App/runtime distributions were reused; only the existing browser harness was
bundled by the server script. No runtime/pin changes or host live OpenCode were used.

Qualified scope: **one public-model text-only round trip in a single fresh-origin
lifecycle**, followed by managed shutdown and OPFS flush/close. This does not
qualify tool execution, model conversation retention across restart/page reload,
or broader provider coverage; OPFS cleanup here means flush/close, not deletion.
Next smallest task: add a bounded page-reload session-retention qualification
that retrieves a recorded session ID/title without another model call.
The qualification host exited; the browser session is retained.

## September 11: session-row retention across same-page OPFS reopen

**PASS**, all 14 acceptance checkpoints; original one-shot host completion
notification confirmed exit **0**. One execution of
`bun scripts/serve-opencode-bun-server.ts --once --session-retention` from `vivari`,
at clean harness commit `9a2b47c16a9d47008eed103455bb277e0efb676c`, with the
360-second harness bound. Browser Control CLI session `brisk-walrus-245`
navigated once to the exact fresh URL:
`http://127.0.0.1:50681/?autorun=1&runID=6a6b9aea-57a8-4fdf-92f0-dbe7acd1d9a2&restart=1&session-retention=1`.
The same attempt was continued to collect its completed receipt; no retry,
app/runtime rebuild, pin change, or app/runtime source edit occurred.

Receipt (local generated artifact):
`vivari/.runtime/opencode-bun-6a6b9aea-57a8-4fdf-92f0-dbe7acd1d9a2.json`,
manifest observed `2026-09-11T18:58:35.540Z`, host Bun `1.4.0`.

The 14 receipt checkpoints, in order, all passed:

1. Fresh real OPFS workspace `default`.
2. Initial mount of all five app assets unchanged, lengths and SHA-256 verified.
3. Initial guest-generated registration validated (credentials omitted).
4. Initial authenticated health `healthy: true`.
5. One unprompted session created, with zero model/tool requests.
6. Initial managed stop `accepted: true`.
7. Initial natural exit `exitCode: 0`, `forced: false`, `signal: null`, before cleanup.
8. Same workspace marker and SQLite size/SHA-256 retained across reopen.
9. Reopened mount of all five app assets unchanged, lengths and SHA-256 verified.
10. Reopened guest-generated registration validated (credentials omitted).
11. Reopened authenticated health `healthy: true`.
12. Retained session ID/title checked, with zero model/tool requests.
13. Reopened managed stop `accepted: true`.
14. Reopened natural exit `exitCode: 0`, `forced: false`, `signal: null`, before cleanup.

Both phases completed awaited `runtime.stop`, `workspace.flush`, and
`workspace.close`; stdout/stderr drains counted 257/0 then 42/0 bytes.
The created and retrieved session was `ses_f6e29a1ccffeUpabGg0N2q8l3o`, titled
`Browser OPFS retention probe`; receipt flags confirm creation and ID/title equality.
`/.server/data/opencode.sqlite` retained its valid SQLite header and identical
**425,984 bytes**, SHA-256
`de39386fe70d2a2ada9925be001c805cc439a9d51030e3951853c8b5eac4b4ee`,
after first runtime stop/flush before close and after workspace reopen
**before the second `Runtime.start`**.

Actual served runtime distribution:
`098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`,
carrying clean fork `80d5cdd599fce4fa4817128461c865e009109d34`, built
`2026-09-11T18:36:31.189Z` (`release: false`). Observed app source was
`d7a7256bb6b0952f486c95718cfbf460b1570a56`, retaining the preexisting
`packages/tui/src/component/devtools-bar.tsx` modification. App build-time
attestation remains absent (`buildReceipt: null`). Served `server.js` was
28,339,357 bytes, SHA-256
`765dd1b67583b645a01e904cdc0de525487e1b5c15db2b281ecad83fa5a5f059`.

Qualified scope: **one unprompted session row and SQLite byte retention across
same-page full workspace/runtime reopen**. Page reload remains unqualified.
Next smallest task: add a bounded two-stage page-reload retention qualification
that resumes the same origin/workspace and retrieves the recorded session ID/title
without model execution. Browser session is retained; this qualification host exited.

## September 11: same-page OPFS workspace/runtime reopen qualification

**PASS**, original one-shot host exit 0, all 12 acceptance checks. One execution of
`bun scripts/serve-opencode-bun-server.ts --once --restart` from `vivari`, at clean
harness commit `434634a4cf93f9ca16e75d70874e5374d1037d33`, with the 360-second
harness bound. Browser Control CLI session `brisk-walrus-245` navigated once to
`http://127.0.0.1:50239/?autorun=1&runID=593b50af-886c-41fa-8cb2-ba678dc6d11f&restart=1`.
The original background host completion notification confirmed success; no retry
or app/runtime rebuild occurred.

Receipt (local generated artifact):
`vivari/.runtime/opencode-bun-593b50af-886c-41fa-8cb2-ba678dc6d11f.json`,
manifest observed `2026-09-11T18:48:06.379Z`.

- Fresh real OPFS workspace `default`; run marker retained after full close/reopen.
- Both initial and reopened executions verified lengths and SHA-256 of all five
  app assets, validated fresh guest registration, returned authenticated health
  HTTP 200 (`healthy: true`), and managed stop HTTP 200 (`accepted: true`).
- Both guests exited naturally with `exitCode: 0`, `signal: null`, `forced: false`
  before cleanup. Both completed awaited `runtime.stop`, `workspace.flush`, and
  `workspace.close`. Stdout/stderr drains counted 257/0 then 42/0 bytes.
- `/.server/data/opencode.sqlite` had a valid SQLite header and identical
  **425,984 bytes**, SHA-256
  `aca532604ece0840285ce893ebbc0f54b10a6f02a9ca9bc423b8d109ccf7ed3c`,
  after first runtime stop/flush before close, and after workspace reopen
  **before the second `Runtime.start`**.

Actual served runtime distribution:
`098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`,
carrying the clean fork `80d5cdd599fce4fa4817128461c865e009109d34` receipt built
`2026-09-11T18:36:31.189Z` (`release: false`). Observed app source remained
`d7a7256bb6b0952f486c95718cfbf460b1570a56` with its preexisting TUI modification;
app build-time attestation is absent (`buildReceipt: null`). Served `server.js`
was 28,339,357 bytes, SHA-256
`765dd1b67583b645a01e904cdc0de525487e1b5c15db2b281ecad83fa5a5f059`.

Scope is **same-page full workspace/runtime reopen and SQLite byte retention**.
Page reload remains unqualified; session-row persistence is now qualified above.
The next task at this checkpoint was creating and retrieving one session row
across the same workspace/runtime reopen without model execution. Browser session is retained;
the qualification host has exited.

## September 11: earlier single-attempt browser OPFS service qualification

**PASS**, host exit 0, using `bun scripts/serve-opencode-bun-server.ts --once`
from `vivari` with harness commit `8d35946`. Browser Control CLI session
`brisk-walrus-245` navigated once to the exact fresh URL:
`http://127.0.0.1:49919/?autorun=1&runID=8c372cbc-d2c0-4f1a-93de-89248b0c75a0`.
The host completion notification supplied the result; no retry was needed.

Receipt (local generated artifact):
`vivari/.runtime/opencode-bun-8c372cbc-d2c0-4f1a-93de-89248b0c75a0.json`,
observed `2026-09-11T18:40:27.767Z`. Acceptance checkpoints:

- Fresh real OPFS workspace `default`, run marker written and flushed.
- All five app outputs mounted unchanged, with byte lengths and SHA-256 verified:
  server JS, emitted native asset, and the three tree-sitter WASM files.
- Guest-generated service registration validated; credentials omitted.
- Authenticated `/api/health`: HTTP 200, `healthy: true`.
- Managed `/api/service/stop`: HTTP 200, `accepted: true`.
- Natural guest exit **0**, `forced: false`, `signal: null`, before cleanup.
  Output drains counted 257 stdout bytes and zero stderr bytes without retaining logs.
- The successful result was posted only after awaited runtime stop, workspace
  flush, workspace close, and cleanup drains completed.

Actual served runtime distribution:
`098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`.
Its carried build receipt identifies clean fork commit
`80d5cdd599fce4fa4817128461c865e009109d34`, built
`2026-09-11T18:36:31.189Z` (`release: false`). The app's observed upstream revision
is `d7a7256bb6b0952f486c95718cfbf460b1570a56`, with the preexisting
`packages/tui/src/component/devtools-bar.tsx` modification retained. App build-time
attestation is absent (`buildReceipt: null`); this records observed inputs and
verified emitted bytes, not a clean-upstream build claim. Actual `server.js` is
28,339,357 bytes, SHA-256
`765dd1b67583b645a01e904cdc0de525487e1b5c15db2b281ecad83fa5a5f059`.

Next task at that checkpoint (now completed above): a bounded fresh-runtime restart on the same
retained OPFS workspace, verifying retained SQLite state and repeating health,
managed stop, and natural-exit checkpoints. Browser session is retained for that
follow-up; the one-shot host has exited.

## Earlier headless and unbundled investigation

Latest conventional-build experiment: `Bun.build` with target `node` and the
authorized exact jsonc-parser published-ESM entry resolver succeeds (28,339,308-byte
JS plus one native asset). `ws` is bundled, and selecting jsonc-parser's existing
ESM modules passes the previous UMD `./impl/format` failure. Ordinary unchanged
tree-sitter runtime/Bash/PowerShell WASM copies and their three upstream
`OPENCODE_TREE_SITTER*_WASM_PATH` settings now pass the subsequent missing-asset
resolution failure. The later `SQLITE_CANTOPEN` was reduced to the default headless
FS worker explicitly supplying no persistence adapter. Reusing the existing
disk-snapshot test worker with a fresh isolated directory and upstream
`OPENCODE_DB=/runtime-probe/opencode.sqlite` resolves it without runtime edits.
On `80d5cdd`, all 41 migrations complete and authenticated `/api/health` returns
200 with `healthy:true`. Default readiness deliberately stops the process (143,
no worker errors); the opt-in managed shutdown now exits cleanly as detailed below.
Full acceptance remains unqualified.
Native SQLite reopened the resulting disk file: integrity `ok`, 18 tables.
Exact build command from `vivari/experiments/opencode-bun-server`: `bun run build`
(runs `bun ./build.ts`; only resolver is `/^jsonc-parser$/` → published ESM main,
followed by original WASM asset copies).
This selects unchanged published source, with no runtime redirect or source rewrite.
Probe from `vivari`:
`/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node scripts/opencode-bun-headless.mjs`.
See the [build probe handoff](../vivari/experiments/opencode-bun-server/README.md)
for configuration, exact asset paths, pins, unchanged JS hash and the next bounded
headless lifecycle task. These were missing deployment data/storage setup, not another code
bundle transform; full server and tree-sitter operation acceptance remain ahead.
**Normal builds/transpilation are accepted; the direct TS stripper is not
necessarily the critical path.** Browser qualification is recorded above; this
earlier investigation made no runtime pin advance.

Managed shutdown now passes in one isolated guest execution: explicit guest XDG
paths, actual registration credentials read through `Kernel.readFile`, health 200,
stop 200 with `accepted: true`, then natural exit 0, no signal or worker errors.
The probe's opt-in `--service` mode preserves default readiness behavior. See the
[current shutdown result](../vivari/experiments/opencode-bun-server/README.md#september-11-isolated-managed-shutdown-current)
for commands and exact registration source. The subsequent opt-in `--restart`
sequence now passes two managed starts using **fresh kernels and FS workers**
sharing only the isolated SQLite snapshot directory: both health/stop 200, natural
exit 0, signal null, no worker errors. The 425,984-byte snapshot retains the same
SHA-256 across restart, and only the first start logs the 41-migration bootstrap.
See the [restart receipt](../vivari/experiments/opencode-bun-server/README.md#september-11-fresh-kernel-managed-restart).
Session retention remains unqualified; that is the next separately scoped task.

Native jsonc-parser reduction now reproduces that same `./impl/format` failure
under both Node 24.7.0 and Bun 1.4.0. The emitted bundle binds require to its own
URL and omits the original implementation files; no Vivari-only discrepancy is
shown. Standard `--packages=external` with the unchanged package delivered, and
ordinary unbundled delivery, both pass native parse/edit checkpoints.
See the [reduction and exact command](../vivari/experiments/opencode-bun-server/jsonc-repro/README.md).
The baseline's `onResolve` chose the package's published ESM entry; it did not
replace package source. This reduction uses neither that hook nor an ESM swap.

Latest unbundled result: runtime `80d5cdd` supplies bounded worker uncloneable-mark semantics.
The direct launcher now passes Undici initialization and reaches `Unexpected string`
compiling `packages/client/src/effect/service.ts`. Earlier failures below record
progress. Still no listener or server acceptance.

## Reproduce

From `browser-container-poc/vivari`, with the existing frozen upstream install at
`.runtime/opencode-v2-source` (`d7a7256bb6b0952f486c95718cfbf460b1570a56`):

```sh
/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node scripts/opencode-direct-headless.mjs
/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node scripts/opencode-direct-headless.mjs --cli
```

`OPENCODE_SOURCE` overrides the upstream directory; `VIVARI_SOURCE` uses the
standard runtime source resolver. Requires already-built runtime WASM. The probe
prints source revision/status and lock hash. It mounts 165,463 JS/TS/JSON/JSONC
files and 12,833 symlinks from the ordinary installed tree into `/upstream`, using
bounded batch delivery. File bodies are copied unchanged. It does not bundle,
rewrite package code, scan an import graph, resolve optional imports in advance,
or invoke either existing application packager. Symlinks retain relative layout;
absolute links inside the source root relocate with the mount.

This is a **diagnostic code image**, not yet a complete distributable install:
other extensions (WASM, SQL, text, native binaries, etc.) are omitted generically.
No missing asset is hidden by a replacement; extend generic asset delivery when
execution reaches it. The host dependency tree is a prerequisite; guest install
and dependency restoration are not qualified. Mounting optional package files
does not execute their imports.

The existing checkout reports a preexisting modification to
`packages/tui/src/component/devtools-bar.tsx`; it was preserved. This is therefore
not a clean-upstream reproduction receipt. Lock SHA-256:
`b6ebc10fd743b192bf81437c0e95a89b850daffa6cfe9de0ba6491c13f1c3764`.

The default invocation-only guest launcher is:

```js
import { Effect } from 'effect';
import { ServerProcess } from '@opencode-ai/cli/server-process';
await Effect.runPromise(ServerProcess.run({
  mode: 'default', hostname: '127.0.0.1', port: 4096,
}));
```

The alternative executes the original CLI source directly:

```sh
bun /upstream/packages/cli/src/index.ts serve --hostname 127.0.0.1 --port 4096
```

Both use fresh in-memory VFS state and `/home/direct`, explicit probe-only auth,
and upstream flags disabling FFF, filewatching and model fetching. No host service
or host credentials are used. A 180-second bound terminates hangs; workers are
terminated after each completed attempt. Exit zero alone fails the probe: eventual
server qualification must add authenticated health and lifecycle checkpoints.

## Executed results and fix

1. **Before fix, exported entry launcher:** Effect's ordinary published
   `dist/Array.js` fails compilation with `Unexpected token 'export'`.
   This happens while loading the real Effect barrel, before server entry loading.
2. **Reduction:** local export lists containing JSDoc braces, e.g.
   `export { /** {@link value} */ value }`, were stripped only to the first `}`.
   The loader left malformed source and missed later export declarations.
3. **General runtime fix:** fork commit `b6a5fbe` reuses the existing lexical
   balanced-brace skipper in `packages/runtime/esm.js`. There is no package name
   check or application hook. New `esm-export-comments` fixture exercises block
   and line comments, aliases and subsequent exports with actual dynamic import.
4. **After fix, exported entry launcher:** Effect loads; then
   `Cannot find module '@opencode-ai/cli/server-process' from '/upstream/packages/cli'`.
   The package declares that exact name/export, but the runtime did not resolve
   package self-references. No import substitution was added. Worker compilation errors are reported separately;
   kernel cleanup gives exit 143, not a successful application shutdown.
5. **Ordinary CLI attempt after fix:** exits 1 with
   `TypeError: webidl.util.markAsUncloneable is not a function`, at Undici's
   `CacheStorage` construction. This is the next independently observed CLI-path
   compatibility blocker; it was not fixed in this milestone.
6. **Continuation, `c2b10ac`:** implement general package self-reference lookup
   through the nearest package name/exports, respecting nested scopes and
   node_modules boundaries. The launcher next actually loads
   `packages/cli/src/server-process.ts`, which fails with `Unexpected token 'export'`.
7. **Second reduction/fix in `c2b10ac`:** the TS stripper treated `as` in
   `export * as ServerProcess from ...` as a type assertion and consumed following
   imports. Preserve module binding clauses and erase only their inline type
   specifiers. The independent contract tests namespace export/import, renamed
   bindings, an ordinary binding named `type`, erased types and real assertions.
8. **Launcher retry after `c2b10ac`:** now also reaches
   `webidl.util.markAsUncloneable is not a function`. This is a missing
   `node:worker_threads.markAsUncloneable` API used by installed modern Undici,
   rather than a reason to rewrite or bundle the package. Correct implementation
   needs cloning-boundary semantics, not a silent no-op.
9. **Bounded fix, `80d5cdd`:** process-local WeakSet marks reject at guest
   structuredClone, MessagePort/BroadcastChannel posting and Worker workerData
   boundaries. JS graphs are snapshotted once, preserving getters-once, cycles,
   aliases, Map/Set entries and Error causes. Known native values and transfer
   semantics remain native; ArrayBuffer/SharedArrayBuffer marks are ignored like
   Node. Unknown branded host objects explicitly reject once marks exist, rather
   than bypassing checks; raw cloning functions saved before builtin loading are
   outside this guard. This is bounded compatibility, not every platform brand.
10. **Latest executed launcher retry on committed `80d5cdd`:** Undici initializes;
    then `SyntaxError: Unexpected string (while compiling
    /upstream/packages/client/src/effect/service.ts [esm])`. A diagnostic parse of
    the runtime's transformed output finds a leftover `from "../service.js"`
    after type-export stripping; additional TS declarations also survive later
    in that file. These are next loader defects, not addressed in this slice.
    The compilation failure triggers worker cleanup/exit 143; no listening marker.

Neither attempt emitted a listener checkpoint. No conclusions about later native,
TUI, SQLite, HTTP, model or tool paths follow from these failures.

## Verification and scope

Executed in the standalone runtime fork with native Node 24.7.0:

```sh
node scripts/fixtures/runtime-contracts/esm-export-comments.cjs
node scripts/fixtures/runtime-contracts/package-self.cjs
node scripts/fixtures/runtime-contracts/worker-uncloneable.cjs
bun scripts/fixtures/runtime-contracts/ts-module-alias.cjs
node scripts/spike-bun-offline.mjs
node scripts/verify-runtime-contracts.mjs
```

Native fixtures and the complete offline Bun suite passed; the latest run passed
all thirteen real-worker contracts (including fs-permissions). The new native
Node/guest uncloneable contract covers nested marked values, maps, sets, Error
causes, workerData rejection, accessor values, getters-once, cycles, ordinary
Date/RegExp/typed-array/Error cloning and real ArrayBuffer transfer/detachment.
A direct `bun run build:core` attempt failed
because `wasm-pack` was absent from that shell's PATH, before any build output.
The coordinating session built clean `b6a5fbe` and qualified unchanged ripgrep in
Chromium, distribution `445933bcccfa1a2d306905190ee896d10bfc4453cc1b6ccdb1c2aeba6d5dd2fc`.
That does not qualify OpenCode or the later `c2b10ac` source-loader additions.
The coordinating session owns subsequent integration build/distribution; this
milestone does not advance the qualified runtime pin. No browser test was run
by this investigation.

The upstream CLI AGENTS references `opencode-dev`; skill loading failed and no
such skill was found in this environment. The available pinned `opencode-drive`
instructions were read. This work used the explicitly authorized noninteractive
isolated guest kernel rather than the installed live service.

Keep the existing packaged baseline. The next bounded conventional-build task is
qualifying supported shutdown and explicit retained-storage restart after authenticated health;
the unbundled client-service TypeScript compilation failure remains a separate
loader issue. Retry with further generic assets when execution requires them.
The original [case-study acceptance gates](opencode-runtime-case-study.md) remain.
