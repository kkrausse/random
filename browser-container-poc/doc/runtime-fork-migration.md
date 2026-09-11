# Vivari fork migration — September 10, 2026

## Source provenance

The runtime is now maintained at <https://github.com/kkrausse/vivari>, default
branch `browser-runtime`, preserving the upstream repository history.

- Upstream: `maitrungduc1410/vivari`.
- Base: `2629c71097238400c45aefa213ef61df4794c2b7`.
- Import: `27d9f3f` — exact 34-file runtime delta plus the existing Bun lockfile.
- Workflow/standalone dependency/contracts: `942d57d`.
- Local source: `/Users/kkrausse/Documents/repos/kkrausse/vivari`.

Before migration, the live checkout's binary diff matched the tracked cumulative
patch exactly. Each of the 34 changed files was byte-compared with the imported
fork source. The additional untracked `bun.lock` was preserved and committed.
The original ignored checkout was left intact.

SQLite WASM had previously resolved from the enclosing POC's dependency tree.
The fork now explicitly declares `@sqlite.org/sqlite-wasm@3.49.1-build1`, making
standalone installation independent of ancestor `node_modules`.

## Development boundary

- Runtime changes are ordinary source commits in the fork.
- Integration builds resolve one source checkout with `VIVARI_SOURCE` override.
- Tests no longer need imports from the ignored `.runtime/patched` source tree.
- Browser workers use static Vite aliases; Node filesystem helpers stay host-side.
- Distribution receipts identify fork source and built assets, not a patch file.
- Generic stream/VM/warning/non-SEA fixtures live with the fork.
- Existing OpenCode/browser qualification remains in the integration repository.

See [DEVELOPMENT.md](../vivari/DEVELOPMENT.md) for the current commands.

## Scope

This migration changes source ownership and the build/test workflow. It does not
implement the subsequent server-only packager, streaming HTTP bridge, new SQLite
transport, or model-facing JavaScript tool. Those remain in the
[server cleanup backlog](opencode2-server-runtime-cleanup.md).

The OpenCode patch only touches TUI devtools; the OpenTUI patch is the renderer
port. Their historical experiments are retained. The runtime's cumulative patch
is removed; its history is preserved in Git and the fork import commit.

## Verification

All checks below passed against the migrated fork:

- Fresh HTTPS setup clone at the recorded fork revision.
- Full Rust/WASM, WASI, and core build; incremental rebuild skipping unchanged
  native commands; forced-native release build; clean pinned release build.
- Receipt verification: clean pinned source, 8 lockfiles, 26 assets, and 37
  native outputs, with matching asset hashes.
- Fork `scripts/verify-node.mjs`: full offline kernel/runtime suite, RESULT PASS.
- Fork `scripts/verify-runtime-contracts.mjs`: all four migrated contracts pass.
- Integration SQLite, FFI, and shell headless suites pass (Node 24.18.0).
- Integration focused Bun tests: 8 pass; workspace unit tests: 5 pass;
  editable-app product tests: 5 pass.
- Vivari integration and workspace TypeScript checks pass.
- Workspace real-worker contract, including real ripgrep WASM: RESULT PASS.
- Workspace distribution packaging succeeds from the fork build receipt.
- Real-browser workspace contract on a dedicated origin: RESULT PASS, including
  large shared binary files, argv/env/exit, watches, binary HTTP/POST, live Fetch
  chunks, cancellation, preview, listener replacement, stop/reattach, and durable
  close/reopen.

Browser distribution version:
`a1b69a6c3a40c4050dc9f46e87b0464caa703a037151b9df6e00070adae142d8`.
Browser Control CLI session: `amber-raven-383`, origin `http://127.0.0.1:43927/`.
This was runtime migration qualification, not a new OpenCode model workflow.

The workspace worker suite initially exposed one integration-asset path still
derived from the old runtime location. It now resolves the ripgrep receipt from
the integration's asset directory and the complete suite passes. A build-script
TypeScript narrowing issue was also corrected without changing build behavior.
