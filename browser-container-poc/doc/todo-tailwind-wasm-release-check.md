# TODO Tailwind WASM: bounded upstream release check

September 11, 2026 local time; authoritative npm registry responses are dated
**September 12, 2026, 02:03:25–26 UTC**. Follow-up to
[the scanner root-cause report](todo-tailwind-hmr-root-cause.md).

## Result

**No newer fixed release was verified.** Latest stable is still **4.3.3**. The
current insiders release, **0.0.0-insiders.41d9cae**, reproduces the same failure
with the published WASM package on native Node: the first scan succeeds, all
subsequent scans on that instance lose the discovered files and miss new candidates.

A targeted older control, **4.1.18**, does discover new candidates through repeated
edits and addition of a file. It predates the parallel-walker optimization. This is
an older artifact with working candidate rescanning in this fixture, **not a newer
fix or a qualified project-compatible downgrade**: its `files` list accumulates
duplicates/stale paths, and it does not expose `scannedFiles`.

Recommendation: carry the explicit upstream WASM incremental-scanning blocker while
proceeding with unrelated Node/OpenCode TODO integration. Keep CSS-HMR acceptance
open. A native Node path using the native addon is not subject to this demonstrated
WASM defect. Overall browser integration remains qualified only by its prior checks.

## Actual published releases

Full packuments were fetched directly from `https://registry.npmjs.org/` for
[`tailwindcss`](https://registry.npmjs.org/tailwindcss),
[`@tailwindcss/oxide`](https://registry.npmjs.org/@tailwindcss%2foxide), and
[`@tailwindcss/oxide-wasm32-wasi`](https://registry.npmjs.org/@tailwindcss%2foxide-wasm32-wasi).
All three have `latest=4.3.3` and `insiders=0.0.0-insiders.41d9cae`.
Their version inventories contain no later stable release.

| Package | 4.3.3 publication (UTC) | Current insiders publication (UTC) |
| --- | --- | --- |
| Tailwind | 2026-07-16 12:03:35.267 | 2026-09-08 13:59:34.541 |
| Oxide | 2026-07-16 12:03:29.017 | 2026-09-08 13:59:27.818 |
| Oxide WASM | 2026-07-16 12:04:17.028 | 2026-09-08 13:59:20.266 |

Tailwind/Oxide's `next` tag is the older `4.0.0`, not a newer prerelease.
WASM 4.1.18 was published December 11, 2025, 16:41:15.266 UTC.

## Published-artifact comparison

Downloaded and extracted the three registry tarballs into an isolated temporary
directory; verified their SHA-1 against registry `dist.shasum` and recorded their
SHA-256, registry integrity, binary hashes, and publication metadata. Used each
package's unchanged CJS loader and bundled dependencies. No install or dependency
change in the project was needed.

Runtime: **Node v24.13.0, darwin arm64**, explicitly invoked from
`/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/node-v24.13.0-darwin-arm64/bin/node`.
This is the same host runtime as the original independent reproduction, not the
fork's qualified v24.18.0 suite. A preliminary shell `node` invocation resolved to
Bun 1.4.0 and failed before scanning (`wasi.initialize` absent); it is excluded
from the Node results. Every result below was rerun with the explicit Node binary.

The small fixture reuses one `Scanner({ sources: [{ base, pattern: '**/*',
negated: false }] })`. Each write explicitly advances mtime by two seconds to avoid
timestamp-resolution ambiguity. Records include source text, mtime, candidates,
`files`, and `scannedFiles` where available. All four Node processes exited naturally
with status 0; WASM emitted Node's ordinary experimental-WASI warning.

| Operation | WASM 4.3.3 | WASM current insiders | WASM 4.1.18 | Native addon 4.3.3 |
| --- | --- | --- | --- | --- |
| Initial `flex` | Found, one file | Same | Same | Same |
| Unchanged repeat | Zero files | Zero files | File retained | File retained, zero changed |
| Edit to add `text-[37px]` | Missing | Missing | Found | Found, one changed |
| Second edit to `text-[41px]` | Missing | Missing | Found | Found, one changed |
| Add file with `grid p-[19px]` | Missing | Missing | Found | Found, two files, one changed |
| Delete added file | Files remain empty | Files remain empty | Stale path retained | File list returns to one |
| Edit remaining file to `text-[43px]` | Missing | Missing | Found | Found, one changed |
| Fresh diagnostic scanner | Finds current candidate | Same | Same | Same |

Candidates are intentionally accumulated: the native control also retains previously
seen candidates after class/file removal. That alone is not a failure. The 4.1.18
`files` lengths are 1, 1, 2, 3, 4, 4, 5 across the seven reused-scanner checkpoints;
duplicate/stale paths prevent claiming file-list parity with current native Oxide.
Fresh scanners were diagnostic controls only.

| WASM package version | Binary bytes | Binary SHA-256 |
| --- | ---: | --- |
| 4.3.3 | 1,715,887 | `96754f9b8b5a755bd5df3ffe84dfd64fdba217f058256740ae5e4b5d3d0d11d2` |
| 0.0.0-insiders.41d9cae | 1,747,982 | `648cdf29afce1ab6787bd7af7cc9771594ce791055a3421c56ea8102ead56023` |
| 4.1.18 | 1,749,048 | `2aab22dc666fd1d1b6d48b1d9181a2598b74b06f712049d18477408fb1163aeb` |

## Upstream changes and issue search

- [PR #19632](https://github.com/tailwindlabs/tailwindcss/pull/19632), merged
  February 17, 2026 (`095ff96ba35de0824313fd150b6e70695d300dd1`), introduced
  synchronous initial walking followed by parallel incremental walking. Its stated
  aim was large-project performance. This supplied a specific reason to test the
  last 4.1 release rather than conduct a broad version bisection.
- [PR #20383](https://github.com/tailwindlabs/tailwindcss/pull/20383), merged
  August 4, adds WASM fallback installation/loading and narrower WASI preopens.
  It addresses unsupported native platforms and sandbox loading, not this
  incremental discovery failure.
- [PR #20409](https://github.com/tailwindlabs/tailwindcss/pull/20409), merged
  August 13, rebases vendored `ignore` from 0.4.24 to 0.4.33. The unsupported
  platform branch is still present in current insiders.
- Insiders commit resolves to `41d9cae8e53378d16087fcf359eb785c2fd42ce4`.
  Its [scanner lines 387–390](https://github.com/tailwindlabs/tailwindcss/blob/41d9cae8e53378d16087fcf359eb785c2fd42ce4/crates/oxide/src/scanner/mod.rs#L387-L390)
  still switch to `walk_parallel` after the first scan; its
  [walker lines 425–438](https://github.com/tailwindlabs/tailwindcss/blob/41d9cae8e53378d16087fcf359eb785c2fd42ce4/crates/ignore/src/walk.rs#L425-L438)
  still reject non-Unix/non-Windows root construction.
- Bounded GitHub issue/PR searches for `repo:tailwindlabs/tailwindcss wasm scanner`
  and `repo:tailwindlabs/tailwindcss "unsupported platform"`, plus recent scanner
  and walker commit histories, found no specific published correction for this
  defect. This is a search result, not a claim that no report or fix exists anywhere.

## What a user experiences with the current browser setup

- **Initial CSS:** initial scanning succeeds. Prior browser evidence contains
  generated initial utilities and installed CSS. The defect does not imply a blank
  or universally unstyled first render.
- **Reuse of already-generated classes:** adding/removing/toggling a class whose
  rule is already installed does not require a new candidate. It should use that
  existing CSS normally, subject to normal selector/cascade behavior. This is an
  inference from the failure boundary, not a new end-to-end test of every edit.
- **New utility candidates:** adding a class absent from the scanner's accumulated
  candidates fails to generate its CSS on ordinary source HMR. The DOM can update
  while styling stays stale: the recorded `text-[37px]` edit reached the DOM but
  the rule never appeared and computed size stayed 16px.
- **Ordinary JS/React edits:** this scanner failure does not prevent the JS update
  mechanism itself. Prior evidence shows the source change, watcher event, JS HMR,
  and changed DOM. It does not prove all application behavior or React edit cases.
- **Fresh scanner/restart:** a fresh scanner sees the edited files and candidates.
  A dev-server restart that creates a fresh scanner should recover discovery at
  that boundary; that is not ordinary HMR, nor was full restart-to-applied-CSS
  recovery tested here. Reloading the browser alone need not replace the scanner
  retained in the running Vite process.
- **CSS-only edits:** direct CSS declarations do not inherently depend on finding
  new source candidates, and some CSS changes can rebuild compiler/scanner state.
  Their actual delivery/application remains unqualified. The earlier CSS-HMR
  response was unchanged, so it could not test installation of genuinely changed
  CSS. Do not claim CSS-only HMR either universally broken or proven working.

## Evidence and scope

Retained read-only investigation evidence under
`vivari/.runtime/todo-tailwind-hmr-investigation/2026-09-11/release-check/`:
full registry packuments, registry summary, four Node receipts, download/probe
scripts, three artifact provenance records, upstream API responses/source files,
and `SHA256.json`. Original tarballs and extracted packages remain in approved
temporary directory `tailwind-release-check.5bmk3I` under the OpenCode temp root.
Fixture directories were removed after each completed probe.

No project source, dependency, lockfile, runtime, pin, generated distribution, or
scanner workaround changed. No new browser qualification was performed. The
pre-existing untracked `vivari/scripts/probe-tailwind-direct.mjs` was preserved.
This report is the only tracked change from this follow-up.
