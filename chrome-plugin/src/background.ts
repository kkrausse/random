import { recordDiagnostic } from "./diagnostics";

function configureExtension() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => recordDiagnostic("panel-behavior-error", {
      message: String(error?.message || error)
    }));
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
    .catch((error) => console.warn("Could not restrict extension storage", error));
}

configureExtension();

chrome.runtime.onInstalled.addListener(configureExtension);

chrome.runtime.onStartup.addListener(configureExtension);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "update-reading-context" || !sender.tab?.id) {
    return false;
  }

  void chrome.storage.session.set({
    [`pendingCapture:${sender.tab.id}`]: message.capture
  }).then(() => sendResponse(), () => sendResponse());
  return true;
});
