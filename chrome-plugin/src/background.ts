import { recordDiagnostic } from "./diagnostics";

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

chrome.runtime.onInstalled.addListener(configureExtension);

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
