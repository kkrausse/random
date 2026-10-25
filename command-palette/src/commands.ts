import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  BookX,
  Copy,
  CopyPlus,
  Download,
  Globe,
  History,
  Keyboard,
  KeyRound,
  Link,
  type LucideIcon,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  Puzzle,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  Settings,
  SquareArrowOutUpRight,
  Volume2,
  X,
  XSquare,
  ZoomIn,
  ZoomOut,
  EyeOff,
  Star
} from "lucide-react";
import { getSettings, restoreLastClosed } from "./shared";
import { SHORTCUTS, type Shortcut } from "./shortcuts";

export type Mode = "root" | "cheatsheet" | "history" | "bookmarks" | "url";

export interface RunContext {
  originTabId: number | null;
  originWindowId: number;
  query: string;
  readingContextId: string | null;
  setMode: (mode: Mode) => void;
}

export interface RunResult {
  // Keep the palette open (mode switches, or an error to show).
  keepOpen?: boolean;
  error?: string;
  message?: string;
  // The command moved focus somewhere on purpose (new window, other tab);
  // don't send focus back to the original window.
  focusMoved?: boolean;
}

export interface PaletteCommand {
  id: string;
  title: string;
  section: "Tabs" | "Navigation" | "Page" | "Window" | "Chrome pages" | "Reading Context" | "Palette";
  icon: LucideIcon;
  shortcut?: Shortcut;
  keywords?: string;
  // Hide when it can't apply (e.g. no Reading Context installed).
  available?: (ctx: RunContext) => boolean;
  run: (ctx: RunContext) => Promise<RunResult | void> | RunResult | void;
}

async function originTab(ctx: RunContext) {
  if (ctx.originTabId === null) throw new Error("No active tab");
  return chrome.tabs.get(ctx.originTabId);
}

function openChromePage(url: string) {
  return async (ctx: RunContext): Promise<RunResult> => {
    await chrome.tabs.create({ url, windowId: ctx.originWindowId, active: true });
    await chrome.windows.update(ctx.originWindowId, { focused: true });
    return { focusMoved: true };
  };
}

// Chrome's built-in zoom steps.
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

async function stepZoom(ctx: RunContext, direction: 1 | -1) {
  const tab = await originTab(ctx);
  const current = await chrome.tabs.getZoom(tab.id!);
  const next = direction > 0
    ? ZOOM_LEVELS.find((level) => level > current + 0.001) ?? current
    : [...ZOOM_LEVELS].reverse().find((level) => level < current - 0.001) ?? current;
  await chrome.tabs.setZoom(tab.id!, next);
}

function escapeMarkdown(text: string) {
  return text.replace(/([\[\]\\])/g, "\\$1");
}

// Must be called synchronously from the key/click handler: the message has
// to leave inside the user gesture so Reading Context can call
// chrome.sidePanel.open().
export function sendReadingContext(ctx: RunContext, action: "open" | "close"): Promise<RunResult> {
  if (!ctx.readingContextId) return Promise.resolve({ keepOpen: true, error: "Reading Context isn't installed or enabled." });
  return chrome.runtime.sendMessage(ctx.readingContextId, {
    type: "reading-context",
    action,
    windowId: ctx.originWindowId
  }).then((response: { ok: boolean; error?: string } | undefined) => {
    if (response?.ok) return {};
    return {
      keepOpen: true,
      error: `Reading Context couldn't ${action}: ${response?.error ?? "no response"}. Use ⌘⇧E instead.`
    };
  }, (error) => ({ keepOpen: true, error: `Reading Context didn't answer (${error?.message ?? error}). Reload it once at chrome://extensions.` }));
}

export const COMMANDS: PaletteCommand[] = [
  // Tabs
  {
    id: "close-tab", section: "Tabs", title: "Close tab", icon: X, shortcut: SHORTCUTS.closeTab,
    run: async (ctx) => { await chrome.tabs.remove((await originTab(ctx)).id!); }
  },
  {
    id: "close-other-tabs", section: "Tabs", title: "Close other tabs", icon: XSquare, keywords: "only keep this",
    run: async (ctx) => {
      const tab = await originTab(ctx);
      const tabs = await chrome.tabs.query({ windowId: tab.windowId, pinned: false });
      await chrome.tabs.remove(tabs.filter((t) => t.id !== tab.id).map((t) => t.id!));
    }
  },
  {
    id: "toggle-pin", section: "Tabs", title: "Pin / unpin tab", icon: Pin,
    run: async (ctx) => { const tab = await originTab(ctx); await chrome.tabs.update(tab.id!, { pinned: !tab.pinned }); }
  },
  {
    id: "toggle-mute", section: "Tabs", title: "Mute / unmute tab", icon: Volume2, keywords: "sound audio silence",
    run: async (ctx) => { const tab = await originTab(ctx); await chrome.tabs.update(tab.id!, { muted: !tab.mutedInfo?.muted }); }
  },
  {
    id: "duplicate-tab", section: "Tabs", title: "Duplicate tab", icon: CopyPlus, keywords: "clone copy",
    run: async (ctx) => { await chrome.tabs.duplicate((await originTab(ctx)).id!); }
  },
  {
    id: "move-to-window", section: "Tabs", title: "Move tab to new window", icon: SquareArrowOutUpRight, keywords: "detach pop out",
    run: async (ctx) => { await chrome.windows.create({ tabId: (await originTab(ctx)).id!, focused: true }); return { focusMoved: true }; }
  },
  {
    id: "reopen-closed", section: "Tabs", title: "Reopen closed tab", icon: RotateCcw, shortcut: SHORTCUTS.reopenClosed, keywords: "undo restore recently closed",
    run: async () => { await restoreLastClosed(); return { focusMoved: true }; }
  },
  {
    id: "new-tab", section: "Tabs", title: "New tab", icon: CopyPlus, shortcut: SHORTCUTS.newTab,
    run: async (ctx) => openChromePage("chrome://newtab")(ctx)
  },

  // Navigation
  {
    id: "back", section: "Navigation", title: "Back", icon: ArrowLeft, shortcut: SHORTCUTS.back, keywords: "previous page history",
    run: async (ctx) => { await chrome.tabs.goBack((await originTab(ctx)).id!); }
  },
  {
    id: "forward", section: "Navigation", title: "Forward", icon: ArrowRight, shortcut: SHORTCUTS.forward, keywords: "next page",
    run: async (ctx) => { await chrome.tabs.goForward((await originTab(ctx)).id!); }
  },
  {
    id: "reload", section: "Navigation", title: "Reload", icon: RotateCw, shortcut: SHORTCUTS.reload, keywords: "refresh",
    run: async (ctx) => { await chrome.tabs.reload((await originTab(ctx)).id!); }
  },
  {
    id: "hard-reload", section: "Navigation", title: "Hard reload (bypass cache)", icon: RefreshCw, shortcut: SHORTCUTS.hardReload, keywords: "refresh cache",
    run: async (ctx) => { await chrome.tabs.reload((await originTab(ctx)).id!, { bypassCache: true }); }
  },
  {
    id: "open-url", section: "Navigation", title: "Open URL…", icon: Globe, shortcut: SHORTCUTS.addressBar, keywords: "go to address navigate",
    run: (ctx) => { ctx.setMode("url"); return { keepOpen: true }; }
  },
  {
    id: "history-search", section: "Navigation", title: "Search history…", icon: History, shortcut: SHORTCUTS.history,
    run: (ctx) => { ctx.setMode("history"); return { keepOpen: true }; }
  },
  {
    id: "bookmarks-search", section: "Navigation", title: "Search bookmarks…", icon: Bookmark,
    run: (ctx) => { ctx.setMode("bookmarks"); return { keepOpen: true }; }
  },

  // Page
  {
    id: "copy-url", section: "Page", title: "Copy URL", icon: Link, shortcut: SHORTCUTS.copyUrl, keywords: "clipboard address link",
    run: async (ctx) => { await navigator.clipboard.writeText((await originTab(ctx)).url ?? ""); }
  },
  {
    id: "copy-markdown", section: "Page", title: "Copy as Markdown link", icon: Copy, keywords: "clipboard md",
    run: async (ctx) => {
      const tab = await originTab(ctx);
      await navigator.clipboard.writeText(`[${escapeMarkdown(tab.title ?? tab.url ?? "")}](${tab.url ?? ""})`);
    }
  },
  { id: "zoom-in", section: "Page", title: "Zoom in", icon: ZoomIn, shortcut: SHORTCUTS.zoomIn, keywords: "bigger larger", run: (ctx) => stepZoom(ctx, 1) },
  { id: "zoom-out", section: "Page", title: "Zoom out", icon: ZoomOut, shortcut: SHORTCUTS.zoomOut, keywords: "smaller", run: (ctx) => stepZoom(ctx, -1) },
  {
    id: "zoom-reset", section: "Page", title: "Reset zoom", icon: Search, shortcut: SHORTCUTS.zoomReset, keywords: "actual size 100%",
    run: async (ctx) => { await chrome.tabs.setZoom((await originTab(ctx)).id!, 0); }
  },

  // Window
  {
    id: "new-window", section: "Window", title: "New window", icon: AppWindow, shortcut: SHORTCUTS.newWindow,
    run: async () => { await chrome.windows.create({ focused: true }); return { focusMoved: true }; }
  },
  {
    id: "new-incognito", section: "Window", title: "New incognito window", icon: EyeOff, shortcut: SHORTCUTS.newIncognito, keywords: "private",
    run: async () => { await chrome.windows.create({ incognito: true, focused: true }); return { focusMoved: true }; }
  },

  // Chrome pages
  { id: "page-settings", section: "Chrome pages", title: "Settings", icon: Settings, shortcut: SHORTCUTS.settings, keywords: "preferences chrome://settings", run: openChromePage("chrome://settings") },
  { id: "page-extensions", section: "Chrome pages", title: "Extensions", icon: Puzzle, keywords: "chrome://extensions addons plugins", run: openChromePage("chrome://extensions") },
  { id: "page-shortcuts", section: "Chrome pages", title: "Extension keyboard shortcuts", icon: Keyboard, keywords: "chrome://extensions/shortcuts hotkeys keybindings change palette shortcut rebind", run: openChromePage("chrome://extensions/shortcuts") },
  { id: "page-downloads", section: "Chrome pages", title: "Downloads", icon: Download, shortcut: SHORTCUTS.downloads, keywords: "chrome://downloads", run: openChromePage("chrome://downloads") },
  { id: "page-history", section: "Chrome pages", title: "History page", icon: History, shortcut: SHORTCUTS.history, keywords: "chrome://history", run: openChromePage("chrome://history") },
  { id: "page-passwords", section: "Chrome pages", title: "Passwords", icon: KeyRound, keywords: "password manager chrome://password-manager", run: openChromePage("chrome://password-manager/passwords") },
  { id: "page-bookmarks", section: "Chrome pages", title: "Bookmarks manager", icon: Star, shortcut: SHORTCUTS.bookmarksManager, keywords: "chrome://bookmarks", run: openChromePage("chrome://bookmarks") },

  // Reading Context
  {
    id: "reading-context-open", section: "Reading Context", title: "Open Reading Context", icon: PanelRightOpen, shortcut: SHORTCUTS.readingContext, keywords: "side panel sidebar",
    available: (ctx) => Boolean(ctx.readingContextId),
    run: (ctx) => sendReadingContext(ctx, "open")
  },
  {
    id: "reading-context-close", section: "Reading Context", title: "Close Reading Context", icon: PanelRightClose, shortcut: SHORTCUTS.readingContext, keywords: "side panel sidebar hide",
    available: (ctx) => Boolean(ctx.readingContextId),
    run: (ctx) => sendReadingContext(ctx, "close")
  },

  // Palette
  {
    id: "cheat-sheet", section: "Palette", title: "Shortcut cheat sheet", icon: BookOpen, keywords: "keyboard help learn keys hotkeys",
    run: (ctx) => { ctx.setMode("cheatsheet"); return { keepOpen: true }; }
  },
  {
    id: "reset-learning", section: "Palette", title: "Reset learning stats", icon: BookX, keywords: "usage counts nudges hints",
    run: async () => { await chrome.storage.local.remove(["usage", "pendingNudge"]); return { keepOpen: true, message: "Usage counts cleared; shortcut hints will show again." }; }
  },
  {
    id: "nudge-limit", section: "Palette", title: "Change shortcut hint limit", icon: Keyboard, keywords: "nudge learning next time stop hints",
    run: async () => {
      const steps = [10, 25, 1_000_000, 0];
      const settings = await getSettings();
      const next = steps[(steps.indexOf(settings.nudgeLimit) + 1) % steps.length];
      await chrome.storage.local.set({ settings: { ...settings, nudgeLimit: next } });
      const label = next === 0 ? "off" : next >= 1_000_000 ? "always shown" : `shown until a command has run ${next} times`;
      return { keepOpen: true, message: `“Next time” hints: ${label}. Run again to cycle.` };
    }
  }
];
