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
  if (message?.type !== "open-reading-context" || !sender.tab?.id) {
    return false;
  }

  const tabId = sender.tab.id;
  const request = (async () => {
    try {
      if (message.directOpenError) {
        await recordDiagnostic("content-script-panel-open-error", {
          tabId,
          message: String(message.directOpenError)
        });
      }
      if (message.panelAlreadyOpen) {
        await chrome.storage.session.set({
          [`pendingCapture:${tabId}`]: message.capture
        });
        await recordDiagnostic("panel-opened-from-highlight", {
          tabId,
          route: "content-script"
        });
        return;
      }
      // This follows Chrome's sidePanel content-script sample exactly: open first,
      // then perform asynchronous work after the user-gesture-gated call succeeds.
      await chrome.sidePanel.open({ tabId });
      await chrome.storage.session.set({
        [`pendingCapture:${tabId}`]: message.capture
      });
      await recordDiagnostic("panel-opened-from-highlight", {
        tabId,
        route: "service-worker"
      });
    } catch (error) {
      const captureKey = `pendingCapture:${tabId}`;
      await chrome.storage.session.set({
        [captureKey]: message.capture
      });
      await recordDiagnostic("panel-open-error", {
        tabId,
        message: String(error?.message || error),
        browser: navigator.userAgent.slice(0, 200)
      });
      // An already-open panel consumes the capture even when Chrome rejects a
      // redundant open() call. Only show recovery UI if the capture is still pending.
      await new Promise((resolve) => setTimeout(resolve, 750));
      const pending = await chrome.storage.session.get(captureKey);
      if (!pending[captureKey]) return;
      chrome.tabs.sendMessage(tabId, { type: "reading-context-panel-open-error" })
        .catch(() => undefined);
    }
  })();
  void request.then(() => sendResponse(), () => sendResponse());
  return true;
});
