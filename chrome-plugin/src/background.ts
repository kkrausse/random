function configureExtension() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}

configureExtension();

chrome.runtime.onInstalled.addListener(configureExtension);

chrome.runtime.onStartup.addListener(configureExtension);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "open-reading-context" || !sender.tab?.id) {
    return false;
  }

  // Invoke open() before awaiting anything so Chrome retains the click's user gesture.
  const openPanel = chrome.sidePanel.open({ tabId: sender.tab.id });
  const saveCapture = chrome.storage.session.set({
    [`pendingCapture:${sender.tab.id}`]: message.capture
  });
  Promise.all([openPanel, saveCapture])
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
