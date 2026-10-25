# Super Extension

One Chrome extension, two jobs:

- **Reading Context** side panel (⌘⇧E): ask about highlighted passages. See
  the **Chrome Extension** section of [`../README.md`](../README.md) for
  setup, the server connection and how capture works.
- **Command palette** (⌘⇧P): a Spotlight-style launcher whose real job is
  teaching you to drive Chrome without the mouse. Described below.

Install: from `boox-plugin-test/`, run `bun install`, then `cd chrome-plugin && bun run build`.
Load unpacked `chrome-plugin/dist` once, with Developer mode on. After that,
`bun run build` (or `bun run dev`, which rebuilds on save) is enough: the
extension notices the new `dist/build-id.txt` within 30 seconds, or straight
away when you open the palette, and reloads itself.

## Command palette

The palette never touches page content. It always opens as its own small
popup window, centered on the current window, rendering `palette.html`. That
keeps it away from pages that grab keystrokes (Google Docs, Gmail, Figma),
z-index fights, fullscreen and focus traps, and it works the same on
`chrome://` pages, the new tab page, the Web Store and PDFs.

- **⌘⇧P** opens it. **⌘⇧P** again, **Esc**, or focusing any other window
  closes it, and focus goes back to the window you came from.
- Type to fuzzy-search one list of open tabs, commands, recently closed tabs,
  bookmarks and history. Commands you use often rank higher.
- **↑/↓**, **Ctrl+N/Ctrl+P** or Tab/⇧Tab move, **↵** runs, **⌘↵** opens links
  in a new tab.
- Commands act on the tab that was active when the palette opened: tab
  management, back/forward/reload, open URL, web search, copy URL or Markdown
  link, zoom, new (incognito) window, Chrome pages, and Open/Close Reading
  Context.
- "Search history…", "Search bookmarks…", "Open URL…" and "Shortcut cheat
  sheet" switch to a focused mode. **Esc**, or **⌫** in an empty box, goes back.

### Learning mode

- Every command with a native Chrome or macOS shortcut shows it as keycaps.
- After you run such a command through the palette, the next time it opens
  the footer says "Last time you ran Close tab. Next time: ⌘W". That stops
  for a command once you've run it 10 times. **Change shortcut hint limit**
  cycles 10 → 25 → always → off, and **Reset learning stats** starts over.
  Counts live in `chrome.storage.local`.
- **Shortcut cheat sheet** lists every shortcut the palette knows, including
  ones it can't run for you: ⌘L, ⌘⇧A tab search, ⌘⇧/ macOS menu search,
  ⌘F → Esc → ↵ to follow a link, ⌘⌥←/→, F6 and more.

### Opening Reading Context from the palette

`chrome.sidePanel.open` needs a user gesture. The palette page sends a
`reading-context` runtime message from inside its ↵ key handler, and Chrome
carries the gesture over to the background, which opens the panel (closing
goes over the panel's port). If it ever fails, the palette shows the error and
suggests ⌘⇧E.

### Changing the shortcuts

Chrome applies a suggested shortcut only if nothing else already owns it. If
⌘⇧P or ⌘⇧E does nothing, set it at `chrome://extensions/shortcuts` (the
palette's "Extension keyboard shortcuts" command opens it).

## Development notes

- Source: `src/background.ts` (single service worker; imports
  `src/palette/background.ts` and `src/autoReload.ts`), `src/content.ts`,
  `src/sidepanel.tsx`, `src/palette/`. The palette's Tailwind CSS is built
  from `src/palette/styles.css` into `dist/palette.css`; the side panel keeps
  its own `sidepanel.css`.
- Closed palette windows land in Chrome's recently-closed list. If ⌘⇧T
  brings one back, it notices it's stale, restores the real closed tab
  instead and closes itself.
- Permissions: `tabs`, `sessions`, `bookmarks`, `history` (palette search and
  tab commands), `search` (web search with your default engine), `favicon`,
  `clipboardWrite`, `alarms` (build check), `scripting` plus http/https host
  access (re-injecting the content script after a reload), and Reading
  Context's own `sidePanel`, `storage`, `contextMenus`.
