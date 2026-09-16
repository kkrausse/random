# Prepared workspace download

The editor preparer now emits a content-addressed `.bundle.gz` alongside the v2
manifest and individual content-addressed assets. The bundle concatenates unique
file contents in manifest order, gzip-compressed. The manifest supplies file
lengths, hashes, paths, modes and symlinks; no archive library is needed in the
browser. Existing prepared manifests remain supported.

Startup downloads and checks the compressed bundle before resetting the prepared
tree, decompresses it with `DecompressionStream`, and installs files with at most
eight concurrent operations. Each file still receives its SHA-256 check, and
OpenCode files retain their installed-byte readback check. Metadata installation
runs only after every file succeeds; failures drain outstanding operations before
returning. User source and database retention semantics are unchanged.

Measured against the local TODO preparation on September 15, 2026:

- 10,469 tree entries, including 8,847 files / 8,278 unique contents.
- Unique uncompressed contents: 171,488,154 bytes.
- Compressed bundle: 37,251,055 bytes.
- File payload requests: 8,847 → 1 (plus the existing manifest request).

These are payload measurements, not browser startup timing results. Individual
filesystem writes, per-file verification, and service startup still happen.
Decompression currently holds the complete uncompressed bundle in browser memory.

To activate for a consumer, rebuild the `opencode-chat` package, refresh its local
file dependency as usual, rerun `bun run prepare:editor` in the application, and
rebuild the application client. Existing generated preparations do not acquire a
bundle until regenerated. No runtime rebuild is needed.
