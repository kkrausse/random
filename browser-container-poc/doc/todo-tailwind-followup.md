# Tailwind WASM follow-up: buildable upstream correction, publication still blocked

September 11, 2026 local time. Independent follow-up to the
[root-cause investigation](todo-tailwind-hmr-root-cause.md) and
[published release check](todo-tailwind-wasm-release-check.md).

## Decision

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

Only this report is a repository change. Runtime/application pins, shared
preparation, generated distribution, and the pre-existing untracked
`vivari/scripts/probe-tailwind-direct.mjs` were not modified. No browser acceptance
claim or app scanner workaround was added.
