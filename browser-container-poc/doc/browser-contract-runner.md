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

## Follow-up — 18 browser cases passing

Three delegated implementations added 14 cases using the existing runner:

- HTTP (`d3ca0d5`, fixture correction `4e514fe`): abort before headers and
  response-reader cancellation close the target guest socket; paced binary
  response consumption checks bounded read-ahead and backpressure; stale endpoint
  handles cannot reach a same-port replacement listener.
- Process (`68668b6`): unread stdout overflow forces teardown and preserves the
  error; stdout/stderr cancellation permits continued execution; execution/runtime
  stop closes descendant listeners and permits port reuse/runtime restart.
- Storage (`c8f818b`): OPFS lease ownership/reopen; concurrent mutations/flushes
  and exact backing bytes/reload; backing-file obstruction and flush retry;
  SQLite ownership, transactions and reopen; failed-commit quarantine and recovery
  after orderly kernel restart. Narrow test-only OPFS layout/lock coupling is
  documented in the case file.
- Registration commits: `b5b108b`, `b6f9e8a`.

The first parent-run HTTP case failed because background `GET /` readiness probes
were included in the fixture's socket closure counter. Agent diagnostics observed
the actual aborted socket close; unrelated probe closures pushed the counter past
the expected exact value. The fixture now handles probes separately and uses
`/identity` for listener identity assertions. Assertions were retained; no runtime
source change was needed.

Final delegated browser verification passed all 18 registered cases against the
same runtime identity recorded above. TypeScript and whitespace checks passed.
Session `workspace-tests-23e12cac-7686-4741-854c-f533dfdf830d` on port 53867,
diagnostic sessions, and test-owned storage were cleaned up.

Remaining qualification includes abrupt crash recovery, cross-document competing
workspace opens, quota exhaustion/interrupted manifest writes, retained headless
compatibility checks and clean-source rebuild/requalification. These passing
orderly reload tests do not establish crash durability. Persistence status remains
latched failed after a successful retry; recovery assertions use acknowledged
flush and actual bytes. Failed SQLite commit outcome is treated as ambiguous.

Release direction clarified by the user: defer npm publication; aim for a
reproducible code release followed by integration into `kkrausse/irs-tools`.
A pinned `vendor/vivari` checkout with local-source override and optional GitHub
Release runtime/package archives were discussed, not implemented or published.

### Updated milestone 2 decision

User subsequently chose GitHub Packages publication, then consuming pinned
published versions in local `kkrausse/irs-tools`, with an explicit local-checkout
override when toolkit/runtime changes are needed. This supersedes the tentative
release-assets-only direction above. npmjs.org publication is not required.
Package scope should match the GitHub owner (`@kkrausse`); exact package names and
runtime asset layout remain implementation work. Default consumer installs must
not depend on sibling source checkouts; the local override should preserve public
imports and use a matching runtime distribution.

GitHub's current documentation: public Packages usage is free; private packages
use plan quotas (Free: 500 MB storage and 1 GB monthly transfer). Its npm registry
requires authentication even to install public packages and limits each package
tarball to under 256 MB. Package publication and site integration have not yet
been performed.
