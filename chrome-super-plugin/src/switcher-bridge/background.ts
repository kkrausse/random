// Switcher bridge: streams the tab list to a native macOS switcher app and
// switches tabs when it asks. The app is the WebSocket server (it can't see
// Chrome's tabs itself); this service worker is the client.
//
// Protocol (JSON text frames on ws://127.0.0.1:47600/):
//   → {"type":"tabs","tabs":[{id,windowId,title,url,lastAccessed,active,favIconUrl?}]}
//       full snapshot of every tab in normal windows, on connect and
//       (debounced) whenever tabs change
//   → {"type":"ping"} every 20s; the app answers {"type":"pong"}
//   ← {"type":"activate","tabId":123,"windowId":4}
// Unknown message types are ignored.

const URL = "ws://127.0.0.1:47600/";
const ALARM = "switcher-bridge-reconnect";
const ALARM_PERIOD_MINUTES = 0.5;
const PING_MS = 20_000;
const DEBOUNCE_MS = 100;
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
  favIconUrl?: string;
}

let running = false;
let socket: WebSocket | null = null;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let lastSent = "";

async function snapshot(): Promise<BridgeTab[]> {
  const tabs = await chrome.tabs.query({ windowType: "normal" });
  return tabs.flatMap((tab) => tab.id === undefined ? [] : [{
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title ?? "",
    url: tab.url || tab.pendingUrl || "",
    lastAccessed: tab.lastAccessed ?? 0,
    active: tab.active,
    ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {})
  }]);
}

async function sendSnapshot(ws: WebSocket) {
  const frame = JSON.stringify({ type: "tabs", tabs: await snapshot().catch(() => []) });
  if (ws !== socket || ws.readyState !== WebSocket.OPEN || frame === lastSent) return;
  lastSent = frame;
  ws.send(frame);
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
