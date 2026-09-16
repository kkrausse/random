# Prepared workspace download

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

It then resets the prepared tree, decompresses with `DecompressionStream`, and installs files with at most
eight concurrent operations. Each file still receives its SHA-256 check, and
OpenCode files retain their installed-byte readback check. Metadata installation
runs only after every file succeeds; failures drain outstanding operations before
returning. User source and database retention semantics are unchanged.

The cache contains only the original prepared archive. `node_modules` is already
excluded from the runtime's OPFS mirror; generated dependencies and Vite's
dependency cache remain disposable. Source edits and conversation state still
live in the browser's existing durable workspace, not on the application server.
Cache hits eliminate repeat bundle downloads, not unpacking or runtime file writes.
The Activity log distinguishes checking the cache, downloading, using a cached
bundle, unpacking, and installing files. This is not a mountable filesystem image.

To discard only the original bundle cache, delete
`browser-editor-prepared-bundles-v1` under DevTools → Application → Cache Storage.
That leaves source/conversation storage intact. Exit and reopen the editor to
reinstall dependencies and recreate Vite's dependency cache while preserving edits.

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

File views must be copied into file-sized buffers before `installFile`: worker
`postMessage` structured cloning copies the entire backing ArrayBuffer, including
bytes outside a subarray view. The initial bundle implementation missed this and
could clone the whole ~171 MB bundle on every file write. The installer now slices
each file immediately before crossing the worker boundary, with at most eight
installs in flight. A regression test checks the cloned backing-buffer size using
a multi-file bundle.

To activate for a consumer, rebuild the `opencode-chat` package, refresh its local
file dependency as usual, rerun `bun run prepare:editor` in the application, and
rebuild the application client. Existing generated preparations do not acquire a
bundle until regenerated. No runtime rebuild is needed.

The built toolkit now includes the verified application payload beside its
preparer. TODO preparation resolves it from the installed package automatically;
`OPENCODE_PACKAGE_DIR` is only an optional custom-build override.
