# Wiring Node compatibility tests into Vivari

Date: September 10, 2026  
Status: Proposed harness design; upstream suite is not wired in yet

## Recommendation

Yes: wire in a pinned subset of Node's own tests early, then expand it as the
runtime improves. Use a small required regression set and a broader reporting
run. This gives the cleanup work an independent behavioral reference, including
edge cases that an application smoke test will not exercise.

Keep three complementary layers:

1. **Upstream compatibility:** guest `node:fs`, streams, HTTP, modules, and process
   behavior against Node's tests.
2. **Vivari/workspace contracts:** host/guest coherence, HTTP bridge flow control,
   listener lifetimes, worker cleanup, OPFS persistence, and SQLite durability.
3. **Application qualification:** real server readiness, streaming, tools, and
   history recovery in a browser.

Node tests strengthen the first layer. They do not independently qualify the
browser embedding transport or storage guarantees.

## What Bun does

Bun's [compatibility documentation](https://github.com/oven-sh/bun/blob/main/docs/runtime/nodejs-compat.mdx)
states that it runs thousands of tests from Node's suite before every release.
Its [test documentation](https://github.com/oven-sh/bun/blob/main/test/README.md)
also describes its own Node API, Web API, and third-party package tests.
The repository includes a [Node test import script](https://github.com/oven-sh/bun/blob/main/scripts/fetch-node-test.ts),
[Node test configuration](https://github.com/oven-sh/bun/blob/main/bunfig.node-test.toml),
and [test adapters](https://github.com/oven-sh/bun/blob/main/test/js/node/harness.ts).

We should borrow the workflow, using pinned upstream Node tests as the baseline.
Bun-specific `bun:test`/`Bun.jest` adapters are not a drop-in Vivari runner. The
inspected adapter even documents a `mustCall` exact-count limitation; preserving
assertion semantics matters as much as importing test files. Bun's fetch helper
reads moving Node main; our importer should resolve and record an exact revision.

## Existing starting point

The editable fork already has `scripts/verify-runtime-contracts.mjs`. It creates
a filesystem worker and Kernel, stages fixture files into the guest VFS, and
launches them with `kernel.start('node', [entry], ...)`. It checks exit status
and an explicit completion checkpoint, then awaits worker termination.

This supplies much of the execution plumbing. Generalize reusable runner pieces
in the **runtime fork**, following its local instructions. Keep distribution and
real-browser embedding qualification in this integration repository. The current
six focused contracts are not an imported upstream suite.

```text
Pinned Node source: test cases + common helpers + fixtures
                          ↓
            manifest / explicit adaptations
                          ↓
                 host test orchestrator
                   ↙              ↘
        reference Node          Vivari guest
        same test source        staged in guest VFS
                                ↙          ↘
                         headless workers  browser workers
                          ↓
       per-test outcomes, logs, timings, provenance, cleanup results
```

Bun can run the orchestrator, but the test's `require('node:fs')` must resolve
inside the Vivari guest. Running a test directly with host `bun test` measures
Bun's implementation instead.

## Minimal useful wiring

Proposed fork layout; these paths and commands do not exist yet:

```text
tests/node-compat/
  source.json              # Node commit, source digest and provenance
  manifest.json            # selected tests, dependencies, flags, expectations
  adapters/                # small, reviewed harness adaptations
scripts/
  sync-node-tests.mjs       # explicit pinned import/cache population
  run-node-compat.mjs       # selection, reference/guest execution, reports
```

1. **Pin a matching Node source revision.** Inspect the runtime's vendored Node
   provenance and intended API target before choosing it. The host Node version
   used for worker qualification is not automatically the compatibility target.
2. **Import helpers and fixtures as well as tests.** Preserve their directory
   structure, source hashes, and attribution. Use a verified offline cache or
   vendored subset so normal test execution needs no network download.
3. **Start with roughly 20–50 relevant cases.** Treat this as a proposed batch
   size, not a count of tests already proven runnable. Select filesystem basics
   and errors, stream finish/destroy/backpressure, events, Buffer, and path cases.
   Add guest-loopback HTTP and module-resolution fixtures next.
4. **Run each case in an isolated guest process and writable test area.** Begin
   serially; use fresh kernels where test mutations can outlive a process. Add
   parallel execution only after port, temporary-path, and state isolation work.
5. **Honor test prerequisites explicitly.** Node tests use `test/common`,
   `common.mustCall`, temporary directories, fixture paths, flags, subprocesses,
   and sometimes Node-internal bindings. Record unsupported flags/capabilities;
   do not silently ignore them or stub the behavior being asserted.
6. **Validate the runner itself.** Include deliberate assertion failure, too few
   and too many callback invocations, asynchronous exception, early exit, hang,
   skip, and worker crash. Prove each is classified correctly on reference Node
   and Vivari before treating green results as evidence.
7. **Write a machine-readable receipt.** Include runtime/source revisions, Node
   test pin, adapter hashes, environment, browser version when applicable,
   selected/excluded counts, actual outcomes, logs, and cleanup failures.

Illustrative eventual interface:

```sh
node scripts/sync-node-tests.mjs
node scripts/run-node-compat.mjs --profile server-core --backend headless
node scripts/run-node-compat.mjs --profile server-core --backend reference-node
node scripts/run-node-compat.mjs --profile browser-smoke --backend browser
```

The browser backend should expose the same selection/result protocol through a
qualification page, driven using the browser-control CLI. It needs its own
timeout and cleanup supervision; an ordinary host worker run is not a browser run.

## Completion and reporting must be trustworthy

Do not append a PASS print after `require(test)` and call that asynchronous test
completion. Preserve upstream callback accounting and exit checks. Capture
`node:test` results where used, including failed subtests. The supervisor should
wait for the test's supported completion mechanism, output drain, and actual
process termination; a crash or forced early exit must not bypass those checks.

Distinguish:

- **PASS:** assertions and required completion checks ran successfully.
- **FAIL:** a behavior/assertion failed.
- **TIMEOUT / CRASH:** execution did not complete normally.
- **SKIP:** explicit unmet environmental prerequisite, with reason.
- **HARNESS_ERROR:** staging, adapter, launch, or result collection failed.

Expected failures are manifest annotations over actual outcomes, not passes.
Store an issue/reason and expected failure signature. A different failure must
not hide behind an old annotation; an unexpected pass should request baseline
review. Report excluded/not-selected tests separately so a high percentage from
a tiny selected set cannot be mistaken for broad Node compatibility.

Run selected unmodified tests on a matching real Node baseline. If that reference
fails, investigate the fixture/environment rather than attributing it to Vivari.
If an adapter is required, record the original source and the adaptation and
compare both on Node when practical. Do not weaken public API assertions just
to accommodate our current behavior.

## How this fits the cleanup schedule

- **Alongside P0:** establish importer, runner self-checks, and a small baseline.
  Report current gaps without requiring the whole imported set to pass first.
- **P1/P2:** promote relevant passing stream/HTTP/process tests into required
  checks. Keep custom endpoint SSE, cancellation, byte-credit, and leak tests.
- **P3:** expand filesystem tests for descriptors, rename, errors, watches, and
  large I/O. Keep host/guest coherence and OPFS failure injection separately.
- **P4:** expand package exports, module identity, async context, and relevant
  WASM addon integration tests. Native-addon build fixtures are a distinct lane.

For pull requests, gate the known-good relevant subset and runner self-checks.
Run a broader selected set on scheduled or explicit qualification runs and retain
its failure inventory. Browser qualification covers the browser-sensitive subset
plus cross-boundary contracts. Expand gates as measured execution cost allows.

## Value and limits

This is especially useful here because we want to fix runtime semantics and
remove package workarounds. An independent suite can reveal that a fix for one
server broke rename errors, stream ordering, or module caching elsewhere.

The initial engineering work is mostly trustworthy harness integration:
`test/common`, fixture delivery, flags, lifecycle accounting, and result capture.
Some cases exercise native OS facilities, V8 internals, or unsupported CLI modes;
keep those visible with reasons. Prioritize the server's required semantics while
using broader results to guide future compatibility work.
