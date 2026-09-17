# Browser contract runner — initial implementation

Date: 2026-09-17 UTC

Added a function-based real-browser contract runner in the consumer candidate:
`browser-agent-toolkit-upstream/workspace-api/tests/browser/`.

Run from `workspace-api`: `bun tests/browser/run.ts`. Requires an existing runtime
distribution and connected Bun-backed Browser Control CLI/extension. Optional
`RUNTIME_DIR` selects the distribution; no model credentials are needed.

The Bun runner serves the current Workspace API bundle and verified runtime
manifest/kernel on an ephemeral loopback origin. Browser tests exercise the real
worker/OPFS stack through Workspace/Runtime APIs, with ordered diagnostic/output
events posted back to the runner console. Each case starts with empty test-owned
OPFS; multiple steps retain that store across document reloads. Existing OPFS is
refused before ownership is claimed. Automatic cleanup stops runtime/workspace,
clears the owned store, deletes the session, and stops the HTTP server. Deadlines
and nonzero failures are implemented.

Helpers: `browserCase`, `mount`, byte-preserving bounded `capture`, `equalBytes`,
`assert`, logging. `vivari(workspace)` is an explicitly test-only escape hatch to
the existing host via the internal map; no production public API was expanded.

Verification: workspace TypeScript check PASS; four real-browser cases PASS:

1. Callback failure preserves its error and releases running process/workspace,
   allowing a second workspace open in the same document.
2. Binary stdin/stdout, stderr EOF marker, natural exit 0.
3. Binary HTTP response/status, EOF shutdown, endpoint closure.
4. Flushed source bytes restored after orderly close and real browser reload.

Runtime identity:
`6896fbc42eec0c625a954634a0772843108c72cf68c58e880bc3d6d8a837ec21`.
Final verification session `workspace-tests-a561f7ba-6e0b-4679-b3e8-baca5dec7a6c`
on ephemeral port 64858 was cleaned up successfully. The original TODO acceptance
session/origin was not used by these tests.

Initial development exposed a fixture-path mistake: Workspace FS paths are
workspace-relative but `runtime.node` takes runtime-absolute entries. Corrected
fixtures to `/workspace/*.cjs`; the failed run exited nonzero and cleaned up.

This is initial reusable coverage, not completed qualification. Persistence here
is orderly close/reload (close also flushes), not abrupt crash recovery. Remaining
work includes cancellation/backpressure/listener replacement, SQLite ownership
and failure modes, multi-tab storage ownership, and explicit storage fault
injection. The README beside the runner documents extension points and usage.
