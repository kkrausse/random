# Super Extension (chrome-super-plugin)

My one Chrome extension. Four features, each of which can be switched off:

| Feature | Key | What it does |
| --- | --- | --- |
| **Reading Context** | ⌘⇧E | Side panel for asking about highlighted passages via the Reading Context OpenCode server. Setup, server and capture details: the **Chrome Extension** section of [`../boox-plugin-test/README.md`](../boox-plugin-test/README.md). |
| **Command palette** | ⌘⇧P | Spotlight-style launcher that runs commands and teaches Chrome's keyboard shortcuts. |
| **Keep Tab Search Shortcut** | ⌘⇧A | Stops websites (Slack, Substack, …) from swallowing Chrome's tab search shortcut. |
| **Switcher bridge** | – | Streams the tab list to the native macOS switcher app over a local WebSocket and switches tabs when it asks. |

## Install once, then never again

```sh
cd chrome-super-plugin
bun install
bun run build
```

1. `chrome://extensions` → turn on **Developer mode** (keep it on).
2. **Load unpacked** → pick `chrome-super-plugin/dist`.
3. Open Reading Context (⌘⇧E) and enter the server password under Settings.

After that, `bun run build` (or `bun run dev`, which rebuilds on save) is
all it takes: each build writes `dist/build-id.txt`, and the loaded
extension checks it every 30 seconds, at startup, and whenever the palette
opens, then calls `chrome.runtime.reload()` when it changed. After a reload
the content scripts are re-injected into open tabs, so pages don't need a
refresh. Chrome only brings a self-reloaded unpacked extension back while
Developer mode is on.

## Turning features on and off

- **Options page**: `chrome://extensions` → Super Extension → Extension
  options, the palette's "Super Extension options" command, or clicking the
  toolbar icon while Reading Context is off. Keyboard-first: focus starts on
  the first switch, ↑/↓ (or j/k) move, Space toggles, 1–4 toggle directly,
  Esc closes.
- **Palette commands**: "Disable Reading Context", "Enable Keep Tab Search
  Shortcut", "Disable Command palette", etc.

Toggles live in `chrome.storage.local` (`features`), all on by default. Off
really means off:

- **Reading Context**: its content script is unregistered and torn down in
  open tabs, the side panel is disabled (the toolbar icon opens the options
  page instead), the right-click menu is removed, and ⌘⇧E does nothing.
- **Command palette**: ⌘⇧P does nothing (an open palette closes).
- **Keep Tab Search Shortcut**: its script is unregistered and switched off in
  open tabs.
- **Switcher bridge**: the socket is closed, its reconnect alarm is cleared
  and its tab/window listeners are removed.

Content scripts are registered at runtime with
`chrome.scripting.registerContentScripts` rather than in the manifest, which
is what makes this possible.

## Command palette

The palette never touches page content. It always opens as its own small
popup window, centered on the current window. That keeps it away from pages
that grab keystrokes (Google Docs, Gmail, Figma), z-index fights, fullscreen
and focus traps, and it works the same on `chrome://` pages, the new tab
page, the Web Store and PDFs.

- **⌘⇧P** opens it. **⌘⇧P** again, **Esc**, or focusing any other window
  closes it, and focus goes back to the window you came from.
- Type to fuzzy-search one list of open tabs, commands, recently closed tabs,
  bookmarks and history. Commands you use often rank higher.
- **↑/↓**, **Ctrl+N/Ctrl+P** or Tab/⇧Tab move, **↵** runs, **⌘↵** opens links
  in a new tab.
- Commands act on the tab that was active when the palette opened: tab
  management, back/forward/reload, open URL, web search, copy URL or Markdown
  link, zoom, new (incognito) window, Chrome pages, Open/Close Reading
  Context, and the feature toggles.
- "Search history…", "Search bookmarks…", "Open URL…" and "Shortcut cheat
  sheet" switch to a focused mode. **Esc**, or **⌫** in an empty box, goes back.

**Learning mode.** Every command with a native Chrome or macOS shortcut shows
it as keycaps. After you run one through the palette, the next time it opens
the footer says "Last time you ran Close tab. Next time: ⌘W", until you've
run it 10 times ("Change shortcut hint limit" cycles 10 → 25 → always → off;
"Reset learning stats" starts over). The **Shortcut cheat sheet** lists every
shortcut the palette knows, including ones it can't run for you: ⌘L, ⌘⇧A tab
search, ⌘⇧/ macOS menu search, ⌘F → Esc → ↵ to follow a link, ⌘⌥←/→, F6.

**Reading Context from the palette.** `chrome.sidePanel.open` needs a user
gesture. The palette page sends a `reading-context` runtime message from its
↵ key handler and Chrome carries the gesture to the background, which opens
the panel.

## Keep Tab Search Shortcut

A MAIN-world script at `document_start` in every frame (including
about:blank-style frames) catches Ctrl+Shift+A / ⌘⇧A in the capture phase
and stops propagation without `preventDefault()`, so page handlers never see
it while Chrome still opens tab search. Chrome doesn't run extension scripts
on internal pages such as `chrome://` URLs. To protect only Ctrl+Shift+A, set
`PROTECT_META_SHIFT_A` to `false` in `src/tab-search-guard/tab-search-guard.ts`.

## Switcher bridge

The native macOS app in [`../switcher`](../switcher/README.md) shows a global fuzzy switcher over Chrome tabs
and native apps. It can't see Chrome's tabs, so the service worker connects
to it as a WebSocket client at `ws://127.0.0.1:47600/` (the app is the
server) and exchanges JSON text frames:

| Direction | Frame | When |
| --- | --- | --- |
| extension → app | `{"type":"tabs","tabs":[{"id":123,"windowId":4,"title":"…","url":"…","lastAccessed":1731111111111.0,"active":true,"icon":"…"}]}` | Full snapshot of every tab in normal windows: on connect, then whenever a tab is created, removed, activated, moved between windows, changes title/URL/favicon, or window focus changes. Debounced 100ms; an unchanged snapshot isn't resent. `icon` is a short key for the tab's favicon (a hash of its `favIconUrl`, so tabs with the same favicon share one); omitted when Chrome has none. |
| extension → app | `{"type":"icons","icons":[{"key":"…","png":"<base64 PNG>"}]}` | The 32px image for icon keys, in batches after the snapshot that first uses them; the snapshot never waits for it. A key is sent once per connection, and again only if it reappears after a snapshot in which no tab used it (the app forgets unused icons). |
| extension → app | `{"type":"ping"}` | Every 20s. The app answers `{"type":"pong"}`. The traffic is also what keeps the MV3 worker alive while connected. |
| app → extension | `{"type":"activate","tabId":123,"windowId":4}` | Activates the tab and focuses its window. A tab that no longer exists is ignored. |

Unknown message types are ignored in both directions.

The app makes no network requests, so favicons are resolved here: from
Chrome's favicon cache (`chrome-extension://<id>/_favicon/?pageUrl=…&size=32`,
the `favicon` permission), or, when the cache only has its generic globe for
the page, by fetching the tab's `favIconUrl` and re-encoding it as a PNG.

The app is often not running. A refused connection is not logged by the
extension; after start-up or a dropped connection it retries after 1, 2, 4
and 8 seconds, then lets the worker sleep and tries once per 30 seconds from
a `chrome.alarms` alarm. So a freshly launched app can wait up to ~30s for
the extension to find it. Tab and window listeners exist only while the
socket is open. Chrome itself prints one
`WebSocket connection to 'ws://127.0.0.1:47600/' failed` line in the service
worker's DevTools console per failed attempt; scripts can't suppress that.

No manifest entry is needed for the connection: MV3's default extension CSP
doesn't restrict `connect-src`.

## Shortcuts

Chrome applies a suggested shortcut only if nothing else owns it. If ⌘⇧P or
⌘⇧E does nothing, set it at `chrome://extensions/shortcuts` (the options page
and the palette both have a way there).

## Layout

```text
manifest.json             one manifest, no static content scripts
build.ts                  Bun.build + Tailwind; --watch for `bun run dev`
src/background.ts         service worker: wires features to their toggles
src/features.ts           toggle storage and metadata
src/contentScripts.ts     runtime content-script registration helpers
src/autoReload.ts         build-id check and self-reload
src/ui.css                Tailwind for the palette and options pages
src/reading-context/      side panel, content script, background, API client
src/palette/              palette page, commands, shortcuts, fuzzy search
src/options/              options page
src/tab-search-guard/     MAIN-world shortcut guard and its registration
src/switcher-bridge/      WebSocket client for the native switcher app
```

The Reading Context client is `reading-context-client` from
`../boox-plugin-test/client` (a `file:` dependency; the Android app shares it).

Checks: `bun test`, `bun run check`, `bun run build`.

Permissions: `tabs`, `sessions`, `bookmarks`, `history` (palette search and
tab commands), `search`, `favicon`, `clipboardWrite`, `alarms` (build check, switcher bridge reconnect),
`scripting` plus `<all_urls>` host access (runtime content scripts and
re-injection), and Reading Context's `sidePanel`, `storage`, `contextMenus`.
