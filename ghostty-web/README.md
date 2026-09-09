# Ghostty Web

A local browser terminal package (`@random/ghostty-web`) around **official Ghostty WASM**, with an xterm.js-style TypeScript interface and WebGL2 rendering. Its first consumer is [bun-web-terminal](../bun-web-terminal/README.md).

The public API follows familiar terminal operations: `open`, `write`, `resize`, `focus`, `dispose`, `onData`, `onResize`, selection, and addons. This is an xterm.js-style subset, not a promise of drop-in compatibility with every xterm.js API or addon.

## Use

In this repository, `bun-web-terminal` depends on `file:../ghostty-web`. Bun bundles the TypeScript directly. Serve `@random/ghostty-web/ghostty-vt.wasm` as `/ghostty-vt.wasm` alongside your application, with the `application/wasm` content type.

```ts
import { init, Terminal } from "@random/ghostty-web";

await init();
const terminal = new Terminal({
  cols: 80,
  rows: 24,
  rendererType: "webgl",
  copyOnSelect: false,
});
await terminal.open(document.getElementById("terminal")!);
terminal.onData(data => socket.send(data));
socket.addEventListener("message", event => terminal.write(event.data));
terminal.write("Hello from official Ghostty WASM\r\n");
```

Give the container a size and resize the terminal when its layout changes, either with `FitAddon` or measured cell dimensions. Use the terminal's bracketed-paste path for pasted text. The application owns the PTY, transport, authentication, and session lifecycle.

Use `init({ wasmUrl: "/assets/ghostty-vt.wasm" })` for a different asset route.
Concurrent initialization calls share one load; a failed load can be retried.

The active buffer exposes text/graphemes, cell styles, and absolute scrollback
coordinates. Reading an inactive named buffer is currently unsupported: it
returns empty state rather than the active screen's contents. History-line wrap
metadata is not yet exposed through this API. Low-level `wasmTerm` and `renderer`
access are package extensions rather than xterm.js compatibility guarantees.

## Architecture and provenance

- **Engine:** checked-in `vendor/ghostty-vt.wasm`, downloaded from the official `ghostty-org/ghostty` release. No patched Ghostty source, Zig compiler, or Coder npm WASM is needed at install or runtime.
- **Bridge:** `src/ghostty.ts` and the official ABI helpers translate the official C API into browser-friendly terminal state, rendering data, keyboard encoding, and terminal replies.
- **Browser layer:** rendering, input, selection, and addons live under `src/`. This layer preserves useful MIT-licensed code from [Coder's ghostty-web](https://github.com/coder/ghostty-web) and our former [`kkrausse/ghostty-web`](https://github.com/kkrausse/ghostty-web) fork at `a169a863599517272533b9c70789a09556a55b06`. It is maintained here as ordinary source, without the fork/submodule dependency. See [LICENSE](LICENSE).

The official artifact's release asset ID, SHA-256, source revision, and license are retained under `vendor/`. The `tip` release URL is mutable: an upgrade must pin a new artifact and adapt/test the matching ABI together. Never replace the binary from `tip` automatically during installation.

The bridge uses native bulk-row reads, dirty-state tracking, pooled cell objects,
and cached style decoding. See [measured engine/bridge performance](docs/performance.md)
for the comparison with the retired implementation and the benchmark's limits.

## Development

```sh
cd ghostty-web
bun install --frozen-lockfile
bun run typecheck
bun test
```

Run `bun run dev` and open `http://127.0.0.1:3108` for a minimal WebGL demo with
Unicode/color samples, scrollback, resizing, and local keyboard/IME echo. It
exposes `window.terminal` for inspecting engine state in the browser console.
Use `bun-web-terminal` for real shell/tmux integration.

Also run the consuming app's checks after bridge or input changes:

```sh
cd ../bun-web-terminal
bun install --frozen-lockfile
bun run typecheck
bun run test
```

DOM unit tests use Happy DOM and a mocked Canvas2D context. They do not establish visual correctness of the WebGL renderer; verify the app in a real WebGL2 browser, including resizing, scrolling, reconnects, selection/copy/paste, keyboard shortcuts, and IME. Real mobile software keyboards need a device check.
