# Bun Web Terminal

A loopback-only web terminal using tmux for session state, Bun's native PTY API for attachments, and the WebGL2 renderer from the `ghostty-web` `xterm-webgl` branch.

## Quick start

Requires Git, Bun 1.3.5 or newer, tmux 3.3 or newer on macOS or Linux, and a browser with WebGL2. On macOS, install tmux with `brew install tmux`. On Linux, set `SHELL` to an installed shell if needed (the fallback is `/bin/zsh`).

From a fresh clone:

```sh
git clone https://github.com/kkrausse/random.git
cd random/bun-web-terminal
git submodule update --init vendor/ghostty-web
bun install --frozen-lockfile
bun run dev
```

For an existing clone, run the last three commands from `bun-web-terminal/` after pulling updates. Use `bun start` instead of `bun run dev` to run without file watching. Client assets are built automatically at startup.

Open the **Mac sign-in** link printed at startup, or scan the QR on your phone
through Tailscale. After signing in, you can open <http://127.0.0.1:3000/sessions>
normally. Sessions keep running when the browser disconnects. The effective local Ghostty palette and font are loaded with `ghostty +show-config --default` at startup.

Desktop Ghostty is optional; without it, the app uses a fallback theme. Tailscale is optional for remote access, and the sibling dictation service is optional for voice input. Neither is required for a local terminal.

## Ghostty dependencies and copying this directory

This app uses two complementary dependencies:

- **Browser source:** `vendor/ghostty-web` is a submodule of [kkrausse/ghostty-web](https://github.com/kkrausse/ghostty-web), our fork of [Coder's ghostty-web](https://github.com/coder/ghostty-web). It supplies the WebGL2 renderer and input/selection/clipboard behavior. Git checks out the exact commit recorded by this repo; the `xterm-webgl` branch is its development branch.
- **Precompiled terminal engine:** the exact `ghostty-web` npm version in `package.json` and `bun.lock` supplies `ghostty-vt.wasm`. Startup copies that binary into the client build directory. Coder's library wraps the official Ghostty terminal engine for browsers; it is a separate project from `ghostty-org/ghostty`.

The app bundles the fork's TypeScript directly. Running it does **not** require Zig, building Ghostty/WASM, installing dependencies inside the vendor folder, or initializing the vendor's nested Ghostty submodule. Keep the source pin and npm/WASM version together when upgrading, and run the checks below.

Prefer cloning this repository: the submodule configuration is in its root `.gitmodules`. A source ZIP or a copy of only `bun-web-terminal/` may omit the vendor source. For a standalone copy with an absent or empty `vendor/ghostty-web`, populate it explicitly from this version's pin:

```sh
# Run inside the standalone bun-web-terminal directory.
git clone https://github.com/kkrausse/ghostty-web.git vendor/ghostty-web
git -C vendor/ghostty-web checkout --detach a169a863599517272533b9c70789a09556a55b06
bun install --frozen-lockfile
bun start
```

If distributing a self-contained copy, include the populated vendor source rather than a submodule placeholder. Dictation additionally needs the sibling service or an explicitly configured service URL; see below.

If startup reports missing `vendor/ghostty-web/lib` imports, initialize the submodule (or use the standalone procedure). A missing `ghostty-web/ghostty-vt.wasm` means the app's Bun dependencies need installing. WebGL2 must be enabled in the browser; the app reports an error rather than falling back to Canvas2D.

## Sign-in and access

Every startup generates a cryptographically random 256-bit access secret. The
printed sign-in links and QR contain it in a URL fragment (`/login#key=…`). The
sign-in page immediately removes the fragment from the address bar and exchanges
the secret for a signed, HttpOnly, SameSite=Strict cookie. HTTPS cookies are also
Secure; direct localhost HTTP uses a separate cookie restricted by the server to
loopback connections. Phone/Tailscale and localhost require separate initial
sign-ins. Cookies last up to 30 days, or until Bun restarts.

**Restart Bun to rotate the secret and revoke all existing sign-ins.** This also
applies to `bun --watch` reloads. Running tmux sessions survive, but browsers must
use the newly printed link. No password or session keys are saved to disk.

All application pages, assets, APIs, terminal WebSockets, and dictation WebSockets
require authentication. Direct unauthenticated API requests receive `401`;
browser page visits go to the sign-in instructions. Only configured hosts are
accepted, and browser Origin checks use the configured origins rather than
trusting forwarded headers. Remote access requires the configured HTTPS origin;
plain HTTP sign-in is only supported over loopback.

Anyone with a sign-in link and network access can sign in, so treat the startup
output/QR as a password. A compromised tailnet device cannot sign in merely by
being on Tailscale: it also needs the secret or a valid browser cookie. Keep those
off other tailnet devices, and restrict Tailscale access to this service where
possible. HTTPS protects traffic; this authentication adds a separate access
check. It does not protect a compromised hosting Mac or authenticated browser.

Terminal pages reconnect automatically after network interruptions or a suspended tab. Use the connection indicator in the top-right corner to force a fresh attachment and redraw.

## Phone controls

- Tap the terminal to click in a mouse-aware application. The click is sent only when you lift your finger without dragging. Swipe vertically to scroll the application or tmux history; gestures use the same wheel encoding and sensitivity as desktop scrolling. A small movement threshold distinguishes taps from drags, and lifting your finger stops scrolling.
- A horizontally scrollable extra-keys bar appears on touch devices and narrow windows: **keyboard icon**, **microphone icon**, **Esc**, **Tab**, one-shot **Ctrl**, arrows, **Paste**, **Select**, and **Copy**. Tap **Ctrl**, then a letter (for example **C** to interrupt or **U** to clear the shell input). The keyboard icon explicitly opens/closes the software keyboard; terminal taps and extra keys leave keyboard focus alone. Touch devices do not autofocus on page load.
- Hold a finger still on terminal text for half a second, then drag to select. Like desktop dragging, this sends mouse press/drag/release to mouse-aware applications such as OpenCode, which handle their own selection and copying. At the shell or in applications without mouse support, it highlights locally; tap **Copy** after release. The next swipe scrolls normally. Moving before the hold completes scrolls instead of selecting. Alternatively, tap **Select** to force persistent local drag-to-select mode (and use **Copy**) even in mouse-aware applications; toggle it off to resume swipe scrolling.
- **Paste** uses the browser clipboard and the terminal's bracketed-paste handling. It needs HTTPS (or localhost) and browser clipboard permission; use the phone keyboard's paste action if access is unavailable.
- The terminal fits the visible viewport above the software keyboard and sends the updated dimensions to tmux. The existing engine handles mobile text/composition input with autocorrect and capitalization disabled.

For a phone check, open the Tailscale HTTPS URL below, try swiping inside a mouse-aware application, open/close the keyboard and rotate the phone, then try **Ctrl+C**, selection/copy, and paste. Actual software-keyboard behavior should be checked on the target phone; desktop touch-event simulation cannot fully reproduce it.

Compact light-blue notices in the top-right show connection status and confirm successful browser selection copies with a brief “Copied” toast. Copy failures show an error instead; application-owned clipboard operations do not trigger this toast.

## Streaming dictation

Build the sibling Swift service once on the hosting Apple Silicon Mac:

```sh
../dictation-server/build.sh
bun start
```

The service reuses the cached English Parakeet Unified 1.1-second model from the
local Swift Hex app, under `~/Library/Application Support/FluidAudio/Models/parakeet-unified-en-0.6b/`.
It does not download models. See [service setup](../dictation-server/README.md)
for the exact required assets and standalone commands. Bun launches the release
executable on the first status/recording request, keeps the model resident, and
owns child shutdown. Initial model loading is shown separately from recording.

On your phone, open the terminal through the Tailscale **HTTPS** URL. Tap the mic,
allow microphone access, wait for **Stop**, and speak. Tap **Stop** to flush the
last word. A tap during **Loading…** cancels. Starting dictation preserves keyboard
visibility and clears one-shot Ctrl. Audio comes from the phone; transcription
runs on the Mac. Only one remote recording can run at once.

Whole words are pasted live at the application's current cursor, with the pending
word previewed above the bar. Finalization releases the tail once. Dictation
never sends Enter and removes terminal controls/newlines from dictated text. Stop
before moving the application's cursor or changing contexts. If the model revises
an observed prefix, automatic insertion stops and the final transcript remains
in the selectable preview for recovery.

Disconnect, takeover, navigation, or page suspension cancels capture and releases
the microphone; already pasted text remains. Dictation never resumes or replays
automatically after reconnect. Recordings are capped at five minutes, with bounded
audio queues and explicit overload errors.

| Environment variable | Default / meaning |
| --- | --- |
| `DICTATION_EXECUTABLE` | `../dictation-server/.build/release/dictation-server`, resolved relative to this project |
| `DICTATION_PORT` | `9876`; choose another for independent Bun instances |
| `DICTATION_MODEL_DIR` | Override the service model cache directory |
| `DICTATION_URL` | Optional loopback HTTP origin, e.g. `http://127.0.0.1:9876`; externally managed mode, so Bun neither spawns nor terminates it |

The Swift service stays on loopback. The existing Tailscale Serve route covers
both terminal and dictation WebSockets. Other hosts can use an explicitly
configured loopback service, while managed mode requires Apple Silicon macOS.

Diagnostics: `GET /api/dictation/status` reports availability/model state without
paths or transcripts. Service logs go to Bun's stderr. Missing executable/cache
or model errors show a dictation notice; a fresh tap retries connection failures.
Restart Bun after building to load the updated routes and client assets.

See [protocol](../dictation-server/docs/protocol.md),
[verification results and phone checks](docs/mobile-dictation-verification.md),
and [third-party notices](docs/third-party-notices.md).

## Session behavior

- The sessions menu and terminal tab favicon recognize Emacs (including `emacsclient`) and show its bundled logo, and recognize OpenCode (including `opencode2` and `OC | …` titles) with a text `OC` badge.
- Sessions created from a phone or tablet browser (detected via user-agent) are named `web-<uuid>-phone`; API clients can pass `{"label":"phone"}` for the same suffix.

- **Rename** in the sessions menu changes the tmux session name. Names are separate from the short tmux ID used for URLs and attachments, so renaming preserves links and running processes. Names must be unique on the tmux server and contain 1–128 characters without dots, colons, or control characters.

- Uses your standard tmux server and configuration. Existing sessions appear automatically; new browser-created sessions are named `web-<uuid>`, with their status bar hidden and mouse support enabled. Global options and key bindings are left to your tmux configuration.
- Refreshing or reconnecting attaches a fresh PTY to the same running application. tmux redraws the current screen and negotiates terminal modes; the browser never replays a truncated output log or historical terminal queries.
- One tab per Bun instance controls a session at a time. Opening it elsewhere detaches the previous tab, which shows **Take over** instead of repeatedly reconnecting. Native tmux clients can remain attached alongside the browser.
- Sessions survive browser disconnections, Bun shutdowns, and code reloads. Startup discovers existing sessions, and the list refreshes every two seconds. Terminal URLs use tmux session IDs, so renaming a session keeps its URL working while the tmux server lives. Removing a session in the browser kills that tmux session. Machine reboots or killing tmux still end the processes.
- Sessions created by the older isolated-server version are not automatically migrated; that older running Bun process still ends them on shutdown.
- Resizing settles for 150 ms in the browser and is coalesced again at the PTY. Output is delivered in batches of at most 32 KiB, with at most 128 KiB awaiting browser acknowledgment and 512 KiB queued. A stalled attachment is dropped and restored from tmux rather than accumulating unlimited work.
- Scrolling runs at 50% sensitivity and accumulates fractional trackpad deltas. Shell history and copy-mode bindings follow your tmux configuration; with mouse support enabled, scrolling up enters copy mode. Applications with mouse support receive normalized wheel input.
- **Ctrl+V** reaches the application, including Emacs. Use **Cmd+V** on macOS or **Ctrl+Shift+V** on other platforms to paste.
- Drag normally to highlight text at the shell or in applications without mouse support; **Cmd+C** copies it and the highlight stays after release. Mouse-aware applications automatically receive clicks and drags instead. Hold **Shift** while dragging to force local highlighting in those applications. The server checks the inner tmux pane's mouse modes every 150 ms while attached, so switching may take a moment. tmux copy mode also uses local highlighting. Auto-copy is disabled; toggle `copyOnSelect` in `src/client.ts` to enable it. Scrolling still goes through tmux.

The browser terminal and tmux negotiate their own capabilities; programs inside tmux use your configured `default-terminal`. Ghostty-web remains the rendering/input engine, so engine-specific keyboard or rendering limitations can still be investigated independently.

## Development and stress checks

```sh
bun run typecheck
bun run test
```

Tests use isolated tmux servers and the same Ghostty WASM as the browser. They cover live application state across SessionManager shutdown/recreation, existing-session discovery, renames/removal, alternate-screen reattachment, 300 coalesced resize requests, tab takeover, output acknowledgments/stalls, and fractional scrolling.

Dictation tests also cover resampling continuity/filtering, transcript divergence,
Unicode/spacing/control removal, final deduplication, protocol order, attachment
ownership, cancellation, and proxy forwarding. To verify managed Swift lifecycle
with the built executable, run `bun docs/verify-dictation-supervision.ts`. For real
model/reset/overload checks, run the service's `scripts/verify.ts` as documented
in its README.

To test alongside a manually used instance on port 3000, use a separate port **and build directory**:

```sh
PORT=3107 TERMINAL_DIST="$(mktemp -d)" bun start
```

Open the printed Mac sign-in link, start `btop`, repeatedly resize the window, then click the connection indicator and reload the page. Confirm that btop remains usable and the same process survives. Open the same session URL in another tab to check takeover. Test shell history scrolling and application scrolling separately. Restart Bun or edit source under `dev` (`--watch`), sign in with the new link, and confirm that the same running application is available. Parallel app instances share the standard tmux sessions.

To expose it only to devices permitted by your tailnet policy, keep the app bound to its default loopback address and run Tailscale Serve in another terminal:

```sh
tailscale serve --bg 3000
tailscale serve status
```

Open the reported `https://<machine>.<tailnet>.ts.net/sessions` URL. Tailscale terminates HTTPS and proxies HTTP and WebSocket traffic to `127.0.0.1:3000`. Remove the Serve configuration with `tailscale serve reset`.

Startup prints a scannable QR code and sign-in links. It automatically
detects an existing Tailscale Serve HTTPS root route pointing to this instance's
port. Scan it with your phone while connected to Tailscale. You can also set
`TERMINAL_PUBLIC_URL=https://your-host/sessions` to choose the QR link explicitly
(a bare origin gets `/sessions` appended). Without either, the QR points to
localhost and is only useful on the hosting machine. Configure Serve before
starting Bun so the HTTPS origin is discovered and accepted for sign-in.

Environment variables:

- `PORT`: HTTP port, default `3000`
- `TERMINAL_PUBLIC_URL`: optional HTTPS origin or `/sessions` URL for remote sign-in; otherwise detected from Tailscale Serve, falling back to localhost
- `HOST`: bind address, default `127.0.0.1`; `0.0.0.0` permits a remote HTTPS reverse proxy (authentication still required)
- `TERMINAL_CWD`: shell working directory, default is this repository's parent directory
- `TERMINAL_FONT`: browser terminal font stack, default `ui-monospace, SFMono-Regular, Menlo, Monaco, monospace`
- `TERMINAL_SCROLL_SENSITIVITY`: wheel scroll multiplier, default `0.5` (was `0.35`)
- `TERMINAL_DIST`: client build output directory, default `dist`; use a separate directory for parallel test instances
- `SHELL`: shell executable, default `/bin/zsh`

Tailscale Serve terminates HTTPS; keep Bun bound to loopback for this setup. App
authentication is required in addition to tailnet access. For another reverse
proxy, preserve the original Host header and set `TERMINAL_PUBLIC_URL` to its
HTTPS origin.

`vendor/ghostty-web` is a Git submodule pinned to the WebGL renderer branch. The app requests `rendererType: "webgl"` and shows an error instead of silently falling back to Canvas2D when WebGL2 is unavailable.
