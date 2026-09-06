# OpenCode tools in Vivari — 2026-09-06

## Execution boundary

Official OpenCode remains pinned to `0.0.0-dev-19167`. Packaging runs on the host;
the SDK, Effect services, filesystem operations and command children run in
Chrome's Vivari workers. SQLite remains browser-native WASM. This qualification
does not use a model or establish CLI/TUI compatibility.

Run commands are in [`vivari/README.md`](../vivari/README.md). The named bridge
probe is `bun run vv --runtime ID probe --tools`; its success requires both
exit zero and an explicit final checkpoint. It uses a newly named fixture
directory for every attempt, preserving failed fixtures for diagnosis.

## File API and real search backend

Pinned `OpenCode.create()` with an in-memory database successfully calls:

- `host.file.read`: exact fixture content; missing file rejects.
- `host.file.list`: both fixture files returned.
- `host.file.find`: matching fixture returned; an absent query returns no entries.

These API operations are distinct from the model-facing tool registry.

The embedded event stream also passes its actual `server.connected` handshake
and delivers `session.created` for a newly created session, with explicit abort
and iterator cleanup. This establishes the SDK event transport, not streamed
model tokens or a model-driven tool loop.

Before provisioning ripgrep, `file.find` returned a generic `ClientError:
UnexpectedStatus`; the pinned resolver cannot download a native executable for
the guest's `wasm32-linux` platform. Native FFF is unavailable on the current
Node-conditioned package path, so OpenCode selects its real ripgrep fallback.

The POC now packages `ripgrep@0.3.1` from its locked npm artifact. It contains
**ripgrep 15.1.0 (rev 4519153e5e)** compiled to WASM. Host packaging decodes the
published z85/Brotli payload and replaces only its byte loader; its published
WASI shim remains unchanged and accesses the guest Node filesystem. The guest
receives the binary, JS runner, metadata and license with SHA-256 receipts.

`probes/runtime/ripgrep-contract.cjs` passed in Chrome, spawning the actual WASM
runner: positive matches with JSON line/submatch metadata, Unicode text,
case-insensitive search, `.gitignore`, hidden files, an absent pattern (exit 1),
and malformed regex (exit 2 with its parser error). The WASM SHA-256 is
`0b39774ab9fe912a277f3b921f7619c937dc0398eacf184683d2112919cb6943`.

## Actual registered tool execution — PASS

`probes/opencode/tool-registry.mjs` uses the official `AppNodeBuilder` to bind
`Instance.graph` and `Session.node`, configured with the actual Node SQLite
adapter and an in-memory database. It waits for plugin activation and creates
a real session. Agent transforms supply fixture-scoped permission rules; the
registered handlers and their direct-tool presentation are unchanged.

All calls go through **`Tool.Service.snapshot().execute()`**, including input
decoding, hooks, tool permissions and output normalization. This is the internal
registry used by tool execution, not a generic SDK tool-call endpoint (none is
exposed in the pinned SDK).

The ten-call Chrome sequence passed:

1. `read` sees `a - b` in the broken sum implementation.
2. `shell` runs `node sum.test.cjs`: exit **1**, with the assertion failure.
3. `edit` replaces `a - b` with `a + b`, reporting one replacement.
4. `read` confirms the repaired content.
5. `shell` reruns the same test: exit **0**, `fixture test passed`.
6. `glob` finds both fixture files; an absent glob returns no entries.
7. `grep` finds the repaired expression with path/line metadata; an absent
   pattern returns no matches; malformed `[` is rejected as an invalid regex.

The ordinary WASM tree-sitter shell parser ran. Initial execution exposed a
host-packaging bug: TypeScript lowered Emscripten's `await import('module')` to
`require('module')` inside a function declaring a later `var require`, so the
generated call read the hoisted undefined local. The packaging transformer now
routes only synthesized import calls through an outer `__packageRequire`;
original source require calls retain their semantics. No installed library or
emitted worker was edited, and the portable scanner override is not enabled.

The first complete tool run used session `ses_f8880b64effbNy9xZ1yBLamECR` and
emitted registry-tools, tools-receipt, and final tools-passed checkpoints before
exiting zero. This is deterministic model-free qualification: a model has not
yet selected these tools or driven their loop.

## Compatibility limits discovered

- Vivari `chmod` is currently a successful no-op. After `chmodSync('/bin/rg',
  0o755)`, stat still reports `0100666`. OpenCode's `which` rejects that file.
  The probe provisions the same genuine runner in `Global.Path.bin/rg`, the
  official resolver's normal cached-binary path; the resolver then launches it
  successfully. This is explicit packaging, not executable-permission support.
- This ripgrep build has no PCRE2 and requires WASM SIMD. Its published WASI
  shim treats stdin as EOF and reports `poll_oneoff` unsupported; file searches
  are the qualified workload.
- SDK logs report unsupported recursive watching of the global config
  directory; entry/file watchers start successfully. Complete watcher semantics
  are not established by the tool fixture.
- The SDK bundle still uses the existing Node conditions and parser-based CJS
  lowering. Native Bun, FFF, PTY and generic libc FFI remain separate gaps.

## Evidence

Ignored local reports: `vivari/.runtime/opencode-package/{tools-run.log,
tools-receipt.json,rg-receipt.json,host-regression.log}`. Bridge regression
(`scripts/qualify-bridge.ts`) and saved-session SDK recovery also passed during
this slice. No upstream runtime files were modified for the WASM search backend.

Final fresh-page run: registry session `ses_f887ce014ffdWRmQawv30QmD0P`, ten
calls, all five tools, structured CLI qualification receipt. Tools bundle
SHA-256: `f268c8ea4e9edf8ec3f79781cf227590c18f94738fd1896d8227df4da5be8572`.
Repackaged host bundle SHA-256:
`2e9b2862206f63fa4a5bfcbd852ca921c867e6f3b13a1c50bc679d821f6d4c4f`;
recovery-only mode read back saved session `ses_f88a29616ffeEV8EWSUONqIu82`,
closed, and emitted host-passed. TypeScript and patched production build pass.

Next: configure a real provider and qualify a prompt with streamed model output
and a model-selected tool loop that changes and tests a fixture. The tested
registry seam supplies deterministic regression coverage for that next step.
