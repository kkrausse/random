# Unmodified ripgrep investigation

September 11, 2026. **Unchanged-package cold/warm API acceptance passed in Chromium**;
separate from packaged OpenCode acceptance.

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
and WASM cache, links the original installed package, and removes its own files.

The headless probe reads all nine installed package files without transformation,
prints their SHA-256 input receipt, and batch-mounts them into the guest filesystem.
It requires completion checkpoints as well as zero exit status. Its cold and warm
checks run in different guest processes sharing one fresh filesystem, so the warm
check exercises the disk cache rather than the first process's module cache.

For browser qualification, first build the runtime and workspace distribution
using [DEVELOPMENT.md](../vivari/DEVELOPMENT.md), then:

```sh
PORT=43932 bun scripts/serve-ripgrep-direct.ts
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

This API probe does not qualify executable permissions/PATH discovery, all ripgrep
flags, stdin, the package's native Node-WASI path, OpenCode integration, or persistence
across runtime reopen. Ordinary command provisioning and the OpenCode regression
remain separate gates in [the case study](opencode-runtime-case-study.md).
