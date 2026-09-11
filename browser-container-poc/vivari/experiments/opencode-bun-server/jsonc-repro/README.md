# jsonc-parser UMD bundle reduction

September 11, 2026. Native-only test of pinned `jsonc-parser@3.3.1` from the
existing OpenCode install (`d7a7256bb6b0952f486c95718cfbf460b1570a56`, upstream
lock SHA-256 `b6ebc10fd743b192bf81437c0e95a89b850daffa6cfe9de0ba6491c13f1c3764`).

From `browser-container-poc/vivari`:

```sh
NODE_BINARY=/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node bun experiments/opencode-bun-server/jsonc-repro/run.ts > .runtime/jsonc-native-repro.log 2>&1
```

The runner copies the installed package into a temporary build directory, builds
the small parse/edit invocation, and executes from sibling directories outside
the original dependency tree. The bundled execution directory has only JS and
`package.json`; the other variants receive their own unchanged package copy.
Child processes receive only PATH, temporary HOME and TMPDIR, with 30-second
timeouts. The printed temporary directory retains artifacts for inspection.
No OpenCode application process is launched.

## Executed results: Bun 1.4.0, Node 24.7.0

| Delivery | Native Node | Native Bun |
| --- | --- | --- |
| `bun build ./entry.ts --target=node --outdir=<isolated-directory>` | Exit 1: missing `./impl/format` | Exit 1: missing `./impl/format` |
| Same command plus ordinary `--packages=external`, package copied into local `node_modules` | Exit 0, `JSONC_PARSE_EDIT_DONE` | Exit 0, `JSONC_PARSE_EDIT_DONE` |
| Unbundled invocation, package copied into local `node_modules` | Exit 0, `JSONC_PARSE_EDIT_DONE` | Exit 0, `JSONC_PARSE_EDIT_DONE` |

The runner checks these outcomes and emits `JSONC_REPRO_DONE`. The operation
parses commented JSON, edits a property, reparses it, and checks that the comment
survives. Native Bun/Node both run the emitted JS, not the original TS entry.

## Why a runtime loader cannot recover this artifact generically

The vanilla bundle contains two modules (entry plus UMD main), and only one
output file. Its operative code is:

```js
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = createRequire(import.meta.url);
// node_modules/jsonc-parser/lib/umd/main.js
var require_main = __commonJS(function(exports, module) {
  // ...
  var v = factory(__require, exports);
  // ...
  // inside factory(require2, exports2):
  const formatter = require2("./impl/format");
});
```

`import.meta.url` identifies the emitted entry file. The wrapper's module object
contains `exports`, not an original filename or original require base. The
package path survives only as a comment, not module-resolution metadata.
The factory receives the bundle-relative require, and the bundle omits the
`impl/format`, `edit`, `scanner`, `parser` source files. Even delivering the
original package under `node_modules` alone would not change this already-bundled
relative require's base.

Vivari's `packages/runtime/module.js` likewise binds `Module.createRequire`
through `makeRequire` to the supplied file's directory. The observed `/app`
resolution agrees with both native runtimes. Inferring identity from comments,
stack positions, or package-specific redirects would add nonstandard recovery
and still require omitted source delivery. No generic Vivari discrepancy is
demonstrated here; there is no basis for a runtime shim in this slice.

## What the earlier baseline actually did

`scripts/package-opencode-server.ts:41` has an `onResolve` for `/^jsonc-parser$/`
that resolves the normal entry then selects `../esm/main.js`. Version 3.3.1
publishes both `main: ./lib/umd/main.js` and `module: ./lib/esm/main.js`.
That hook selects an **existing published ESM entry**, rather than replacing or
editing package source. It is still package-specific consumer resolution policy;
this reproduction does not invoke it or silently select the ESM file.

## Smallest supported conventional remedy

For this reduced program, ordinary **external-package delivery** works:
`--packages=external` leaves the application import intact and the normal package
layout provides UMD-relative source identity and files. It changes build/delivery
configuration while keeping application and dependency code unchanged.

For a selective server bundle, a normal CLI `--external=jsonc-parser` plus delivery
of its unchanged package would be the narrower conventional candidate; that
specific flag and the full server were **not tested** here. The all-package
external reduction does not establish that OpenCode's workspace TS packages run
without further transpilation or generic delivery. A future bounded server trial
can test selective external delivery before considering any loader work.
Choosing published ESM via explicit build policy is another entry-selection
option, but no such switch was made or qualified in this experiment.
