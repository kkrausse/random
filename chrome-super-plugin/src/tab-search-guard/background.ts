import { inEveryWebTab, setContentScript } from "../contentScripts";

const CONTENT_SCRIPT: chrome.scripting.RegisteredContentScript = {
  id: "tab-search-guard",
  matches: ["<all_urls>"],
  js: ["tab-search-guard.js"],
  runAt: "document_start",
  allFrames: true,
  // Also about:blank / srcdoc / blob frames, like match_about_blank did.
  matchOriginAsFallback: true,
  world: "MAIN",
  persistAcrossSessions: true
};

function inject(tabId: number) {
  return chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: "MAIN", files: ["tab-search-guard.js"] });
}

function tearDown(tabId: number) {
  return chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "MAIN",
    func: () => window.dispatchEvent(new Event("super-extension:tab-search-guard:teardown"))
  });
}

// The guard runs in the page's own world, so an older copy keeps working
// across extension reloads; injecting replaces it with the current build and
// covers tabs opened before the feature was switched on.
export async function applyTabSearchGuard(on: boolean, { inject: injectOpenTabs }: { inject: boolean }) {
  await setContentScript(CONTENT_SCRIPT, on).catch((error) => console.warn("tab-search-guard registration failed", error));
  if (!on) await inEveryWebTab(tearDown);
  else if (injectOpenTabs) await inEveryWebTab(inject);
}
