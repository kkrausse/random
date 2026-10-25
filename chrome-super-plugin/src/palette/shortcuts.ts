// Native Chrome / macOS shortcuts. `mac` is the source of truth (the user is
// on a Mac); `other` is the Windows/Linux Chrome equivalent when there is one.
// Steps separated by "," are pressed in sequence, e.g. "⌘L, ⌘C".

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export interface Shortcut {
  mac: string;
  other?: string;
}

export interface CheatSheetEntry {
  id: string;
  title: string;
  shortcut: Shortcut;
  section: string;
  // Extra keywords for fuzzy matching ("omnibox", "url bar"...).
  keywords?: string;
  hint?: string;
}

export function shortcutText(shortcut: Shortcut | undefined): string | undefined {
  if (!shortcut) return undefined;
  return isMac ? shortcut.mac : shortcut.other;
}

export type ShortcutPart = { kind: "keys"; keys: string[] } | { kind: "text"; text: string };

const KEY_WORDS = new Set(["Esc", "Tab", "Space", "Home", "End", "F6", "F11", "↵", "PgUp", "PgDn", "Del", "Delete"]);

// Turns "⌘L, type, ↵" or "⌘G / ⌘⇧G" into keycap groups and plain-text glue.
// Steps are separated by ", " (with a space) so "⌘," stays one shortcut.
export function shortcutParts(text: string): ShortcutPart[] {
  const parts: ShortcutPart[] = [];
  text.split(/,\s+/).forEach((step, stepIndex) => {
    if (stepIndex > 0) parts.push({ kind: "text", text: "then" });
    for (const word of step.split(" ")) {
      if (!word) continue;
      if (word === "/" || word === "…") {
        parts.push({ kind: "text", text: word });
      } else if (/^[A-Z][a-z]*\+/.test(word)) {
        parts.push({ kind: "keys", keys: word.split(/\+(?=.)/) });
      } else if (/^[⌘⌥⇧⌃]/.test(word) || KEY_WORDS.has(word) || word.length === 1) {
        const keys: string[] = [];
        let rest = word;
        while (rest.length && "⌘⌥⇧⌃".includes(rest[0])) {
          keys.push(rest[0]);
          rest = rest.slice(1);
        }
        if (rest) keys.push(rest);
        parts.push({ kind: "keys", keys });
      } else {
        // "type", "link text": an instruction, not a key.
        const last = parts[parts.length - 1];
        if (last?.kind === "text" && last.text !== "then") last.text += ` ${word}`;
        else parts.push({ kind: "text", text: word });
      }
    }
  });
  return parts;
}

export const SHORTCUTS = {
  newTab: { mac: "⌘T", other: "Ctrl+T" },
  newWindow: { mac: "⌘N", other: "Ctrl+N" },
  newIncognito: { mac: "⌘⇧N", other: "Ctrl+Shift+N" },
  closeTab: { mac: "⌘W", other: "Ctrl+W" },
  closeWindow: { mac: "⌘⇧W", other: "Ctrl+Shift+W" },
  reopenClosed: { mac: "⌘⇧T", other: "Ctrl+Shift+T" },
  nextTab: { mac: "⌘⌥→", other: "Ctrl+Tab" },
  prevTab: { mac: "⌘⌥←", other: "Ctrl+Shift+Tab" },
  lastTab: { mac: "⌘9", other: "Ctrl+9" },
  back: { mac: "⌘[", other: "Alt+←" },
  forward: { mac: "⌘]", other: "Alt+→" },
  reload: { mac: "⌘R", other: "Ctrl+R" },
  hardReload: { mac: "⌘⇧R", other: "Ctrl+Shift+R" },
  addressBar: { mac: "⌘L", other: "Ctrl+L" },
  searchWeb: { mac: "⌘L, type, ↵", other: "Ctrl+L, type, Enter" },
  copyUrl: { mac: "⌘L, ⌘C", other: "Ctrl+L, Ctrl+C" },
  zoomIn: { mac: "⌘=", other: "Ctrl+=" },
  zoomOut: { mac: "⌘-", other: "Ctrl+-" },
  zoomReset: { mac: "⌘0", other: "Ctrl+0" },
  settings: { mac: "⌘,", other: undefined },
  history: { mac: "⌘Y", other: "Ctrl+H" },
  downloads: { mac: "⌘⇧J", other: "Ctrl+J" },
  bookmarksManager: { mac: "⌘⌥B", other: "Ctrl+Shift+O" },
  tabSearch: { mac: "⌘⇧A", other: "Ctrl+Shift+A" },
  readingContext: { mac: "⌘⇧E", other: "Ctrl+Shift+E" }
} satisfies Record<string, Shortcut>;

export function tabNumberShortcut(index: number, isLast: boolean): Shortcut | undefined {
  if (index < 8) return { mac: `⌘${index + 1}`, other: `Ctrl+${index + 1}` };
  if (isLast) return SHORTCUTS.lastTab;
  return undefined;
}

// Everything shown by "Shortcut cheat sheet", including keys the palette
// cannot run itself (address bar, find, macOS menu search...).
export const CHEAT_SHEET: CheatSheetEntry[] = [
  { id: "addr", section: "Address bar", title: "Focus address bar", shortcut: SHORTCUTS.addressBar, keywords: "omnibox url location" },
  { id: "addr-search", section: "Address bar", title: "Search the web", shortcut: SHORTCUTS.searchWeb, keywords: "google omnibox" },
  { id: "addr-copy", section: "Address bar", title: "Copy page URL", shortcut: SHORTCUTS.copyUrl },
  { id: "addr-newtab", section: "Address bar", title: "Open address in a new tab", shortcut: { mac: "⌘L, type, ⌥↵", other: "Ctrl+L, type, Alt+Enter" } },
  { id: "addr-delete", section: "Address bar", title: "Remove a suggestion", shortcut: { mac: "⇧⌦", other: "Shift+Delete" }, hint: "with the suggestion highlighted; ⌦ is fn⌫ on a laptop" },

  { id: "tab-new", section: "Tabs", title: "New tab", shortcut: SHORTCUTS.newTab },
  { id: "tab-close", section: "Tabs", title: "Close tab", shortcut: SHORTCUTS.closeTab },
  { id: "tab-reopen", section: "Tabs", title: "Reopen closed tab", shortcut: SHORTCUTS.reopenClosed },
  { id: "tab-next", section: "Tabs", title: "Next tab", shortcut: SHORTCUTS.nextTab, keywords: "right ctrl tab" },
  { id: "tab-prev", section: "Tabs", title: "Previous tab", shortcut: SHORTCUTS.prevTab, keywords: "left" },
  { id: "tab-next-ctrl", section: "Tabs", title: "Next / previous tab (alt)", shortcut: { mac: "⌃Tab / ⌃⇧Tab", other: "Ctrl+PgDn / Ctrl+PgUp" } },
  { id: "tab-n", section: "Tabs", title: "Switch to tab 1–8", shortcut: { mac: "⌘1 … ⌘8", other: "Ctrl+1 … Ctrl+8" }, keywords: "number" },
  { id: "tab-last", section: "Tabs", title: "Switch to last tab", shortcut: SHORTCUTS.lastTab },
  { id: "tab-search", section: "Tabs", title: "Search tabs (Chrome tab search)", shortcut: SHORTCUTS.tabSearch, keywords: "find tab" },

  { id: "nav-back", section: "Navigation", title: "Back", shortcut: SHORTCUTS.back, keywords: "history previous page" },
  { id: "nav-forward", section: "Navigation", title: "Forward", shortcut: SHORTCUTS.forward },
  { id: "nav-reload", section: "Navigation", title: "Reload", shortcut: SHORTCUTS.reload, keywords: "refresh" },
  { id: "nav-hard", section: "Navigation", title: "Hard reload (bypass cache)", shortcut: SHORTCUTS.hardReload, keywords: "refresh" },
  { id: "nav-stop", section: "Navigation", title: "Stop loading", shortcut: { mac: "Esc", other: "Esc" } },

  { id: "page-find", section: "Page", title: "Find in page", shortcut: { mac: "⌘F", other: "Ctrl+F" }, keywords: "search" },
  { id: "page-find-next", section: "Page", title: "Find next / previous", shortcut: { mac: "⌘G / ⌘⇧G", other: "Ctrl+G / Ctrl+Shift+G" } },
  { id: "page-follow", section: "Page", title: "Follow a link without the mouse", shortcut: { mac: "⌘F, link text, Esc, ↵", other: "Ctrl+F, link text, Esc, Enter" }, keywords: "click open link keyboard", hint: "Esc leaves the match focused; ↵ opens it, ⌘↵ in a new tab" },
  { id: "page-tab", section: "Page", title: "Move between links and fields", shortcut: { mac: "Tab / ⇧Tab", other: "Tab / Shift+Tab" } },
  { id: "page-top", section: "Page", title: "Top / bottom of page", shortcut: { mac: "⌘↑ / ⌘↓", other: "Home / End" }, keywords: "scroll" },
  { id: "page-scroll", section: "Page", title: "Page down / up", shortcut: { mac: "Space / ⇧Space", other: "Space / Shift+Space" }, keywords: "scroll" },
  { id: "page-zoom-in", section: "Page", title: "Zoom in", shortcut: SHORTCUTS.zoomIn },
  { id: "page-zoom-out", section: "Page", title: "Zoom out", shortcut: SHORTCUTS.zoomOut },
  { id: "page-zoom-reset", section: "Page", title: "Reset zoom", shortcut: SHORTCUTS.zoomReset },
  { id: "page-bookmark", section: "Page", title: "Bookmark this page", shortcut: { mac: "⌘D", other: "Ctrl+D" } },
  { id: "page-print", section: "Page", title: "Print", shortcut: { mac: "⌘P", other: "Ctrl+P" } },
  { id: "page-save", section: "Page", title: "Save page", shortcut: { mac: "⌘S", other: "Ctrl+S" } },
  { id: "page-source", section: "Page", title: "View source", shortcut: { mac: "⌘⌥U", other: "Ctrl+U" } },
  { id: "page-devtools", section: "Page", title: "Developer tools", shortcut: { mac: "⌘⌥I", other: "Ctrl+Shift+I" }, keywords: "inspect" },
  { id: "page-console", section: "Page", title: "JavaScript console", shortcut: { mac: "⌘⌥J", other: "Ctrl+Shift+J" } },

  { id: "win-new", section: "Windows", title: "New window", shortcut: SHORTCUTS.newWindow },
  { id: "win-incognito", section: "Windows", title: "New incognito window", shortcut: SHORTCUTS.newIncognito, keywords: "private" },
  { id: "win-close", section: "Windows", title: "Close window", shortcut: SHORTCUTS.closeWindow },
  { id: "win-cycle", section: "Windows", title: "Cycle Chrome windows", shortcut: { mac: "⌘`", other: "Alt+Tab" } },
  { id: "win-fullscreen", section: "Windows", title: "Full screen", shortcut: { mac: "⌘⌃F", other: "F11" } },
  { id: "win-minimize", section: "Windows", title: "Minimize", shortcut: { mac: "⌘M" } },

  { id: "chrome-settings", section: "Chrome", title: "Settings", shortcut: SHORTCUTS.settings },
  { id: "chrome-history", section: "Chrome", title: "History", shortcut: SHORTCUTS.history },
  { id: "chrome-downloads", section: "Chrome", title: "Downloads", shortcut: SHORTCUTS.downloads },
  { id: "chrome-bookmarks", section: "Chrome", title: "Bookmarks manager", shortcut: SHORTCUTS.bookmarksManager },
  { id: "chrome-bookmarks-bar", section: "Chrome", title: "Show / hide bookmarks bar", shortcut: { mac: "⌘⇧B", other: "Ctrl+Shift+B" } },
  { id: "chrome-clear", section: "Chrome", title: "Clear browsing data", shortcut: { mac: "⌘⇧⌫", other: "Ctrl+Shift+Del" } },
  { id: "chrome-toolbar", section: "Chrome", title: "Focus the toolbar", shortcut: { mac: "⌘⌥T", other: "Alt+Shift+T" }, hint: "then Tab / arrows through toolbar buttons and extensions" },
  { id: "chrome-panes", section: "Chrome", title: "Cycle focus: page, toolbar, side panel", shortcut: { mac: "F6 / ⇧F6", other: "F6 / Shift+F6" } },
  { id: "chrome-menu-search", section: "Chrome", title: "Search the macOS menu bar", shortcut: { mac: "⌘⇧/" }, keywords: "help menu commands", hint: "type any menu item name, ↵ to run it" },
  { id: "chrome-reading-context", section: "Chrome", title: "Toggle Reading Context side panel", shortcut: SHORTCUTS.readingContext },
  { id: "palette", section: "Chrome", title: "Open this command palette", shortcut: { mac: "⌘⇧P", other: "Ctrl+Shift+P" } }
];
