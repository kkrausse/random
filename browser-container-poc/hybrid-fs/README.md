# Linux-authoritative filesystem in Vivari

This spike mounts **Linux `/workspace` directly in Vivari's process filesystem
syscall path**. Reads, writes, metadata, directory operations, links and file
descriptors execute in the QEMU Linux guest. Source files are never installed
in Vivari's Rust VFS or mirrored into OPFS. `/workspace/node_modules` is an
explicit worker-local submount; dependencies are intentionally separate.

**Real browser passes:** process filesystem semantics, Linux-only JS entry +
`require`, and actual Vite/React HMR after Linux edits, with the same preview
Document retained. HMR uses the isolated metadata-polling overlay described below.

Live isolated origin: **http://127.0.0.1:5220/**. Browser Control session:
**`tidy-walrus-391`**. The existing `:5213` / `lucky-panda-267` page was not used
or changed. Reloading this spike discards its Linux memory-overlay filesystem.

## Reproduce

From this directory:

```sh
bun run build
bun run dev
bun test
bunx --package node-bin-darwin-arm64@24.18.0 node scripts/verify-runtime.mjs
```

Inputs are reused read-only: `../qemu/public/qemu/` (QEMU and Linux disk),
`../hybrid/dist/runtime.{js,css}` and `runtime.html` (terminal),
`../qemu/{public/serial-bridge.js,guest/preview-bridge.ts}` (transport),
`../vivari/.runtime/baseline/` (pinned source, Wasm and installed build tools),
`../vivari/public/vendor/npm-pack.bin`, and optionally
`../hybrid/.artifacts/deps/hybrid-deps.bin` plus its manifest. Follow the sibling
READMEs to generate missing inputs. This build only writes this directory.
Baseline revision is checked against `2629c71097238400c45aefa213ef61df4794c2b7`
and tracked source cleanliness. `runtime-build.json` records output digests.
Vivari's MIT notice is emitted with the runtime; QEMU/Linux retain the notices
and source references documented by the QEMU project.

1. Open `:5220`, **Start Linux**, log in as `root`, and wait for
   `demo:/workspace#` (the image prints its tool versions first).
2. **Connect** transfers the helper into Linux `/tmp` and opens its real PTY.
3. **Boot Vivari**, then **Test shared filesystem**.
4. For the extended qualification, from the repository root:

```sh
browser-control execute --session SESSION --file browser-container-poc/hybrid-fs/scripts/accept-browser.js
browser-control execute --session SESSION 'return await page.evaluate(()=>window.fsAcceptance)'
```

Wait for `phase: "pass"`. The runner is asynchronous to avoid a CLI request
timeout killing a long guest transfer. It owns only Linux
`/workspace/fs-spike`; rerunning deletes/recreates that test directory.
`scripts/start-browser.js` automates steps 1–3 on a **fresh page** and exposes
`window.fsStartup.phase`. Do not run it against a VM whose overlay you need.

Vite qualification (after filesystem acceptance, on the same page):

```sh
browser-control execute --session SESSION --file browser-container-poc/hybrid-fs/scripts/vite-browser.js
# Wait for the iframe heading "Ready for an agent edit".
browser-control execute --session SESSION --file browser-container-poc/hybrid-fs/scripts/hmr-browser.js
browser-control execute --session SESSION 'return await page.evaluate(()=>window.fsHmr)'
```

The dependency loader verifies the existing archive SHA-256 and loads **only
6,195 `node_modules/` entries** via Vivari's internal batch protocol. It discards
the archive's root lockfile. Package/config/React source stays on Linux. This is
the pinned worker Vite 7.1.4 + esbuild-wasm archive, not Linux native dependencies.
The static Bun server serves assets only: no execution endpoint, host filesystem
write API, application transform, or host Vite service. `POST /` is 405.

## Actual process routing

```
Vivari Process Worker: unmodified node:fs / require / Vite
  -> existing syscall SAB + fs MessagePort; caller Atomics.wait loop
  -> FS Worker: source-overlaid FsServer.service
       /workspace/node_modules -> existing Rust VFS
       /workspace              -> deferred Linux request
       other paths             -> existing Rust VFS
  -> BroadcastChannel("hybrid-fs-v1") -> browser page relay
  -> existing QEMU serial JSON bridge
  -> Bun helper INSIDE Linux -> native Linux fs syscalls
  <- raw result / errno -> caller's original SAB -> Atomics.notify
```

`src/remote.js` intercepts the actual FS-worker servicing method, including the
kernel's own fs client. It never dispatches mounted source reads/writes to the
Rust filesystem. `writeLarge` and batch source writes fail `ENOSYS` rather than
creating a hidden replica. The guest helper bundles `src/guest-fs.ts` together
with the reused PTY bridge; its `node:fs` imports remain native Linux Bun imports.
No host filesystem implementation participates in the browser acceptance.

The FS worker stays async while Linux is working. Each caller stays synchronous
on its existing SAB. The page is only a relay and never calls `Atomics.wait`.
The FS worker talks **directly to the page**, because routing replies through
the kernel would deadlock when the kernel is itself blocked in `kernel-fs`.
The inherited state-rechecking syscall wait fix is applied at both source sites.

Open returns an opaque high-numbered handle mapped to a real Linux fd and owning
Vivari client. Linux maintains positions, append semantics, and inode identity;
rename/unlink of an open file does not turn it into a path-based snapshot.
The current syscall transport copies bytes transiently through frames/SABs, as
any remote read does. There is no second mounted source body or write-through
source file in Vivari.

## Measured filesystem evidence

Real Chromium, COOP/COEP, QEMU Linux and Vivari workers; Browser Control CLI
0.7.0. Local raw receipts/screenshots are in ignored `evidence/`;
`measurements.json` commits their SHA-256 digests and condensed results.
Regenerate the summary with `bun scripts/summarize.ts` after capturing those files.

| Probe | Result | Linux fs RPCs | Elapsed |
|---|---|---:|---:|
| First process FS sequence | PASS | 21 | 4,221.77 ms |
| Warm rerun of same sequence | PASS | 21 | 1,056.66 ms |
| Extended semantics + Linux-only JS entry | PASS | 53 | 18,202.64 ms |
| Five write/read + Linux-observation sequences | PASS | 4 each | 216.03–266.56 ms |

The five warm sequence times were 252.68, 216.03, 220.50, 266.56 and 221.42 ms.
Their 20 filesystem RPCs had median **25.29 ms**, p95 **36.09 ms**, max
**40.22 ms**. These are page-relay → Linux → page times; total sequence times
also include worker spawn/module loading, SAB scheduling, and an independent
Linux shell `cat`. RPC counts exclude shell exec and local dependency operations.

The 94-RPC qualification used 103,488 JSON request characters and 101,554
response characters, including base64 framing. Its dominant operation was a
70,000-byte write: **13,850.71 ms** for one 93,436-character JSON request.
Two 32 KiB fd-read responses took 982.80 and 972.73 ms. The serial ingress is a
serious bulk-I/O bottleneck; small warm RPC latency is not a throughput estimate.

The **final polling-overlay runtime** also passed the entire qualification after
a fresh Linux boot. That run was substantially slower: 13,006.87 ms basic,
113,552.42 ms extended, and 1,026.98–1,953.99 ms for the five warm sequences.
Its warm RPC median was 165.73 ms, p95 277.09 ms, max 415.10 ms; the 70,000-byte
write took 81,206.70 ms. These are shared-machine browser measurements, not
controlled before/after benchmarks. Polling was not running during either
filesystem-only qualification, so the difference cannot be attributed to watcher
poll traffic. Do not promise the faster numbers as a latency guarantee.

Assertions cover:

- Linux-created file read by unmodified worker `fs.readFileSync`.
- Binary `[0,255,10,128]` worker write read immediately by Linux `od`.
- `stat`, `lstat`, `readdir`, mkdir/rmdir, rename replacement, symlink/readlink,
  hard links, append, open/close/fstat/ftruncate and positional fd read/write.
- Open fd retains its inode across rename **and unlink**.
- 70,000-byte binary roundtrip using short chunked reads; Linux independently
  reports the resulting byte count.
- `ENOENT`, `ENOTDIR`, `EEXIST`, `EISDIR`, `EBADF`, and cross-mount `EXDEV`.
- Linux modifies the worker-created inode; the worker immediately sees the
  new bytes through its hard link, with no synchronization operation.
- Both an actual JS **entry** and its `require('./module.cjs')` dependency exist
  only in Linux; Vivari prints `LINUX_ENTRY linux module`.

Unit checks use synthetic protocol replies and synthetic metadata, not a host
filesystem standing in for Linux. They verify the pending SAB state, no local
dispatch, dependency boundaries, rejection of source bulk writes, and watcher
replacement/deletion/recreation behavior. The upstream 90-process headless suite
passes with the wait/watcher overlays; the Linux mount itself is qualified by
the real browser run.

## Watching and limits

The first Vite run served the real React fixture (Vite reported 8,805 ms to
ready), but Linux edit → HMR **timed out after 90 seconds**. Investigation found
that upstream `internal/fs/watchers.js` implements **both** `fs.watch` and
`fs.watchFile` using VFS push notifications; `CHOKIDAR_USEPOLLING=true` alone is
ineffective. `scripts/poll-watch.ts` source-overlays `StatWatcher` with actual
Linux metadata polling for the mounted subtree. The test Vite uses a 2-second
interval. Only metadata is retained between polls; no source body is cached.

With that overlay, **Vite 7.1.4 served and HMR passed**. Vite reported 29,754 ms
to ready on the slower final run. Three Linux `sed -i` edits and restorations:

| Change | Linux edit → visible React heading | Linux fs RPCs during window |
|---|---:|---:|
| Edit 0 | 9,164.51 ms | 65 |
| Restore 0 | 7,189.24 ms | 47 |
| Edit 1 | 8,940.29 ms | 62 |
| Restore 1 | 6,372.24 ms | 48 |
| Edit 2 | 6,702.96 ms | 49 |
| Restore 2 | 12,200.29 ms | 69 |

Every sample asserted the same iframe `Document` object and `performance.timeOrigin`.
The real Vite log reported `hmr update /src/WelcomeCard.tsx`; the real HMR client
reported `hot updated`. Final heading is restored to `Ready for an agent edit`.
Counts include background stat polling and transform reads, exclude the shell
exec request, and do not imply one atomic operation. Linux command time alone
was 1,596.52–1,856.89 ms for the three edits. No save-sync button or VFS source
write was involved.

A subsequent 10,001.52 ms idle window still issued **8 Linux stat RPCs**, totaling
5,209.75 ms of relay roundtrip time. That is polling overhead with no user edit;
the requested 2-second timer interval is not a guaranteed detection deadline.

Remaining explicit limits:

- Native `fs.watch` on the mount returns `ENOSYS`. No inotify event transport.
  Stat polling can miss intermediate changes and timestamp/size/inode-preserving
  edits, and costs one RPC per watched path per interval. Full Node watcher
  ref/unref and bigint-zero-stat semantics are not qualified.
- Open handles are owned by the RPC client, but guest fd cleanup on abrupt worker
  kill and passing fds between processes are not implemented. There is no fsync,
  mmap, advisory locking, chmod/chown/utimes RPC surface, or full POSIX audit.
  The inherited Node stat binding derives all exposed time fields from mtime;
  full atime/ctime/birthtime fidelity is not provided despite richer guest data.
- All operations use Linux's own atomic syscall behavior; a sequence is not a
  transaction. Concurrent Linux edits can interleave. Linux's QEMU disk overlay
  is memory-only and is lost on reload.
- The original syscall window is 1 MiB. Whole-file guest reads over 512 KiB return
  `EFBIG`; fd reads return at most 32 KiB. Runtime fd writes can still generate
  large serial frames. Files over the window, cancellation, and saturation need
  qualification before relying on this for large projects.
- The 300-second FS timeout does not cancel a Linux operation. A timed-out write
  may still complete; do not retry mutations blindly. No reconnect/replay layer.
- Mount selection is lexical after the runtime's normal path resolution. Symlinks
  across the local-dependency boundary, arbitrary raw syscall paths, and root
  directory union details need a formal mount resolver. This trusted prototype
  is not a filesystem security boundary.
- There is no mount-level content or stat cache. Node's normal per-process module
  cache and Vite's own transform cache still exist. Local VFS structural parent
  directories can exist to hold dependencies; mounted source lookups bypass them.
- Large/batch SDK writes to mounted source explicitly fail. Kernel download/batch
  paths and SDK recursive operations need mount-aware equivalents for a complete
  general-purpose SDK filesystem. No generic Linux-shell JS execution dispatcher
  is installed by this filesystem spike.

## Recommended shared transport hooks

Keep this **deferred FsServer backend seam**, with one configured mount table.
Replace the origin-wide BroadcastChannel with a boot-provisioned dedicated
MessagePort connecting FS worker to the shared QEMU relay. The experimental
request is `{opcode, flags, client, fields}` (the existing Vivari ABI, fields
base64 in the serial frame); the response is `{body}` or `{error: errno}`.
Current sequence IDs and guest high-numbered fd handles demonstrate correlation
and ownership but should become session-scoped capabilities.

Use binary chunk framing, explicit queue/backpressure and client teardown hooks
in a dedicated QEMU channel before optimizing Vite startup. Add native Linux
watch subscription/event frames (watch ID, path, event, overflow/rescan), rather
than polling every source path. Metadata batching can reduce resolver startup
cost without storing another source tree. Keep dependency storage an explicit
submount, and give the execution/FFI dispatchers the **same Linux fd/path
authority**, rather than adding another sync service.

This proves a real shared source subtree through process syscall routing. It
does not yet constitute a complete POSIX mount or a general-purpose production
filesystem backend.
