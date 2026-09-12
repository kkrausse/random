# Tailwind WASM follow-up: adopted source-pinned user PR backend

September 11, 2026 local time. Independent follow-up to the
[root-cause investigation](todo-tailwind-hmr-root-cause.md) and
[published release check](todo-tailwind-wasm-release-check.md).

## Current result: user's PR adopted and browser-qualified

The user explicitly authorized adopting their existing
[PR #20487](https://github.com/tailwindlabs/tailwindcss/pull/20487), after confirming
its identity. **The prior bounded search missed that PR.** Its source correction
and regression test supersede the duplicate one-line experiment below. No corrected
registry release was found, but publication is no longer the acquisition blocker:
a separately identified backend from the exact authorized PR is built and retained.

Confirmed through `gh pr view 20487 --repo tailwindlabs/tailwindcss`:

| Field | Immutable adoption pin |
| --- | --- |
| Author / head repository | `kkrausse` / `kkrausse/tailwindcss` |
| Branch (informational only) | `fix/wasm-incremental-scanning` |
| Commit | `11050dda2c4e26a3412b1745e84ea41d8fed6335` |
| Git tree | `98aa087afde005c8ae3956ae98db37b4d23bb3fb` |
| Upstream base | `41d9cae8e53378d16087fcf359eb785c2fd42ce4` |
| Candidate ID | `tailwindcss-pr-20487@11050dda2c4e26a3412b1745e84ea41d8fed6335` |

The tracked PR diff contains only `crates/oxide/src/scanner/mod.rs` and
`integrations/oxide/wasm.test.ts`. Its actual selection condition is
`self.has_scanned_once && cfg!(any(unix, windows))`; the surrounding comment
explains the supported-platform boundary. The added upstream regression covers
initial scanning, unchanged reuse, and editing `flex` to `grid`. The earlier
v4.3.3 experiment is **not** the adopted source.

### Embedding preparation checkpoint (September 12)

The public build-time `prepareBrowserEditor` now accepts explicit `backendArchives`,
and `/prepare` exports the pinned verifier. The TODO consumer selects the PR with
`TAILWIND_CANDIDATE_RECEIPT` and `TAILWIND_CANDIDATE_SHA256`. The verified tarball
is retained as a hashed binary prepared asset under `/workspace/.browser-editor-backends/`;
the derived manifest/lock retain its portable path and its own archive integrity.
The browser validates that each receipted archive has a matching delivered input.

A complete host preparation using the actual PR archive passed with **10,468 tree
entries** and all **115 source-backend package files** checked by the installer.
The resulting prepared manifest SHA-256 is
`e7dde6be8e68a8f0d77a7529a962d805f14e9364ba6f13a1098d44e75ca5d3aa`.
Evidence and disposable output are under
`/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/todo-editor-clean-acceptance.d1vGpL/`
(`prepare-pr-host.ts`, `prepare-pr-host.json`, `prepared-pr-host/`).
This checkpoint leaves the live published-backend browser diagnostic unchanged.

The pin now lives inside the toolkit's source root and is bundled into its host
helper. A relocated-consumer test passes, and emitted declarations retain the
package's flat public layout. This avoids requiring an adjacent Vivari checkout
or emitting declarations under an unexpected parent directory. The pin bytes and
existing artifact identities are unchanged by that source-file move.

Package checks after this integration: **73 passed, one retained-artifact test
skipped without its explicit environment input, 311 assertions**. The actual
retained candidate was additionally consumed by the full preparation checkpoint.
The later [combined browser run](todo-clean-demo-acceptance.md) passed new-utility
CSS HMR: actual CSS responses and installed CSSOM contained `text-[37px]`, and the
edited row computed to 37px without replacing the preview document. Runtime fixes
resolved the independent native-realpath startup and multiline shell defects; the
requested clean-demo acceptance flow now passes.

### Maintained build and package verification

New source files:

- `opencode-chat/src/tailwind-wasm-candidate.json`: explicit repository, commit, tree, base,
  PR identity, target, tool versions, and hashed pnpm bootstrap tarball.
- `vivari/scripts/build-tailwind-wasm-candidate.ts`: Bun host recipe; immutable
  Git checkout, upstream frozen pnpm/Cargo locks, two clean WASM builds, same-source
  native control, normal upstream artifact moving/packing, artifact assertions,
  and durable content-addressed receipt/package output.
- `opencode-chat/src/tailwind-application.ts`: host-only
  `readTailwindWasmCandidate(receiptPath, expectedReceiptSha256)` verifier returning
  the explicit package root and provenance for a generic dependency override.
- `opencode-chat/test/tailwind-application.test.ts`: seven focused receipt/package
  contract tests, including stale source, changed bytes, extra files, and symlinks.

Reproduce from `browser-container-poc/vivari`:

```sh
bun scripts/build-tailwind-wasm-candidate.ts --node /absolute/path/to/native/node
```

The pin currently requires **Node v24.13.0** (native, not Bun), **Rust 1.95.0** and
installed `wasm32-wasip1-threads`. The recipe's `--source /existing/tailwind-checkout`
option clones committed objects into a fresh temporary checkout, never changes
the supplied checkout, and ignores its working-tree edits. Without that option it
clones the pinned repository. `--temp-root` selects another approved scratch root.
The successful runs used isolated source originally cloned into approved temp
directory `tailwind-pr20487.kGrqSU`, not a user's editable fork.

The PR's frozen lock selects pnpm **11.9.0**, NAPI CLI **3.7.4**, emnapi/core/runtime
**1.11.3**, and NAPI WASM runtime **1.2.2**. Both Cargo builds use `--locked` in
separate clean output trees. The script invokes upstream's generated-artifact mover
and `pnpm pack --config.node-linker=hoisted`, as upstream requires for bundled
dependencies. No source patch, loader rewrite, binary edit, or metadata version
rewrite is applied. It verifies the Git checkout remains clean after building.

The resulting 115-file package preserves original package name/version
**`@tailwindcss/oxide-wasm32-wasi@4.3.3`**, loaders, browser loader/worker, and all
six bundled dependency packages. The source JSON bytes are separately preserved
as `evidence/original-package.json`; upstream `pnpm pack` removes the final newline,
so metadata hashes differ while parsed metadata is asserted exactly equal.
Candidate identity lives in the receipt, never in a fabricated registry version.

| Bundled dependency | Exact frozen version |
| --- | --- |
| `@napi-rs/wasm-runtime` | 1.2.2 |
| `@emnapi/core` | 1.11.3 |
| `@emnapi/runtime` | 1.11.3 |
| `@tybys/wasm-util` | 0.10.3 |
| `@emnapi/wasi-threads` | 1.2.3 |
| `tslib` | 2.8.1 |

### Qualification and durable receipts

The adopted package's same-instance scanner passes all eight checkpoints in the
historical table below, with **exact complete candidate/file/scanned-file parity
against the native addon compiled from the same PR commit**. Neither probe forces
exit: both emit `TAILWIND_SCANNER_SAME_INSTANCE_PASS` and exit naturally zero.
The build script emits `TAILWIND_WASM_CANDIDATE_READY` only after those checks,
package integrity checks, source-drift checks, and receipt publication.

The two independent clean WASM builds match in every section except `build_id`.
Full binary hashes are retained without stripping that section; cross-host
bit-for-bit reproduction is not claimed. The receipt records native Node binary
hash, Rust/Cargo information, environment, host Cargo config, tool metadata hashes,
commands/logs, source archive and tree, original manifests/locks, all package bytes,
the packaged tarball, both WASM hashes, and the retained native control.

Durable ignored root: `vivari/.runtime/tailwind-wasm-candidate/`:

```text
current.json                     # atomic pointer + exact receipt SHA-256
<revision>/<package-manifest-sha256>/
  receipt.json                   # source/tool/build/package/verification provenance
  package.tgz                    # unchanged output of upstream pnpm pack
  package/                       # extracted self-contained backend, 115 files
  evidence/                      # source.tar, locks, recipe, probes, binaries, logs
```

The earlier successful PR build has receipt SHA-256
`4cbfc578756519b55f1fd106aa5d4acc898be606bfb5f455e2ee7860ed605082`
and WASM SHA-256
`d3b80f7e7f7f429c967050e46c4f8410d6deb869b69107a85ae25ec9fbfe9844`
(1,718,880 bytes). Its immutable directory remains available if preparation has
already selected it. The final maintained recipe's receipt is selected by
`current.json`. Final maintained-recipe artifact:

| Field | SHA-256 |
| --- | --- |
| Receipt | `456722dd32ebba38e957bf9560eaab820936e8c16132d14b5c861381793adc9a` |
| Package file manifest / directory key | `a6719da6db7b71197e68f29625597633cb31de6cb13f434f485d02e80e4856e3` |
| WASM (1,718,880 bytes) | `cfde7c6f47206120876212f3ee943bbc666b1489622c462d825ed394d12cc583` |
| Upstream-packed tarball | `6e5ce92301d411cf21c29c148f9eddd9d8744698980966f7bb58e4ccd2f2e998` |
| Maintained build recipe | `9aa467c0a951ee85e3ea510ff9a6a3e1d3615e6fd60c3b6cb395841f329f68fe` |

Its package directory is
`vivari/.runtime/tailwind-wasm-candidate/11050dda2c4e26a3412b1745e84ea41d8fed6335/a6719da6db7b71197e68f29625597633cb31de6cb13f434f485d02e80e4856e3/package`.
All 115 package files total 6,561,483 bytes. The final build reran both clean WASM
builds, the native build, the upstream pack step, and eight-checkpoint parity;
the exact final package also passed the host verifier.

Validation: the actual durable package passes the new host verifier; all five
focused verifier tests pass; isolated TypeScript checking of the three new TS
files passes. An initial build/probe run exposed the macOS `/var` versus
`/private/var` fixture-path alias; canonicalizing the scratch root fixed the fixture
comparison. This was not a scanner failure or package modification.

### Preparation integration contract and remaining gate

The integration owner should explicitly select a receipt/digest (the mutable
`current.json` pointer is a discovery aid), call `readTailwindWasmCandidate`, and
use its `packageRoot` as a **generic package override for
`@tailwindcss/oxide-wasm32-wasi` only**. Preserve the bundled nested dependency tree
and original manifest. Carry `id`, source commit/tree, receipt SHA-256, package
manifest SHA-256, and WASM SHA-256 into preparation provenance. The backend's source
version is still 4.3.3; do not merge its identity with cached registry 4.3.3 bytes.

This helper does not alter preparation defaults or package graph types. The parent
owns `prepare.ts` / `prepared.ts` integration and actual browser acceptance.
The remaining gate is the ordinary TODO edit to `row text-[37px]`: require the
utility in transformed CSS, actual HMR CSS response, installed CSSOM, matching
selector, and **37px computed style**. The source acquisition/build blocker is
resolved; that final browser gate remains open in these receipts.

## Historical investigation before the authorized PR adoption

The following sections retain the original bounded search and duplicate build
experiment. Their publication/adoption blocker statements describe that earlier
point in time; the authorized PR build above supersedes them.

### Original decision

**There is still no verified corrected published artifact. A minimal upstream
source correction is now experimentally proven buildable and passes native-parity
incremental scanning.** Ordinary TODO CSS HMR remains an acceptance blocker until
a corrected backend is delivered and tested in the browser.

The sustainable upstream change is a one-line platform guard in Oxide's discovery
walker selection. Both independently built experimental WASM artifacts pass eight
same-instance checkpoints with exactly the native 4.3.3 candidate, `files`, and
`scannedFiles` records. This is stronger than a source-only proposed fix, but these
are local experimental builds, not new upstream releases or production artifacts.

## Current publication and source check

Direct registry and GitHub API responses were dated **2026-09-12 05:45:18 UTC**:

- [`@tailwindcss/oxide-wasm32-wasi`](https://registry.npmjs.org/@tailwindcss%2foxide-wasm32-wasi):
  `latest=4.3.3`, `insiders=0.0.0-insiders.41d9cae`. The full version inventory's
  maximum stable version remains 4.3.3.
- [`main`](https://api.github.com/repos/tailwindlabs/tailwindcss/commits/main) still
  resolves to `41d9cae8e53378d16087fcf359eb785c2fd42ce4`.
- Freshly fetched source at that exact commit still chooses parallel walking after
  the first scan (`crates/oxide/src/scanner/mod.rs:387`) and rejects unsupported
  platforms in vendored ignore (`crates/ignore/src/walk.rs:385,435`).

Fresh downloads of both published tarballs were checked against registry SHA-1;
the binary hashes match the earlier investigation exactly:

| Artifact | Bytes | WASM SHA-256 |
| --- | ---: | --- |
| Published 4.3.3 | 1,715,887 | `96754f9b8b5a755bd5df3ffe84dfd64fdba217f058256740ae5e4b5d3d0d11d2` |
| Published insiders `41d9cae` | 1,747,982 | `648cdf29afce1ab6787bd7af7cc9771594ce791055a3421c56ea8102ead56023` |
| Experimental patched build 1 | 1,683,958 | `ac8d6d3ef141637f8530cfa5249580e047679a65ccfbc778054417f017cdc6ad` |
| Experimental patched build 2 | 1,683,958 | `a37a2af8f69e3c3b3b5fc5c1a5694e35d3575484e6ed673598a737c20e1f7bab` |

Publication dates remain July 16 for stable and September 8 for insiders. Full
registry metadata, tarball SHA-256, integrity strings, and source responses are
retained. This check found neither a newer published fix nor a changed upstream
`main`; it does not claim to exhaust all unmerged branches or open PRs.

## Smallest source correction actually tested

An isolated checkout of upstream **v4.3.3**, commit
`c2b24dd15fed1c59dd521bd86082f520c9f5ad0d`, changes only this condition in
`crates/oxide/src/scanner/mod.rs:375`:

```diff
-        let all_entries = if self.has_scanned_once {
+        let all_entries = if self.has_scanned_once && !cfg!(target_family = "wasm") {
             walk_parallel(walker)
         } else {
             walk_synchronous(walker)
         };
```

This retains the existing synchronous discovery implementation on WASM, including
ignore handling, patterns, file-list rebuilding, and mtime-based changed-file
selection. Native platforms retain their parallel incremental path. No application
scanner, scanner recreation, JS loader patch, or runtime filesystem workaround is
involved. An upstream submission should update the adjacent comment and add a
WASM-artifact regression test covering the fixture below.

## Independent artifact regression and native parity

Runtime: explicit native **Node v24.13.0, darwin arm64**, at
`$TMP/node-v24.13.0-darwin-arm64/bin/node`, where `$TMP` is the approved OpenCode
temporary root below. This is not the fork's qualified Node v24.18.0 suite.

`probe.cjs` uses a single `Scanner({ sources: [{ base, pattern: '**/*', negated:
false }] })`. Writes advance mtime by two seconds. It asserts exact normalized
`files` and `scannedFiles` arrays plus required candidates, saves full receipts,
and removes its fixture in `finally`. No fresh scanner is used to pass a failing
incremental checkpoint.

| Checkpoint | Published stable / insiders | Patched builds 1 and 2 / native 4.3.3 |
| --- | --- | --- |
| Initial `flex` | Pass | Pass: one discovered and changed file |
| Unchanged repeat | Fail: zero discovered files | Pass: one file, zero changed |
| Edit to `text-[37px]` | Fail: candidate absent | Pass: new candidate, one changed |
| Edit to `text-[41px]` | Fail: candidate absent | Pass: new candidate, one changed |
| Add file with `grid p-[19px]` | Fail: candidates absent | Pass: two files, added file changed |
| Remove added file | Fail: files still empty | Pass: one file, zero changed |
| Edit remaining file to `text-[43px]` | Fail: candidate absent | Pass: new candidate, one changed |
| Final unchanged repeat | Fail: files still empty | Pass: one file, zero changed |

The two published probes exit 1 through the intentional assertion; native and
both patched probes exit naturally 0. `compare.py` additionally asserts **exact
equality of all eight full records**, including the complete accumulated candidate
arrays, between each patched artifact and native 4.3.3. Prior candidates remaining
after deletion are expected native behavior.

## Build feasibility and reproducibility boundary

The upstream build works on this host using:

- Rust/Cargo **1.95.0**, matching upstream `rust-toolchain.toml`;
  `wasm32-wasip1-threads` target; unchanged upstream `Cargo.lock`, enforced with
  `--locked`.
- Upstream **`@napi-rs/cli@3.7.0`**, **`emnapi@1.11.1`**,
  **`@napi-rs/wasm-runtime@1.1.5`**, and **`@emnapi/core` / `runtime@1.11.1`**,
  matching the relevant upstream pnpm lock entries. These build tools were installed
  into a separate temporary package with a retained Bun lockfile and linked as the
  isolated checkout's `crates/node/node_modules`.
- The upstream NAPI command and upstream artifact-moving script, invoked from
  `crates/node` with the explicit native Node binary:

```sh
"$NODE" node_modules/@napi-rs/cli/dist/cli.js build --release --target wasm32-wasip1-threads -- --locked
"$NODE" scripts/move-artifacts.mjs
```

Run the retained probe from the experiment root:

```sh
"$NODE" probe.cjs patched upstream/crates/node/npm/wasm32-wasi
```

A second build used `CARGO_TARGET_DIR=../../../target-second`, forcing a separate
clean Cargo output tree. It independently compiled successfully, was moved by the
same upstream script, and passed the same probe and exact native parity.

**The two complete binary hashes differ.** The retained WASM-section comparison
proves every section is byte-identical except the 25-byte `build_id` custom section.
This demonstrates repeatable executable/data output and behavior on this host,
not bit-for-bit whole-artifact reproducibility across hosts. No build-ID stripping
or binary rewrite was applied. A production build should retain the exact artifact
hash and recipe, or separately establish a deterministic build-ID policy.

Initial setup failures are preserved for reproducibility: bare `cargo build`
requires NAPI's `EMNAPI_LINK_DIR` setup; an incorrect guessed CLI entry path failed;
unconstrained emnapi peer resolution produced a version mismatch. Using the actual
CLI entry and upstream-locked emnapi versions resolves these. The initial probe of
the build-root loader also required running upstream's normal artifact-moving
script and targeting its `npm/wasm32-wasi` package. No loader edit was needed.

## Actionable handoff and remaining acceptance gate

1. Submit the platform guard plus published-WASM regression fixture upstream, or
   explicitly adopt a maintained, source-pinned upstream fork/build with its own
   artifact identity and reproducible build recipe. The experiment demonstrates
   feasibility; it is not a publication or adoption decision.
2. Recheck the exact corrected delivered backend with the same-instance regression
   and native parity. A version string alone is insufficient.
3. Run ordinary TODO Vite HMR on that delivered backend: edit `row` to
   `row text-[37px]`; require the new utility in transformed CSS, actual HMR CSS
   response, installed CSSOM, matching row selector, and **37px computed style**.
   JS HMR and an initial CSS render do not satisfy this gate.

**Precise remaining blocker:** no corrected published backend exists in the
checked release channels, and no corrected backend has been delivered/qualified
in the browser. No inherent source-build blocker was encountered. The parent
session can continue independent preparation/OpenCode integration while keeping
Tailwind new-candidate CSS HMR explicitly open.

## Evidence and scope

Approved temporary evidence root:

```text
/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/
  tailwind-followup.LCCYhC/
    registry.json, head.json, main-*.rs, provenance.json
    upstream/                       # exact tag + isolated one-line correction
    build-tools/{package.json,bun.lock}
    source.patch, build-provenance.json
    build.log, napi-build*.log       # setup failures and both successful builds
    probe.cjs, *.receipt.json, *.stdout, *.stderr
    patched-first.wasm, compare.py, reproducibility.json
    SHA256.json                     # receipt/script/provenance evidence index
```

The experimental second artifact and generated upstream loaders remain under
`upstream/crates/node/npm/wasm32-wasi/`. The experimental package still carries
upstream's 4.3.3 source version: **do not mistake it for the published 4.3.3 bytes**.
The first artifact is separately retained as `patched-first.wasm`.

The original duplicate experiment changed only this report and did not alter
runtime/application pins, shared preparation or distribution. The later authorized
PR adoption, maintained build, preparation wiring and browser acceptance are
recorded above. The pre-existing untracked `vivari/scripts/probe-tailwind-direct.mjs`
was preserved throughout.
