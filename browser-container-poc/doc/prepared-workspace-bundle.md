# Prepared workspace delivery and startup

The editor preparer now emits a content-addressed `.bundle.gz` alongside the v2
manifest and individual content-addressed assets. The bundle concatenates unique
file contents in manifest order, gzip-compressed. The manifest supplies file
lengths, hashes, paths, modes and symlinks; no archive library is needed in the
browser. Existing prepared manifests remain supported.

Startup checks the browser's `browser-editor-prepared-bundles-v1` CacheStorage
cache for the content-addressed bundle, downloading on a miss. Both cache hits
and downloads receive compressed-byte length and SHA-256 checks. Corrupt cache
entries are discarded; unavailable/quota-limited cache storage falls back to the
verified download. A successful cache write replaces older bundles for the same
preparation base URL, bounding retained versions to one.

It decompresses with `DecompressionStream`, then calls `ToolContext.installTree`
with the complete disposable tree. All file views share the archive buffer, so
the page clones it once; the supervisor transfers it once to the FS worker. The
worker checks paths, roots, links and SHA-256 hashes (eight concurrent hashes,
deduplicated by buffer range) **before** resetting anything. It performs reset,
directory creation, file writes, symlinks and chmod directly against the VFS.
OpenCode retains installed-byte readback verification, now inside the FS worker.
Only one watch invalidation per root is emitted. No per-file stat/write RPCs or
guest metadata processes are needed. This is a pre-launch bulk replacement, not
an atomic live mount; a write failure rejects and retry must replace the tree.
Legacy preparations without a bundle retain the old bounded per-file path.

The cache contains only the original prepared archive. `node_modules` is already
excluded from the runtime's OPFS mirror; generated dependencies remain disposable.
Vite now stores its derived cache at `/workspace/.browser-editor-cache/vite`,
outside node_modules, so it survives reload in the existing OPFS mirror. The
recipe resets only this cache directory when runtime version or prepared bundle
identity changes, or when its preparation marker is absent. Vite still owns its
normal lock/config-hash checks and new-import discovery. The cache is excluded
from application source scanning and is flushed after preview readiness.
Source edits and conversation state still
live in the browser's existing durable workspace, not on the application server.
Bundle cache hits eliminate repeat downloads; a bulk VFS load still occurs.
The Activity log distinguishes checking the cache, downloading, using a cached
bundle, unpacking, and bulk loading, including verification/install/readback
timings. This is not a mountable filesystem image.

To discard only the original bundle cache, delete
`browser-editor-prepared-bundles-v1` under DevTools → Application → Cache Storage.
That leaves source/conversation storage intact. Exit and reopen the editor to
reload dependencies while reusing the matching Vite cache and preserving edits.

Browser check on a task-owned `http://localhost:4394` host: the first editor open
requested the manifest plus the 36,962,513-byte bundle and populated CacheStorage.
After Exit and a full page reload, opening the editor requested only the manifest,
logged `Using cached prepared workspace bundle`, and progressed through file
installation without any bundle or `.bin` network requests. This verifies cache
reuse across document reloads, not an end-to-end service startup benchmark.

Measured against the local TODO preparation on September 15, 2026:

- 10,469 tree entries, including 8,847 files / 8,278 unique contents.
- Unique uncompressed contents: 171,488,154 bytes.
- Compressed bundle: 37,251,055 bytes.
- File payload requests: 8,847 → 1 (plus the existing manifest request).

These are payload measurements, not browser startup timing results. Individual
filesystem writes, per-file verification, and service startup still happen.
Decompression currently holds the complete uncompressed bundle in browser memory.

The earlier per-file loader required file-sized buffers before `installFile`: worker
`postMessage` structured cloning copies the entire backing ArrayBuffer, including
bytes outside a subarray view. The initial bundle implementation missed this and
could clone the whole ~171 MB bundle on every file write. The bulk API instead
delivers all views in one structured clone, which preserves their shared backing
buffer. The regression test checks shared-buffer identity after cloning multiple
file views; worker tests exercise >1 MiB binary bytes, subarrays, links, permissions,
source retention, invalid roots, corruption-before-reset and tree replacement.

To activate bulk delivery, rebuild the Vivari fork with the integration build,
package `workspace-api/dist/runtime`, rebuild the workspace and opencode-chat
libraries, refresh consumer dependencies, rerun `bun run prepare:editor`, and
rebuild/restart the application. The distribution advertises `install-tree-v1`;
an older runtime fails promptly with a rebuild instruction rather than hanging on
an unknown worker message. Preparations remain bound to the exact runtime version.

The built toolkit now includes the verified application payload beside its
preparer. TODO preparation resolves it from the installed package automatically;
`OPENCODE_PACKAGE_DIR` is only an optional custom-build override.

## Bulk startup browser qualification — September 15, 2026

Runtime fork commit: `0b35f2e` (bulk tree API and real-FS-worker tests).
The recipe starts Vite and OpenCode concurrently after delivery and drains both
startup attempts before reporting a failure, retaining their normal client/health
readiness gates and graceful shutdown. A failed tree install stops that runtime
so retry actually redelivers the tree instead of launching partial contents.

Task-owned TODO host `http://localhost:4392`, Browser Control CLI, existing source
tree and 8,851–8,852 prepared files (the new cache helper accounts for one file):

| Measurement | Result |
| --- | --- |
| Original sequential startup | ~40s to Ready; ~22s delivery; ~15s preview; ~3s OpenCode |
| Bulk install, repeated runs | ~4.2–4.4s VFS work, 0.1–0.4s verification, ~0.1s readback |
| Final cold cache startup with concurrent services | ~30s to Ready |
| Final full reload with both caches | 27.3s to Ready; 4.7s bulk operation; services ready after 12.9s (OpenCode) / 17.7s (preview), overlapping |

Warm reload requested zero `.bundle.gz` or prepared `.bin` payloads. The persisted
Vite `_metadata.json` was byte-equivalent as parsed JSON across reload (browserHash
`46b5e2ca`), proving the optimizer cache was reused, not merely its identity marker.
Both runs reached OpenCode Ready and the preview iframe rendered the TODO form.
These are local observations, not a controlled performance guarantee: workspace
restore and service startup vary, and preview startup remains the dominant cost.

Checks: fork Node worker tests (large binary/subarray delivery, permissions, links,
root invalidation and rejection before reset); workspace unit/type and real-worker
contracts; opencode-chat unit/UI/type checks; TODO production build and browser
cold/reload qualification. One pre-existing opt-in retained-candidate test is skipped
in the default chat suite.
