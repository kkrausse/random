# Clean TODO demo: combined browser acceptance

September 12, 2026. **PASS: the requested clean-demo acceptance flow is complete,
including the native shell Node check.** This is a real fresh-origin run with the
faithful V2 package tree, native-realpath and shell-quoting runtime fixes, unchanged
OpenCode beta-19425 server, matching chat client, and the user's source-pinned
Tailwind PR backend. `summary.json` independently validates the final receipts.

## Exact identities

| Input | Identity |
| --- | --- |
| Runtime fork | `33305d590c2d0a739d3fa4ccf08893f0519a96e2` |
| Runtime distribution | `913a31409aa2fbae699e3e1675f8ec11fb48c7c7c0b8edc5c93e4ad36b93338d` |
| Prepared manifest SHA-256 | `5556ee8e08087c0db7b2db8536d9bc7d19256d362b0c7252c690d43839e0ea75` |
| Prepared tree | 10,469 entries; original manifest/lock and archive inputs retained |
| OpenCode source | `20aff6d9f643afe9abf8a048e68f019d049f5329` |
| OpenCode build receipt SHA-256 | `d6dcd8f0458d7bb3238229eebb0d01766eb4bd8861abc8e74646fe65fe8d7949` |
| OpenCode server.js SHA-256 | `55be88221d3d21dc373fb7ad7f80fdda3974a4a0be6453001e8e3df0957fc4fb` |
| Tailwind PR | [#20487](https://github.com/tailwindlabs/tailwindcss/pull/20487), `11050dda2c4e26a3412b1745e84ea41d8fed6335` |
| Tailwind build receipt SHA-256 | `456722dd32ebba38e957bf9560eaab820936e8c16132d14b5c861381793adc9a` |
| Tailwind WASM SHA-256 | `cfde7c6f47206120876212f3ee943bbc666b1489622c462d825ed394d12cc583` |

The corrected runtime's isolated distribution and the first failed-run diagnosis
are documented in [native realpath startup qualification](todo-clean-startup.md).
The PR's source/build/installation provenance is in
[the Tailwind follow-up](todo-tailwind-followup.md). The registry backend was not
substituted invisibly: the prepared manifest records the source archive and its
distinct SHA-512.

## Browser checks

Browser Control CLI **0.7.0**, session `brisk-otter-643`, origin
`http://127.0.0.1:54394/`. OPFS was observed empty before opening. The ordinary
production application and toolkit were rebuilt; the consumer was reinstalled
with Bun 1.4.0's isolated linker. Preparation and the host both selected the same
corrected runtime. Main run ID: **`mty15y4n`**.

| Check | Result and independent evidence |
| --- | --- |
| Default-closed editor | PASS: normal TODO UI ready, no editor/preview; pre-open network captured |
| Complete tree, Vite and chat startup | PASS: all six startup stages complete, both clients ready, TODO inputs hydrated |
| Real backend CRUD | PASS: iframe add/complete/delete each independently checked through host tRPC |
| Manual source autosave/HMR | PASS: exact workspace bytes, explicit flush status, changed heading, identical preview Document |
| Genuine model read/edit | PASS: Muse Spark's native local read/edit tool IDs, completed timestamps and exact target/old/new strings correlated to independent source bytes |
| Model-driven preview update | PASS: requested heading rendered in the same preview Document |
| Tool file navigation | PASS: actual tool file button opened the independently verified edited bytes |
| Native shell → Node source check | **PASS**: exact five-line quoted command, independent source hash/heading, native tool capture, unique marker, numeric exit 0 |
| New Tailwind utility | PASS: novel `text-[37px]`, generated CSS, actual CSS/JS HMR responses, matching CSSOM rule and computed `37px`; same Document |
| Close and drain | PASS: clients/endpoints disposed, runtime/workspace closed, both service output drains joined |
| OpenCode EOF shutdown | PASS: exitCode 0, signal null, forced false |
| Vite shutdown | Explicit stop: exitCode 143, SIGTERM, forced true; drained. Not claimed as natural exit |
| Reopen persistence | PASS: full edited source bytes, prior session/message IDs and stable conversation/tool content retained |
| Source restoration | PASS: exact original source restored through UI; independently read close receipt equals prepared source |
| Startup cancellation | PASS on run `mty1czhg`: cancelled while busy, then no runtime/workspace/services and closed persistence |

The final real host boundary checkpoint passed 13 checks for normal app/API
availability plus non-admin and foreign-origin editor denial. Pre-open network
evidence confirms that runtime/prepared assets were not eagerly downloaded.

### Tailwind proof

The exact utility string was absent from **all prepared project and asset bytes**
before editing. The source change was solely:

```diff
-        <div className="row">
+        <div className="row text-[37px]">
```

The row's computed font size changed from `16px` to **`37px`**. The installed CSSOM
contained its matching utility rule. Actual timestamped HMR responses were:

- `/preview/5173/src/style.css?t=1789196298585`: HTTP 200, `text/css`, 5,418 characters.
- The same URL's JS module request: HTTP 200, `text/javascript`, 6,150 characters.

Both contained the new utility. A subsequent direct public Vite Endpoint request
for `/src/style.css?direct` returned the generated CSS with `37px`. It was made
after the actual HMR/computed-style proof, so it cannot explain initial success.
The captured screenshot was inspected at its original resolution.

### Shell result and preserved earlier failure

The final native local shell tool `call_01a094682d977a60a310353f003eaeeb` returned
`{status:"completed", truncated:false, exit:0}`. Its first content block was exactly
`editor-shell-mty15y4n\n`; its separate tool notice was `Command exited with code 0.`.
The unchanged five-line `node -e` command checked source SHA-256
`2e987905e5cb72b90696d0b55ef3f2f732ea029db530334733df5ac44bc74c47`
and `<h1>Todos model mty15y4n</h1>` before printing the marker.

The earlier `mty0l5ta` run on the native-realpath-only runtime failed as follows.
Its original receipt remains under the sibling `final-pr/` evidence directory.

The model used the requested native `shell` tool with `background:false` and an
8-second timeout. Its exact `node -e '…'` command contained a quoted multiline
JavaScript program reading `/workspace/src/home.tsx`, checking its SHA-256 and
heading, and printing a unique marker only on success.

The tool completed with numeric metadata `exit:127`, `status:"completed"`,
`truncated:false`. Its actual output included:

```text
sh: const: not found
sh: if: not found
sh: if: not found
sh: process.stdout.write(editor-shell-mty0l5ta\n): not found
sh: : not found
```

The separate tool-generated notice was `Command exited with code 127.`. This is a
real command-parsing failure, not missing result metadata, model prose, or an
unrelated command accepted as proof. A dedicated Node tool or a simpler command
was not substituted to turn this gate green. The runtime's existing lexer was
corrected in `33305d5`, then the original command shape was rerun successfully.
See [shell root cause and source checks](todo-shell-acceptance.md). This qualifies
the tested shell subset, not arbitrary native OS commands or full POSIX grammar.

## Harness corrections retained honestly

Two initial phase failures were harness mistakes, with their original receipts
retained:

1. `checkbox.check()` made an immediate assertion while the server-controlled
   checkbox awaited its mutation response. Fresh DOM and host API reads proved
   completion had succeeded. The harness now submits one click and observes both
   states without resubmitting while pending.
2. File-link discovery excluded the button inside a closed details element.
   Read-only inspection found it. The corrected locator includes hidden elements
   for discovery, then opens the details before the actual click.

Both corrected phases passed. The final runtime rerun additionally corrected a
file-link assertion that ran before its asynchronous read completed: it now waits
for the exact independent source bytes within the existing eight-second bound.
A premature model-send guard also rejected admission while session creation was
still settling; no prompt had been sent, and the later admitted turn passed.
These guarded/harness observations remain in the raw receipts. The final native
shell result is PASS; the earlier exit-127 result remains historical evidence.
The normal iframe/source identity was retained through these harness corrections;
neither required reload, runtime restart, storage reset or application edits.

## Evidence and cleanup

Durable local evidence copy (ignored generated output):

```text
browser-container-poc/vivari/.runtime/todo-clean-acceptance-mty15y4n/
```

Original execution evidence root (absolute paths inside receipts retain this):

```text
/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/todo-editor-clean-acceptance.d1vGpL/final-shell/
```

Key artifacts:

- `fresh-origin.json`, `before-open-network.json`, `prepared-provenance.json`,
  `prepared-manifest.json` (complete captured prepared contract)
- Main numbered receipts `mty15y4n-001-startup.json` through `mty15y4n-026-closed.json`
- `mty15y4n-012-model-verify.json`, `mty15y4n-016-shell-verify.json`
- `mty15y4n-018-tailwind-verify.json`, `tailwind-hmr-responses.json`,
  `tailwind-transformed-css.json`, `accepted-editor.png`
- `mty15y4n-020-closed.json`, `mty15y4n-024-retention.json`, `source-restoration.json`
- Cancellation receipts `mty1czhg-001-startup.json` through `mty1czhg-004-closed.json`
- `network-final.json`, `host-boundary.json`, `host-boundary-process.json`
- `summarize.ts`, `summary.json`: checks 15 selected phase receipts plus CSS response
  equality/CSSOM, source restoration, exact shell output, cancellation, host
  authorization, lazy startup and empty page-error capture; records evidence hashes

The owned TODO was deleted, source restored, editing closed, and cancellation
cleanup completed. Conversation data stays in this isolated origin. The host on
54394 is available with the editor closed and original source restored. Earlier
owned hosts and Browser Control sessions were stopped/deleted. The final runtime
revision is promoted in `vivari/runtime-source.json`; the default workspace
distribution now has the exact accepted runtime identity above.

## Run this assembled demo

With the current qualified prepared output and default runtime distribution:

```sh
cd browser-container-poc/todo-app-demo
LOCAL_EDITOR_ADMIN=1 PORT=54394 bun start
```

If that server is already running, use its URL instead of launching a second one.
For regeneration, also select the retained OpenCode root and the explicit Tailwind
receipt/hash from the [demo README](../todo-app-demo/README.md), then run the
ordinary `prepare:editor` and production build commands. The accepted candidate
distribution also remains at `vivari/.runtime/editor-runtime-candidate`.
If overriding `RUNTIME_DIR`, select the same distribution for preparation and hosting.
