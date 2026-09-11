# Unmodified ripgrep investigation

September 11, 2026. **Unchanged-package cold/warm API and PATH command acceptance passed in Chromium**;
separate from packaged OpenCode acceptance.

## Exact OpenCode grep command: headless preflight

September 11, 2026: native Node **24.7.0**, then real guest workers on existing
runtime `80d5cdd599fce4fa4817128461c865e009109d34`, passed the opt-in
`--opencode-grep` extension to the existing direct probe. Commands from `vivari/`:

```sh
/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node scripts/probe-ripgrep-direct.mjs --native --opencode-grep
/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node scripts/probe-ripgrep-direct.mjs --opencode-grep
```

Both retain cold/warm API and basic CLI/discovery checks, then launch the original
CLI with exactly:

```js
['--no-config', '--json', '--hidden', '--no-messages', '--glob=!**/.git/**', '--', 'VIVARI_GREP_NEEDLE', 'grep-probe.txt']
```

Guest command cwd is `/workspace`, containing `grep-probe.txt` with exact bytes
`before\nVIVARI_GREP_NEEDLE\nafter\n`. Native uses an equivalent `workspace`
directory inside its disposable temporary installation. The same fixture asserts
JSON event order `begin, match, end, summary` and this exact match payload on both:

```json
{"path":{"text":"grep-probe.txt"},"lines":{"text":"VIVARI_GREP_NEEDLE\n"},"line_number":2,"absolute_offset":7,"submatches":[{"match":{"text":"VIVARI_GREP_NEEDLE"},"start":0,"end":18}]}
```

Timing-dependent summary fields are not compared; summary match and matched-line
counts must each be 1. Exact-command and parent exits are code 0, signal null,
with empty stderr and explicit `RIPGREP_OPENCODE_GREP_PASS` /
`RIPGREP_COMMAND_PASS` checkpoints. The supervisor emits its existing OPFS SQLite
availability notice; captured guest stderr is empty.

### Delivery/setup for the next browser task

- Reuse `scripts/ripgrep-direct-assets.mjs`: deliver the nine original
  `ripgrep@0.3.1` files verbatim to `/direct/node_modules/ripgrep`. The existing
  standalone discovery fixture also mounts `which@6.0.1` and `isexe@4.0.0`:
  55 total files, `transforms: []`, manifest SHA-256
  `e40f3b2f9cb5617e5c50e6f70a4ed2c8c01fccd7fda28cf191d9700914a9c7d7`.
- Make `/direct/node_modules/.bin/rg` a symlink to `../ripgrep/lib/rg.mjs`,
  chmod its target to `0755`, and prepend `/direct/node_modules/.bin` to PATH
  (retain `/bin` for the Node shebang). Set `RIPGREP_NODE_WASI=0` in the launched
  process environment. Fixture discovery verifies rejection at `0644` and
  successful published `isexe`/`which` checks at `0755`.
- OpenCode already bundles which 6/isexe 4 and checks PATH before its private
  binary directory; later application delivery needs no extra external discovery
  dependencies or OpenCode private binary cache provisioning.
- The exact check deletes only the package's `ripgrep-wasm-*.wasm` temporary cache
  before launch and verifies it is recreated by the unchanged guest loader.
  No host decompression, loader rewrite, runtime rebuild, or pin change was needed.
- Reuse the fixture directly as `node /direct/command.cjs command /workspace`
  with parent cwd `/direct`, or its opt-in headless probe flag above. The optional
  workspace argument enables the exact check; existing browser invocations retain
  their current checks. Browser `--grep` mode and model/server acceptance are the
  next independent gate and were not run in this preflight.

## PATH command continuation

Runtime `2b27981` implements inode-owned chmod/fchmod and exposes the existing
single-user virtual uid/gid through process identity getters. The latter matters
because published `isexe` rejects execution checks without uid/gid; `which`
silently treats that error as a missing command. No package-specific lookup hook
or caller-supplied uid override is used.

The expanded probe mounts pinned `which@6.0.1` (matching the inspected OpenCode
dependency) and its lockfile-selected `isexe` alongside unchanged ripgrep, for 55
hash-verified files. It creates the ordinary `node_modules/.bin/rg` symlink to the
published `lib/rg.mjs`, applies chmod, verifies non-executable rejection followed
by successful `isexe`/`which` discovery, and launches `rg` through `child_process`.
`RIPGREP_NODE_WASI=0` explicitly selects the published package's own WASI shim.

Native Node, headless guest workers and Chromium now pass:

- API cold/warm cache checks from the prior milestone
- Original CLI cold-cache search with an argument containing spaces
- CLI no-match exit 1, glob output, and invalid-regex exit 2
- Clean parent completion with empty stderr

Browser continuation used clean runtime `2b27981` (including `c2b10ac` loader
fixes), distribution
`64b673e7dea777a985120f1149dc856a59d253e8247da9d03fc4e6141b0e2ecf`,
fresh origin `http://127.0.0.1:43932/`, session `cosmic-falcon-435`.
The automatic host receipt reports `PASS` with checks `cold`, `warm`, `command`;
local full receipt: `.runtime/ripgrep-direct-fb54a82e-0af2-4c06-9f04-09bf7e44a8d3.json`
under `vivari/`. No OpenCode binary-cache path is provisioned.

This qualifies the command provisioning/search path, not the complete OpenCode
server or permission persistence/multiuser enforcement. The existing packaged
baseline and qualified P1 runtime pin remain until that server regression passes.

## Low-output browser iteration

The browser harness supports one-shot automatic result reporting:

```sh
PORT=43933 bun scripts/serve-ripgrep-direct.ts --once
```

Run the host as a background tool call and navigate once with Browser Control CLI:

```sh
browser-control execute --session <session> 'await page.goto("http://127.0.0.1:43933/?autorun=1"); return page.url()'
```

The page runs the checks, closes its runtime/workspace, and POSTs a run-ID-bound
JSON receipt to the host. The host saves the full result/log under
`vivari/.runtime/ripgrep-direct-<runID>.json`, prints one compact summary and exits
0 for PASS or 1 for failure. A 120-second deadline also fails the host. Tool
completion delivers the result automatically: no Browser Control polling,
screenshots, or repeated full-page log reads are needed. Omit PORT to let the OS
choose an available port and use the printed URL. Use a fresh origin for acceptance.

The reporting failure path was also exercised by repeating the used origin:
the page reported `Use a fresh localhost port for qualification`, the host wrote
the failure receipt and exited 1. That expected failure verifies reporting and
exit-status propagation; it is not a runtime regression.

During compatibility iteration, use the focused native/worker contract first,
then this browser gate when a fix is ready. Read saved logs only after a failure;
retain browser interaction for browser-specific diagnostics and UI workflows.

## Accepted continuation

Runtime commit `05684dbb2d91b51bc129d1275718d555ea3284a5` adds the reusable
`BrotliDecoder` binding over `brotli-decompressor@5.0.3` in the existing codec WASM.
Node's published zlib JS uses this binding for synchronous, callback and Transform
decompression. No ripgrep source or loader was changed.

The general Brotli contract passed against native Node 24.7.0 and guest workers,
including malformed/truncated inputs, output limits, 320,000-byte expansion,
byte-split streaming and reset. The fork's runtime contracts and offline Node suite
also passed during implementation.

The integration build/distribution was regenerated from **clean** runtime source
`b6a5fbe02e64b15397660b624ad7ce4813f5e686` (the Brotli commit plus the independently
tested ESM export-comment fix). Chromium acceptance used:

- Distribution: `445933bcccfa1a2d306905190ee896d10bfc4453cc1b6ccdb1c2aeba6d5dd2fc`
- Fresh origin: `http://127.0.0.1:43931/`
- Browser Control CLI session: `cosmic-falcon-435`
- Nine hash-verified, unchanged package files; `transforms: []`
- Cold and warm completion checkpoints, exact search bytes and no-match exit 1
- Separate guest processes: both exited `{exitCode:0, signal:null, forced:false}`,
  with empty stderr

This removes the demonstrated need for host Brotli decoding, fixed-path loader
rewriting, CJS lowering and `import.meta` substitution for this API workload.
The baseline packager remains in place until ordinary executable discovery and
the full OpenCode workflow pass. The shared qualified runtime pin still identifies
P1; this focused acceptance does not replace that complete server regression.

## First executed blocker

The published `ripgrep@0.3.1` package mounts and imports unchanged in both headless
guest workers and Chromium workers. Its executed dynamic imports reach the cold
WASM cache loader. The first package failure is:

```text
TypeError: binding.BrotliDecoder is not a constructor
  at BrotliDecompress.Brotli (.../node/lib/zlib.js:854)
  at brotliDecompressSync
  at getRgWasmBytes
```

Browser reproduction used the qualified P1 distribution
`028a96fdd9e2c86963e9ca4f2a46f41f16fe40996011caec70d702b45e731aa7`,
fresh origin `http://127.0.0.1:43930/`, Browser Control session
`cosmic-falcon-435`. Both explicit `RIPGREP_DIRECT_IMPORTED` and
`RIPGREP_DIRECT_COLD_START` checkpoints printed; execution exited 1 without forced
termination. This is evidence for implementing the general Brotli binding, rather
than rewriting this package's loader or eagerly decompressing its payload on the host.

## Reproduction

From `browser-container-poc/vivari`, install the pinned probe dependency if needed:

```sh
bun install --frozen-lockfile --cwd probes/ripgrep
```

Use native Node (the bare `node` in some agent shells is a Bun shim):

```sh
~/.nvm/versions/node/v24.7.0/bin/node scripts/probe-ripgrep-direct.mjs
~/.nvm/versions/node/v24.7.0/bin/node scripts/probe-ripgrep-direct.mjs --native
```

The same fixture passes both cold and warm checks on native Node 24.7.0, with
empty stderr and exact result bytes. `--native` uses a private temporary workspace
and WASM cache, copies the original installed packages, and removes its own files.

The headless probe reads installed package files without transformation,
prints their aggregate SHA-256 manifest receipt (`--trace-inputs` includes the full
per-file manifest), and batch-mounts them into the guest filesystem.
It requires completion checkpoints as well as zero exit status. Its cold and warm
checks run in different guest processes sharing one fresh filesystem, so the warm
check exercises the disk cache rather than the first process's module cache.

For browser qualification, first build the runtime and workspace distribution
using [DEVELOPMENT.md](../vivari/DEVELOPMENT.md), then:

```sh
PORT=43933 bun scripts/serve-ripgrep-direct.ts
```

Use a fresh port for every browser run. Open `/` using Browser Control CLI, then
start asynchronously to avoid stranding a long call:

```js
await page.evaluate(() => {
  window.ripgrepDirectResult = { status: 'running' }
  window.qualifyRipgrepDirect().then(
    result => window.ripgrepDirectResult = result,
    error => window.ripgrepDirectResult = { status: 'FAIL', error: String(error) },
  )
})
```

Read `window.ripgrepDirectResult` and the page's `pre` log after completion.
The server bundles only the embedding harness, never the guest package. Package
files are delivered verbatim and checked against a hash manifest before installation.

## Scope

`probes/runtime/ripgrep-direct.mjs` is the same guest fixture in headless and browser
runs. It calls the published API with `buffer:true, nodeWasi:false`, explicitly
selecting the package's own WASI shim. It checks exact search bytes, no-match exit 1,
cache creation, and a second-process warm-cache search. No special CJS lowering,
`import.meta` substitution, loader rewrite, or host-side Brotli decoding is used.

The additional `ripgrep-command.cjs` fixture qualifies the command path described
above. Neither fixture qualifies all ripgrep flags, stdin, the package's native
Node-WASI path, OpenCode integration, or persistence across runtime reopen.
The OpenCode regression remains a separate gate in
[the case study](opencode-runtime-case-study.md).
