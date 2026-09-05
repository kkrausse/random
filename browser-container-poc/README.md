# Browser container POC

v0 boots an x86-64 Alpine Linux guest under QEMU-Wasm in a browser worker and connects an interactive serial terminal.
It establishes the first milestone in [`plan.md`](./plan.md); it does **not** yet include OpenCode, Bun, Vite, or the
preview/HMR network bridge.

## Run

Chrome/Chromium is recommended. The runtime allocates a fixed 2.3 GB Wasm memory and a 512 MB guest, and downloads about
145 MB on first setup.

```sh
bun install
bun run artifacts
bun run dev
```

Open the printed local URL, choose **Start VM**, wait for `demo login:`, and log in as `root` with no password. The root
filesystem uses an in-memory overlay, so guest changes disappear when the iframe is restarted.

`bun run artifacts` downloads from the immutable `qemu-wasm-demo-images` revision in `artifacts.lock.json`. Every file is
validated against its expected Git blob hash and size. Generated artifacts live in `public/qemu/` and are not committed.

## What v0 proves

- QEMU system emulation starts in a browser without a host compute process.
- The x86-64 guest boots from pinned kernel, initramfs, ROM, and root filesystem artifacts.
- Browser input/output is connected to the guest serial console.
- Development and preview servers emit the COOP/COEP headers required by Wasm threads.

## Known boundary

The pinned upstream image is only a boot baseline (Alpine 3.21 with vim and Python). The next image revision needs pinned
Bun and stock OpenCode, fixture files and dependencies. After that, add an explicit guest HTTP/WebSocket bridge for Vite
assets and HMR. The empty preview pane intentionally does not claim those milestones are complete.

## Pinned upstream

- QEMU-Wasm source reviewed at `0ef7b4e2814b231705d8371dd7997f5b72e70baf` (experimental, QEMU licensing applies).
- Browser artifacts from `qemu-wasm-demo-images@b7c549b5e6f4c376f76483a03e983214421434ad`.
- Execution arguments select QEMU TCG with its Wasm hot-block compilation backend (`tcg,tb-size=500`).
