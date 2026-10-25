export const PALETTE_WIDTH = 720;
export const PALETTE_HEIGHT = 480;

export const READING_CONTEXT_NAME = "Reading Context";

export interface PaletteState {
  windowId: number;
  originWindowId: number;
  originTabId: number | null;
  // Set once the palette window has actually received focus, so the
  // transient focus changes during creation don't close it.
  hadFocus: boolean;
}

export type BackgroundMessage =
  | { type: "close-palette"; refocusOrigin: boolean }
  | { type: "toggle-palette" };

export const PALETTE_PATH = "palette.html";

// storage.session key holding the ?open= id of the palette window the
// background opened; a page restored by ⌘⇧T carries a stale one.
export const OPEN_ID_KEY = "paletteOpenId";

// Closed palette windows land in Chrome's recently-closed list, so ⌘⇧T
// would bring them back. Anything that restores sessions skips them.
export function isPaletteSession(session: chrome.sessions.Session) {
  const prefix = chrome.runtime.getURL(PALETTE_PATH);
  if (session.tab) return Boolean(session.tab.url?.startsWith(prefix));
  return Boolean(session.window?.tabs?.length && session.window.tabs.every((t) => t.url?.startsWith(prefix)));
}

export async function restoreLastClosed() {
  const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
  const real = sessions.find((s) => !isPaletteSession(s));
  const id = real?.tab?.sessionId ?? real?.window?.sessionId;
  if (id) await chrome.sessions.restore(id);
}

export interface Nudge {
  title: string;
  shortcut: string;
  count: number;
  at: number;
}

export interface Settings {
  // Stop showing "Next time: ⌘W" once a command has run this many times.
  nudgeLimit: number;
}

export const DEFAULT_SETTINGS: Settings = { nudgeLimit: 10 };

export async function getUsage(): Promise<Record<string, number>> {
  const { usage } = await chrome.storage.local.get("usage");
  return (usage as Record<string, number>) || {};
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings> | undefined) };
}
