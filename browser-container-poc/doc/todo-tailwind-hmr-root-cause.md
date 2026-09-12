# TODO Tailwind CSS HMR: upstream WASM scanner root cause

September 11, 2026. Investigation only; continuation of
[the upstream attempt](todo-upstream-tailwind-attempt.md) and commit `058f6e1`.

## Conclusion

**The first failing layer is incremental source discovery inside the published
`@tailwindcss/oxide-wasm32-wasi@4.3.3` scanner.** Its first scan succeeds; subsequent
scans empty `scanner.files` and never discover edited candidates. The identical
published WASM binary reproduces this on native Node, outside Vivari. The native
Oxide 4.3.3 addon passes the same test.

Tailwind 4.3.3 switches from synchronous walking to its vendored `ignore` parallel
walker after the first scan. That walker explicitly rejects non-Unix/non-Windows
targets, including WASM, before doing filesystem work. Oxide discards the error
and proceeds with an empty file list and its old accumulated candidates.

No application, dependency, runtime, preparer, pin, or distribution fix was made.
This investigation does not establish that CSS application will work after the
scanner is corrected; it establishes why the new utility is never generated now.

## Correlated TODO evidence

Two bounded real-browser runs used isolated origins and the existing distribution.
The first used the ordinary TODO CLI/config. The second added a temporary diagnostic
config that imports the ordinary config and observes scanner returns, watcher events,
and transformed CSS. Browser observers recorded actual responses, iframe messages,
link mutations, stylesheets, CSSOM rules, and computed style.

Instrumentation is isolated from the baseline: the diagnostic config wraps
`Scanner.prototype.scan` with a pass-through logger and adds supported Vite watcher
and post-transform hooks. Config evaluation installs the logger twice, so duplicate
scanner log rows do not mean two underlying scans. The minimal trace process wraps
WASI import calls and redirects newly created workers through a logging entrypoint;
the uninstrumented minimal process and native-Node control establish the behavior
independently of those wrappers. No wrapper changes scan results or syscall results.

| Layer | Observation |
| --- | --- |
| Source | Exact `className="row"` → `className="row text-[37px]"`; UTF-8 source grows from 2,290 to 2,302 bytes. Immediate workspace readback equals the edited bytes. Both full versions and hashes are retained. |
| Filesystem | Diagnostic run: source mtime changes from `1789177387296` to `1789177412329`; the guest reads the edited text and new size. |
| Watch | Guest Vite watcher emits `change` for `/workspace/src/home.tsx` at `1789177412332`. |
| Vite invalidation | Actual iframe WS bridge receives JS updates and a CSS update for `/src/style.css?direct`, timestamp `1789177412339`. |
| Scanner | At `1789177412368`, the actual plugin's scanner reads metadata/text showing the edit, but returns the same 354 candidates without `text-[37px]`; its discovered files are now empty. Earlier first scans list 27 files, including `src/home.tsx`. |
| Transform | The post-edit Vite transform for `/workspace/src/style.css?direct` runs at `1789177412375` and contains no `37px` utility. |
| Browser response | Baseline initial CSS and timestamped HMR CSS both return HTTP 200 and exactly the same 5,485 bytes: SHA-256 `301fba1eba10f99da4db0094005cd4a011838611d0831a25f9144d7a30564b68`. |
| Supported Endpoint HTTP | After the 20-second observation window, `/src/style.css?direct` and `/src/style.css` also lack `37px`. These additional requests occur after the baseline observation, so they cannot explain that failure. |
| DOM | The exact inspected `.row` becomes `row text-[37px]`. |
| Installed CSS | One inline stylesheet, 16 top-level CSSOM rules, unchanged before/after. Its utilities layer contains `.block`, `.line-through`, and the initial arbitrary variant; no `text-[37px]` selector or declaration exists. Full style-tag text and nested rule serialization are retained. |
| Computed style | The edited row stays at `16px` after 20 seconds in both runs. No generated `37px` declaration exists to match or lose in the cascade. The app's unlayered `.row` rules set layout/margin, not font size. |

The browser changes the CSS **preload** link's URL to the timestamped URL and logs
`css hot updated`; that link remains `rel="preload" as="style"`. The installed
inline stylesheet remains unchanged. Because the response itself is unchanged,
these facts cannot establish a second delivery/application defect or qualify that
path with genuinely changed CSS. The preload warning alone is not the root cause.

Baseline edit/observation times are `1789177218639` and `1789177238640` epoch ms.
Diagnostic edit/observation times are `1789177412329` and `1789177432332`.
Actual iframe WS payloads and CSS request URLs are retained, rather than inferred
from Vite's console messages.

## Independent minimal reproduction

A separate fresh browser origin delivered the same unchanged packages and ran a
short guest program with a single HTML file and a normal `Scanner` instance.
There was no Vite, React Router, preview, CSS assertion, or file watcher in this test.

| Step | Browser WASM | Native Node + same WASM | Native Node + native addon |
| --- | --- | --- | --- |
| First scan, `class="flex"` | `flex`; one discovered file | Same | Same |
| Repeat without edit | Old candidates; **zero files** | Same failure | One file, zero changed files |
| Write `class="flex text-[37px]"`; reuse scanner | **No new candidate; zero files** | Same failure | Finds `text-[37px]`, one file |
| Fresh scanner over edited file | Finds `text-[37px]`, one file | Same | Same |

The uninstrumented guest exits naturally with code 0 and `MINIMAL_DONE`; its
start time is `1789177620709`. A second guest process repeats the same behavior
with isolated WASI-call logging. That trace observes no watched filesystem calls
between the initial and incremental scan checkpoints, consistent with the
compile-time unsupported branch. Its attempted path-string decoder produced no
path fields, so those absent fields are not evidence about requested paths.
Both processes have empty stderr and natural, non-forced exit 0.

The independent host check uses **Node v24.13.0, darwin arm64**, not the fork's
qualified v24.18.0 suite. It runs both the unchanged published WASM package and
the normally installed native Oxide addon. Both are 4.3.3. The native fixture is
deleted after recording the comparison. A fresh scanner is used only as a
diagnostic control; no scanner recreation workaround was adopted.

## Exact upstream ownership

Source references below are from the **Tailwind `v4.3.3` tag**, retained locally:

1. [`crates/oxide/src/scanner/mod.rs:375–379`](https://github.com/tailwindlabs/tailwindcss/blob/v4.3.3/crates/oxide/src/scanner/mod.rs#L375-L379)
   selects `walk_parallel` once `has_scanned_once` is true.
2. [`crates/ignore/src/walk.rs:425–430`](https://github.com/tailwindlabs/tailwindcss/blob/v4.3.3/crates/ignore/src/walk.rs#L425-L430)
   implements `DirEntryRaw::from_path` for `not(any(windows, unix))` as unconditional
   `Err("unsupported platform")`. `from_entry_os` has the same limitation at
   lines 383–395. This is Tailwind's **vendored ignore 0.4.24**, selected via
   `crates/oxide/Cargo.toml`'s path dependency, not registry ignore 0.4.23 also in
   its lockfile.
3. [`crates/ignore/src/walk.rs:1372–1391`](https://github.com/tailwindlabs/tailwindcss/blob/v4.3.3/crates/ignore/src/walk.rs#L1372-L1391)
   passes root-construction errors to the visitor, then returns without workers
   when its work stack is empty.
4. [`crates/oxide/src/scanner/mod.rs:619–621`](https://github.com/tailwindlabs/tailwindcss/blob/v4.3.3/crates/oxide/src/scanner/mod.rs#L619-L621)
   discards those errors. `discover_sources` clears `self.files` at line 386;
   `scan()` still returns the previously accumulated candidates.
5. Published `@tailwindcss/vite/dist/index.mjs:1` retains its scanner and invokes
   `scanner.scan()` during generation. Thus Vite correctly rerunning the transform
   cannot recover the missing candidate.

`rustc --print cfg --target wasm32-wasip1-threads` reports `target_family="wasm"`,
`target_os="wasi"`, and neither `unix` nor `windows`. The published WASM contains
the `unsupported platform` string. The identical native-Node/WASM failure and the
successful native-addon control corroborate the source-level diagnosis. There is
no evidence here of a missing Vivari Node/WASI API causing this failure; changing
a runtime filesystem API cannot activate code excluded at Rust compile time.

## Smallest proposed fix and proving test — not implemented

The smallest upstream-owned correction is to use the supported synchronous walker
for WASM incremental discovery in Oxide, retaining the existing scanner's candidate
extraction, ignore rules, source patterns, and mtime logic. That belongs in the
published upstream WASM backend, with an upstream regression test, rather than an
application scanner or a Vivari package-source rewrite.

The proving test must run the **published WASM artifact**, repeatedly scan the same
instance, verify unchanged files remain in `files`, edit an existing file, and
verify both `scannedFiles` and the new candidate. Include native-addon parity.
Then rerun ordinary TODO Vite HMR and require the utility in the transformed CSS,
actual HMR response, installed CSSOM, matching row selector, and `37px` computed
style. That last gate remains necessary because changed-CSS application has not
yet been qualified. Obtaining/building a corrected backend or adopting any repair
requires separate authorization.

## Provenance, retained evidence, and cleanup

- Runtime revision: `80d5cdd599fce4fa4817128461c865e009109d34`.
- Unchanged distribution: `098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`.
- Tailwind/Oxide: 4.3.3; Vite 7.3.6; React Router 7.18.3.
- Runtime alias-table delivery: esbuild-wasm 0.28.2, Rollup WASM 4.63.1,
  lightningcss-wasm 1.32.0. Each run verifies all 5,692 delivered asset hashes.
- Published Oxide WASM: 1,715,887 bytes, SHA-256
  `96754f9b8b5a755bd5df3ffe84dfd64fdba217f058256740ae5e4b5d3d0d11d2`.
- Browser Control CLI: 0.7.0; Bun CLI only.

Ignored evidence root:

```text
vivari/.runtime/todo-tailwind-hmr-investigation/2026-09-11/
  summary.json          # classification, source hashes, per-evidence SHA-256 index
  baseline/             # ordinary TODO config: receipt, CSS responses, scripts
  observed/             # isolated observation config, scanner/watch/WS/CSSOM receipt
  minimal/              # plain and traced scanner runs, native comparison,
                        # full delivery manifest, runtime receipt, upstream sources
```

Original execution directories under the approved temporary root are
`tailwind-hmr-layer.Delc7y`, `tailwind-hmr-observe.vPLwTL`, and
`tailwind-scanner-minimal.dYaK5T`. Scripts and receipts are preserved verbatim.
**Receipt-label caveat:** the baseline harness inherited `PASS` and
`todo.css-hmr.PASS` labels after its assertion was replaced by bounded observation.
Those labels are incorrect as acceptance claims; its recorded computed value is
`16px`. `summary.json` explicitly classifies it as observed failure. The subsequent
harnesses use `OBSERVED`, and the minimal comparison independently proves failure.

Both TODO source edits were restored; the diagnostic run additionally verifies
restored bytes. Preview attachments/endpoints were disposed, runtimes stopped,
outputs drained, and workspaces closed. Owned sessions `rapid-wombat-160`,
`tidy-comet-737`, and `amber-raven-114` were deleted. Ports 51000, 51138, and 51279
were verified unreachable after stopping the owned servers. Existing user OPFS
was not opened; scratch data remains only in the discarded isolated origins.
The pre-existing untracked `vivari/scripts/probe-tailwind-direct.mjs` is preserved.
The only tracked change from this investigation is this report.
