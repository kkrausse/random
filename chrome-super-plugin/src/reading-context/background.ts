import { recordDiagnostic } from "./diagnostics";
import { reinjectContentScripts, startAutoReload } from "./autoReload";
import "./palette/background";

const CONTEXT_MENU_ID = "reading-context-ask";

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

function configureExtension() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => recordDiagnostic("panel-behavior-error", {
      message: String(error?.message || error)
    }));
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
    .catch((error) => console.warn("Could not restrict extension storage", error));
  registerContextMenu();
}

configureExtension();

chrome.runtime.onInstalled.addListener(() => {
  configureExtension();
  // Covers both rebuild auto-reloads and manual reloads: open pages get the
  // new content script without being refreshed.
  void reinjectContentScripts();
});

startAutoReload();

chrome.runtime.onStartup.addListener(configureExtension);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) return;
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

  void chrome.storage.session.set({
    [`pendingCapture:${sender.tab.id}`]: message.capture
  }).then(() => sendResponse(), () => sendResponse());
  return true;
});

// The side panel holds a port open while it is showing, so the shortcut can
// toggle synchronously; sidePanel.open must run inside the command's gesture.
const openPanels = new Map<number, chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  const match = /^sidepanel:(\d+)$/.exec(port.name);
  if (!match) return;
  const windowId = Number(match[1]);
  openPanels.set(windowId, port);
  port.onDisconnect.addListener(() => {
    if (openPanels.get(windowId) === port) openPanels.delete(windowId);
  });
});

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

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "toggle-reading-context" || tab?.windowId === undefined) return;
  void setPanel(tab.windowId, "toggle");
});

// The command palette (src/palette/) opens and closes the panel. Its page
// sends this message from the Enter keydown, and Chrome carries that user
// gesture over to here, so sidePanel.open is allowed.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "reading-context" || !sender.url?.startsWith(chrome.runtime.getURL("palette.html"))) return false;
  if (typeof message.windowId !== "number") {
    sendResponse({ ok: false, error: "missing windowId" });
    return false;
  }
  const action: PanelAction = message.action === "close" || message.action === "toggle" ? message.action : "open";
  void setPanel(message.windowId, action).then(sendResponse);
  return true;
});
