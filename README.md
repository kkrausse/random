# Reading Context

> Server migration note: production now runs regular OpenCode `1.18.13`, while
> the Android client still requires API migration. The Chrome extension now
> uses the regular OpenCode server contract. See
> [`MIGRATION.md`](MIGRATION.md) for the current status and contract handoff;
> V2-specific server instructions below are retained temporarily and are stale.

Android reading assistant for a BOOX Palma 2. It captures a highlight plus rolling surrounding context from supported reading apps, sends that context to a dedicated OpenCode V2 server over Tailscale, and provides persistent reading chats on the device. Kindle and Substack are currently supported.

## Architecture

```text
Kindle or Substack on Palma 2
  -> Android accessibility service
  -> Reading Context Android app
  -> HTTP Basic over Tailscale
  -> OpenCode V2 on Raspberry Pi
  -> configured model provider
```

The deployed components are intentionally isolated:

| Component | Value |
| --- | --- |
| Android package | `dev.example.kindlecontext` |
| Kindle package | `com.amazon.kindle` |
| Substack package | `com.substack.app` |
| Server hostname | `raspberrypi.example.ts.net` |
| Tailscale IPv4 | `100.64.0.10` |
| Server port | `41137` |
| Server URL | `http://raspberrypi.example.ts.net:41137` |
| systemd service | `palma2-opencode-v2.service` |
| Deployment root | `/home/pi/deploys/palma2-opencode` |
| OpenCode location | `/home/pi/deploys/palma2-opencode/workdir` |

Port `41137`, the service name, and the deployment root distinguish this instance from other OpenCode processes on the Pi. The service binds only to the Pi's Tailscale address, not its LAN address or every interface.

Plain HTTP is intentional because traffic is carried inside Tailscale. OpenCode still requires HTTP Basic authentication.

## Reading Flow

1. Highlight text in Kindle or Substack while its selection toolbar is visible.
2. Press the floating `K` accessibility shortcut.
3. The service captures prose nodes intersecting the physical display and builds a rolling context window.
4. The service invokes the reader's exposed `Copy` action. Substack's transient toolbar action is retained from its accessibility event because it is omitted from the active-window tree.
5. The app opens and reads the copied highlight with Android's foreground clipboard access.
6. Choose a prompt template or enter a custom question.
7. The app creates an OpenCode session and sends up to 5,000 words of the most recent surrounding context, the highlight, and the question.
8. The chat screen streams response updates from OpenCode's event endpoint and accepts follow-up messages.
9. Use `CHATS` to reopen sessions stored by the server or the source-app button (`KINDLE` or `SUBSTACK`) to return to the reading app.

The initial prompt combines captured snapshots into one chronological surrounding-context section without page labels. It uses XML-style boundaries to separate source material from the reader's instructions. Captured text is escaped so it cannot close or alter those boundaries. When more than 5,000 words have been captured, it drops the oldest words first. The question remains last.

If the source app does not expose `Copy` or readable clipboard text, the app falls back to standard accessibility selection offsets. The surrounding context remains available when no highlight can be recovered.

Supported readers are declared as source profiles in `KindleAccessibilityService`. Each profile provides its package, display label, copy action, and whether the action must be retained from a transient accessibility event. Captured source metadata drives return navigation, and context history resets when switching readers so text from separate sources is not mixed.

Kindle retains copied selections as annotations. Automatic deletion is intentionally not attempted because Copy closes and invalidates the selection toolbar before its accessible `Delete Highlight` action can run. See `progress_20260801_113544.md` for tested alternatives.

## Repository Layout

```text
app/                                  Android application
chrome-plugin/                        Chrome extension (Manifest V3)
server/deploy.sh                      Repeatable Pi deployment
server/palma2-opencode-v2.service     systemd unit
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
  workdir/
  state/
    server.env
    share/opencode/
```

`opencode.json`, `AGENTS.md`, and `.gitignore` are copied from `server/runtime/` and committed into a Git repository on the Pi. `workdir/` and `state/` are excluded from that repository.

## Server Policy

OpenCode starts with `workdir/` as its location. It discovers the parent `opencode.json` and `AGENTS.md`, but relative mutations cannot escape the active location.

The checked-in V2 permission policy denies every action first, then allows only:

- `read`
- `glob`
- `grep`
- `webfetch`

This denies shell commands, file edits, subagents, skills, interactive questions, and `websearch`. Web search is temporarily disabled because the pinned server leaves the tool running indefinitely. See `server/OPENCODE_MIGRATION_NOTES.md`. The reading instructions also tell the model to treat book text as quoted context rather than instructions.

Changes to `server/runtime/` do nothing until `./server/deploy.sh` is run.

## Pi Prerequisites

The tested host is the `pi` user on `raspberrypi.example.ts.net`. It needs:

- Tailscale connected with IPv4 `100.64.0.10`
- Passwordless `sudo` for systemd installation and control
- `git`, `curl`, `openssl`, `rsync`, and SSH access
- OpenCode V2's ARM64 native binary
- An SSH alias named `your-pi`, unless `PALMA_SERVER_HOST` is supplied

The current native binary is:

```text
/home/pi/.bun/install/global/node_modules/@opencode-ai/cli-linux-arm64/bin/opencode2
```

The deployment is pinned to `v0.0.0-next-16741`.

The `~/.bun/bin/opencode2` JavaScript wrapper does not work on this Pi because `/usr/bin/env node` is unavailable. The systemd unit deliberately invokes the native ARM64 binary directly. If the package layout changes during an upgrade, update `server/palma2-opencode-v2.service`.

Install the pinned package with Bun when needed:

```sh
ssh your-pi '/home/pi/.bun/bin/bun install -g --trust @opencode-ai/cli@0.0.0-next-16741'
ssh your-pi '/home/pi/.bun/install/global/node_modules/@opencode-ai/cli-linux-arm64/bin/opencode2 --version'
```

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
2. Synchronizes checked-in runtime files while preserving `.git/`, `workdir/`, and `state/`.
3. Creates the workdir and isolated OpenCode data directory.
4. Generates `state/server.env` with mode `0600` on first deployment.
5. Seeds a private `auth.json` from the Pi user's existing OpenCode data only when no isolated copy exists.
6. Initializes the deployment root as a Git repository and commits runtime configuration.
7. Installs and enables `palma2-opencode-v2.service`.
8. Restarts the service.
9. Polls the authenticated `/api/health` endpoint before returning success.

The HTTP password is stable across normal deploys and restarts because it lives in `state/server.env`. It is not printed by the deploy script or committed to Git.

## Service Operation

Check status and the listener:

```sh
ssh your-pi 'sudo systemctl status palma2-opencode-v2.service --no-pager'
ssh your-pi 'ss -ltn | grep 41137'
```

Restart, stop, or start the server:

```sh
ssh your-pi 'sudo systemctl restart palma2-opencode-v2.service'
ssh your-pi 'sudo systemctl stop palma2-opencode-v2.service'
ssh your-pi 'sudo systemctl start palma2-opencode-v2.service'
```

Follow service logs:

```sh
ssh your-pi 'sudo journalctl -u palma2-opencode-v2.service -f'
```

Inspect OpenCode's application log:

```sh
ssh your-pi 'tail -f /home/pi/deploys/palma2-opencode/state/share/opencode/log/opencode.log'
```

Run an authenticated health check from the Pi without displaying the password:

```sh
ssh your-pi '. /home/pi/deploys/palma2-opencode/state/server.env; curl --fail --user "opencode:$OPENCODE_PASSWORD" http://100.64.0.10:41137/api/health'
```

An unauthenticated request returning `401 Unauthorized` with `WWW-Authenticate: Basic` proves the server is reachable but does not prove the password works.

## Debug Latest Session Usage

The session endpoint reports cumulative usage, while each assistant message reports one provider step. A single reader question can produce several steps for tool calls such as web search, and automatic title generation contributes to the session total without appearing as a normal assistant message. Input usage includes the active conversation, server instructions, tool definitions, and tool results, not only the visible reader prompt.

Run these commands from a Tailscale-connected development machine with `jq` and the `your-pi` SSH alias. They keep the password and message content out of the output:

```sh
PASSWORD=$(ssh your-pi "sed -n 's/^OPENCODE_PASSWORD=//p' /home/pi/deploys/palma2-opencode/state/server.env")
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
  | jq '.data | {id, title, model, cost, tokens, time}'

curl --fail --silent --get --user "opencode:$PASSWORD" \
  --data-urlencode 'limit=50' \
  --data-urlencode 'order=asc' \
  "$BASE_URL/api/session/$SESSION_ID/message" \
  | jq '[.data[] | {
      type,
      id,
      model,
      cost,
      tokens,
      tools: [.content[]? | select(.type == "tool") | .name]
    }]'
```

Compare the session's `tokens` object with the assistant-message entries. The difference can include title generation and other session-level work. Multiple assistant entries usually indicate an agent loop: for example, one step requests web searches and a later step receives the search results and writes the answer. `cache.read` records provider-reported reused context and is separate from the captured page-context estimate shown by the Chrome extension.

## Authentication

OpenCode V2 requires a server password. The username is always `opencode`; the generated password is stored only at:

```text
/home/pi/deploys/palma2-opencode/state/server.env
```

Read it when configuring the Android app:

```sh
ssh your-pi "sed -n 's/^OPENCODE_PASSWORD=//p' /home/pi/deploys/palma2-opencode/state/server.env"
```

The Android app stores the password in its private SharedPreferences and sends `Authorization: Basic base64(opencode:<password>)`. It is not stored in this repository.

To rotate the password:

```sh
ssh your-pi 'sudo systemctl stop palma2-opencode-v2.service'
ssh your-pi 'umask 077; printf "OPENCODE_PASSWORD=%s\n" "$(openssl rand -hex 24)" > /home/pi/deploys/palma2-opencode/state/server.env'
ssh your-pi 'sudo systemctl start palma2-opencode-v2.service'
```

After rotation, update `SERVER PASSWORD` in the app's `SETTINGS` screen.

## Model Setup

Provider credentials are server-side and separate from the HTTP server password. OpenCode V2 did not import the existing V1 OpenAI OAuth connection into this isolated deployment. Until a V2 provider is connected, the server falls back to the public `Ling-3.0-flash Free` model.

Connect the deployed server through a matching V2 TUI:

```sh
ssh -t your-pi 'cd /home/pi/deploys/palma2-opencode/workdir && . ../state/server.env && /home/pi/.bun/install/global/node_modules/@opencode-ai/cli-linux-arm64/bin/opencode2 --server http://100.64.0.10:41137'
```

In the TUI:

1. Run `/connect`.
2. Select OpenAI or the intended provider.
3. Complete the offered browser or headless OAuth flow.
4. Run `/models` and record the exact provider and model IDs.
5. Run `/variants` and verify that `high` exists for that model.

Do not guess model identifiers. The requested GPT-5.6 Luna High model has not yet been resolved against this server's catalog.

Inspect enabled models and the current default after connection:

```sh
ssh your-pi '. /home/pi/deploys/palma2-opencode/state/server.env; curl --silent --user "opencode:$OPENCODE_PASSWORD" http://100.64.0.10:41137/api/model'
ssh your-pi '. /home/pi/deploys/palma2-opencode/state/server.env; curl --silent --user "opencode:$OPENCODE_PASSWORD" http://100.64.0.10:41137/api/model/default'
```

OpenCode V2's root model configuration does not retain a variant. If the reading app must always use a specific `high` variant, pass the exact `{ providerID, id, variant }` model reference when creating the session after confirming it from the server catalog.

## Server Persistence

OpenCode state is redirected with `XDG_DATA_HOME` to:

```text
/home/pi/deploys/palma2-opencode/state/share/opencode/
```

This contains session history, SQLite data, logs, and provider state. The HTTP password is adjacent at `state/server.env`. Deployment preserves the entire `state/` directory.

Back up the server while it is stopped:

```sh
ssh your-pi 'sudo systemctl stop palma2-opencode-v2.service'
ssh your-pi 'tar -C /home/pi/deploys/palma2-opencode -czf /home/pi/palma2-opencode-state.tgz state'
ssh your-pi 'sudo systemctl start palma2-opencode-v2.service'
scp your-pi:/home/pi/palma2-opencode-state.tgz .
```

Do not edit or delete the SQLite database while the service is running. Back up `state/` before database recovery or migration work.

## OpenCode API Usage

The Android client currently uses these V2 endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Test settings |
| `POST` | `/api/session` | Create a reading chat at the configured location |
| `GET` | `/api/session` | List recent chats |
| `POST` | `/api/session/{id}/prompt` | Send initial and follow-up messages |
| `GET` | `/api/session/{id}/message` | Poll conversation messages |

Responses update from OpenCode's authenticated server-sent event stream. The app reconnects after transient stream interruptions and reloads the session to recover any events missed while disconnected.

The V2 API and client contract are beta. After upgrading OpenCode, verify `/api/health`, session creation, prompting, message parsing, and session listing before relying on the reader.

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
"$ADB" shell 'printf "GET /api/health HTTP/1.0\r\nHost: raspberrypi.example.ts.net\r\n\r\n" | toybox nc -w 5 raspberrypi.example.ts.net 41137 | head -1'
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

## Chrome Extension

`chrome-plugin/` contains a Bun-built TypeScript and React Manifest V3 extension that connects to the same server and workspace as the Android app. React is limited to the side panel; the background and content scripts remain plain TypeScript. Sessions are shared through OpenCode, while the Chrome model, template, prompt presets, and credentials are stored separately in `chrome.storage.local`.

Install it for development:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Run `cd chrome-plugin && bun install && bun run build` from the repository root.
4. Choose `Load unpacked` and select this repository's `chrome-plugin/dist/` directory.
5. Open the extension side panel, enter the server password under `Settings`, then press `Save and test`.

After changing extension code, rerun `bun run build`, click the extension's reload button on `chrome://extensions`, and refresh any website tabs that were already open so Chrome reinjects the updated content script.

Open the extension side panel and highlight text on a normal website. Each selection automatically updates `Ask the page` with the highlighted passage, page title and URL, and up to 5,000 words from the nearest readable `article` or `main` region. Clearing the page selection also removes the pending highlight from the side panel and its next prompt. If no readable region exists, the extension falls back to body text. Choose a quick question or write a custom one to start a shared OpenCode chat.

In chat history, reading prompts show the question and highlighted passage in a compact card, with the full page context available from `View page context`. Each OpenCode response shows the exact provider, model ID, and variant reported with that assistant message. OpenCode responses render as Markdown and update directly from the authenticated `/event` stream. If text is selected inside a streaming response, that message's DOM remains stable while incoming text buffers; rendering catches up when the selection clears. If the volatile stream disconnects, the extension reconnects and reloads canonical messages to recover missed events. A `Stop` action interrupts a stalled server execution and restores the composer. A compact footer sums input, output, reasoning, cache read/write, and USD cost across the session's assistant messages. New messages, streamed response text, and new inline highlights automatically scroll into view while the chat remains pinned to the bottom. Scrolling away or selecting text suspends auto-scroll; manually reaching the bottom pins the chat to updates again. The persistent header remains available while prompts and responses are loading, so `New`, `Chats`, and `Settings` can be opened at any time without discarding the current capture. If a conversation is open, a new selection appears in the shared composer. The compact quick-question buttons and normal `Send` action automatically include that highlight. The adjacent `New chat` action opens the normal new-chat form with the latest highlight and its freshly captured page context. From other screens, selecting text opens `New`, including when the capture came from another tab.

The checked-in host permission covers the default Tailscale server. If the server URL is changed, Chrome asks for access to the new origin when loading models or saving settings.

The extension observes text selections on normal websites using the manifest's `<all_urls>` content-script access. It does not inject controls into the page. Server credentials remain restricted to trusted extension pages, and captured page text is held temporarily in tab-scoped `chrome.storage.session` only until the side panel receives it.

Extension and API failures are retained as a bounded local diagnostics log. Open `Settings -> Diagnostics` to copy or clear it. Diagnostics omit the server password, highlighted text, surrounding page text, and page URL.

Run the extension's local checks with:

```sh
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

The model list is loaded from the server's active catalog. The message template is literal text with `{{highlight}}`, `{{surrounding_context}}`, and `{{question}}` placeholders. The built-in template wraps source material and instructions in XML-style elements. The surrounding context is chronological and retains the latest 5,000 words. Existing custom templates using `{{previous_page}}` and `{{current_page}}` continue to work, while former built-in templates upgrade automatically. In chat history, structured prompts show the question and highlight immediately and keep surrounding context collapsed behind an expandable button. Pre-filled prompt labels and text can be edited, added, removed, and reordered directly in Settings. Press `SAVE AND TEST` to persist all settings. Existing chats retain their original model and messages; these selections apply to new chats.

The manifest allows cleartext traffic because the endpoint is HTTP over Tailscale. Do not point the app at an untrusted cleartext network endpoint.

Changing app settings only changes private Android preferences. It does not modify the checked-in server policy.

## BOOX Configuration

Disable freezing for `Reading Context` under `Settings -> Apps & Notifications -> Freeze Settings / App Freeze`. BOOX freezing disables the package, kills its accessibility service, removes it from enabled accessibility services, and clears the accessibility-button target.

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
"$ADB" shell pm enable dev.example.kindlecontext
"$ADB" shell settings put secure enabled_accessibility_services \
  'com.onyx.floatingbutton/.service.FloatButtonAccessibilityService:dev.example.kindlecontext/dev.example.kindlecontext.KindleAccessibilityService'
"$ADB" shell settings put secure accessibility_enabled 1
"$ADB" shell settings put secure accessibility_button_targets \
  'dev.example.kindlecontext/dev.example.kindlecontext.KindleAccessibilityService'
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
ssh your-pi 'sudo systemctl status palma2-opencode-v2.service --no-pager -l'
ssh your-pi 'sudo journalctl -u palma2-opencode-v2.service -n 100 --no-pager'
```

Common causes are a missing native binary after upgrade, a changed Tailscale IP, a missing `workdir/`, or an invalid `opencode.json`.

### Server answers but no model is available

Inspect `/api/model` and `/api/integration/openai`. Reconnect the provider through the V2 TUI. V1 credentials are not sufficient for this isolated V2 beta deployment.

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
"$ADB" exec-out run-as dev.example.kindlecontext \
  cat files/reading-accessibility-tree.txt > reading-accessibility-tree.txt
"$ADB" exec-out run-as dev.example.kindlecontext \
  cat files/reading-accessibility-events.txt > reading-accessibility-events.txt
```

These files contain book prose. Keep them local and remove or gate diagnostic persistence before production use.

## Upgrade Procedure

1. Back up `state/`.
2. Upgrade the V2 package on the Pi.
3. Confirm the native binary path and version.
4. Run `./server/deploy.sh` to reinstall and restart the service.
5. Verify authenticated health and model catalog endpoints.
6. Build and lint the Android app against any changed API contract.
7. Install the APK with `adb install -r`.
8. Test capture, a new session, a reply, and prior-session loading.

OpenCode V2 is beta. Pinning a known-good CLI package version is preferable once this workflow is stable.

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
"$ADB" uninstall dev.example.kindlecontext
```

Uninstalling removes private captures and connection preferences. It does not affect BOOX NaviBall or server-side OpenCode history.

Stop and disable the Pi service without deleting history:

```sh
ssh your-pi 'sudo systemctl disable --now palma2-opencode-v2.service'
```

The deployment root and `state/` remain until deliberately archived or removed.
