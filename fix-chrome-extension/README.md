# Keep Tab Search Shortcut

A minimal Chrome extension that prevents websites from intercepting Chrome's Tab Search shortcut:

- `Ctrl+Shift+A` on Windows/Linux
- `Command+Shift+A` on macOS

The content script runs at `document_start`, catches the shortcut before page handlers, and stops propagation without calling `preventDefault()`. That keeps site code from overriding the shortcut while still allowing Chrome to perform its default action.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this directory.

Chrome does not allow extensions to run content scripts on internal pages such as `chrome://` URLs, but it will run on ordinary sites including Substack and Slack.

## Develop locally

To launch Chromium with this unpacked extension from the repo:

```sh
make dev
```

That starts a separate dev profile in `.chromium-dev-profile`, loads this directory as an unpacked extension, and opens Substack so you can test the shortcut.

If the script cannot find your Chromium binary, point it at the browser manually:

```sh
CHROMIUM_BIN="/Applications/Chromium.app/Contents/MacOS/Chromium" make dev
```

After changing `manifest.json`, reload the browser window. After changing `shortcut-guard.js`, click reload for the extension on `chrome://extensions` or restart `make dev`.

## Ctrl only

By default this also protects `Command+Shift+A` on macOS. To protect only `Ctrl+Shift+A`, set `PROTECT_META_SHIFT_A` to `false` in `shortcut-guard.js`.
