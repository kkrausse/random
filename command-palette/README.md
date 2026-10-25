# Command Palette

A Spotlight-style command palette for Chrome, opened with **⌘⇧P** (Ctrl+Shift+P
on Windows/Linux). Its real job is teaching you to drive Chrome without the
mouse: every command that has a native shortcut shows it as keycaps, and after
you run one through the palette it tells you the shortcut the next time you
open it ("Last time you ran Close tab. Next time: ⌘W").

The palette never touches page content. It always opens as its own small
popup window, centered on the current window, rendering an extension page.
That keeps it away from pages that grab keystrokes (Google Docs, Gmail,
Figma), z-index fights, fullscreen and focus traps, and it works the same on
`chrome://` pages, the new tab page, the Web Store and PDFs.

## Install

```sh
cd command-palette
bun install
bun run build
```

Then open `chrome://extensions`, turn on Developer mode, click **Load
unpacked** and pick `command-palette/dist`. After changing code, rebuild and
click the reload icon on the extension's card.

## Using it

- **⌘⇧P** opens it. **⌘⇧P** again, **Esc**, or clicking any other window
  closes it, and focus goes back to the window you came from.
- Type to fuzzy-search one list of open tabs, commands, recently closed tabs,
  bookmarks and history. Commands you use often rank higher.
- **↑/↓** or **Ctrl+N/Ctrl+P** (or Tab/⇧Tab) move, **↵** runs, **⌘↵** opens
  links in a new tab.
- Commands act on the tab that was active when the palette opened.
- "Search history…", "Search bookmarks…", "Open URL…" and "Shortcut cheat
  sheet" switch the palette into a focused mode. **Esc** or **⌫** on an empty
  box goes back.
- **Shortcut cheat sheet** lists every shortcut it knows, including the ones
  the palette can't run for you: ⌘L, ⌘⇧A tab search, ⌘⇧/ macOS menu search,
  ⌘F → Esc → ↵ to follow a link, ⌘⌥←/→, F6 and more.
- The "Next time" hint stops for a command after you've run it 10 times. Run
  **Change shortcut hint limit** to cycle 10 → 25 → always → off, and **Reset
  learning stats** to start over. Counts live in `chrome.storage.local`.

## Changing the shortcut

Chrome only applies an extension's suggested shortcut if nothing else already
owns it (clicking the toolbar icon always opens the palette). If ⌘⇧P does
nothing, open `chrome://extensions/shortcuts` (or run
"Extension keyboard shortcuts" from the palette),
find **Command Palette → Open or close the command palette**, and set the key
you want. You can make it global there too, though then it only opens over
Chrome windows.

## Reading Context

"Open Reading Context" and "Close Reading Context" open and close the side
panel of the Reading Context extension (`boox-plugin-test/chrome-plugin/`).

- The palette finds Reading Context by name with `chrome.management` and
  sends it a `chrome.runtime.sendMessage(id, { type: "reading-context",
  action, windowId })`.
- Reading Context's `onMessageExternal` handler only accepts messages from
  this extension's ID, `npfagmlfdgapcbhlpcocjeokabcfdmmn`. The ID is fixed by
  the `key` in `manifest.json`, so it's the same for every unpacked install.
  If you change or remove the key, update `COMMAND_PALETTE_ID` in
  `boox-plugin-test/chrome-plugin/src/background.ts`.
- `chrome.sidePanel.open` needs a user gesture. The message is sent
  synchronously from the palette's ↵ key handler, and Chrome carries that
  gesture across to Reading Context, so opening works. Without a gesture
  Chrome refuses with "`sidePanel.open()` may only be called in response to a
  user gesture"; the palette then shows the error and suggests ⌘⇧E.
- Reading Context must be rebuilt and reloaded once to pick up the handler.

## Notes

- A closed palette window lands in Chrome's recently-closed list. If ⌘⇧T
  brings one back, it notices it's stale, restores the real closed tab
  instead and closes itself.
- Permissions: `tabs`, `sessions`, `bookmarks`, `history` for search and tab
  commands; `search` for "Search the web" with your default engine; `favicon`
  for icons; `management` to find Reading Context; `clipboardWrite` for the
  copy commands.
