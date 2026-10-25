import { checkForNewBuild } from "../autoReload";
import { OPEN_ID_KEY, PALETTE_HEIGHT, PALETTE_WIDTH, type BackgroundMessage, type PaletteState } from "./shared";

// The palette is always its own small popup window rendering palette.html;
// it never touches page content. State lives in storage.session so it
// survives the service worker being stopped between keystrokes.

const STATE_KEY = "paletteState";
// When the palette page closed itself (Esc, ⌘⇧P handled in the page).
let lastClosedAt = 0;

async function getState(): Promise<PaletteState | null> {
  const stored = await chrome.storage.session.get(STATE_KEY);
  return (stored[STATE_KEY] as PaletteState | undefined) ?? null;
}

function setState(state: PaletteState | null) {
  return state ? chrome.storage.session.set({ [STATE_KEY]: state }) : chrome.storage.session.remove([STATE_KEY, OPEN_ID_KEY]);
}

async function closePalette(state: PaletteState, refocusOrigin: boolean) {
  await setState(null);
  await chrome.windows.remove(state.windowId).catch(() => {});
  if (refocusOrigin) {
    await chrome.windows.update(state.originWindowId, { focused: true }).catch(() => {});
  }
}

async function openPalette() {
  // Picks up a rebuilt extension (the reload would close this palette, so
  // it happens before the window exists).
  await checkForNewBuild();
  let origin: chrome.windows.Window;
  try {
    origin = await chrome.windows.getLastFocused({ populate: true, windowTypes: ["normal"] });
  } catch {
    origin = (await chrome.windows.create({ focused: true }))!;
  }
  const tab = origin.tabs?.find((t) => t.active);
  const left = Math.round((origin.left ?? 0) + ((origin.width ?? PALETTE_WIDTH) - PALETTE_WIDTH) / 2);
  const top = Math.round((origin.top ?? 0) + Math.max(48, ((origin.height ?? PALETTE_HEIGHT) - PALETTE_HEIGHT) * 0.3));
  const openId = crypto.randomUUID();
  const params = new URLSearchParams({ window: String(origin.id), open: openId });
  if (tab?.id !== undefined) params.set("tab", String(tab.id));
  // Written before the window exists so the page can check it on load.
  await chrome.storage.session.set({ [OPEN_ID_KEY]: openId });

  const win = (await chrome.windows.create({
    url: chrome.runtime.getURL(`palette.html?${params}`),
    type: "popup",
    width: PALETTE_WIDTH,
    height: PALETTE_HEIGHT,
    left,
    top,
    focused: true
  }))!;
  await setState({
    windowId: win.id!,
    originWindowId: origin.id!,
    originTabId: tab?.id ?? null,
    hadFocus: win.focused === true
  });
}

async function togglePalette() {
  const state = await getState();
  if (state) {
    await closePalette(state, true);
    return;
  }
  // The palette page also handles ⌘⇧P itself; ignore a command that lands
  // right after that close so the palette doesn't immediately reopen.
  if (Date.now() - lastClosedAt < 400) return;
  await openPalette();
}

// Exposed for tests: automation can't press chrome.commands shortcuts, and
// headless Chromium doesn't emit window focus changes.
(globalThis as { paletteTest?: unknown }).paletteTest = { togglePalette, onWindowFocus };

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-palette") void togglePalette();
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === "close-palette") {
    lastClosedAt = Date.now();
    void getState().then(async (state) => {
      if (state) await closePalette(state, message.refocusOrigin);
      sendResponse(true);
    });
    return true;
  }
  if (message?.type === "toggle-palette") {
    void togglePalette().then(() => sendResponse(true));
    return true;
  }
  return false;
});

function onWindowFocus(windowId: number) {
  return getState().then(async (state) => {
    if (!state) return;
    if (windowId === state.windowId) {
      if (!state.hadFocus) await setState({ ...state, hadFocus: true });
      return;
    }
    if (state.hadFocus) await closePalette(state, false);
  });
}

chrome.windows.onFocusChanged.addListener((windowId) => void onWindowFocus(windowId));

chrome.windows.onRemoved.addListener((windowId) => {
  void getState().then((state) => {
    if (state?.windowId === windowId) void setState(null);
  });
});
