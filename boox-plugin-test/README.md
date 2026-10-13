# Reading Context

Android reading assistant for a BOOX Palma 2. It captures a highlight plus surrounding context from Kindle, Substack, or Google Chrome, sends that context to a dedicated OpenCode Server v2 (`@opencode/cli` `2.0.27`) over Tailscale, and provides persistent reading chats on the device.

## Architecture

```text
Kindle, Substack, or Google Chrome on Palma 2
  -> Android accessibility service
  -> Reading Context Android app
  -> shared TypeScript client (client/, in a hidden WebView)
  -> HTTP Basic over Tailscale
  -> OpenCode Server v2 on Raspberry Pi
  -> configured model provider

Desktop Chrome page
  -> Chrome extension side panel
  -> the same shared TypeScript client
  -> the same server and chats
```

Both front ends talk to OpenCode only through `client/`, a small normalized layer over the official `@opencode/client`. The extension imports it; the Android app ships it as one bundled script (`app/src/main/assets/reading-client.js`) and calls it across a JavaScript bridge. The API and the bridge contract are in `client/README.md`.

The deployed components are intentionally isolated:

| Component | Value |
| --- | --- |
| Android package | `dev.kkrausse.kindlecontext` |
| Kindle package | `com.amazon.kindle` |
| Substack package | `com.substack.app` |
| Chrome package | `com.android.chrome` |
| Server hostname | `raspberrypi.example.ts.net` |
| Tailscale IPv4 | `100.64.0.10` |
| Server port | `41137` |
| Server URL | `http://raspberrypi.example.ts.net:41137` |
| systemd service | `palma2-opencode.service` |
| Deployment root | `/home/pi/deploys/palma2-opencode` |
| OpenCode location | `/home/pi/deploys/palma2-opencode/workdir` |

Port `41137`, the service name, and the deployment root distinguish this instance from other OpenCode processes on the Pi. The service binds only to the Pi's Tailscale address, not its LAN address or every interface.

Plain HTTP is intentional because traffic is carried inside Tailscale. OpenCode still requires HTTP Basic authentication.

## Reading Flow

1. Highlight text in Kindle, Substack, or Google Chrome while its selection toolbar is visible.
2. Press the floating `K` accessibility shortcut.
3. The service captures prose nodes intersecting the physical display, remembers exposed book or article metadata, and builds a rolling context window.
4. The service invokes an exposed `Copy` action, including a transient action from an accessibility event or a separate selection-toolbar window when available.
5. The app opens and reads the copied highlight with Android's foreground clipboard access.
6. Choose a prompt template or enter a custom question.
7. The app creates an OpenCode session and sends the configured surrounding-context window, the highlight, and the question. The default context limit is 2,000 words.
8. The chat screen streams response updates from OpenCode's event endpoint, accepts follow-up messages, and shows current-session token, cache, and cost totals below the return button.
9. Use `CHATS` to reopen sessions stored by the server or the source-app button to return to the app captured most recently. Return uses that app's launcher, so exact tab or reading-position restoration depends on the source app.

The initial prompt identifies the source app and includes the title and author when the reader exposes them, then combines captured snapshots into one chronological surrounding-context section without page labels. Kindle metadata comes from the selected library cover; Substack metadata comes from article title, byline, and heading semantics. A changed snapshot must share at least 12 consecutive words with the prior snapshot before earlier pages are retained; otherwise it starts a new context chain and clears stale metadata. This prevents text from another book in the same reader app from leaking into the prompt when the reader does not expose a stable book identifier. Kindle library screens are excluded from prose capture. The prompt uses XML-style boundaries to separate source material from the reader's instructions. Captured text is escaped so it cannot close or alter those boundaries. By default, the app sends at most 2,000 words and centers the highlighted passage in that window, splitting the remaining budget between earlier and later text. Highlight matching ignores case, punctuation, and whitespace differences. The compact capture preview uses a separate whitespace-collapsed 30-word window so it can show and bold the matched passage, with the number of omitted words reported on either side; the full configured window retains its paragraph formatting and is still sent to the model. If the highlight still cannot be matched in the accessibility prose, the exact copied highlight remains in its separate prompt field, the latest captured words are used as surrounding context, and the preview displays a warning. The limit is configurable in Android Settings. The question remains last.

If the source app does not expose `Copy` or readable clipboard text, the app falls back to standard accessibility selection offsets. The surrounding context remains available when no highlight can be recovered.

Kindle, Substack, and Google Chrome (`com.android.chrome`, not BOOX NeoBrowser) are declared as source profiles in `KindleAccessibilityService`. The service polls only these known sources for rolling context. Chrome captures from its WebView rather than its browser toolbar and clears old context when the address-bar location changes. Captured package and app label drive return navigation, and context history resets when switching apps so text from separate sources is not mixed. Websites with inaccessible prose or browser error pages may provide incomplete or no capture. A generic, on-demand handler for other apps is follow-on work, not part of the current capture path.

Kindle retains copied selections as annotations. Automatic deletion is intentionally not attempted because Copy closes and invalidates the selection toolbar before its accessible `Delete Highlight` action can run. See `progress_20260801_113544.md` for tested alternatives.

Follow-on work: investigate a generic, explicitly triggered capture for other apps.

## Repository Layout

```text
app/                                  Android application
app/src/main/assets/reading-client.js Built shared client for the Android WebView
client/                               Shared OpenCode v2 client, Android bridge, mock harness
chrome-plugin/                        Chrome extension (Manifest V3)
package.json                          bun workspace: client + chrome-plugin
server/deploy.sh                      Repeatable Pi deployment (live or staging)
server/palma2-opencode.service        systemd unit
server/runtime/opencode.json          Checked-in OpenCode policy
server/runtime/AGENTS.md               Reading-assistant instructions
```

The remote deployment becomes:

```text
/home/pi/deploys/palma2-opencode/
  .git/
  .gitignore
  AGENTS.md
  opencode.json
  cli/                 pinned @opencode/cli install
  workdir/
  state/
    server.env
    share/opencode/    sessions, credentials, logs (XDG_DATA_HOME)
    state/             XDG_STATE_HOME
    cache/             XDG_CACHE_HOME
```

`opencode.json`, `AGENTS.md`, and `.gitignore` are copied from `server/runtime/` and committed into a Git repository on the Pi. `cli/`, `workdir/`, and `state/` are excluded from that repository.

## Server Policy

OpenCode starts with `workdir/` as its location. It discovers the parent `opencode.json` and `AGENTS.md`, but relative mutations cannot escape the active location.

The checked-in server policy is deny-by-default and allows only:

- `read`
- `glob`
- `grep`
- `webfetch`
- `websearch`

```json
"permission": { "*": "deny", "read": "allow", "glob": "allow", "grep": "allow", "webfetch": "allow", "websearch": "allow" }
```

OpenCode v2 turns this into an ordered rule list where the last matching rule wins, so `"*": "deny"` must stay the first key. Its built-in agents start from "allow everything", which is why the policy denies by default instead of naming what to forbid: a v1-style file that only denied `edit` and `bash` left the model with the `question`, `skill`, `subagent`, and `execute` tools under v2. With this policy the model is offered exactly the five tools above; `cd client && bun run verify` asserts that against a fake provider. The reading instructions also tell the model to treat book text as quoted context rather than instructions.

`autoupdate` is off in the same file so the pinned server does not replace itself.

Changes to `server/runtime/` do nothing until `./server/deploy.sh` is run.

## Pi Prerequisites

The tested host is the `pi` user on `raspberrypi.example.ts.net`. It needs:

- Tailscale connected with IPv4 `100.64.0.10`
- Passwordless `sudo` for systemd installation and control
- `git`, `curl`, `openssl`, `rsync`, and SSH access
- Bun (the deploy script installs the pinned OpenCode CLI with it)
- An SSH alias named `your-pi`, unless `PALMA_SERVER_HOST` is supplied
- `PALMA_SERVER_ADDRESS` set to the Pi's real Tailscale IPv4; the checked-in `100.64.0.10` is a placeholder

The server binary is private to the deployment, so it does not share a version with any other OpenCode install on the Pi:

```text
/home/pi/deploys/palma2-opencode/cli/node_modules/.bin/opencode
```

`server/deploy.sh` installs `@opencode/cli` there, pinned to `2.0.27` unless `OPENCODE_VERSION` is set, and refuses to continue if the installed binary reports another version.

## Server Deployment

Deploy from the repository root:

```sh
./server/deploy.sh
```

Use another SSH target without editing the script:

```sh
PALMA_SERVER_HOST=pi@raspberrypi.example.ts.net ./server/deploy.sh
```

The script performs these operations:

1. Creates `/home/pi/deploys/palma2-opencode`.
2. Synchronizes checked-in runtime files while preserving `.git/`, `cli/`, `workdir/`, and `state/`.
3. Creates the workdir and isolated OpenCode data directories.
4. Generates `state/server.env` with mode `0600` on first deployment.
5. Seeds a private `auth.json` from the Pi user's existing OpenCode data only when no isolated copy exists.
6. Installs the pinned `@opencode/cli` into `cli/` and checks its version.
7. Initializes the deployment root as a Git repository and commits runtime configuration.
8. Stops `palma2-opencode.service` and writes `/home/pi/palma2-opencode-before-v2-<timestamp>.tgz`, a tarball of `state/` as it was.
9. Installs, enables, and restarts `palma2-opencode.service`.
10. Polls the authenticated `/api/info` and `/api/session` endpoints, then prints the v1 history migration status (`/api/experimental/migration/v1`) and how many chats the server lists for the workdir.

The first v2 start on a state directory written by OpenCode `1.18` migrates the old session history. The migration status is one of `required`, `running` (with progress), `completed`, or `error`. Step 8's tarball is the way back: stop the service, restore `state/` from it, and redeploy the previous server.

### Staging

```sh
STAGING=1 ./server/deploy.sh
```

Staging runs the same server from a copy of the live data, to try a version or the history migration first. It differs from a live deploy in these ways and never stops, restarts, or reconfigures the live service:

| | Live | Staging |
| --- | --- | --- |
| Deployment root | `/home/pi/deploys/palma2-opencode` | `/home/pi/deploys/palma2-opencode-staging` |
| systemd unit | `palma2-opencode.service` (enabled at boot) | `palma2-opencode-staging.service` (started, not enabled) |
| Port | `41137` | `41138` |
| State | kept in place, tarball taken first | copied from live on the first run |

The state copy is taken while live keeps running; SQLite databases are copied through a `VACUUM INTO` snapshot so the copy is consistent. Later staging runs keep the staging state; `STAGING_REFRESH=1 STAGING=1 ./server/deploy.sh` discards it and copies live again. The copy includes `server.env`, so staging has the live password.

Migrated chats keep the directory they were created in. To look at them on staging, point a client at port `41138` but leave its workspace directory at the live `/home/pi/deploys/palma2-opencode/workdir`; the deploy output reports the chat count for that directory. New chats created that way are governed by the policy file in the live root, not the staging one.

Remove staging when done:

```sh
ssh your-pi 'sudo systemctl stop palma2-opencode-staging.service; sudo rm -f /etc/systemd/system/palma2-opencode-staging.service; sudo systemctl daemon-reload; rm -rf /home/pi/deploys/palma2-opencode-staging'
```

The HTTP password is stable across normal deploys and restarts because it lives in `state/server.env`. It is not printed by the deploy script or committed to Git.

## Service Operation

Check status and the listener:

```sh
ssh your-pi 'sudo systemctl status palma2-opencode.service --no-pager'
ssh your-pi 'ss -ltn | grep 41137'
```

Restart, stop, or start the server:

```sh
ssh your-pi 'sudo systemctl restart palma2-opencode.service'
ssh your-pi 'sudo systemctl stop palma2-opencode.service'
ssh your-pi 'sudo systemctl start palma2-opencode.service'
```

Follow service logs:

```sh
ssh your-pi 'sudo journalctl -u palma2-opencode.service -f'
```

Inspect OpenCode's application log:

```sh
ssh your-pi 'tail -f /home/pi/deploys/palma2-opencode/state/share/opencode/log/opencode.log'
```

Run an authenticated health check from the Pi without displaying the password:

```sh
ssh your-pi '. /home/pi/deploys/palma2-opencode/state/server.env; curl --fail --user "opencode:$OPENCODE_SERVER_PASSWORD" http://100.64.0.10:41137/api/info'
```

An unauthenticated `/api/...` request returning `401 Unauthorized` proves the server is reachable but does not prove the password works. Paths outside `/api` answer with OpenCode's own web UI shell without authentication, so do not use `/` as a health check.

## Debug Latest Session Usage

Each assistant message reports one provider step. A single reader question can produce several steps for tool calls such as web search. Input usage includes the active conversation, server instructions, tool definitions, and tool results, not only the visible reader prompt.

Run these commands from a Tailscale-connected development machine with `jq` and the `your-pi` SSH alias. They keep the password and message content out of the output:

```sh
PASSWORD=$(ssh your-pi "sed -n 's/^OPENCODE_SERVER_PASSWORD=//p' /home/pi/deploys/palma2-opencode/state/server.env")
BASE_URL=http://raspberrypi.example.ts.net:41137
DIRECTORY=/home/pi/deploys/palma2-opencode/workdir

SESSION_ID=$(curl --fail --silent --get --user "opencode:$PASSWORD" \
  --data-urlencode 'limit=1' \
  --data-urlencode 'order=desc' \
  --data-urlencode "directory=$DIRECTORY" \
  "$BASE_URL/api/session" | jq -r '.data[0].id')

printf 'Latest session: %s\n' "$SESSION_ID"

curl --fail --silent --user "opencode:$PASSWORD" \
  "$BASE_URL/api/session/$SESSION_ID" \
  | jq '.data | {id, title, model, cost, tokens, outcome, time}'

curl --fail --silent --get --user "opencode:$PASSWORD" \
  --data-urlencode 'limit=50' \
  --data-urlencode 'order=asc' \
  "$BASE_URL/api/session/$SESSION_ID/message" \
  | jq '[.data[] | select(.type == "assistant") | {
      id,
      model,
      finish,
      cost,
      tokens,
      tools: [.content[]? | select(.type == "tool") | .name]
    }]'
```

A v2 session row carries its own cumulative `cost` and `tokens`, which is what both front ends display. The total also includes the server's title generation, so it can be larger than the sum over assistant messages. Multiple assistant entries usually indicate an agent loop: for example, one step requests web searches and a later step receives the search results and writes the answer. `cache.read` records provider-reported reused context and is separate from the captured page-context estimate shown by the Chrome extension.

## Authentication

OpenCode requires a server password. The username is always `opencode`; the generated password is stored only at:

```text
/home/pi/deploys/palma2-opencode/state/server.env
```

Read it when configuring the Android app:

```sh
ssh your-pi "sed -n 's/^OPENCODE_SERVER_PASSWORD=//p' /home/pi/deploys/palma2-opencode/state/server.env"
```

The Android app stores the password in its private SharedPreferences; the shared client sends `Authorization: Basic base64(opencode:<password>)` on every request. It is not stored in this repository.

To rotate the password:

```sh
ssh your-pi 'sudo systemctl stop palma2-opencode.service'
ssh your-pi 'umask 077; printf "OPENCODE_SERVER_PASSWORD=%s\n" "$(openssl rand -hex 24)" > /home/pi/deploys/palma2-opencode/state/server.env'
ssh your-pi 'sudo systemctl start palma2-opencode.service'
```

After rotation, update `SERVER PASSWORD` in the app's `SETTINGS` screen.

## Model Setup

Provider credentials are server-side and separate from the HTTP server password. The isolated deployment keeps its provider credentials under `state/share/opencode/`.

Point the deployment's own CLI at the running production server. In v2 a bare `opencode` talks to a per-user background service, not to this server, so always pass `--server`:

```sh
ssh -t your-pi '
  set -a
  . /home/pi/deploys/palma2-opencode/state/server.env
  set +a
  cd /home/pi/deploys/palma2-opencode/workdir
  /home/pi/deploys/palma2-opencode/cli/node_modules/.bin/opencode \
    --server http://100.64.0.10:41137
'
```

The CLI reads the server password from `OPENCODE_SERVER_PASSWORD`. Connect or update provider credentials from the TUI it opens. Do not run a bare `opencode` or `opencode auth` for this purpose; those use the Pi user's separate default data.

List the models the server offers for the workdir, without the TUI:

```sh
ssh your-pi '
  set -a; . /home/pi/deploys/palma2-opencode/state/server.env; set +a
  cd /home/pi/deploys/palma2-opencode/workdir
  /home/pi/deploys/palma2-opencode/cli/node_modules/.bin/opencode models --server http://100.64.0.10:41137
'
```

or over HTTP, with variants:

```sh
ssh your-pi '. /home/pi/deploys/palma2-opencode/state/server.env; curl --silent --get --user "opencode:$OPENCODE_SERVER_PASSWORD" --data-urlencode "location[directory]=/home/pi/deploys/palma2-opencode/workdir" http://100.64.0.10:41137/api/model' \
  | jq -r '.data[] | select(.status == "active" and .enabled) | "\(.providerID)/\(.id)  variants: \(.variants | map(.id) | join(","))"'
```

Do not guess model identifiers; pick them from this list. In v2 the model is a property of the chat: both front ends set the model and variant chosen in their settings when a chat is created, and follow-up messages keep that chat's model.

## Server Persistence

OpenCode state is redirected with `XDG_DATA_HOME` to:

```text
/home/pi/deploys/palma2-opencode/state/share/opencode/
```

This contains session history, SQLite data, logs, and provider state. `XDG_STATE_HOME` and `XDG_CACHE_HOME` point at `state/state` and `state/cache`, and the HTTP password is adjacent at `state/server.env`. Deployment preserves the entire `state/` directory. OpenCode's global configuration directory is not redirected: the Pi user's `~/.config/opencode`, if present, still applies on top of the checked-in policy.

Back up the server while it is stopped:

```sh
ssh your-pi 'sudo systemctl stop palma2-opencode.service'
ssh your-pi 'tar -C /home/pi/deploys/palma2-opencode -czf /home/pi/palma2-opencode-state.tgz state'
ssh your-pi 'sudo systemctl start palma2-opencode.service'
scp your-pi:/home/pi/palma2-opencode-state.tgz .
```

Do not edit or delete the SQLite database while the service is running. Back up `state/` before database recovery or migration work.

## OpenCode API Usage

Neither front end issues HTTP requests itself. Both call the shared client in `client/`, which wraps the official `@opencode/client` (pinned in `client/package.json` to the server's version) and uses these OpenCode v2 endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/info` | Test settings |
| `GET` | `/api/model` | List available models |
| `POST` | `/api/session` | Create a reading chat at the configured location, with its model |
| `GET` | `/api/session` | List recent chats with their cost and token totals |
| `GET` | `/api/session/{id}` | One chat's model and totals |
| `GET` | `/api/session/active` | Which chats the server is working on |
| `POST` | `/api/session/{id}/model` | Change a chat's model |
| `POST` | `/api/session/{id}/prompt` | Send initial and follow-up messages |
| `GET` | `/api/session/{id}/message` | Load conversation messages |
| `POST` | `/api/session/{id}/interrupt` | Stop a response |
| `GET` | `/api/event` | Stream server events |

The running server publishes its full contract at `/openapi.json` (authenticated); no copy is kept in this repository.

Differences from OpenCode `1.18` that shaped the client: the model is set on the session rather than sent with each prompt; messages are one flat typed list (`user`, `assistant`, `idle`, ...) with assistant text in `content[]`; a session carries its own `cost` and `tokens`; and `/api/event` is a single stream for every location, with granular events such as `session.text.delta`, `session.tool.called`, and `session.execution.succeeded`. The shared client filters that stream by session, reduces it to a handful of event kinds, reconnects after interruptions, and tells the UI to reload the conversation to recover anything missed while disconnected.

After upgrading OpenCode, run `cd client && bun run verify && bun run build:android && bun run verify:bridge`. These exercise connection, model loading, session creation, prompting, streaming, message parsing, interruption, event reconnection, session listing, and the tool policy against a throwaway local server with a fake provider; no real model is involved. See `client/README.md`.

## Android OpenCode Bridge

`OpenCodeClient.java` is not an HTTP client. It owns one Android System WebView that is never shown, loads `assets/reading-client.js` into it with the server URL as the page's base URL (so the script's `fetch` calls are same-origin), and passes calls and events across the contract in `client/README.md`. The native screens are unchanged.

- Calls block and belong on a background thread (`MainActivity` uses its single `network` executor); a call from the main thread throws rather than deadlocking. The WebView is only touched on the main thread.
- One page serves one set of connection settings. Saving a different server URL, password, or directory discards the WebView and loads a new one on the next call.
- The model is set when a chat is created. A follow-up in an older chat switches that chat to the model currently chosen in Settings before sending.
- A missing or disabled System WebView, a script the WebView cannot run, and a renderer that dies all show as a readable message in the app's status line, and the next call starts a fresh WebView. `adb logcat -s ReadingBridge` shows page loads, script errors, and why a WebView was dropped.
- Safe Browsing is turned off for this WebView: its only host is the reader's own server.

On a device, check the WebView version (`adb shell dumpsys webviewupdate | head -4`); the bundle is ES2020 and needs streaming `fetch`. Do not run this WebView on an Android emulator without hardware acceleration: on the API 33 `google_apis` image under `-accel off`, WebView 109's renderer crashes at startup on any page.

## Android Prerequisites

The Android SDK is installed without Android Studio:

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ADB="$ANDROID_HOME/platform-tools/adb"
```

The tested Palma 2 serial is `BOOX_DEVICE_SERIAL`. Confirm the device before issuing commands:

```sh
"$ADB" devices -l
```

On the Palma 2, USB debugging is under `Settings -> More Settings -> USB Debug Mode`.

The Palma and Raspberry Pi must both be connected to the same Tailscale network. A basic reachability check from the device is:

```sh
"$ADB" shell 'printf "GET /api/info HTTP/1.0\r\nHost: raspberrypi.example.ts.net\r\n\r\n" | toybox nc -w 5 raspberrypi.example.ts.net 41137 | head -1'
```

`HTTP/1.1 401 Unauthorized` is expected for this unauthenticated connectivity test.

## Build And Install

Build and run lint:

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
./gradlew --no-daemon clean assembleDebug lintDebug
```

Build, install on the only connected device, and launch:

```sh
./install.sh
```

If multiple devices are connected, pass the target serial (or set `ANDROID_SERIAL`):

```sh
./install.sh BOOX_DEVICE_SERIAL
```

The script uses `ADB`, `adb` from `PATH`, or the SDK location under `ANDROID_HOME`. It builds the APK at `app/build/outputs/apk/debug/app-debug.apk`, installs it with `-r` to preserve captured context and connection preferences, and launches the app.

Before installing on an existing device, confirm the APK uses `dev.kkrausse.kindlecontext` and matches the installed app's signing certificate. A different application ID creates a second Reading Context icon and accessibility shortcut; a different certificate cannot update in place. Do not uninstall the existing app to resolve either mismatch. After an install, verify BOOX App Freeze remains off for Reading Context (see below).

## Chrome Extension

`chrome-plugin/` is a separate desktop Chrome extension; Android Chrome uses the accessibility-service source profile described above, not this extension. The extension is a Bun-built TypeScript and React Manifest V3 extension that connects to the same server and workspace as the Android app, through the same shared client (`client/`). React is limited to the side panel; the background and content scripts remain plain TypeScript. Sessions are shared through OpenCode, while the Chrome model, template, prompt presets, and credentials are stored separately in `chrome.storage.local`.

Install it for development:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Run `bun install && cd chrome-plugin && bun run build` from the repository root. `bun install` covers the whole workspace, including the shared client.
4. Choose `Load unpacked` and select this repository's `chrome-plugin/dist/` directory.
5. Open the extension side panel, enter the server password under `Settings`, then press `Save and test`.

After changing extension code, rerun `bun run build`, click the extension's reload button on `chrome://extensions`, and refresh any website tabs that were already open so Chrome reinjects the updated content script.

Open the extension side panel and highlight text on a normal website. Each selection automatically updates `Ask the page` with the highlighted passage, page title and URL, and up to 5,000 words from the nearest readable `article` or `main` region. Clearing the page selection also removes the pending highlight from the side panel and its next prompt. If no readable region exists, the extension falls back to body text. Choose a quick question or write a custom one to start a shared OpenCode chat.

In chat history, reading prompts show the question and highlighted passage in a compact card, with the full page context available from `View page context`. Each OpenCode response shows the exact provider, model ID, and variant reported with that assistant message. OpenCode responses render as Markdown and update directly from the server's authenticated event stream. If text is selected inside a streaming response, that message's DOM remains stable while incoming text buffers; rendering catches up when the selection clears. If the volatile stream disconnects, the shared client reconnects and the extension reloads canonical messages to recover missed events. A `Stop` action interrupts a stalled server execution and restores the composer. A compact footer shows the server's running totals for the chat: input, output, reasoning, cache read/write, and USD cost, updated while a response streams. New messages, streamed response text, and new inline highlights automatically scroll into view while the chat remains pinned to the bottom. Scrolling away or selecting text suspends auto-scroll; manually reaching the bottom pins the chat to updates again. The persistent header remains available while prompts and responses are loading, so `New`, `Chats`, and `Settings` can be opened at any time without discarding the current capture. If a conversation is open, a new selection appears in the shared composer. The compact quick-question buttons and normal `Send` action automatically include that highlight. The adjacent `New chat` action opens the normal new-chat form with the latest highlight and its freshly captured page context. From other screens, selecting text opens `New`, including when the capture came from another tab.

The checked-in host permission covers the default Tailscale server. If the server URL is changed, Chrome asks for access to the new origin when loading models or saving settings.

The extension observes text selections on normal websites using the manifest's `<all_urls>` content-script access. It does not inject controls into the page. Server credentials remain restricted to trusted extension pages, and captured page text is held temporarily in tab-scoped `chrome.storage.session` only until the side panel receives it.

Extension and API failures are retained as a bounded local diagnostics log. Open `Settings -> Diagnostics` to copy or clear it. Diagnostics omit the server password, highlighted text, surrounding page text, and page URL.

Run the extension's local checks with:

```sh
bun install
cd chrome-plugin
bun test
bun run check
bun run build
```

## App Configuration

Open `SETTINGS` in Reading Context and configure:

| Setting | Default |
| --- | --- |
| Server URL | `http://raspberrypi.example.ts.net:41137` |
| Workspace directory | `/home/pi/deploys/palma2-opencode/workdir` |
| Server password | No compiled default; enter the value from `state/server.env` |
| New chat model | `Laguna S 2.1 Free` |
| Model variant | `medium` |
| Message template | Surrounding context, highlight, then question |
| Pre-filled prompts | Explain terms, why it matters, historical context |

The model list is loaded from the server's active catalog. The message template is literal text with `{{highlight}}`, `{{surrounding_context}}`, and `{{question}}` placeholders. The built-in template wraps source material and instructions in XML-style elements. The surrounding context is chronological and retains the latest 5,000 words. Existing custom templates using `{{previous_page}}` and `{{current_page}}` continue to work, while former built-in templates upgrade automatically. In chat history, structured prompts show the question and highlight immediately and keep surrounding context collapsed behind an expandable button. Pre-filled prompt labels and text can be edited, added, removed, and reordered directly in Settings. Press `SAVE AND TEST` to persist all settings. Existing chats retain their original model and messages; the model and variant are fixed when a chat is created, so these selections apply to new chats.

The manifest allows cleartext traffic because the endpoint is HTTP over Tailscale. Do not point the app at an untrusted cleartext network endpoint.

Changing app settings only changes private Android preferences. It does not modify the checked-in server policy.

## BOOX Configuration

Disable freezing for `Reading Context` under `Settings -> Apps & Notifications -> Freeze Settings / App Freeze`. BOOX freezing disables the package, kills its accessibility service, removes it from enabled accessibility services, and clears the accessibility-button target.

Use the BOOX launcher **Settings** (not Android's standard Settings screen) for this path. Find **Reading Context** in Freeze Settings and switch freezing **off**. If `Automatically enable freezing after installing an app` is on, repeat this check after an install or update. `adb shell pm enable` can temporarily revive a frozen app but does not disable BOOX's freeze policy; it will be disabled again when backgrounded.

After installing an APK, verify:

1. `Reading Context` is not frozen.
2. `Reading Context Capture` is enabled in Android accessibility settings.
3. The floating `K` button targets `Reading Context Capture`.
4. The app's `SETTINGS` connection test succeeds.

The separate BOOX NaviBall service can remain enabled.

## Accessibility Recovery

Inspect current state:

```sh
"$ADB" shell dumpsys accessibility
"$ADB" shell settings get secure enabled_accessibility_services
"$ADB" shell settings get secure accessibility_button_targets
```

Development-only recovery commands that preserve NaviBall:

```sh
"$ADB" shell pm enable dev.kkrausse.kindlecontext
"$ADB" shell settings put secure enabled_accessibility_services \
  'com.onyx.floatingbutton/.service.FloatButtonAccessibilityService:dev.kkrausse.kindlecontext/.KindleAccessibilityService'
"$ADB" shell settings put secure accessibility_enabled 1
"$ADB" shell settings put secure accessibility_button_targets \
  'dev.kkrausse.kindlecontext/.KindleAccessibilityService'
```

If Android still lists the service as crashed, toggle only `Reading Context Capture` off and on in accessibility settings.

## Troubleshooting

### App reports HTTP 401

The server is reachable, but the app password is absent or stale. Read `state/server.env`, update `SERVER PASSWORD`, then use `SAVE AND TEST`.

### App cannot connect

Verify Tailscale on both devices, resolve `raspberrypi.example.ts.net`, check the `41137` listener, and run the authenticated server health check. Confirm the app URL uses `http`, not `https`.

### Server repeatedly restarts

Run:

```sh
ssh your-pi 'sudo systemctl status palma2-opencode.service --no-pager -l'
ssh your-pi 'sudo journalctl -u palma2-opencode.service -n 100 --no-pager'
```

Common causes are a missing binary under `cli/` after a failed install, a changed Tailscale IP, a missing `workdir/`, or an invalid `opencode.json`.

### Server answers but no model is available

List the models as shown under **Model Setup** and reconnect the provider through the CLI pointed at the production server. A list that is empty only right after a restart fills in within a couple of seconds.

### Chats disappear

Confirm systemd still sets `XDG_DATA_HOME=/home/pi/deploys/palma2-opencode/state/share` and that the service is not using the Pi user's default OpenCode database.

### Accessibility capture problems

Follow app logs:

```sh
"$ADB" logcat -s KindleContext
```

Capture Kindle's UI Automator hierarchy:

```sh
"$ADB" shell uiautomator dump /sdcard/kindle-window.xml
"$ADB" pull /sdcard/kindle-window.xml .
```

Pull private accessibility diagnostics:

```sh
"$ADB" exec-out run-as dev.kkrausse.kindlecontext \
  cat files/reading-accessibility-tree.txt > reading-accessibility-tree.txt
"$ADB" exec-out run-as dev.kkrausse.kindlecontext \
  cat files/reading-accessibility-events.txt > reading-accessibility-events.txt
```

These files contain book prose. Keep them local and remove or gate diagnostic persistence before production use.

## Upgrade Procedure

The server, the official client library, and the bundled Android script move together.

1. Set the new version as the `OPENCODE_VERSION` default in `server/deploy.sh` and as the exact `@opencode/client` version in `client/package.json`, then run `bun install`.
2. Run `cd client && bun run check && OPENCODE_BIN=<new opencode binary> bun run verify`. Fix anything the new contract broke in `client/src`.
3. Run `bun run build:android && OPENCODE_BIN=<new opencode binary> bun run verify:bridge` and commit the rebuilt `app/src/main/assets/reading-client.js`.
4. Run `bun test`, `bun run check`, and `bun run build` in `chrome-plugin/`.
5. Run `STAGING=1 ./server/deploy.sh` and check the staging server on port `41138`.
6. Run `./server/deploy.sh`. It backs up `state/` before restarting.
7. Build and lint the Android app, install the APK with `adb install -r`, and reload the Chrome extension.
8. Test capture, a new session, a reply, and prior-session loading.

Keep production pinned to a known-good OpenCode version and validate API compatibility before upgrading.

## Security And Privacy

- The server listens only on its Tailscale IPv4 address.
- HTTP Basic protects the API; Tailscale protects transport confidentiality.
- The HTTP password and provider credentials are never checked into Git.
- The agent cannot run shell commands or edit files under the checked-in policy.
- Captured book text is sent to the configured model provider and stored in OpenCode session history.
- Android stores recent captured context and the server password in private app storage.
- Accessibility diagnostic files may contain substantial copyrighted or sensitive text.
- Rotating the server password does not rotate provider credentials.
- Changing `AGENTS.md` or prompt wording is a behavior change and should be reviewed before deployment.

## Removal

Remove the Android app:

```sh
"$ADB" uninstall dev.kkrausse.kindlecontext
```

Uninstalling removes private captures and connection preferences. It does not affect BOOX NaviBall or server-side OpenCode history.

Stop and disable the Pi service without deleting history:

```sh
ssh your-pi 'sudo systemctl disable --now palma2-opencode.service'
```

The deployment root and `state/` remain until deliberately archived or removed.
