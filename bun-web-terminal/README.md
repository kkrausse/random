# Bun Web Terminal

A loopback-only web terminal using tmux for session state, Bun's native PTY API for attachments, and the local [ghostty-web](../ghostty-web/README.md) browser wrapper around official Ghostty WASM, rendered with WebGL2.

## Quick start

Requires Git, Bun 1.3.5 or newer, tmux 3.3 or newer on macOS or Linux, and a browser with WebGL2. On macOS, install tmux with `brew install tmux`. On Linux, set `SHELL` to an installed shell if needed (the fallback is `/bin/zsh`).

From a fresh clone:

```sh
git clone https://github.com/kkrausse/random.git
cd random/bun-web-terminal
bun install --frozen-lockfile
bun run dev
```

For an existing clone, run the last two commands from `bun-web-terminal/` after pulling updates. Use `bun start` instead of `bun run dev` to run without server file watching. Client assets are built automatically at startup. Restart Bun after browser-only or sibling wrapper changes so the client bundle and WASM are rebuilt together.

Open the **Mac sign-in** link printed at startup, or scan the QR on your phone
through Tailscale. After signing in, you can open <http://127.0.0.1:4784/sessions>
normally. Sessions keep running when the browser disconnects. The effective local Ghostty palette and font are loaded with `ghostty +show-config --default` at startup.

Desktop Ghostty is optional; without it, the app uses a fallback theme. Tailscale is optional for remote access, and the sibling dictation service is optional for voice input. Neither is required for a local terminal.

## Ghostty dependencies and copying this directory

The `@random/ghostty-web` dependency is linked from `../ghostty-web`. It contains the browser renderer/input wrapper and a checked-in, checksum-pinned **official `ghostty-org/ghostty` WASM release artifact**. Startup bundles its TypeScript and copies its WASM into the client build directory. There is no Git submodule, npm `ghostty-web` engine dependency, Zig build, or runtime artifact download.

For a standalone copy or source ZIP, include **both sibling directories**, preserving this layout:

```text
your-project/
  bun-web-terminal/
  ghostty-web/
```

Then run `bun install --frozen-lockfile` and `bun start` inside `bun-web-terminal/`. You do not need to install the wrapper's development dependencies to run the app. Dictation additionally needs the sibling service or an explicitly configured service URL; see below.

If startup reports a missing `@random/ghostty-web` package or WASM, ensure the sibling directory is present and reinstall the app's Bun dependencies. WebGL2 must be enabled in the browser; the app reports an error rather than falling back to Canvas2D. See the wrapper README for artifact provenance and coordinated engine/bridge upgrades.

## Sign-in and access

On first startup, the server generates a cryptographically random 256-bit access secret
and signing key and stores both persistently: in macOS Keychain on a Mac, or a
private user-state file on Linux. Later starts reuse them. The
printed sign-in links and QR contain it in a URL fragment (`/login#key=…`). The
sign-in page immediately removes the fragment from the address bar and exchanges
the secret for a signed, HttpOnly, SameSite=Strict cookie. HTTPS cookies are also
Secure; direct localhost HTTP uses a separate cookie restricted by the server to
loopback connections. Phone/Tailscale and localhost require separate initial
sign-ins. Cookies last up to 30 days and survive Bun restarts and watch reloads.

On macOS, credentials use a generic-password item with service `bun-web-terminal.auth.v1`
and account `port-3000` for the default port `4784`, preserving existing sign-ins
from the old default port. Other configured `PORT` values use `port-<PORT>`.
Running instances on ports 3000 and 4784 therefore share credentials; do not
reset authentication for one unless you intend to revoke sign-ins for both.
macOS may request Keychain access; a locked or inaccessible Keychain stops startup
rather than silently rotating credentials or writing a plaintext fallback.
On Linux, credentials live in `$XDG_STATE_HOME/bun-web-terminal/port-<PORT>.auth`
(default `~/.local/state/bun-web-terminal/port-<PORT>.auth`). The default listener
port `4784` uses `port-3000.auth`, matching the same compatibility mapping as macOS.
The directory is created with mode `0700`, and files with mode `0600`. These files
contain both secrets in plaintext (base64 is not encryption); protect them and
any backups as passwords. Unsafe permissions, symlinks, corrupt files, or storage
errors stop startup rather than silently generating a replacement. Concurrent
first starts reuse the same atomically published credentials.
No credential file is stored in the repo. Keep the same user, port, and Linux
state directory across restarts to preserve sign-ins. Relative `XDG_STATE_HOME`
values are ignored, per the XDG specification.

**To revoke all sign-ins:** stop the server, run `bun run auth:reset`, then start
it again. Use the same `PORT` for the reset command if customized. The next start
creates new credentials; browsers must use the new sign-in link. Resetting the
stored credentials alone does not revoke a running server's in-memory credentials.
Running tmux sessions survive either kind of restart. Upgrading from the old
in-memory authentication requires one final sign-in on the first restart.

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

## Always-on Linux service

A systemd **user** service is recommended for a stable Linux host. It restarts
Bun after failures and preserves the same credentials. Install dependencies
with `bun install --frozen-lockfile` in this project first, and configure
Tailscale Serve **before** starting the service:

```sh
tailscale serve --bg --https=443 4784
tailscale serve status
mkdir -p ~/.config/systemd/user
```

Check existing Serve routes before configuring one; the command sets the root
route on HTTPS port 443. Do not use Funnel for private tailnet access.

Save this as `~/.config/systemd/user/bun-web-terminal.service`, replacing the
project path, Bun path, and Tailscale hostname with your own values. `%h` means
your home directory. Set `SHELL` to an installed shell.

```ini
[Unit]
Description=Bun Web Terminal

[Service]
Type=simple
WorkingDirectory=%h/devfs/repos/kkrausse/random/bun-web-terminal
ExecStart=%h/.bun/bin/bun src/server.ts
Environment=PATH=%h/.bun/bin:/usr/local/bin:/usr/bin:/bin
Environment=SHELL=/bin/bash
Environment=HOST=127.0.0.1
Environment=PORT=4784
Environment=TERMINAL_PUBLIC_URL=https://YOUR-MACHINE.YOUR-TAILNET.ts.net/sessions
UMask=0077
Restart=on-failure
RestartSec=5
# Do not kill tmux/session processes in the service cgroup on a Bun restart.
KillMode=process

[Install]
WantedBy=default.target
```

The explicit HTTPS URL keeps remote sign-in configured even if Tailscale is not
yet running when Bun starts. Keep the default state directory (or explicitly set
the same `XDG_STATE_HOME` as your manual launch); switching it creates a separate
set of credentials. `KillMode=process` intentionally leaves tmux children running
when the service stops. Stop unwanted sessions using tmux or the sessions menu.

```sh
systemctl --user daemon-reload
systemctl --user enable --now bun-web-terminal
systemctl --user status bun-web-terminal
journalctl --user -u bun-web-terminal -n 60 --no-pager
```

The journal contains the secret sign-in link/QR: do not share those logs.
Sign in once using the printed HTTPS link, then bookmark `/sessions`.
Use `systemctl --user restart bun-web-terminal` after updates. Stop any manually
running instance on the same port before enabling the service.

To keep the user service running after logout and start it at boot, an
administrator may need to enable lingering:

```sh
sudo loginctl enable-linger "$USER"
```

Bun restarts preserve tmux sessions and browser logins. Machine reboots preserve
credentials, but terminate running tmux processes. To reset auth, stop the
service, run `bun run auth:reset` as the same user with the same state directory
and port, and start the service again.

## Phone controls

- Tap the terminal to click in a mouse-aware application. The click is sent only when you lift your finger without dragging. Swipe vertically to scroll the application or tmux history; gestures use the same wheel encoding and sensitivity as desktop scrolling. A small movement threshold distinguishes taps from drags, and lifting your finger stops scrolling.
- Tap a link once to open it in a new tab without sending a click to the application or opening the keyboard. Explicit terminal hyperlinks work across multiple rows; plain URLs are joined across terminal soft wraps, not arbitrary hard line breaks. Swipes and long presses never open links.
- A two-row extra-keys bar appears on touch devices and narrow windows: **keyboard icon**, **microphone icon**, **Esc**, **Enter**, one-shot **Ctrl**, arrows, and **Paste**/**Attach** icons. Buttons have equal widths within each row; the bottom row is inset from the sides. Tap **Ctrl**, then a letter (for example **C** to interrupt or **U** to clear the shell input). The keyboard icon explicitly opens/closes the software keyboard; terminal taps and extra keys leave keyboard focus alone. Touch devices do not autofocus on page load.
- Hold a finger still on terminal text for half a second, then drag to select. Like desktop dragging, this sends mouse press/drag/release to mouse-aware applications such as OpenCode, which handle their own selection and copying. At the shell or in applications without mouse support, it highlights locally. The next swipe scrolls normally. Moving before the hold completes scrolls instead of selecting.
- **Paste** uses the browser clipboard and the terminal's bracketed-paste handling. It needs HTTPS (or localhost) and browser clipboard permission; use the phone keyboard's paste action if access is unavailable. Pasting or dropping files of any type (up to 200 MiB each) uploads them to `$TMPDIR/bun-web-terminal/<session>/` and types the saved paths at the cursor; the files are deleted when the session is removed. iOS gives a page nothing for a copied file such as a PDF, so on a phone use the **Attach** (paperclip) key to choose files instead.
- The terminal fits the visible viewport above the software keyboard and sends the updated dimensions to tmux. The existing engine handles mobile text/composition input with autocorrect and capitalization disabled.
- The keys bar leaves a 22px bottom gap (half a button height), or the device's bottom safe-area inset if larger.

For a phone check, open the Tailscale HTTPS URL below, try swiping inside a mouse-aware application, open/close the keyboard and rotate the phone, then try **Ctrl+C**, selection/copy, and paste. Actual software-keyboard behavior should be checked on the target phone; desktop touch-event simulation cannot fully reproduce it.

Compact light-blue notices in the top-right show connection status and confirm successful browser clipboard writes with a brief “Copied” toast. Application copy actions (including OpenCode) are handled through OSC 52. If iOS blocks the automatic write, tap the persistent **Tap to copy** button in the top-right to copy the exact application-selected text. No terminal highlighting is needed. The button retains the latest request until copied or the terminal reconnects/leaves the page. Clipboard access requires HTTPS (or localhost). tmux must have `set-clipboard on` and clipboard support for the attached terminal (`xterm-256color`); `external` ignores application copy requests.

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
owns child shutdown. The phone starts capturing as soon as microphone permission
and its audio processor are ready, without waiting for the model. The browser
prepares the audio processor on page load without requesting microphone access;
the mic button shows **Mic access…**, **Audio processor…**, or **Audio startup…**
until the first actual audio packet confirms recording. These steps can still
take time on a phone, especially on the first permission request.

On your phone, open the terminal through the Tailscale **HTTPS** URL. Tap the mic,
allow microphone access, and speak even if the connection is still loading. Tap
**Stop** to flush the last word. A tap during microphone startup cancels.
Starting dictation preserves keyboard visibility and clears one-shot Ctrl.
Audio comes from the phone; transcription
runs on the Mac. Only one remote recording can run at once.

Whole words are pasted live at the application's current cursor, with the pending
word previewed above the bar. Finalization releases the tail once. Dictation
removes terminal controls/newlines from dictated text. Pressing Enter during
dictation stops recording, waits for the final transcript, then sends Enter once;
failed or revised transcripts are not automatically submitted. Tapping Stop alone
does not send Enter. Stop
before moving the application's cursor or changing contexts. If the model revises
an observed prefix, automatic insertion stops and the final transcript remains
in the selectable preview for recovery.

The phone retains up to five minutes of audio in memory (about 19 MB raw) while
recording, even when the server is unavailable. Inference acknowledgments pace
uploads; if the dictation socket drops, a new decoder session replays the entire
recording. Already inserted text is not pasted again; if the replay changes that
prefix, automatic insertion stops and the recovery transcript stays visible.
Temporary terminal disconnection also waits for reattachment, but a permanent
takeover, navigation, or page suspension cancels capture. Stop waits for buffered
audio and the final transcript (up to five minutes); it cannot preserve capture
through phone sleep, browser termination, or a page reload. Server-side transport
queues remain bounded to about two seconds, and the five-minute capture cap is
explicit.

After Stop, the phone keeps its microphone stream open but muted for up to 30
seconds so the next dictation can reuse it without another `getUserMedia()` startup.
The toolbar visibly says **Mic on · muted** while this is happening; the browser
may also keep its microphone-use indicator on. The stream is released on expiry,
terminal detachment, page navigation, or backgrounding. The first tap after the
page opens still needs normal microphone startup.

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
- **Cmd+click** a link (Ctrl+click off macOS) to open it in a new tab; the click is not sent to tmux or the application. This covers plain URLs and explicit OSC 8 hyperlinks, such as the labelled links Claude Code and OpenCode print. The browser attachment advertises tmux's `hyperlinks` feature for itself only (tmux 3.4 or newer), since tmux otherwise drops OSC 8 for an `xterm-256color` client. An application decides for itself whether to emit OSC 8; inside tmux some need `FORCE_HYPERLINK=1`.
- **Ctrl+V** reaches the application, including Emacs. Use **Cmd+V** on macOS or **Ctrl+Shift+V** on other platforms to paste.
- Desktop shell drags select in tmux copy mode, including lines from before the browser connected. Holding a drag at the top or bottom scrolls tmux history and extends the selection. The tmux highlight stays after release without copying; **Cmd+C** explicitly copies the selected text to the browser clipboard and tmux's paste buffer. Typing returns to the shell. Mouse-aware applications still receive clicks and drags. Hold **Shift** while dragging for Ghostty Web's local selection instead. Phone touch selection retains its local selection. The server checks the inner pane's mouse modes every 150 ms, so switching may take a moment.

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

To test alongside a manually used instance on port 4784, use a separate port **and build directory**:

```sh
PORT=3107 TERMINAL_DIST="$(mktemp -d)" bun start
```

Open the printed Mac sign-in link, start `btop`, repeatedly resize the window, then click the connection indicator and reload the page. Confirm that btop remains usable and the same process survives. Open the same session URL in another tab to check takeover. Test shell history scrolling and application scrolling separately. Restart Bun or edit source under `dev` (`--watch`), sign in with the new link, and confirm that the same running application is available. Parallel app instances share the standard tmux sessions.

To expose it only to devices permitted by your tailnet policy, keep the app bound to its default loopback address and run Tailscale Serve in another terminal:

```sh
tailscale serve --bg --https=443 4784
tailscale serve status
```

Open the reported `https://<machine>.<tailnet>.ts.net/sessions` URL. Tailscale terminates HTTPS and proxies HTTP and WebSocket traffic to `127.0.0.1:4784`. Remove the Serve configuration with `tailscale serve reset` (this also removes any other Serve routes on the machine).

Startup prints a scannable QR code and sign-in links. It automatically
detects an existing Tailscale Serve HTTPS root route pointing to this instance's
port. Scan it with your phone while connected to Tailscale. You can also set
`TERMINAL_PUBLIC_URL=https://your-host/sessions` to choose the QR link explicitly
(a bare origin gets `/sessions` appended). Without either, the QR points to
localhost and is only useful on the hosting machine. Configure Serve before
starting Bun so the HTTPS origin is discovered and accepted for sign-in.

Environment variables:

- `PORT`: HTTP port, default `4784`
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

The app requests `rendererType: "webgl"` from the local wrapper and shows an error instead of silently falling back to Canvas2D when WebGL2 is unavailable.
