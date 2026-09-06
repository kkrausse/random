# OpenCode compatibility checkpoint — 2026-09-06

## Current result

**The real pinned OpenCode Node and Bun SQLite Effect adapters pass in Chrome.**
Normal SDK host import is now attempted using host-side packaging, but still
fails before `OpenCode.create()`: the package is missing tree-sitter WASM assets.
No host, session, full migrations, tools, model calls, or credentials were used.

This is a compact/resume checkpoint, not a completed host milestone. Continue
the agreed mainline SDK direction; no architecture change has been made.

## Passing evidence

- `@opencode-ai/core@0.0.0-dev-19167`'s actual `database/sqlite.node` and
  `database/sqlite.bun` implementations run through their own Effect SQL layers
  over the shared SQLite WASM backend, inside a Vivari `bun` process.
- Both adapters: default writable constructors and WAL request, parameterized
  INSERT, committed transaction, deliberately failed transaction/rollback,
  exact BigInt `9007199254740993`, BLOB `[0,127,255]`, object and array result
  rows, scoped close, and reopen all pass. This does not establish WAL support;
  the underlying backend still returns memory journal mode.
- Both recover the committed rows in a separate process **after page reload and
  runtime rebuild**, without rewriting the database. Final recovery package
  SHA-256: `fcf315009f631b214b36990147cf9c5b1acc0f62d809c6ad8a763d3a97f13c5a`.
- Added correct non-single-executable `node:sea` behavior: `isSea()` false;
  asset methods throw `ERR_NOT_IN_SINGLE_EXECUTABLE_APPLICATION`. Compared with
  host Node 24.18.0 and checked under both guest `node` and `bun`, headlessly
  and in Chrome. This is feature detection, not a native executable substitute.
- Reproducible patched source build, upstream `verify-node.mjs` (90 processes),
  extended headless SQLite API/ownership/restart suite, and patched harness
  TypeScript/production build all pass. SQLite engine/FS worker code is unchanged
  in this continuation; the browser OPFS fault suite was not rerun.

## Packaging and exact failing checkpoint

`scripts/package-opencode.ts` uses the existing frozen inspection installation:
Bun 1.4.0 bundles the normal host probe for Node conditions, matching current
Vivari resolution. TypeScript 5.9.2 lowers that single module to CommonJS within
an async wrapper. Imported package implementations are not edited. `import.meta`
is bundle-relative; only URL and a require-resolution-based helper are provided.
This is provisional packaging, not full import.meta/ESM compatibility.

The same pinned jsonc-parser's published ESM distribution replaces its UMD
entry **for packaging only**. Bun had left that UMD factory's aliased relative
`require('./impl/format')` unresolved in the bundle. Native FFF/PTY dependencies
remain external and unimplemented; no successful stubs were introduced.

Host bundle: 32,446,661 bytes, SHA-256
`bf953871755f34d58ed6a2918784cd1f0ab37b5cdeb60955621706c3c35414fe`.
Inspection lock SHA-256:
`15589f146885cfd797b9d7a46fb831a9f12c42aec9b9679a6deab615e5bedf28`.
The runner fetches assets same-origin, writes 256 KiB pieces, assembles via guest
fd IO, and now verifies SHA-256 in both browser and guest. It checks explicit
success markers as well as exit status. Generated bundles/receipts are ignored.

Last host output after fixing `node:sea` and jsonc-parser packaging:

```text
checkpoint: delivered 32446661
checkpoint: importing SDK
Error: Cannot find module 'web-tree-sitter/tree-sitter.wasm' from '/opencode-packaged'
```

Source: official `core/dist/shell/parser-wasm.node.js` resolves three assets at
module initialization:

- `web-tree-sitter/tree-sitter.wasm`
- `tree-sitter-bash/tree-sitter-bash.wasm`
- `tree-sitter-powershell/tree-sitter-powershell.wasm`

**Resume here:** package those pinned real WASM files, preserving their VFS
`node_modules/<package>/...` resolution paths, hashes, and licensing. Extend the
existing chunked delivery for assets larger than the SAB window. Photon also
ships `@silvia-odwyer/photon-node/photon_rs_bg.wasm`; inspect requirements when
reached. Then retry normal host import/create before expanding other subsystems.
Do not treat tree-sitter delivery as proof that its WASM actually initializes.

## Assumptions and feasibility flags

1. **Exit zero is insufficient.** The initial plain 28 MB ESM bundle exited zero
   without executing the entry checkpoint, under both guest `bun` and `node`.
   A wrapper's awaited dynamic import also reported success without the inner
   checkpoint. Root cause is not isolated. The runtime documents incomplete
   non-entry top-level-await semantics; the actual Node FFF adapter uses TLA.
   Parser-based host packaging gets further, but unbundled mainline loading is
   still unqualified. Preserve checkpoint assertions.
2. **Large SDK mount silently drops writes.** `vm.mount`/SDK `writeFile` returned
   while kernel logging reported `kernel fs request too large for the shared
   data region`; the file was absent. Chunked delivery plus guest digest checks
   avoid that issue. The underlying SDK API still needs generic error propagation.
3. **Bun remains a Node-backed API shim.** This work proves real OpenCode Bun
   SQLite adapter behavior, not stock Bun execution or general Bun conformance.
4. **Native dependencies remain real work.** Both process-lock adapters need
   libc flock contention and FD-close/process-death release. PTY needs a genuine
   backend; search needs FFF or verified ripgrep fallback. No evidence here makes
   browser compatibility infeasible, but no basis exists to call the remaining
   work a few trivial shims. Generic native FFI remains outside the agreed slice.
5. **Module import ordering matters.** Static source inventory does not show
   when optional/lazy services execute. The SDK's bundled PTY service loads its
   native adapter lazily, though that adapter itself loads node-pty eagerly.
   Advance using actual failure traces rather than assuming every native import
   must be implemented before host creation.

## Reproduction and live environment

From `browser-container-poc/vivari`:

```sh
# If needed, restore the already pinned inspection tree first:
# (in probes/opencode) bun install --frozen-lockfile
bun scripts/package-opencode.ts host
bun scripts/package-opencode.ts sqlite-adapter
```

Use patched server port 5192. Current session `tidy-otter-432` is booted at
**http://127.0.0.1:5192/**, a separate OPFS origin from earlier localhost work.
It has the fixture mounted but Vite is not running in this new origin.
Current workers: `process-worker-D7-JlnGr.js`, `fs-worker-BDLnKstk.js`, kernel
`kernel-worker-CSI16vko.js`.

From repo root:

```sh
browser-control execute --session tidy-otter-432 'state.opencodeEntry="host"; state.opencodeRecover=false'
browser-control execute --session tidy-otter-432 --file browser-container-poc/vivari/scripts/opencode-packaged.js
browser-control execute --session tidy-otter-432 'return await page.evaluate(()=>window.packagedProbe)'
# Adapter write + close/reopen: opencodeEntry="sqlite-adapter", opencodeRecover=false.
# Recovery-only (after reload and boot): same entry, opencodeRecover=true.
```

Final CLI state currently selects adapter recovery. `state.hostPackageResult`
and `state.adapterResult` retain prior reports. `window.packagedProbe` contains
passing recovery on the rebuilt runtime. Raw combined evidence:
`logs/vivari/1788680260129-opencode-packaging.json` (ignored).

Browser Control 0.7.0 lost/replaced its session page during large evaluate
delivery; old localhost targets still exist and one kernel holds the origin
Web Lock. A newly booted localhost kernel therefore lacked durable persistence.
No old tabs were deleted. Moving this continuation to 127.0.0.1 isolated it and
recovered adapter persistence. See `vivari/browser-control.todo.md`; inspect
sessions/targets/origin before resuming. Do not reset OPFS to resolve this.
