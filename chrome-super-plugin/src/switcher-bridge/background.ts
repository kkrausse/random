// Switcher bridge: streams the tab list to a native macOS switcher app and
// switches tabs when it asks. The app is the WebSocket server (it can't see
// Chrome's tabs itself); this service worker is the client.
//
// Protocol (JSON text frames on ws://127.0.0.1:47600/):
//   → {"type":"tabs","tabs":[{id,windowId,title,url,lastAccessed,active,icon?}]}
//       full snapshot of every tab in normal windows, on connect and
//       (debounced) whenever tabs change. `icon` is a short key for the
//       tab's favicon, absent when it has none.
//   → {"type":"icons","icons":[{"key":"…","png":"<base64 PNG>"}]}
//       the 32px image behind icon keys, sent after the snapshot that first
//       uses them (the app makes no network requests of its own). A key is
//       sent once per connection, and again only if it comes back after a
//       snapshot in which no tab used it, because the app forgets it then.
//   → {"type":"ping"} every 20s; the app answers {"type":"pong"}
//   ← {"type":"activate","tabId":123,"windowId":4}
// Unknown message types are ignored.

const URL = "ws://127.0.0.1:47600/";
const ALARM = "switcher-bridge-reconnect";
const ALARM_PERIOD_MINUTES = 0.5;
const PING_MS = 20_000;
const DEBOUNCE_MS = 100;
const ICON_SIZE = 32;
// Favicons resolved at a time; each batch goes out as one "icons" frame.
const ICON_BATCH = 8;
// Quick retries after start-up or a dropped connection (the app restarting).
// After these the worker is allowed to fall asleep and the alarm takes over,
// so a missing app costs one attempt per alarm period.
const BACKOFF_MS = [1000, 2000, 4000, 8000];

interface BridgeTab {
  id: number;
  windowId: number;
  title: string;
  url: string;
  lastAccessed: number;
  active: boolean;
  icon?: string;
}

// A favicon some tab in a snapshot uses: a page showing it, and where the
// page says it lives.
interface IconSource {
  pageUrl: string;
  favIconUrl: string;
}

let running = false;
let socket: WebSocket | null = null;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let lastSent = "";
// Icon keys sent, or being resolved, on the current connection.
let iconsSent = new Set<string>();
let defaultIcon: Promise<string | undefined> | null = null;

// favIconUrl can be a multi-KB data: URL, so tabs carry a short hash of it
// (cyrb53). Tabs with the same favicon share a key, and so one image.
function iconKey(favIconUrl: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < favIconUrl.length; i++) {
    const code = favIconUrl.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

async function snapshot(): Promise<{ tabs: BridgeTab[]; icons: Map<string, IconSource> }> {
  const icons = new Map<string, IconSource>();
  const tabs = (await chrome.tabs.query({ windowType: "normal" })).flatMap((tab): BridgeTab[] => {
    if (tab.id === undefined) return [];
    const url = tab.url || tab.pendingUrl || "";
    const icon = tab.favIconUrl ? iconKey(tab.favIconUrl) : undefined;
    if (icon && tab.favIconUrl) icons.set(icon, { pageUrl: url, favIconUrl: tab.favIconUrl });
    return [{
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title ?? "",
      url,
      lastAccessed: tab.lastAccessed ?? 0,
      active: tab.active,
      ...(icon ? { icon } : {})
    }];
  });
  return { tabs, icons };
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Chrome's own favicon cache, always a PNG of the size asked for.
async function cachedFavicon(pageUrl: string): Promise<string | undefined> {
  try {
    const response = await fetch(`${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(pageUrl)}&size=${ICON_SIZE}`);
    return response.ok ? await toBase64(await response.blob()) : undefined;
  } catch {
    return undefined;
  }
}

// The favicon itself, re-encoded as a small PNG. Fails for formats the worker
// can't decode (SVG).
async function fetchedFavicon(favIconUrl: string): Promise<string | undefined> {
  try {
    const response = await fetch(favIconUrl, { credentials: "omit" });
    if (!response.ok) return undefined;
    const bitmap = await createImageBitmap(await response.blob(), {
      resizeWidth: ICON_SIZE,
      resizeHeight: ICON_SIZE,
      resizeQuality: "high"
    });
    const canvas = new OffscreenCanvas(ICON_SIZE, ICON_SIZE);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await toBase64(await canvas.convertToBlob({ type: "image/png" }));
  } catch {
    return undefined;
  }
}

async function resolveIcon(source: IconSource): Promise<string | undefined> {
  // For a page it has no favicon stored for (often one still loading), the
  // cache answers with a generic globe rather than an error. Recognise that
  // and go to the favicon's own URL instead.
  defaultIcon ??= cachedFavicon("https://no-such-page.invalid/");
  const [cached, fallback] = await Promise.all([cachedFavicon(source.pageUrl), defaultIcon]);
  if (cached && cached !== fallback) return cached;
  return await fetchedFavicon(source.favIconUrl) ?? cached;
}

// Runs after the snapshot is on the wire; nothing waits for it.
async function sendIcons(ws: WebSocket, wanted: [string, IconSource][]) {
  for (let i = 0; i < wanted.length; i += ICON_BATCH) {
    const resolved = await Promise.all(wanted.slice(i, i + ICON_BATCH).map(async ([key, source]) => ({
      key,
      png: await resolveIcon(source)
    })));
    if (ws !== socket || ws.readyState !== WebSocket.OPEN) return;
    const icons = resolved.filter((icon) => icon.png !== undefined);
    if (icons.length > 0) ws.send(JSON.stringify({ type: "icons", icons }));
  }
}

async function sendSnapshot(ws: WebSocket) {
  const { tabs, icons } = await snapshot().catch(() => ({ tabs: [], icons: new Map<string, IconSource>() }));
  const frame = JSON.stringify({ type: "tabs", tabs });
  if (ws !== socket || ws.readyState !== WebSocket.OPEN || frame === lastSent) return;
  lastSent = frame;
  ws.send(frame);
  // The app drops icons this snapshot doesn't use, so forget those too.
  for (const key of iconsSent) if (!icons.has(key)) iconsSent.delete(key);
  const wanted = [...icons].filter(([key]) => !iconsSent.has(key));
  for (const [key] of wanted) iconsSent.add(key);
  void sendIcons(ws, wanted);
}

function scheduleSnapshot() {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    if (socket) void sendSnapshot(socket);
  }, DEBOUNCE_MS);
}

function onTabUpdated(_tabId: number, change: { title?: string; url?: string; favIconUrl?: string }) {
  // Loading progress, audio, mute etc. don't change anything we send.
  if (change.title !== undefined || change.url !== undefined || change.favIconUrl !== undefined) scheduleSnapshot();
}

// Tab listeners only exist while the socket is open: a snapshot is sent on
// connect, so nothing is missed, and tab activity never wakes the worker on
// the bridge's behalf while the app isn't there (or the feature is off).
function listenToTabs(on: boolean) {
  const method = on ? "addListener" : "removeListener";
  chrome.tabs.onCreated[method](scheduleSnapshot);
  chrome.tabs.onRemoved[method](scheduleSnapshot);
  chrome.tabs.onUpdated[method](onTabUpdated);
  chrome.tabs.onActivated[method](scheduleSnapshot);
  chrome.tabs.onAttached[method](scheduleSnapshot);
  chrome.tabs.onDetached[method](scheduleSnapshot);
  chrome.tabs.onReplaced[method](scheduleSnapshot);
  chrome.windows.onFocusChanged[method](scheduleSnapshot);
}

async function activate(tabId: number, windowId: number) {
  // The tab may have been closed since the snapshot the app is showing.
  const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
  // If it was dragged to another window meanwhile, focus the one it is in now.
  await chrome.windows.update(tab?.windowId ?? windowId, { focused: true }).catch(() => {});
}

function onMessage(data: unknown) {
  if (typeof data !== "string") return;
  let message: { type?: unknown; tabId?: unknown; windowId?: unknown };
  try {
    message = JSON.parse(data);
  } catch {
    return;
  }
  if (message?.type === "activate" && typeof message.tabId === "number" && typeof message.windowId === "number") {
    void activate(message.tabId, message.windowId);
  }
  // "pong" and anything unknown: nothing to do.
}

function clearTimers() {
  if (retryTimer) clearTimeout(retryTimer);
  if (pingTimer) clearInterval(pingTimer);
  if (snapshotTimer) clearTimeout(snapshotTimer);
  retryTimer = pingTimer = snapshotTimer = null;
}

function scheduleRetry() {
  if (!running || retryTimer || attempt >= BACKOFF_MS.length) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, BACKOFF_MS[attempt++]);
}

function connect() {
  if (!running || socket) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(URL);
  } catch {
    scheduleRetry();
    return;
  }
  socket = ws;
  let opened = false;

  ws.onopen = () => {
    if (ws !== socket) return;
    opened = true;
    attempt = 0;
    lastSent = "";
    iconsSent = new Set();
    listenToTabs(true);
    void sendSnapshot(ws);
    // Socket traffic also keeps the MV3 worker alive while connected.
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
    }, PING_MS);
  };
  ws.onmessage = (event) => {
    if (ws === socket) onMessage(event.data);
  };
  // The app usually isn't running; a refused connection is the normal case
  // and is deliberately not logged. "close" always follows "error".
  ws.onerror = () => {};
  ws.onclose = () => {
    if (ws !== socket) return;
    socket = null;
    listenToTabs(false);
    clearTimers();
    // A connection that had been up was probably the app restarting: start
    // the quick retries over.
    if (opened) attempt = 0;
    scheduleRetry();
  };
}

function start() {
  if (!running) {
    running = true;
    attempt = 0;
  }
  void chrome.alarms.create(ALARM, { periodInMinutes: ALARM_PERIOD_MINUTES });
  connect();
}

function stop() {
  running = false;
  void chrome.alarms.clear(ALARM);
  clearTimers();
  listenToTabs(false);
  const ws = socket;
  socket = null;
  if (ws) {
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try {
      ws.close();
    } catch {
      // Already closed.
    }
  }
}

// Called on every service-worker start and whenever the toggle changes.
export function applySwitcherBridge(on: boolean) {
  if (on) start();
  else stop();
}

// Registered synchronously at worker start-up so the alarm can wake a
// sleeping worker. Waking is most of the job: background.ts then applies the
// toggles, which connects (or, if the feature is off, clears the alarm).
export function setupSwitcherBridge() {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) connect();
  });
}
