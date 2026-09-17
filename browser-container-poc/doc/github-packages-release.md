# GitHub Packages release preparation

## Source publication and clean runtime build

User authorized committing/pushing the current integration and preparing GitHub
Packages consumption before integration into `kkrausse/irs-tools`. Both source
repositories now have `integration/upstream-runtime` branches:

- Toolkit: <https://github.com/kkrausse/browser-agent-toolkit> (public, newly created).
- Runtime: <https://github.com/kkrausse/vivari>, commit
  `6badd6731a70a2354898d6155301fe724b61c485`.

Runtime commit includes reviewed integration source, SDK, tests and architecture
notes. Four local handoffs remain untracked and unpushed in the original candidate.
Rather than excluding those files in its shared Git metadata, a fresh pinned
checkout was cloned into the toolkit's gitignored `vendor/vivari`.

`build-runtime.ts --release` succeeded from that clean clone with Node 24.18.0,
Rust 1.93.0, wasm-pack 0.13.1 and Bun 1.4.0. Distribution identity:
`972d9bc8d3515d3c1dfcf4fb4fc95efae7f939328aa6b497e1c999cd38d14884`.
The active kernel/process hashed filenames match the prior accepted build.

All 18 browser cases passed against this clean-source distribution. Session
`workspace-tests-14a002c6-e432-4b84-a2e8-bc4f4ec1d53b`, port 63075, and its test-owned
storage were cleaned up. Workspace typecheck and all 11 unit tests passed.

The full retained runtime contract command still fails on the previously tracked
missing `worker_threads.markAsUncloneable`. This is not full runtime compatibility
qualification. Crash-durability and additional storage fault gaps remain as
documented in the browser contract report.

## Portable build inputs and packed consumers

The existing qualified OpenCode 2.0.3 receipt and declared outputs were verified,
then published as a build-input asset under toolkit release `opencode-input-2.0.3`.
This is not a toolkit package release. `scripts/setup-opencode.ts` downloads the
checksummed archive and applies the existing receipt/output verification before
installing it. A download/install from GitHub passed locally.

Archive SHA-256:
`f8d5870652a9b29dbf6224c09c29519f9b635dd941d2ba70c6cc4bfe0813eb4e`.
Receipt SHA-256:
`df6a3d88f014f95c1dd5957a06c6e3baa3ca4d4dd45ca4be5ea88d6518627813`.

Packed-consumer verification initially exposed the local Vivari dependency leaking
from the Workspace manifest. Its host implementation is already bundled; the
dependency is now development-only, and the generated package includes the host
declarations with local imports plus the upstream license. Chat development uses
the compiled Workspace output, avoiding source-only imports and duplicate local
dependency entries emitted by Bun 1.4.0's old lockfile arrangement.

After repair, independent Workspace tarball install, declarations, SSR, cross-copy
preview/HMR/lifetime checks, and relocated runtime validation all passed. Chat
tests passed: 81 pass, one conditional retained-artifact test skipped, 373 assertions.

GitHub Packages release tooling and workflow are being integrated. Package
publication and `irs-tools` integration are not yet claimed complete.
