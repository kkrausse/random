# switcher

A global-hotkey fuzzy switcher for macOS: one popover listing Chrome tabs and
running apps together. Type to filter, Enter jumps, Esc dismisses. With an
empty query the list is in most-recently-used order with the thing you are on
moved to the end, so hotkey + Enter flips to the previous tab or app.

Rust, GPUI 0.2, objc2. Tabs come from a browser extension (separate project)
over a loopback WebSocket; this app is the server.

## Build and run

```sh
cargo build --release      # needs Xcode's Metal toolchain for GPUI's shaders
./target/release/switcher  # no Dock icon; logs to stderr; Ctrl-C or `pkill -x switcher` to quit
```

Press Option+Space. It exits at startup if the hotkey is taken by another app
or the port is in use.

Keys: Up/Down, Ctrl-P/Ctrl-N, Tab/Shift-Tab move; Enter or click activates;
Esc, the hotkey again, or clicking elsewhere hides. Backspace, Opt-Backspace /
Ctrl-W (word), Cmd-Backspace / Ctrl-U (all) and Cmd-V edit the query.

## Config

`~/.config/switcher/config.toml`, all keys optional, read at startup:

```toml
hotkey = "alt+space"   # global-hotkey syntax: modifiers + key, e.g. "cmd+shift+KeyK", "ctrl+alt+Tab"
port = 47600           # must match the extension
# browser_bundle_id = "com.brave.Browser"
```

Picking a tab tells the extension to focus it and also brings the browser app
forward. Which browser that is gets detected from the process on the other end
of the extension's socket (`lsof`, then up the parent chain to an app), falling
back to Chrome. Set `browser_bundle_id` to pin it instead.

## Permissions

None. The hotkey is a Carbon `RegisterEventHotKey` (no Accessibility), apps are
listed and activated through NSWorkspace / NSRunningApplication, and the socket
is loopback-only, so there is no network prompt.

## Extension protocol

Listens on `ws://127.0.0.1:47600/`. The handshake is refused with 403 unless
`Origin` starts with `chrome-extension://`, which keeps web pages from reading
the tab list. JSON text frames:

- extension → app `{"type":"tabs","tabs":[{"id","windowId","title","url","lastAccessed","active","favIconUrl"?}]}`:
  full snapshot on connect and on every change; dropped when the socket closes.
- extension → app `{"type":"ping"}`, answered with `{"type":"pong"}`.
- app → extension `{"type":"activate","tabId":123,"windowId":4}`.

Unknown types and fields are ignored. Several extensions (profiles, browsers)
may connect at once; their tabs are merged.

## Run at login

Either add the binary under System Settings → General → Login Items, or write a
LaunchAgent at `~/Library/LaunchAgents/com.kkrausse.switcher.plist` with
`ProgramArguments` = the absolute path to `target/release/switcher`,
`RunAtLoad` = true, `KeepAlive` = true, and `StandardErrorPath` pointing at a
log file, then `launchctl bootstrap gui/$(id -u) <that plist>`.

## Layout

- `src/main.rs`: startup, hotkey, event loop glue
- `src/ui.rs`: the panel and its view
- `src/rank.rs`: merging and ordering items
- `src/apps.rs`: NSWorkspace: running apps, activation, MRU tracking
- `src/server.rs`: WebSocket server
- `src/config.rs`: config file
