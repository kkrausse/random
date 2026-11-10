import { recordDiagnostic } from "./diagnostics";
import { inEveryWebTab, setContentScript } from "../contentScripts";
import { cachedFeature } from "../features";

const CONTEXT_MENU_ID = "reading-context-ask";

const CONTENT_SCRIPT: chrome.scripting.RegisteredContentScript = {
  id: "reading-context",
  matches: ["<all_urls>"],
  js: ["content.js"],
  runAt: "document_idle",
  persistAcrossSessions: true
};

function enabled() {
  return cachedFeature("readingContext") !== false;
}

function registerContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "Ask Reading Context about “%s”",
      contexts: ["selection"]
    }, () => {
      if (chrome.runtime.lastError) {
        void recordDiagnostic("context-menu-create-error", {
          message: String(chrome.runtime.lastError?.message || chrome.runtime.lastError)
        });
      }
    });
  });
}

function openSidePanel(tabId: number) {
  return chrome.sidePanel.open({ tabId }).catch((error) => {
    recordDiagnostic("sidepanel-open-error", {
      message: String(error?.message || error)
    });
  });
}

// The side panel holds a port open while it is showing, so the shortcut can
// toggle synchronously; sidePanel.open must run inside the command's gesture.
const openPanels = new Map<number, chrome.runtime.Port>();

type PanelAction = "open" | "close" | "toggle";

// Calls sidePanel.open synchronously, so it must run inside the caller's
// user gesture (a command, or a message sent from one).
function setPanel(windowId: number, action: PanelAction): Promise<{ ok: boolean; error?: string }> {
  const port = openPanels.get(windowId);
  if (port) {
    if (action !== "open") port.postMessage({ type: "close" });
    return Promise.resolve({ ok: true });
  }
  if (action === "close") return Promise.resolve({ ok: true });
  return chrome.sidePanel.open({ windowId }).then(() => ({ ok: true }), (error) => {
    const message = String(error?.message || error);
    recordDiagnostic("sidepanel-open-error", { message });
    return { ok: false, error: message };
  });
}

function injectContentScript(tabId: number) {
  return chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

// content.ts listens for this DOM event and shuts itself down.
function tearDownContentScript(tabId: number) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.dispatchEvent(new Event("reading-context:teardown"))
  });
}

// Turns every piece of Reading Context on or off: the content script, the
// side panel (also what the toolbar icon opens), and the context menu.
// `inject` re-injects the content script into already-open tabs, after an
// install/reload or when the feature is switched back on.
export async function applyReadingContext(on: boolean, { inject }: { inject: boolean }) {
  await setContentScript(CONTENT_SCRIPT, on).catch((error) => recordDiagnostic("content-script-register-error", {
    message: String(error?.message || error)
  }));
  await chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: on }).catch(() => {});
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: on }).catch((error) => recordDiagnostic("panel-behavior-error", {
    message: String(error?.message || error)
  }));
  if (on) {
    registerContextMenu();
    if (inject) await inEveryWebTab(injectContentScript);
  } else {
    chrome.contextMenus.removeAll();
    for (const port of openPanels.values()) port.postMessage({ type: "close" });
    await inEveryWebTab(tearDownContentScript);
  }
}

export function setupReadingContext() {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id || !enabled()) return;
    const tabId = tab.id;
    void chrome.tabs.sendMessage(tabId, { type: "capture-selection" }).then((capture) => {
      if (!capture) {
        void recordDiagnostic("context-menu-capture-empty", {});
        return;
      }
      void chrome.storage.session.set({ [`pendingCapture:${tabId}`]: capture });
    }).catch((error) => {
      void recordDiagnostic("context-menu-capture-error", {
        message: String(error?.message || error)
      });
    });
    void openSidePanel(tabId);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "update-reading-context" || !sender.tab?.id) {
      return false;
    }
    if (!enabled()) {
      sendResponse();
      return false;
    }

    void chrome.storage.session.set({
      [`pendingCapture:${sender.tab.id}`]: message.capture
    }).then(() => sendResponse(), () => sendResponse());
    return true;
  });

  chrome.runtime.onConnect.addListener((port) => {
    const match = /^sidepanel:(\d+)$/.exec(port.name);
    if (!match) return;
    const windowId = Number(match[1]);
    openPanels.set(windowId, port);
    port.onDisconnect.addListener(() => {
      if (openPanels.get(windowId) === port) openPanels.delete(windowId);
    });
  });

  chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== "toggle-reading-context" || tab?.windowId === undefined || !enabled()) return;
    void setPanel(tab.windowId, "toggle");
  });

  // The command palette (src/palette/) opens and closes the panel. Its page
  // sends this message from the Enter keydown, and Chrome carries that user
  // gesture over to here, so sidePanel.open is allowed.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "reading-context" || !sender.url?.startsWith(chrome.runtime.getURL("palette.html"))) return false;
    if (!enabled()) {
      sendResponse({ ok: false, error: "Reading Context is turned off" });
      return false;
    }
    if (typeof message.windowId !== "number") {
      sendResponse({ ok: false, error: "missing windowId" });
      return false;
    }
    const action: PanelAction = message.action === "close" || message.action === "toggle" ? message.action : "open";
    void setPanel(message.windowId, action).then(sendResponse);
    return true;
  });
}
