# September 11 clean-source build handoff

**BUILD_PASS: one offline build, exit 0.** This artifact is ready as an input to
the next browser gate; it has not been executed or browser-qualified here.

Retained temporary root (do not remove before that gate):

```text
/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/clean-build.x7j1u24y
```

Paths relative to that root:

- Artifact directory: `.runtime/opencode-bun-server/`
- Build-time receipt: `receipt.json` (outside emitted output)
- Exact build log: `build.log`
- Detached source worktree: `.runtime/opencode-v2-source/`
- Exact copied recipe: `experiments/opencode-bun-server/{server.ts,build.ts,package.json}`
- Copied-image content manifest: `dependency-content.jsonl`
- Complete symlink audit: `symlinks.json`
- Accepted-versus-clean JS diff: `accepted-server.diff`

## Provenance

Before and after the build, clean source HEAD was
`d7a7256bb6b0952f486c95718cfbf460b1570a56`, tree
`f4999819e778ae35433716c72f643c1eaf1a30ba`, with empty Git status and lock SHA-256
`b6ebc10fd743b192bf81437c0e95a89b850daffa6cfe9de0ba6491c13f1c3764`.
The original checkout's preexisting TUI edit, Git diff hash, and accepted artifact
hashes match before/after. No runtime source or pin changed.

Copied 43 installed dependency roots using macOS `/bin/cp -cR -P`, preserving
symlinks without linking dependency roots back to the dirty checkout. All
**12,835 symlinks** audited resolve inside clean source; none dangle or escape.
This includes workspace-relative links and the experiment's two dependency links
to clean `packages/cli` and `packages/cli/node_modules/effect`.
The manifest hashes **225,320 regular files / 3,479,983,315 logical bytes**.
It identifies the copied local image; it does **not** verify registry integrity
or compare every copied file against the original image. No fresh-install or
package-integrity claim is made. No install, network, or native build scripts ran.

Builder: `/opt/homebrew/bin/bun`, resolving to
`/opt/homebrew/Cellar/bun/1.3.9/bin/bun`, which actually reports
**1.4.0+34cbb9a40**. Binary SHA-256:
`539598c775882420b9d8deb7dc14d845f20f7d26f5600c50ab067dde6ac3f3bf`.
Upstream declares `bun@1.3.14`; this is a recorded toolchain mismatch, not a
build under that declared version.

Exact command: `/opt/homebrew/bin/bun run build`, in the copied experiment.
One attempt, **0.497 seconds**, exit **0**. Copy took **42.08 seconds**;
copy/audit/hash/build receipt elapsed **89.42 seconds** (later comparison and
documentation excluded). The recipe is unchanged: Node target, published
jsonc-parser ESM resolver hook, three original WASM copies, no further rewrites.
Inspection found the ESM main/scanner/string-intern/format/parser/edit modules,
with no UMD main or dangling `require2("./impl/format")` match.

Exact recipe SHA-256:

| File | SHA-256 |
| --- | --- |
| `server.ts` | `2703ce3baeba1af96745ec22c8eda80fc7af4a146bd7e3a40ae4cbc4011f2ede` |
| `build.ts` | `431c02871642566da0209fddd67aadb42f516b599cff3d98a620c4927157f0fa` |
| `package.json` | `9e18749e47c8ef7b3f51aa68a3837428857bc46722afc8d6c4f5d970c7f68223` |

## Outputs and comparison

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `server.js` | 28,339,477 | `1281158d5c583e49b5e20eab2705b35fb902fb729dd2635cf0d29f8c6a0eb115` |
| `ffi-rs.darwin-arm64-r0yfvhwh.node` | 705,384 | `47b518f1ee334248b7bd7ce1d0788e9d9a0b8c759056b600e9d04da16fa542bc` |
| `tree-sitter.wasm` | 205,488 | `f38dcc4b43b818f9a0785bc1c6d5611a75ac4cdd428ff3f02757c34ca4e46d7f` |
| `tree-sitter-bash.wasm` | 1,380,769 | `364f0a2cd385c792239423026ef442dbd073d34c396b7bc9e5932426b8e4aa5d` |
| `tree-sitter-powershell.wasm` | 983,236 | `1d30b5a21866354aa2eb94845556f1e19126ff00e3335048719a0e6435b1c154` |

All three WASM files equal their resolved installed originals by SHA-256.
All four non-JS files equal the accepted outputs. Accepted JS remains
`765dd1b67583b645a01e904cdc0de525487e1b5c15db2b281ecad83fa5a5f059`.
The JS diff is exactly **12 absolute source-path occurrences across 11 lines**,
in bundled dependency `__dirname`, `__filename`, and `require.resolve` values.
Replacing just the old/new source-root prefixes **in memory** produces identical
bytes. These are runtime-valued paths, not merely source comment labels:
this establishes the narrow textual difference, not runtime equivalence.
Emitted files were never rewritten. The next browser gate must use the raw clean
artifact and obtain its own acceptance receipt.

## Repeating the preparation

From this directory: `python3 clean-build.py`. It retains a new detached worktree,
copied dependency image, artifact directory and external receipt each time.
It requires the existing installed image, macOS clone-copy support, Python 3.9+
and the observed Bun revision. It never removes old checkouts or accepted outputs.
Run normally, without Python's `-O` flag (guards use assertions).

The helper ran successfully once. Its post-build preservation enforcement and
in-memory comparison were then added and syntax-checked; those same checks were
performed separately on the retained artifact and added to the receipt, without
another build. The receipt notes that later read-only comparison explicitly.
